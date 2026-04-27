"use strict";

/**
 * elevenLabsAgentService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages all interactions with ElevenLabs Conversational AI for DialAI.
 */

const WebSocket = require("ws");
const axios = require("axios");
const EventEmitter = require("events");

const { logger } = require("../utils/logger");
const {
  buildCallOverride,
  getAgentCreationPayload,
} = require("../config/agentConfig");
const cache = require("../utils/cache");
const { detectLanguage } = require("./languageDetector");

const log = logger.forModule("elevenLabsAgentService");

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const ELEVENLABS_WS_BASE = "wss://api.elevenlabs.io/v1/convai/conversation";
const RECONNECT_ATTEMPTS = 1;
const RECONNECT_DELAY_MS = 1000;
const PING_TIMEOUT_MS = 10000;
const MAX_AUDIO_QUEUE = 200;

function makeApiClient() {
  return axios.create({
    baseURL: ELEVENLABS_API_BASE,
    timeout: 15000,
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

const apiClient = makeApiClient();

async function getAgent(agentId) {
  const res = await apiClient.get(`/convai/agents/${agentId}`);
  return res.data;
}

async function createAgent() {
  log.info('Creating ElevenLabs "Nova" agent …');
  try {
    const listRes = await apiClient.get("/convai/agents", { params: { page_size: 100 } });
    const agents = listRes.data?.agents ?? [];
    const existing = agents.find((a) => a.name.includes("Nova"));
    if (existing) {
      log.info(`Reusing existing agent: ${existing.agent_id}`);
      return existing.agent_id;
    }
  } catch (err) {
    log.warn("Could not list existing agents");
  }

  const payload = getAgentCreationPayload();
  const res = await apiClient.post("/convai/agents/create", payload);
  return res.data?.agent_id;
}

async function ensureAgent() {
  if (process.env.ELEVENLABS_AGENT_ID) return process.env.ELEVENLABS_AGENT_ID;
  const agentId = await createAgent();
  process.env.ELEVENLABS_AGENT_ID = agentId;
  return agentId;
}

async function updateAgent(agentId, patchPayload) {
  const res = await apiClient.patch(`/convai/agents/${agentId}`, patchPayload);
  return res.data;
}

class ElevenLabsSession extends EventEmitter {
  constructor({ agentId, callSid, callerNumber, language = "en" }) {
    super();
    this.agentId = agentId;
    this.callSid = callSid;
    this.callerNumber = callerNumber;
    this.language = language;
    this.ws = null;
    this._audioQueue = [];
    this._isClosed = false;
    this._reconnectLeft = RECONNECT_ATTEMPTS;
    this._transcriptBuffer = "";
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${ELEVENLABS_WS_BASE}?agent_id=${encodeURIComponent(this.agentId)}`;
      this.ws = new WebSocket(url, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });

      this.ws.on("open", () => {
        const override = buildCallOverride({ language: this.language, callSid: this.callSid });
        const initPayload = { type: "conversation_initiation_client_data" };
        if (override && Object.keys(override).length > 0) initPayload.conversation_config_override = override;
        this._sendJSON(initPayload);
      });

      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "conversation_initiation_metadata") {
          this.conversationId = msg.conversation_initiation_metadata_event?.conversation_id;
          this.emit("metadata", this.conversationId);
          resolve();
        } else if (msg.type === "audio") {
          this.emit("audio", msg.audio_event?.audio_base_64, msg.audio_event?.event_id, 16000);
        } else if (msg.type === "user_transcript") {
          const text = msg.user_transcription_event?.user_transcript;
          if (text) {
            this._transcriptBuffer += " " + text;
            const detectedLang = detectLanguage(this._transcriptBuffer.trim());
            if (detectedLang !== this.language) this.language = detectedLang;
            this.emit("transcript", text, this.language);
          }
        }
      });

      this.ws.on("close", () => {
        if (!this._isClosed) this.emit("close");
      });

      this.ws.on("error", (err) => reject(err));
    });
  }

  sendAudio(base64PCM) {
    if (this.ws?.readyState === WebSocket.OPEN) this._sendJSON({ user_audio_chunk: base64PCM });
  }

  _sendJSON(payload) {
    try { this.ws.send(JSON.stringify(payload)); } catch (err) { log.error("WS Send failed", err); }
  }

  close() {
    this._isClosed = true;
    if (this.ws) this.ws.close();
  }
}

async function createSession(options = {}) {
  const agentId = await ensureAgent();
  const session = new ElevenLabsSession({ agentId, ...options });
  await session.connect();
  return session;
}

module.exports = { createSession, ensureAgent, createAgent, getAgent, updateAgent };
