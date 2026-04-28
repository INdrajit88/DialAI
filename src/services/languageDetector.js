"use strict";

/**
 * languageDetector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight language detector for DialAI.
 */

function detectLanguage(text, options = {}) {
  const defaultLang = process.env.DEFAULT_LANGUAGE || "en";
  if (!text) {
    return options.verbose
      ? { lang: defaultLang, confidence: 1, method: "default" }
      : defaultLang;
  }

  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  const bengaliCount = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const total = text.length;

  if (devanagariCount / total > 0.1) {
    return options.verbose
      ? { lang: "hi", confidence: devanagariCount / total, method: "script" }
      : "hi";
  }
  if (bengaliCount / total > 0.1) {
    return options.verbose
      ? { lang: "bn", confidence: bengaliCount / total, method: "script" }
      : "bn";
  }

  const lower = text.toLowerCase();
  const words = lower.split(/\W+/).filter((w) => w.length > 0);

  const hiKeywords = [
    "kya",
    "hai",
    "kaise",
    "ka",
    "ki",
    "ke",
    "liye",
    "karna",
    "chahiye",
    "bukhar",
    "mein",
    "bataiye",
    "yojana",
    "fasal",
    "barish",
    "hoga",
    "mandi",
    "bhav",
    "aaj",
    "kal",
    "mujhe",
    "bacho",
    "ko",
    "aaya",
    "samjhao",
  ];
  const bnKeywords = [
    "ki",
    "korbo",
    "hobe",
    "ami",
    "kemon",
    "ache",
    "bolun",
    "daktar",
    "ke",
    "bolbo",
    "aj",
    "bristi",
    "jor",
    "ba",
    "kashi",
    "hole",
  ];

  let hiCount = 0;
  let bnCount = 0;
  for (const word of words) {
    if (hiKeywords.includes(word)) hiCount++;
    if (bnKeywords.includes(word)) bnCount++;
  }

  if (bnCount > 0 && bnCount > hiCount) {
    return options.verbose
      ? { lang: "bn", confidence: bnCount / words.length, method: "keyword" }
      : "bn";
  }
  if (hiCount > 0 && hiCount >= bnCount) {
    return options.verbose
      ? { lang: "hi", confidence: hiCount / words.length, method: "keyword" }
      : "hi";
  }

  return options.verbose
    ? { lang: "en", confidence: 1, method: "fallback" }
    : "en";
}

module.exports = { detectLanguage };
