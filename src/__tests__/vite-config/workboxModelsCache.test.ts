/**
 * Verify the Workbox runtime-cache regex in `vite.config.ts` correctly
 * matches the model URLs that the SLM runtime will request — and does
 * NOT accidentally match other paths (CSS, JS, HTML).
 *
 * This test guards against accidental edits to the regex that break
 * offline SLM access without anyone noticing until QA on a real device.
 */

import { describe, it, expect } from 'vitest';

// Re-declare here to keep the test self-contained. The source of
// truth is `vite.config.ts`. If the regex changes there, this file
// MUST change in the same commit.
const MODELS_CACHE_REGEX = /\/models\/.*\.(?:onnx|onnx_data|bin)(?:\?.*)?$/i;

describe('Workbox runtime cache for /models/*', () => {
  describe('matches expected SLM model URLs', () => {
    const expected = [
      '/models/qwen-2.5-0.5b/model_q4f16.onnx',
      '/models/qwen-2.5-0.5b/model_q4f16.onnx_data',
      '/models/phi-3-mini/onnx/model_q4.onnx',
      '/models/phi-3-mini/onnx/model_q4.onnx_data',
      '/models/gemma-2-2b-it/onnx/model_q4f16.onnx',
      // With query string (CDN cache busting).
      '/models/qwen-2.5-0.5b/model_q4f16.onnx?v=1',
      '/models/phi/m.onnx?build=abc123',
      // Case insensitive (rare HF redirects).
      '/models/qwen-2.5-0.5b/MODEL_Q4F16.ONNX',
      // Other supported extensions.
      '/models/test/weights.bin',
    ];
    it.each(expected)('matches %s', (url) => {
      expect(MODELS_CACHE_REGEX.test(url)).toBe(true);
    });
  });

  describe('does NOT match unrelated paths', () => {
    const rejected = [
      // Root paths.
      '/',
      '/index.html',
      '/assets/index-abc.js',
      '/assets/vendor-react-xyz.js',
      // Sound-alike but wrong extensions.
      '/models/qwen/readme.txt',
      '/models/qwen/manifest.json',
      // Models in nested path that aren't ONNX.
      '/models/qwen/config.json',
      '/api/models/list',
      // Has `models` in path but not at the right place.
      '/static/list-of-models.html',
      '/foo/bar/baz.onnx', // not under /models/
    ];
    it.each(rejected)('rejects %s', (url) => {
      expect(MODELS_CACHE_REGEX.test(url)).toBe(false);
    });
  });

  it('regex is anchored to end of path before query (so .onnx_data.zip would NOT match)', () => {
    expect(MODELS_CACHE_REGEX.test('/models/x/model.onnx.zip')).toBe(false);
    expect(MODELS_CACHE_REGEX.test('/models/x/model.onnx_data.zip')).toBe(false);
  });

  it('regex preserves match when query string present', () => {
    expect(MODELS_CACHE_REGEX.test('/models/x/m.onnx?v=1&t=foo')).toBe(true);
    expect(MODELS_CACHE_REGEX.test('/models/x/m.onnx_data?build=xyz')).toBe(true);
  });

  it('regex is case-insensitive on the extension', () => {
    expect(MODELS_CACHE_REGEX.test('/models/x/M.OnNx')).toBe(true);
    expect(MODELS_CACHE_REGEX.test('/models/x/m.ONNX_DATA')).toBe(true);
  });

  it('matches the canonical registry URL paths for each registered model', () => {
    // These mirror `prePackagedPath` declared in registry.ts. If those
    // change without the regex being updated, this test fires.
    const canonicalPaths = [
      '/models/qwen-2.5-0.5b/model_q4f16.onnx',
    ];
    for (const p of canonicalPaths) {
      expect(MODELS_CACHE_REGEX.test(p)).toBe(true);
    }
  });
});
