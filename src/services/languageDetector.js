"use strict";

/**
 * languageDetector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight language detector for DialAI.
 */

function detectLanguage(text) {
  if (!text) return process.env.DEFAULT_LANGUAGE || "en";
  
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  const bengaliCount = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const total = text.length;

  if (devanagariCount / total > 0.1) return "hi";
  if (bengaliCount / total > 0.1) return "bn";
  
  return "en";
}

module.exports = { detectLanguage };
