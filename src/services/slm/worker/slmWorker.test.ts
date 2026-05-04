/**
 * Smoke tests for the slmWorker tokenizer wiring (Sprint 20 fifth wave,
 * Bucket Sigma, T-1.3.1).
 *
 * Scope is intentionally narrow: assert that `init()` decides whether
 * to attempt a real tokenizer load based on `model.tokenizerUrl`, and
 * that load failures degrade gracefully to the naïve fallback. We do
 * NOT exercise real ONNX inference here — that's perf testing and lives
 * outside this suite (T-1.3.2 / future).
 *
 * Both `onnxruntime-web` and `@huggingface/transformers` are mocked at
 * the module boundary so the worker module can be imported under Node
 * without dragging in WASM runtimes or hitting the HuggingFace Hub.
 *
 * `slmWorker.ts` keeps state in module scope, so we re-import it per
 * test via `vi.resetModules()` to keep tests independent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelDescriptor } from '../types';

const baseModel: ModelDescriptor = {
  id: 'test-phi',
  name: 'Test Phi',
  size: 64,
  url: 'https://example.invalid/model.onnx',
  format: 'onnx-int4',
  license: 'MIT',
  preferredBackend: 'wasm-simd',
  quantization: 'int4',
};

/**
 * Build a minimal ORT mock: `InferenceSession.create` resolves with a
 * stubbed session (the inputs/outputs we never actually run against in
 * these smoke tests). `Tensor` is a no-op constructor so any code paths
 * that touch it during init don't blow up.
 */
function ortMockFactory() {
  return {
    InferenceSession: {
      create: vi.fn().mockResolvedValue({
        inputNames: ['input_ids'],
        outputNames: ['logits'],
        run: vi.fn(),
        release: vi.fn().mockResolvedValue(undefined),
      }),
    },
    Tensor: vi.fn(),
  };
}

describe('slmWorker — tokenizer wiring (T-1.3.1)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('onnxruntime-web');
    vi.doUnmock('@huggingface/transformers');
  });

  it('init() calls AutoTokenizer.from_pretrained when tokenizerUrl is set', async () => {
    const fromPretrained = vi.fn().mockResolvedValue({
      encode: () => [1, 2, 3],
      decode: () => 'hello',
    });
    vi.doMock('onnxruntime-web', ortMockFactory);
    vi.doMock('@huggingface/transformers', () => ({
      AutoTokenizer: { from_pretrained: fromPretrained },
    }));

    const { default: api } = await import('./slmWorker');
    await api.init(
      { ...baseModel, tokenizerUrl: 'fake-org/fake-tokenizer' },
      new ArrayBuffer(8),
    );

    expect(fromPretrained).toHaveBeenCalledTimes(1);
    expect(fromPretrained).toHaveBeenCalledWith('fake-org/fake-tokenizer');
  });

  it('init() skips tokenizer load when tokenizerUrl is missing', async () => {
    const fromPretrained = vi.fn().mockResolvedValue({
      encode: () => [1, 2, 3],
      decode: () => 'hello',
    });
    vi.doMock('onnxruntime-web', ortMockFactory);
    vi.doMock('@huggingface/transformers', () => ({
      AutoTokenizer: { from_pretrained: fromPretrained },
    }));

    const { default: api } = await import('./slmWorker');
    // No tokenizerUrl on the descriptor — naïve fallback path.
    await api.init({ ...baseModel }, new ArrayBuffer(8));

    expect(fromPretrained).not.toHaveBeenCalled();
  });

  it('init() does not throw when tokenizer load fails (fallback to naïve)', async () => {
    const fromPretrained = vi
      .fn()
      .mockRejectedValue(new Error('hub unreachable'));
    vi.doMock('onnxruntime-web', ortMockFactory);
    vi.doMock('@huggingface/transformers', () => ({
      AutoTokenizer: { from_pretrained: fromPretrained },
    }));

    // Silence the expected console.error so test output stays clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { default: api } = await import('./slmWorker');
    await expect(
      api.init(
        { ...baseModel, tokenizerUrl: 'fake-org/missing-tokenizer' },
        new ArrayBuffer(8),
      ),
    ).resolves.toBeUndefined();

    expect(fromPretrained).toHaveBeenCalledTimes(1);
    // Error path should have logged once for the tokenizer failure.
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
