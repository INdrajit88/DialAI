'use strict';

const WebSocket = require('ws');
const { logger, runWithCallContext } = require('../utils/logger');
const { mulawToLinear16, base64PCMToBase64Mulaw } = require('../utils/audioConverter');
const { createSession }  = require('./elevenLabsAgentService');

const log = logger.forModule('audioStreamBridge');

class BridgeSession {
  constructor(ws) {
    this.ws = ws;
    this.sid = null;
    this.el = null;
    this.queue = [];
    this.timer = null;
    this.ts = 0;
  }

  async start(data) {
    try {
      this.sid = data.streamSid || data.stream_sid || 'unknown';
      log.info('Media Stream Started', { sid: this.sid });
      
      await runWithCallContext({ callSid: this.sid }, async () => {
        log.info('Connecting to ElevenLabs...');
        this.el = await createSession({ callSid: this.sid });
        log.info('ElevenLabs Session Ready');

        this.el.on('audio', (pcm, id, rate) => {
          const mulaw = base64PCMToBase64Mulaw(pcm, rate);
          if (!mulaw) return;
          const buf = Buffer.from(mulaw, 'base64');
          for (let i = 0; i < buf.length; i += 160) {
            this.queue.push(buf.slice(i, i + 160).toString('base64'));
          }
        });

        this.el.on('close', () => this.stop('elevenlabs-closed'));
        this.el.on('error', (err) => log.error('ElevenLabs Error', { err: err.message }));
        
        this._drain();
      });
    } catch (err) {
      log.error('BridgeSession Start Error', { err: err.message });
      this.stop('start-error');
    }
  }

  _drain() {
    this.timer = setInterval(() => {
      try {
        const payload = this.queue.shift();
        if (payload && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            event: 'media',
            stream_sid: this.sid,
            media: { payload, timestamp: String(this.ts) }
          }));
          this.ts += 20;
        }
      } catch (err) { }
    }, 20);
  }

  stop(reason) {
    clearInterval(this.timer);
    if (this.el) { this.el.close(); this.el = null; }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.close(); }
    log.info('Stream Stopped', { reason, sid: this.sid });
  }
}

function createBridge(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/media-stream' });
  
  wss.on('connection', (ws, req) => {
    log.info('EXOTEL CONNECTED TO WEBSOCKET', { 
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      url: req.url 
    });
    
    const session = new BridgeSession(ws);

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Handle 'connected' event which some providers send before 'start'
        if (msg.event === 'connected') {
          log.info('Exotel Handshake: Connected');
          return;
        }
        
        if (msg.event === 'start') {
          await session.start(msg.start);
        } else if (msg.event === 'media') {
          if (session.el && msg.media && msg.media.payload) {
            const pcm = mulawToLinear16(Buffer.from(msg.media.payload, 'base64'));
            session.el.sendAudio(pcm.toString('base64'));
          }
        } else if (msg.event === 'stop') {
          session.stop('telephony-stop');
        }
      } catch (err) {
        log.error('WS Processing Error', { err: err.message });
      }
    });

    ws.on('close', () => session.stop('ws-closed'));
    ws.on('error', (err) => log.error('WS Error', { err: err.message }));
  });

  return wss;
}

module.exports = { createBridge, getBridgeStats: () => ({}) };
