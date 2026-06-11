// Central AI model registry — debt D6 (hardcoded Gemini models).
//
// WHY THIS FILE EXISTS
// --------------------
// Before centralization there were ~39 hardcoded Gemini model literals
// spread across ~16 files (server routes + src/services/gemini/* +
// *Backend.ts services). When Google deprecates a model SKU that meant
// touching 16 files. Now every call site imports a SEMANTIC constant
// keyed by USE CASE (not by model), and this file is the single place
// where use case → concrete model is decided.
//
// HOW TO MIGRATE TO A NEW MODEL
// -----------------------------
// 1. Without a deploy: set the matching env var (e.g.
//    `AI_MODEL_FAST=gemini-4-flash`) — every call site for that use
//    case switches immediately. Use this for emergency deprecations.
// 2. Permanently: change the default literal in GEMINI_MODEL_IDS /
//    the constant below, then add the new SKU's per-1M-token pricing to
//    GEMINI_PRICING_USD_PER_M_TOKENS in
//    `src/services/gemini/governance.ts` (unknown SKUs fall back to Pro
//    pricing — over-billing, never under-billing).
// 3. Keep this module PURE: no firebase / SDK imports. It is consumed
//    by both server routes (src/server/**) and services (src/services/**).
//
// CHOOSING A CONSTANT FOR A NEW CALL SITE
// ---------------------------------------
// AI_MODEL_CHAT          conversational / streaming ("El Guardián", SSE chat)
// AI_MODEL_REASONING     deep analysis & long structured generation (legal,
//                        emergency plans, DIAT, prediction)
// AI_MODEL_FAST          fast classification / extraction / short JSON
// AI_MODEL_FAST_STABLE   fast JSON on the stable (non-preview) flash SKU
// AI_MODEL_FAST_LONGFORM fast long-form Markdown reports
// AI_MODEL_LITE          lowest-latency calls under hard timeouts with a
//                        deterministic local fallback (wisdom capsule)
// AI_MODEL_VISION        image/multimodal ANALYSIS (safety images, posture)
// AI_MODEL_VISION_FAST   fast image analysis (quick EPP detection)
// AI_MODEL_IMAGE_GENERATION image OUTPUT (anatomical illustrations)
// AI_MODEL_TTS           text-to-speech (voice assistant replies)
// AI_MODEL_EMBEDDINGS    vector embeddings (RAG / semantic search)

/**
 * Raw model SKU literals. Exported separately because some consumers key
 * on the CONCRETE SKU rather than the use case — e.g. the pricing table in
 * `src/services/gemini/governance.ts` prices SKUs, not use cases.
 */
export const GEMINI_MODEL_IDS = {
  FLASH_15: 'gemini-1.5-flash',
  FLASH_20: 'gemini-2.0-flash',
  FLASH_25: 'gemini-2.5-flash',
  FLASH_TTS_25: 'gemini-2.5-flash-preview-tts',
  IMAGE_GEN_FLASH_20: 'gemini-2.0-flash-preview-image-generation',
  FLASH_3_PREVIEW: 'gemini-3-flash-preview',
  FLASH_31_PREVIEW: 'gemini-3.1-flash-preview',
  FLASH_IMAGE_31_PREVIEW: 'gemini-3.1-flash-image-preview',
  PRO_31_PREVIEW: 'gemini-3.1-pro-preview',
  TEXT_EMBEDDING_004: 'text-embedding-004',
} as const;

/**
 * Read an optional env override. Empty / whitespace-only values are
 * treated as unset so a stray `AI_MODEL_FAST=` line in an env file can
 * never silently route traffic to a model named "".
 */
const fromEnv = (name: string): string | undefined => {
  // `typeof process` guard keeps the module safe if it ever lands in a
  // browser bundle where `process` is not defined.
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

/** Conversational / streaming chat (ask-guardian, /api/gemini/stream). */
export const AI_MODEL_CHAT = fromEnv('AI_MODEL_CHAT') ?? GEMINI_MODEL_IDS.PRO_31_PREVIEW;

/** Deep analysis & long structured generation (legal, plans, prediction). */
export const AI_MODEL_REASONING = fromEnv('AI_MODEL_REASONING') ?? GEMINI_MODEL_IDS.PRO_31_PREVIEW;

/** Fast classification / extraction / short JSON answers (default workhorse). */
export const AI_MODEL_FAST = fromEnv('AI_MODEL_FAST') ?? GEMINI_MODEL_IDS.FLASH_3_PREVIEW;

/** Fast JSON on the stable (non-preview) flash SKU. */
export const AI_MODEL_FAST_STABLE = fromEnv('AI_MODEL_FAST_STABLE') ?? GEMINI_MODEL_IDS.FLASH_20;

/** Fast long-form Markdown report generation. */
export const AI_MODEL_FAST_LONGFORM =
  fromEnv('AI_MODEL_FAST_LONGFORM') ?? GEMINI_MODEL_IDS.FLASH_31_PREVIEW;

/** Lowest-latency tier: hard-timeout calls with a deterministic fallback. */
export const AI_MODEL_LITE = fromEnv('AI_MODEL_LITE') ?? GEMINI_MODEL_IDS.FLASH_15;

/** Image/multimodal ANALYSIS (safety photos, ergonomic posture). */
export const AI_MODEL_VISION = fromEnv('AI_MODEL_VISION') ?? GEMINI_MODEL_IDS.PRO_31_PREVIEW;

/** Fast image analysis (quick EPP detection). */
export const AI_MODEL_VISION_FAST =
  fromEnv('AI_MODEL_VISION_FAST') ?? GEMINI_MODEL_IDS.FLASH_IMAGE_31_PREVIEW;

/** Image GENERATION output (e.g. anatomical illustration for DIAT docs). */
export const AI_MODEL_IMAGE_GENERATION =
  fromEnv('AI_MODEL_IMAGE_GENERATION') ?? GEMINI_MODEL_IDS.IMAGE_GEN_FLASH_20;

/** Text-to-speech (voice assistant audio replies). */
export const AI_MODEL_TTS = fromEnv('AI_MODEL_TTS') ?? GEMINI_MODEL_IDS.FLASH_TTS_25;

/** Vector embeddings for RAG / semantic search. */
export const AI_MODEL_EMBEDDINGS =
  fromEnv('AI_MODEL_EMBEDDINGS') ?? GEMINI_MODEL_IDS.TEXT_EMBEDDING_004;
