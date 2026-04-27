'use strict';

const express = require('express');
const { logger } = require('../utils/logger');

const router = express.Router();
const log = logger.forModule('exotelWebhook');

router.get('/incoming', (req, res) => {
  const host = req.headers.host;
  const wsUrl = `wss://${host}:443/media-stream`;
  
  log.info('Exotel Voicebot Request Received', { 
    sid: req.query.CallSid, 
    returningUrl: wsUrl 
  });
  
  // Explicitly set content type to application/json
  res.header('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ url: wsUrl }));
});

router.post('/incoming', (req, res) => {
  const host = req.headers.host;
  const wsUrl = `wss://${host}:443/media-stream`;
  const callSid = req.body.CallSid || 'unknown';

  log.info('Exotel Passthru Request Received', { sid: callSid });

  const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect><Stream url="${wsUrl}"><Parameter name="callSid" value="${callSid}" /></Stream></Connect>
</Response>`;

  res.status(200).type('text/xml').send(response);
});

router.post('/status', (req, res) => res.status(204).end());

module.exports = { router };
