"use strict";

const SYSTEM_PROMPT = `
You are "Saathi", a friendly, intelligent, and UNRESTRICTED AI assistant.
You are powered by Gemini 1.5, and you have access to the SUM of all human knowledge.
Answer any question the caller asks in a helpful, concise way.
Emergency helpline 108.
Consult a doctor.
We NEVER diagnose or prescribe.
ABSOLUTE SAFETY disclaimer.
You are helping a student, maybe for school. Class example real-world.
Ensure you are always providing accurate and reliable information for farmers, students, and anyone asking for help. Speak simply and clearly, keeping in mind that the user might be calling from a rural area.
Do not use highly complex technical jargon unless asked specifically to explain it.
Be patient, empathetic, and offer step-by-step guidance whenever you can.
If the caller is speaking Hindi, respond in Hindi. If they are speaking Bengali, respond in Bengali. Provide localized context.
`.trim();
const FIRST_MESSAGE = {
  default: "Hello! I am Saathi, your AI assistant. How can I help you today?",
  en: "Hello! I am Saathi, your AI assistant. How can I help you today?",
  hi: "Namaste! Main Saathi hoon. Main aapki kaise madad kar sakti hoon?",
  bn: "Nomoshkar! Ami Saathi. Ami apnake kibhabe sahajya korte pari?",
};

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const VOICE_CONFIG = {
  voiceId: process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
  stability: numberFromEnv("ELEVENLABS_VOICE_STABILITY", 0.6),
  similarityBoost: numberFromEnv("ELEVENLABS_VOICE_SIMILARITY_BOOST", 0.85),
  speed: numberFromEnv("ELEVENLABS_VOICE_SPEED", 0.95),
};

const LLM_CONFIG = {
  maxTokens: 1024,
  model: process.env.ELEVENLABS_LLM || "gemini-1.5-flash",
  temperature: numberFromEnv("ELEVENLABS_TEMPERATURE", 0.3),
};

const CONVERSATION_CONFIG = {
  asr: {
    quality: "high",
    provider: "elevenlabs",
    user_input_audio_format: "pcm_16000",
  },
  agent: {
    prompt: {
      prompt: SYSTEM_PROMPT,
      llm: LLM_CONFIG.model,
      temperature: LLM_CONFIG.temperature,
      max_tokens: LLM_CONFIG.maxTokens,
    },
    first_message: FIRST_MESSAGE.default,
    language: "en",
  },
  tts: {
    voice_id: VOICE_CONFIG.voiceId,
    model_id: "eleven_multilingual_v2", // Force high quality
    optimize_streaming_latency: 3, // Best balance for Railway
    agent_output_audio_format: "pcm_16000",
    stability: VOICE_CONFIG.stability,
    similarity_boost: VOICE_CONFIG.similarityBoost,
    speed: VOICE_CONFIG.speed,
  },
  conversation: {
    max_duration_seconds: 600,
    client_events: [
      "audio",
      "agent_response",
      "user_transcript",
      "interruption",
      "ping",
    ],
    turn_timeout_ms: 30000, // 30 seconds - give user time to respond after agent finishes
  },
};

module.exports = {
  SYSTEM_PROMPT,
  FIRST_MESSAGE,
  VOICE_CONFIG,
  LLM_CONFIG,
  getAgentCreationPayload: () => ({
    name: "DialAI - Saathi",
    conversation_config: CONVERSATION_CONFIG,
    platform_settings: { auth: { enable_auth: false } },
  }),
  buildCallOverride: ({ language, callSid }) => ({
    agent: {
      prompt: {
        prompt: SYSTEM_PROMPT,
      },
      first_message: FIRST_MESSAGE[language] || FIRST_MESSAGE.default,
      language: language,
    },
    tts: {
      voice_id: VOICE_CONFIG.voiceId,
    },
  }),
};
