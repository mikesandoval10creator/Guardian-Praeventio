import { describe, it, expect } from 'vitest';

import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  getDefaultModel,
  getModelById,
} from './registry';

/**
 * Tests for the static SLM model registry (Fase 1 T-1.1).
 *
 * These tests pin the shape of the registry rather than its exact URLs —
 * the URLs may shift while the loader (T-1.2) is still in flight, but the
 * count, schema, default-id, and per-model size envelopes should remain
 * stable.
 */

const MB = 1024 * 1024;

describe('SLM model registry', () => {
  it('exposes exactly three candidate models', () => {
    expect(MODEL_REGISTRY).toHaveLength(3);
  });

  it('every entry has the canonical descriptor shape', () => {
    for (const m of MODEL_REGISTRY) {
      expect(typeof m.id).toBe('string');
      expect(m.id.length).toBeGreaterThan(0);

      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);

      expect(typeof m.size).toBe('number');
      expect(m.size).toBeGreaterThan(0);

      expect(typeof m.url).toBe('string');
      expect(m.url.startsWith('https://')).toBe(true);

      expect(typeof m.license).toBe('string');
      expect(m.license.length).toBeGreaterThan(0);

      // Pinned for Fase 1.
      expect(m.format).toBe('onnx-int4');
      expect(m.quantization).toBe('int4');
      expect(['webgpu', 'wasm-simd']).toContain(m.preferredBackend);
    }
  });

  it('all model ids are unique', () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("default model is 'phi-3-mini'", () => {
    expect(DEFAULT_MODEL_ID).toBe('phi-3-mini');
    const def = getDefaultModel();
    expect(def.id).toBe('phi-3-mini');
  });

  it('Phi-3 Mini size is in the expected 1500-2200 MB envelope', () => {
    const phi = getModelById('phi-3-mini');
    expect(phi).toBeDefined();
    const sizeMb = (phi as { size: number }).size / MB;
    expect(sizeMb).toBeGreaterThanOrEqual(1500);
    expect(sizeMb).toBeLessThanOrEqual(2200);
  });

  it('Qwen 2.5 0.5B size is in the expected 200-350 MB envelope', () => {
    const qwen = getModelById('qwen-2.5-0.5b');
    expect(qwen).toBeDefined();
    const sizeMb = (qwen as { size: number }).size / MB;
    expect(sizeMb).toBeGreaterThanOrEqual(200);
    expect(sizeMb).toBeLessThanOrEqual(350);
  });

  it('Gemma 2 2B size is in the expected 1200-1700 MB envelope', () => {
    const gemma = getModelById('gemma-2-2b');
    expect(gemma).toBeDefined();
    const sizeMb = (gemma as { size: number }).size / MB;
    expect(sizeMb).toBeGreaterThanOrEqual(1200);
    expect(sizeMb).toBeLessThanOrEqual(1700);
  });

  it('getModelById returns undefined for unknown ids', () => {
    expect(getModelById('does-not-exist')).toBeUndefined();
  });
});
