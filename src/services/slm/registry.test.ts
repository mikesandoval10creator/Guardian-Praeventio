import { describe, it, expect } from 'vitest';

import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  getDefaultModel,
  getModelById,
  requiresExplicitDownloadConsent,
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

  // B14 (2026-06-11): Qwen-default decision. The default model is the
  // ONE that ships pre-packaged inside the build — never a multi-GB CDN
  // download on a faena connection.
  it("default model is 'qwen-2.5-0.5b' (B14 Qwen-default)", () => {
    expect(DEFAULT_MODEL_ID).toBe('qwen-2.5-0.5b');
    const def = getDefaultModel();
    expect(def.id).toBe('qwen-2.5-0.5b');
  });

  it('default model ships pre-packaged — no CDN URL in the default path', () => {
    const def = getDefaultModel();
    // The runtime/loader prefer `prePackagedPath` (same-origin asset
    // staged by scripts/prepackage-slm-models.mjs in prebuild).
    expect(def.prePackagedPath).toBe('/models/qwen-2.5-0.5b/model_q4f16.onnx');
    // No companion files → a single ~483 MB artifact, embeddable.
    expect(def.companionFiles).toBeUndefined();
    expect(totalDownloadBytes(def)).toBeLessThan(600 * MB);
    // The default never needs explicit download consent.
    expect(requiresExplicitDownloadConsent(def)).toBe(false);
  });

  it('Phi-3 y Gemma son opt-in: requieren consentimiento explícito de descarga', () => {
    // Multi-GB CDN downloads — UI must show an es-CL size warning and
    // require explicit user action before fetching these.
    expect(requiresExplicitDownloadConsent(getModelById('phi-3-mini')!)).toBe(
      true,
    );
    expect(requiresExplicitDownloadConsent(getModelById('gemma-2-2b')!)).toBe(
      true,
    );
  });

  it('the first registry entry IS the default (order contract)', () => {
    expect(MODEL_REGISTRY[0]!.id).toBe(DEFAULT_MODEL_ID);
  });

  it('Phi-3 Mini principal weight is ~1GB (.onnx, sin contar .onnx_data companion)', () => {
    // Sprint 54: size refleja el .onnx principal. El .onnx_data
    // (1.66GB external data) está en companionFiles. Total descarga
    // efectiva ~2.7 GB se valida con totalDownloadBytes() abajo.
    const phi = getModelById('phi-3-mini');
    expect(phi).toBeDefined();
    const sizeMb = (phi as { size: number }).size / MB;
    expect(sizeMb).toBeGreaterThanOrEqual(900);
    expect(sizeMb).toBeLessThanOrEqual(1200);
  });

  it('Qwen 2.5 0.5B q4f16 — real size ~480 MB (no 280 como legacy doc)', () => {
    // Sprint 54: verificado contra HF /tree/main/onnx → 483 MB.
    const qwen = getModelById('qwen-2.5-0.5b');
    expect(qwen).toBeDefined();
    const sizeMb = (qwen as { size: number }).size / MB;
    expect(sizeMb).toBeGreaterThanOrEqual(450);
    expect(sizeMb).toBeLessThanOrEqual(520);
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

// ────────────────────────────────────────────────────────────────────────
// Sprint 54 SLM real — verified hashes + companion files + gated handling
// ────────────────────────────────────────────────────────────────────────

import {
  listModelsWithVerifiedHash,
  totalDownloadBytes,
  listDownloadableFiles,
} from './registry.js';

describe('Sprint 54 SLM real — verified hashes', () => {
  it('Phi-3 mini tiene SHA-256 real (no null)', () => {
    const phi = getModelById('phi-3-mini');
    expect(phi?.expectedSha256).toBe(
      '16b8e5d28a757c37bbfa7d9420fd094c0c20e3615ca3c203b5b9501015045c8f',
    );
    // 64 chars hex
    expect(phi?.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Qwen 0.5B tiene SHA-256 real (no null)', () => {
    const qwen = getModelById('qwen-2.5-0.5b');
    expect(qwen?.expectedSha256).toBe(
      'b11c1dd99efd57e6c6e5bc4443a019931a5fbd5dd500d48644d8225f5ce0b2cb',
    );
    expect(qwen?.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Gemma sigue null + marcado gated (Google ToS gating)', () => {
    const gemma = getModelById('gemma-2-2b');
    expect(gemma?.expectedSha256).toBeNull();
    expect(gemma?.gated).toBe(true);
  });

  it('Phi-3 declara companion file .onnx_data con su propio hash', () => {
    const phi = getModelById('phi-3-mini');
    expect(phi?.companionFiles).toBeDefined();
    expect(phi?.companionFiles?.length).toBe(1);
    const companion = phi?.companionFiles?.[0];
    expect(companion?.filename).toBe('onnx/model_q4.onnx_data');
    expect(companion?.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(companion?.size).toBeGreaterThan(1_000_000_000); // >1GB
  });

  it('hashComputedAt está poblado para models con hash real', () => {
    const phi = getModelById('phi-3-mini');
    expect(phi?.hashComputedAt).toBeDefined();
    expect(() => new Date(phi!.hashComputedAt!).toISOString()).not.toThrow();
  });

  it('Qwen NO tiene companion files (modelo de un solo archivo)', () => {
    const qwen = getModelById('qwen-2.5-0.5b');
    expect(qwen?.companionFiles).toBeUndefined();
  });
});

describe('Sprint 54 — URLs apuntan a resolve/main directo (no repo root)', () => {
  it('Phi-3 URL es directa al .onnx', () => {
    const phi = getModelById('phi-3-mini');
    expect(phi?.url).toContain('/resolve/main/');
    expect(phi?.url).toMatch(/\.onnx$/);
  });

  it('Qwen URL es directa', () => {
    const qwen = getModelById('qwen-2.5-0.5b');
    expect(qwen?.url).toContain('/resolve/main/');
    expect(qwen?.url).toMatch(/\.onnx$/);
  });

  it('Gemma URL es directa también (aún si gated)', () => {
    const gemma = getModelById('gemma-2-2b');
    expect(gemma?.url).toContain('/resolve/main/');
  });
});

describe('listModelsWithVerifiedHash', () => {
  it('excluye modelos con hash null (gated)', () => {
    const verified = listModelsWithVerifiedHash();
    const ids = verified.map((m) => m.id);
    expect(ids).toContain('phi-3-mini');
    expect(ids).toContain('qwen-2.5-0.5b');
    expect(ids).not.toContain('gemma-2-2b'); // null hash
  });

  it('todos los modelos verified tienen hash hex 64 chars', () => {
    const verified = listModelsWithVerifiedHash();
    for (const m of verified) {
      expect(m.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe('totalDownloadBytes', () => {
  it('Phi-3 suma .onnx + .onnx_data', () => {
    const phi = getModelById('phi-3-mini')!;
    const total = totalDownloadBytes(phi);
    expect(total).toBe(phi.size + phi.companionFiles![0]!.size);
    expect(total).toBeGreaterThan(2_500_000_000); // >2.5GB
  });

  it('Qwen es solo el .onnx (no companions)', () => {
    const qwen = getModelById('qwen-2.5-0.5b')!;
    expect(totalDownloadBytes(qwen)).toBe(qwen.size);
  });
});

describe('listDownloadableFiles', () => {
  it('Phi-3 retorna 2 archivos (principal + companion)', () => {
    const phi = getModelById('phi-3-mini')!;
    const files = listDownloadableFiles(phi);
    expect(files).toHaveLength(2);
    expect(files[0]!.filename).toBe('onnx/model_q4.onnx');
    expect(files[1]!.filename).toBe('onnx/model_q4.onnx_data');
  });

  it('URL del companion file deriva del repo base correctamente', () => {
    const phi = getModelById('phi-3-mini')!;
    const files = listDownloadableFiles(phi);
    expect(files[1]!.url).toContain('/resolve/main/onnx/model_q4.onnx_data');
    expect(files[1]!.url).toContain('Phi-3-mini-4k-instruct-onnx-web');
  });

  it('Qwen retorna 1 archivo', () => {
    const qwen = getModelById('qwen-2.5-0.5b')!;
    const files = listDownloadableFiles(qwen);
    expect(files).toHaveLength(1);
  });

  it('Gemma retorna 1 archivo con expectedSha256 null (gated)', () => {
    const gemma = getModelById('gemma-2-2b')!;
    const files = listDownloadableFiles(gemma);
    expect(files[0]!.expectedSha256).toBeNull();
  });
});
