'use strict';

const express = require('express');
const { logger } = require('../utils/logger');

const router = express.Router();
const log = logger.forModule('exotelWebhook');

router.all('/incoming', (req, res) => {
  const serverUrl = process.env.SERVER_URL || `https://${req.get('host')}`;
  const wsUrl = serverUrl.replace(/^https?:\/\//, 'wss://') + '/media-stream';
  const callSid = req.query.CallSid || req.body.CallSid || 'unknown';

  log.info('Exotel incoming request', { method: req.method, sid: callSid });

  // Exotel Voicebot (GET) expects JSON. Exotel Passthru (POST) expects XML.
  if (req.method === 'GET') {
    return res.json({ url: wsUrl });
  }

  const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="callSid" value="${callSid}" />
            <Parameter name="provider" value="exotel" />
        </Stream>
    </Connect>
</Response>`;

  res.status(200).type('text/xml').send(response);
});

router.post('/status', (req, res) => {
  res.status(204).end();
});

module.exports = { router };
