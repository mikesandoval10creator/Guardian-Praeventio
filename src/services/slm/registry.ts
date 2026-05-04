/**
 * Static registry of on-device SLM candidates.
 *
 * Fase 1 (Sprint 20, Bucket Gamma, T-1.1) ships three models so the loader
 * — which arrives in T-1.2 — can pick based on device capability:
 *
 *   - phi-3-mini   — default; balances quality vs. footprint (~2 GB).
 *   - qwen-2.5-0.5b — fallback for low-storage devices (~280 MB).
 *   - gemma-2-2b   — premium opt-in; better generation quality (~1.4 GB).
 *
 * No runtime side effects. This module exports plain data + a tiny lookup
 * helper. Anything that needs to download / load a model lives downstream
 * (worker code in T-1.2).
 *
 * URL caveat: HuggingFace Hub layout for `*-onnx-web` repos is stable but
 * the per-file paths inside the repo (e.g. `model_q4f16.onnx`) shift across
 * uploads. The URLs below point at the canonical repo root; the loader
 * resolves the exact weight file from the repo's metadata at fetch time.
 * Where the repo path itself is the best guess we have, the entry carries
 * a `// TODO: confirm URL` comment.
 */

import type { ModelDescriptor } from './types';

const MB = 1024 * 1024;

/**
 * The canonical, ordered list of SLM models the app may use offline.
 *
 * Order matters: the first entry is treated as the default candidate by
 * `getDefaultModel()`.
 */
export const MODEL_REGISTRY: readonly ModelDescriptor[] = [
  {
    id: 'phi-3-mini',
    name: 'Phi-3 Mini 4K Instruct (ONNX int4)',
    // ~2 GB on disk for the int4 quantization. Microsoft publishes both
    // q4 and fp16 variants in the same repo; size pinned to the q4 path.
    size: 1900 * MB,
    url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx-web',
    // HF repo id used by AutoTokenizer.from_pretrained() in slmWorker
    // (T-1.3.1). The library resolves `tokenizer.json` + `tokenizer_config.json`
    // from the canonical Hub layout under this id.
    // TODO Sigma: confirm AutoTokenizer.from_pretrained signature — if the
    // library rejects this onnx-web repo (some HF mirrors strip tokenizer
    // files from ONNX-only forks), fall back to the upstream
    // `microsoft/Phi-3-mini-4k-instruct` repo which always carries the
    // canonical tokenizer.json.
    tokenizerUrl: 'microsoft/Phi-3-mini-4k-instruct-onnx-web',
    format: 'onnx-int4',
    license: 'MIT',
    preferredBackend: 'webgpu',
    quantization: 'int4',
  },
  {
    id: 'qwen-2.5-0.5b',
    name: 'Qwen 2.5 0.5B Instruct (ONNX int4)',
    // ~280 MB — small enough to be a viable fallback on storage-tight
    // mobile hardware while still useful for short prompts.
    size: 280 * MB,
    // TODO: confirm URL — Qwen team publishes ONNX builds across multiple
    // mirror repos; this is the most stable candidate at time of writing.
    url: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct',
    tokenizerUrl: 'onnx-community/Qwen2.5-0.5B-Instruct',
    format: 'onnx-int4',
    license: 'Apache-2.0',
    preferredBackend: 'wasm-simd',
    quantization: 'int4',
  },
  {
    id: 'gemma-2-2b',
    name: 'Gemma 2 2B IT (ONNX int4)',
    // ~1.4 GB. Gemma uses Google's bespoke "Gemma Terms of Use" — not a
    // standard OSI license — so this entry is opt-in and gated by the UI.
    size: 1400 * MB,
    // TODO: confirm URL — Google publishes Gemma weights primarily on
    // Kaggle; community ONNX exports live under `onnx-community/` on HF.
    url: 'https://huggingface.co/onnx-community/gemma-2-2b-it',
    tokenizerUrl: 'onnx-community/gemma-2-2b-it',
    format: 'onnx-int4',
    license: 'Gemma',
    preferredBackend: 'webgpu',
    quantization: 'int4',
  },
] as const;

/**
 * The id of the model the app should attempt to load by default.
 * Currently Phi-3 Mini, which is permissively licensed (MIT) and offers
 * the best quality/size trade-off in the registry.
 */
export const DEFAULT_MODEL_ID = 'phi-3-mini';

/**
 * Look up a model descriptor by its registry id.
 *
 * @returns the descriptor, or `undefined` if no model has the given id.
 */
export function getModelById(id: string): ModelDescriptor | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

/**
 * Return the default model descriptor (the one keyed by DEFAULT_MODEL_ID).
 *
 * @throws if the registry has been mis-edited and no default is present.
 */
export function getDefaultModel(): ModelDescriptor {
  const m = getModelById(DEFAULT_MODEL_ID);
  if (!m) {
    throw new Error(
      `SLM registry: default model id "${DEFAULT_MODEL_ID}" not found.`,
    );
  }
  return m;
}
