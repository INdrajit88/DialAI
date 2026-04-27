'use strict';

const WebSocket = require('ws');
const { logger, runWithCallContext } = require('../utils/logger');
const {
  mulawToLinear16,
  base64PCMToBase64Mulaw,
} = require('../utils/audioConverter');
const { createSession }  = require('./elevenLabsAgentService');

const log = logger.forModule('audioStreamBridge');

const ipConnections = new Map();

class BridgeSession {
  constructor(twilioWs) {
    this.twilioWs   = twilioWs;
    this.streamSid  = null;
    this.elSession  = null;
    this.isStarted     = false;
    this._outboundQueue = [];
    this._outboundTimer = null;
    this._outboundTimestampMs = 0;
  }

  async onStart(startPayload) {
    this.streamSid = startPayload.streamSid || startPayload.stream_sid;
    this.isStarted = true;
    log.info('Media stream started', { sid: this.streamSid });
    
    // Immediately send a small silence packet to "ping" the telephony hardware
    this._sendSilence();
    
    await runWithCallContext({ callSid: this.streamSid }, () => this._connectElevenLabs());
  }

  _sendSilence() {
    if (this.twilioWs.readyState === WebSocket.OPEN) {
      this.twilioWs.send(JSON.stringify({
        event: 'media',
        stream_sid: this.streamSid,
        media: { payload: 'f/f/f/8=', chunk: '1', timestamp: '0' }
      }));
    }
  }

  onMedia(mediaPayload) {
    if (!this.isStarted || !this.elSession || !mediaPayload.payload) return;
    const mulawBuf = Buffer.from(mediaPayload.payload, 'base64');
    const pcmBuf = mulawToLinear16(mulawBuf);
    this.elSession.sendAudio(pcmBuf.toString('base64'));
  }

  async _connectElevenLabs() {
    try {
      this.elSession = await createSession({ callSid: this.streamSid });
      this.elSession.on('audio', (base64PCM, _id, sampleRate) => {
        const fullOutbound = base64PCMToBase64Mulaw(base64PCM, sampleRate);
        if (!fullOutbound) return;
        const buf = Buffer.from(fullOutbound, 'base64');
        // Slice into 40ms chunks (320 bytes) for better stability on Railway
        for (let i = 0; i < buf.length; i += 320) {
          this._outboundQueue.push(buf.slice(i, i + 320).toString('base64'));
        }
      });
      this.elSession.on('close', () => this.destroy('el-closed'));
      this._startDrain();
    } catch (err) { log.error('EL Connect Error', { err: err.message }); }
  }

  _startDrain() {
    this._outboundTimer = setInterval(() => {
      const payload = this._outboundQueue.shift();
      if (payload && this.twilioWs.readyState === WebSocket.OPEN) {
        this.twilioWs.send(JSON.stringify({
          event: 'media',
          stream_sid: this.streamSid,
          media: { payload, timestamp: String(this._outboundTimestampMs) }
        }));
        this._outboundTimestampMs += 40;
      }
    }, 40);
  }

  destroy(reason) {
    clearInterval(this._outboundTimer);
    if (this.elSession) this.elSession.close();
    if (this.twilioWs) this.twilioWs.close();
    log.info('Session destroyed', { reason });
  }
}

function createBridge(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/media-stream' });
  wss.on('connection', (ws) => {
    const session = new BridgeSession(ws);
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.event === 'start') await session.onStart(msg.start);
        else if (msg.event === 'media') session.onMedia(msg.media);
        else if (msg.event === 'stop') session.destroy('stop');
      } catch (e) {}
    });
    ws.on('close', () => session.destroy('ws-closed'));
  });
  return wss;
}

module.exports = { createBridge, getBridgeStats: () => ({}) };
