// Tests for src/config/aiModels.ts — central AI model registry (debt D6).
//
// Contract under test:
//   1. Every use-case constant defaults to the EXACT model id that the
//      call sites used before centralization (no behavior change).
//   2. Each constant is overridable via its same-named env var.
//   3. Empty / whitespace-only env values are ignored (default wins).
//   4. GEMINI_MODEL_IDS exposes the raw SKU literals (used as pricing
//      table keys in src/services/gemini/governance.ts).
//
// The module reads process.env at import time, so override tests use
// vi.stubEnv + vi.resetModules + dynamic import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALL_ENV_VARS = [
  'AI_MODEL_CHAT',
  'AI_MODEL_REASONING',
  'AI_MODEL_FAST',
  'AI_MODEL_FAST_STABLE',
  'AI_MODEL_FAST_LONGFORM',
  'AI_MODEL_LITE',
  'AI_MODEL_VISION',
  'AI_MODEL_VISION_FAST',
  'AI_MODEL_IMAGE_GENERATION',
  'AI_MODEL_TTS',
  'AI_MODEL_EMBEDDINGS',
] as const;

async function freshImport() {
  vi.resetModules();
  return import('./aiModels');
}

beforeEach(() => {
  // Guarantee a clean slate: no AI_MODEL_* leaking from the host env.
  for (const name of ALL_ENV_VARS) vi.stubEnv(name, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('aiModels defaults (exact pre-centralization model ids)', () => {
  it('preserves the historical model id per use case', async () => {
    const m = await freshImport();
    expect(m.AI_MODEL_CHAT).toBe('gemini-3.1-pro-preview');
    expect(m.AI_MODEL_REASONING).toBe('gemini-3.1-pro-preview');
    expect(m.AI_MODEL_FAST).toBe('gemini-3-flash-preview');
    expect(m.AI_MODEL_FAST_STABLE).toBe('gemini-2.0-flash');
    expect(m.AI_MODEL_FAST_LONGFORM).toBe('gemini-3.1-flash-preview');
    expect(m.AI_MODEL_LITE).toBe('gemini-1.5-flash');
    expect(m.AI_MODEL_VISION).toBe('gemini-3.1-pro-preview');
    expect(m.AI_MODEL_VISION_FAST).toBe('gemini-3.1-flash-image-preview');
    expect(m.AI_MODEL_IMAGE_GENERATION).toBe('gemini-2.0-flash-preview-image-generation');
    expect(m.AI_MODEL_TTS).toBe('gemini-2.5-flash-preview-tts');
    expect(m.AI_MODEL_EMBEDDINGS).toBe('text-embedding-004');
  });

  it('exposes raw SKU literals via GEMINI_MODEL_IDS for pricing keys', async () => {
    const m = await freshImport();
    expect(m.GEMINI_MODEL_IDS.FLASH_20).toBe('gemini-2.0-flash');
    expect(m.GEMINI_MODEL_IDS.FLASH_25).toBe('gemini-2.5-flash');
    expect(m.GEMINI_MODEL_IDS.FLASH_31_PREVIEW).toBe('gemini-3.1-flash-preview');
    expect(m.GEMINI_MODEL_IDS.PRO_31_PREVIEW).toBe('gemini-3.1-pro-preview');
  });
});

describe('aiModels env overrides', () => {
  it.each(ALL_ENV_VARS)('%s overrides its constant', async (envVar) => {
    vi.stubEnv(envVar, 'models/custom-override');
    const m = await freshImport();
    expect((m as Record<string, unknown>)[envVar]).toBe('models/custom-override');
  });

  it('an override on one constant does not bleed into the others', async () => {
    vi.stubEnv('AI_MODEL_CHAT', 'gemini-99-pro');
    const m = await freshImport();
    expect(m.AI_MODEL_CHAT).toBe('gemini-99-pro');
    expect(m.AI_MODEL_REASONING).toBe('gemini-3.1-pro-preview');
    expect(m.AI_MODEL_FAST).toBe('gemini-3-flash-preview');
  });

  it('ignores whitespace-only env values (default wins)', async () => {
    vi.stubEnv('AI_MODEL_FAST', '   ');
    const m = await freshImport();
    expect(m.AI_MODEL_FAST).toBe('gemini-3-flash-preview');
  });

  it('trims surrounding whitespace from env values', async () => {
    vi.stubEnv('AI_MODEL_TTS', '  gemini-tts-next  ');
    const m = await freshImport();
    expect(m.AI_MODEL_TTS).toBe('gemini-tts-next');
  });
});
