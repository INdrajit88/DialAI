const { getAgentCreationPayload } = require('../src/config/agentConfig');
const https = require('https');
require('dotenv').config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

function request(options) {
  return new Promise((resolve, reject) => {
    const { body, ...reqOptions } = options;
    reqOptions.hostname = reqOptions.hostname || 'api.elevenlabs.io';
    reqOptions.protocol = 'https:';
    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }
    req.end();
  });
}

async function main() {
  const payload = getAgentCreationPayload();
  console.log("Sending payload:", JSON.stringify(payload, null, 2));
  const res = await request({
    path: '/v1/convai/agents/create',
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(payload))
    },
    body: JSON.stringify(payload)
  });
  console.log("Status:", res.status);
  console.log("Response:", JSON.stringify(res.data, null, 2));
}

main().catch(console.error);
