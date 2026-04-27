#!/usr/bin/env node

/**
 * Test ElevenLabs API Key and Quota Status
 * 
 * Usage:
 *   node scripts/testAPIKey.js
 * 
 * This script checks:
 *   1. API key validity
 *   2. Subscription status
 *   3. Character quota remaining
 *   4. Voice availability
 *   5. Agent configuration
 */

const axios = require('axios');
require('dotenv').config();

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

const fmt = {
  ok: (msg) => `✅ ${msg}`,
  err: (msg) => `❌ ${msg}`,
  warn: (msg) => `⚠️  ${msg}`,
  info: (msg) => `ℹ️  ${msg}`,
};

async function testAPIKey() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║        ElevenLabs API Key & Quota Diagnostic Tool           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (!API_KEY) {
    console.error(fmt.err('ELEVENLABS_API_KEY not set in .env'));
    process.exit(1);
  }

  const apiClient = axios.create({
    baseURL: ELEVENLABS_API_BASE,
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 10000,
  });

  // Test 1: Check User Account
  try {
    console.log('🔍 Test 1: Checking user account...');
    const userRes = await apiClient.get('/user');
    const user = userRes.data;
    
    console.log(fmt.ok(`Account valid: ${user.email}`));
    console.log(`   Subscription: ${user.subscription?.tier || 'unknown'}`);
    console.log(`   Status: ${user.subscription?.status || 'unknown'}`);
  } catch (err) {
    console.error(fmt.err(`Failed to fetch user account: ${err.response?.data?.detail || err.message}`));
    process.exit(1);
  }

  // Test 2: Check Character Quota
  try {
    console.log('\n🔍 Test 2: Checking character quota...');
    const quotaRes = await apiClient.get('/user');
    const quota = quotaRes.data.subscription;
    
    const charLimit = quota?.character_limit || 0;
    const charUsed = quota?.character_used || 0;
    const charRemaining = charLimit - charUsed;
    const usage = charLimit > 0 ? ((charUsed / charLimit) * 100).toFixed(2) : 0;

    console.log(`   Monthly Limit: ${charLimit.toLocaleString()} characters`);
    console.log(`   Used: ${charUsed.toLocaleString()} characters`);
    console.log(`   Remaining: ${charRemaining.toLocaleString()} characters`);
    console.log(`   Usage: ${usage}%`);

    if (charRemaining < 1000) {
      console.error(fmt.warn(`⚠️  Low quota! Only ${charRemaining.toLocaleString()} chars remaining`));
    } else {
      console.log(fmt.ok(`Good quota available`));
    }
  } catch (err) {
    console.error(fmt.err(`Failed to check quota: ${err.message}`));
  }

  // Test 3: Test Conversational AI Agent
  try {
    console.log('\n🔍 Test 3: Testing Conversational AI availability...');
    const voicesRes = await apiClient.get('/voices');
    console.log(fmt.ok(`Voice library accessible: ${voicesRes.data.voices?.length || 0} voices available`));
  } catch (err) {
    console.error(fmt.err(`Failed to access voice library: ${err.message}`));
  }

  // Test 4: Check Agent Configuration
  if (AGENT_ID) {
    try {
      console.log('\n🔍 Test 4: Checking agent configuration...');
      const agentRes = await apiClient.get(`/convai/agents/${AGENT_ID}`);
      const agent = agentRes.data;
      
      console.log(fmt.ok(`Agent found: ${agent.name}`));
      console.log(`   ID: ${agent.agent_id}`);
      console.log(`   Model: ${agent.model || 'unknown'}`);
      console.log(`   Status: ${agent.status || 'active'}`);
    } catch (err) {
      if (err.response?.status === 404) {
        console.warn(fmt.warn(`Agent not found (ID: ${AGENT_ID}). Create new agent on first run.`));
      } else {
        console.error(fmt.err(`Failed to fetch agent: ${err.message}`));
      }
    }
  }

  // Test 5: Simulate Connection (create temporary WebSocket)
  try {
    console.log('\n🔍 Test 5: Testing WebSocket connectivity...');
    const WebSocket = require('ws');
    
    const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID || 'test'}`;
    
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: { 'xi-api-key': API_KEY },
      });

      const timeout = setTimeout(() => {
        ws.close();
        console.error(fmt.warn(`WebSocket timeout (expected during testing)`));
        resolve();
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log(fmt.ok(`WebSocket connection successful`));
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        if (err.message.includes('quota')) {
          console.error(fmt.err(`❗ QUOTA LIMIT EXCEEDED - Please check ElevenLabs billing`));
          console.error(`   Error: ${err.message}`);
        } else {
          console.error(fmt.err(`WebSocket error: ${err.message}`));
        }
        resolve();
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        if (code === 1002 && reason?.includes('quota')) {
          console.error(fmt.err(`❗ QUOTA LIMIT EXCEEDED (1002) - ${reason}`));
        }
        resolve();
      });
    });
  } catch (err) {
    console.error(fmt.err(`WebSocket test error: ${err.message}`));
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Test Complete                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

testAPIKey().catch(console.error);
