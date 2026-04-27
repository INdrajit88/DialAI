'use strict';

const express = require('express');
const { callHandler } = require('../services/callHandler');
const { logger } = require('../utils/logger');

const router = express.Router();
const log = logger.forModule('exotelWebhook');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendExoML(res, xml) {
  res.status(200).type('text/xml').send(xml);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.use((req, res, next) => {
  log.info(`Exotel ${req.method} ${req.path}`, { sid: req.query.CallSid || req.body.CallSid });
  next();
});

/**
 * GET & POST /exotel/incoming
 * Exotel's Voicebot/Passthru applet calls this.
 * We MUST return <Connect><Stream/></Connect> to trigger the WebSocket.
 */
router.all('/incoming', (req, res) => {
  const serverUrl = process.env.SERVER_URL || `https://${req.get('host')}`;
  const wsUrl = serverUrl.replace(/^https?:\/\//, 'wss://') + '/media-stream';
  const callSid = req.query.CallSid || req.body.CallSid || 'unknown';

  log.info('Bridging call to WebSocket', { callSid, wsUrl });

  // This is the standard ExoML/TwiML format to start a media stream
  const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="callSid" value="${callSid}" />
            <Parameter name="provider" value="exotel" />
        </Stream>
    </Connect>
</Response>`;

  sendExoML(res, response);
});

router.post('/status', (req, res) => {
  const payload = req.body;
  callHandler.handleStatusUpdate({
    CallSid: payload.CallSid,
    CallStatus: payload.Status || payload.CallStatus,
    CallDuration: payload.CallDuration || payload.Duration,
  });
  res.status(204).end();
});

module.exports = { router };
