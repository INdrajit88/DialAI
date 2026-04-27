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

function buildErrorExoML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="en-US">I am sorry, but there is a technical issue. Please call back later.</Say>
  <Hangup/>
</Response>`.trim();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Log every single request to /exotel/* for debugging
router.use((req, res, next) => {
  log.info(`Incoming ${req.method} request to ${req.path}`, { 
    query: req.query, 
    body: req.body,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });
  next();
});

/**
 * GET /exotel/incoming
 * Used by Exotel's "Voicebot" applet to get the WebSocket URL.
 */
router.get('/incoming', (req, res) => {
  const serverUrl = process.env.SERVER_URL || `https://${req.get('host')}`;
  const wsUrl = serverUrl.replace(/^https?:\/\//, 'wss://') + '/media-stream';
  
  // Exotel needs a JSON response with the 'url' field for Voicebot applets
  res.json({ url: wsUrl });
});

/**
 * POST /exotel/incoming
 * Used by Exotel's "Passthru" applet to bridge the call.
 */
router.post('/incoming', (req, res) => {
  const callSid = req.body.CallSid || req.query.CallSid;
  
  if (!callSid) {
    log.error('Missing CallSid in request');
    return sendExoML(res, buildErrorExoML());
  }

  try {
    const { twiml } = callHandler.handleIncoming({
      CallSid: callSid,
      From: req.body.From || req.query.From,
      To: req.body.To || req.query.To,
    });

    sendExoML(res, twiml);
  } catch (err) {
    log.error('Call Handler Error', { err: err.message });
    sendExoML(res, buildErrorExoML());
  }
});

/**
 * POST /exotel/status
 * Captures call end/duration events.
 */
router.post('/status', (req, res) => {
  const payload = req.body;
  log.info('Exotel Status Update', { status: payload.Status, sid: payload.CallSid });
  
  callHandler.handleStatusUpdate({
    CallSid: payload.CallSid,
    CallStatus: payload.Status || payload.CallStatus,
    CallDuration: payload.CallDuration || payload.Duration,
  });

  res.status(204).end();
});

module.exports = { router };
