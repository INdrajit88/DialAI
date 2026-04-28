'use strict';

const WebSocket = require('ws');
const { logger, runWithCallContext } = require('../utils/logger');
const {
  base64PCM8kToBase64PCM16k,
  base64PCM16kToBase64PCM8k,
  base64PCM24kToBase64PCM16k,
  computeRMS,
  normaliseVolume,
} = require('../utils/audioConverter');
const { createSession }  = require('./elevenLabsAgentService');
const { callHandler }    = require('./callHandler');
const cache              = require('../utils/cache');

const log = logger.forModule('audioStreamBridge');

const AUDIO_FLUSH_INTERVAL_MS = 100;
const MAX_WS_PER_IP           = 5;
const MAX_CONCURRENT_CALLS    = 50;
const SPEECH_DETECTION_THRESHOLD = 250;
const EXOTEL_FRAME_MS = 100;
const EXOTEL_PCM16_8K_FRAME_BYTES = 1600; // 100 ms * 8000 samples/s * 2 bytes/sample

const ipConnections = new Map();

function incrementIpCount(ip) {
  const count = (ipConnections.get(ip) || 0) + 1;
  ipConnections.set(ip, count);
  return count;
}

function decrementIpCount(ip) {
  const count = Math.max(0, (ipConnections.get(ip) || 0) - 1);
  if (count === 0) ipConnections.delete(ip);
  else ipConnections.set(ip, count);
}

class BridgeSession {
  constructor(twilioWs, clientIp, provider = 'exotel', mediaSampleRate = 8000) {
    this.twilioWs   = twilioWs;
    this.clientIp   = clientIp;
    this.provider   = provider;
    this.mediaSampleRate = mediaSampleRate;
    this.streamSid  = null;
    this.callSid    = null;
    this.callerNum  = null;
    this.elSession  = null;
    this.isStarted     = false;
    this.isStopped     = false;
    this.isELConnected = false;
    this.language   = process.env.DEFAULT_LANGUAGE || 'hi';
    this._audioAccumulator  = [];
    this._accumulatorBytes  = 0;
    this._flushTimer        = null;
    this._outboundQueue     = [];
    this._outboundTimer     = null;
    this._inboundFrames     = 0;
    this._speechFrames      = 0;
    this._agentSpeaking     = false;
    this._log = logger.forModule('BridgeSession');
    this._outboundSequence = 1;
    this._outboundChunk = 1;
    this._outboundTimestampMs = 0;
    this._lastInboundSequence = 0;
  }

  async onTwilioStart(startPayload) {
    const customParameters = startPayload.customParameters || startPayload.custom_parameters || {};
    this.streamSid  = startPayload.streamSid || startPayload.stream_sid;
    this.callSid    = startPayload.callSid || startPayload.call_sid;
    this.callerNum  = customParameters.callerNumber || customParameters.caller_number || startPayload.from || null;
    this.provider   = 'exotel';
    this.mediaSampleRate = 8000;
    this.isStarted  = true;

    this._log.info('Media stream started', { callSid: this.callSid, provider: this.provider });
    await runWithCallContext({ callSid: this.callSid }, () => this._connectElevenLabs());
  }

  onTwilioMedia(mediaPayload) {
    if (this.isStopped || !this.isStarted) return;
    const base64Audio = mediaPayload.payload;
    if (base64Audio) this._accumulateAudio(base64Audio);
  }

  onTwilioStop() {
    this.destroy('telephony-stop');
  }

  noteInboundSequence(seq) {
    const parsed = parseInt(seq, 10);
    if (parsed > this._lastInboundSequence) this._lastInboundSequence = parsed;
  }

  destroy(reason = 'unknown') {
    if (this.isStopped) return;
    this.isStopped = true;
    clearTimeout(this._flushTimer);
    clearInterval(this._outboundTimer);
    if (this.elSession) this.elSession.close();
    if (this.twilioWs) this.twilioWs.close();
    if (this.clientIp) decrementIpCount(this.clientIp);
    this._log.info('Bridge session destroyed', { callSid: this.callSid, reason });
  }

  async _connectElevenLabs() {
    try {
      this.elSession = await createSession({ callSid: this.callSid, callerNumber: this.callerNum, language: this.language });
      this.isELConnected = true;
      this.elSession.on('audio', (base64PCM, _id, sampleRate) => this._onElevenLabsAudio(base64PCM, sampleRate));
      this.elSession.on('close', () => this.destroy('elevenlabs-closed'));
      this._startOutboundDrain();
    } catch (err) {
      this._log.error('Failed to connect ElevenLabs', { err: err.message });
      this.destroy('elevenlabs-failed');
    }
  }

  _accumulateAudio(base64Audio) {
    const inboundPcm8k = Buffer.from(base64Audio, 'base64');
    if (inboundPcm8k.length === 0) return;

    if (this._inboundFrames < 5) {
      this._log.debug('Exotel inbound audio frame', {
        callSid: this.callSid,
        bytes: inboundPcm8k.length,
        rms: Math.round(computeRMS(inboundPcm8k)),
        encoding: 'pcm_s16le_8000',
      });
    }

    const base64PCM = base64PCM8kToBase64PCM16k(base64Audio);
    if (!base64PCM) return;
    const pcmBuf = Buffer.from(base64PCM, 'base64');
    const normalised = normaliseVolume(pcmBuf, 3000);
    this._audioAccumulator.push(normalised);
    this._accumulatorBytes += normalised.length;
    this._inboundFrames++;
    // Flush more frequently to reduce latency and buffering
    if (this._accumulatorBytes >= 3200) this._flushAudioToElevenLabs();
    else if (!this._flushTimer) this._flushTimer = setTimeout(() => this._flushAudioToElevenLabs(), AUDIO_FLUSH_INTERVAL_MS);
  }

  _flushAudioToElevenLabs() {
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    if (this._audioAccumulator.length === 0 || !this.isELConnected) return;
    const combined = Buffer.concat(this._audioAccumulator);
    this.elSession.sendAudio(combined.toString('base64'));
    this._audioAccumulator = [];
    this._accumulatorBytes = 0;
  }

  _onElevenLabsAudio(base64PCM, sampleRate) {
    let pcm16kBase64 = base64PCM;
    if (sampleRate === 24000) {
      pcm16kBase64 = base64PCM24kToBase64PCM16k(base64PCM);
    } else if (sampleRate !== 16000) {
      this._log.warn('Unexpected ElevenLabs output sample rate for Exotel bridge', {
        callSid: this.callSid,
        sampleRate,
      });
    }

    const outboundBase64 = base64PCM16kToBase64PCM8k(pcm16kBase64);
    if (!outboundBase64) return;

    const outboundPcm8k = Buffer.from(outboundBase64, 'base64');
    for (let offset = 0; offset < outboundPcm8k.length; offset += EXOTEL_PCM16_8K_FRAME_BYTES) {
      const frame = outboundPcm8k.subarray(offset, offset + EXOTEL_PCM16_8K_FRAME_BYTES);
      this._outboundQueue.push(frame.toString('base64'));
    }
  }

  _startOutboundDrain() {
    this._outboundTimer = setInterval(() => {
      if (this.twilioWs.readyState === WebSocket.OPEN && this._outboundQueue.length > 0) {
        const payload = this._outboundQueue.shift();
        if (payload) {
          this.twilioWs.send(JSON.stringify({
            event: 'media',
            stream_sid: this.streamSid,
            media: { payload, chunk: String(this._outboundChunk++), timestamp: String(this._outboundTimestampMs) }
          }));
          this._outboundTimestampMs += EXOTEL_FRAME_MS;
        }
      }
    }, EXOTEL_FRAME_MS);
  }
}

function createBridge(httpServer, { path = '/media-stream' } = {}) {
  const wss = new WebSocket.Server({ server: httpServer, path });
  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    if (incrementIpCount(clientIp) > MAX_WS_PER_IP) {
       decrementIpCount(clientIp);
       return ws.close();
    }
    const session = new BridgeSession(ws, clientIp);
    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === 'start') await session.onTwilioStart(msg.start);
      else if (msg.event === 'media') session.onTwilioMedia(msg.media);
      else if (msg.event === 'stop') session.onTwilioStop();
    });
    ws.on('close', () => session.destroy('ws-closed'));
  });
  return wss;
}

module.exports = { createBridge, getBridgeStats: () => ({}), BridgeSession };
