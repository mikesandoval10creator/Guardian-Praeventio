/**
 * Cache-aware SLM model loader.
 *
 * Fase 1 (Sprint 20, Bucket Epsilon, T-1.2). Sits between the registry
 * and the Web Worker, providing a single async entry point that:
 *
 *   1. Tries IndexedDB cache first  (`./cache/modelCache`).
 *   2. Falls back to streaming `fetch` of `model.url`, surfacing
 *      progress to the caller (so the UI can show a download bar).
 *   3. Persists the freshly downloaded bytes for next time.
 *
 * The function intentionally returns the raw `ArrayBuffer`. ONNX
 * Runtime Web's `InferenceSession.create()` accepts a buffer directly
 * — keeping the loader tied to bytes (not Sessions) means the worker
 * boundary can stay simple and we keep this module unit-testable
 * without spinning up an inference engine.
 */

import { cacheModel, loadCachedModel } from './cache/modelCache';
import type { ModelDescriptor } from './types';

/**
 * Optional progress callback. `loaded` is monotonically increasing in
 * bytes; `total` is the `Content-Length` of the response, or `null`
 * when the server doesn't advertise one (some HF mirrors omit it for
 * gated models).
 */
export type LoadProgressFn = (loaded: number, total: number | null) => void;

/** Options accepted by `loadModel`. */
export interface LoadModelOptions {
  /** Optional progress callback, fired during fetch (cache hits skip it). */
  onProgress?: LoadProgressFn;
  /**
   * Optional `fetch` override for tests / instrumentation. Defaults to
   * `globalThis.fetch`. We capture this at call-time (not module-load
   * time) so a test can swap `globalThis.fetch` between cases without
   * having to thread the override through every layer.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Load the bytes for `model`, preferring the on-device cache.
 *
 * Cache hit  → resolves immediately with the cached `ArrayBuffer`.
 * Cache miss → fetches `model.url`, streams chunks while reporting
 *              progress, persists the result, then resolves with it.
 *
 * Errors propagate as-is: a non-ok HTTP status throws an `Error` whose
 * message includes the status code. Callers (worker bootstrap, UI) are
 * expected to catch and decide whether to retry / fall back to a
 * smaller registry entry.
 */
export async function loadModel(
  model: ModelDescriptor,
  opts: LoadModelOptions = {},
): Promise<ArrayBuffer> {
  // 12th wave analytics — `slm.model.downloaded` covers BOTH branches
  // (cache hit + fresh download). Catalog row 78 description is "finished
  // downloading + cached"; we read that as "the bytes are usable now",
  // which a cache hit also satisfies. The `cache_origin` enum disambiguates:
  // `pre_packaged` for cache hits, `cdn` for live fetches.
  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  // 1. Cache lookup.
  const cached = await loadCachedModel(model.id);
  if (cached) {
    void emitModelDownloaded({
      model_id: model.id,
      model_bytes: cached.byteLength,
      download_duration_ms: durationSince(startedAt),
      cache_origin: 'pre_packaged',
    });
    return cached;
  }

  // 2. Streaming fetch.
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'SLM loader: no fetch implementation available (pass opts.fetchImpl).',
    );
  }

  const response = await fetchImpl(model.url);
  if (!response.ok) {
    throw new Error(
      `SLM loader: fetch failed for ${model.id} (HTTP ${response.status}).`,
    );
  }

  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;

  // Some test fetch mocks return a body without `getReader` — fall back
  // to `arrayBuffer()` in that case so the loader still behaves sanely.
  const body = response.body;
  let bytes: ArrayBuffer;

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    // Stream the response, accumulating chunks and reporting progress.
    // We allocate the final buffer at the end (single copy) rather than
    // growing a buffer per chunk — simpler and bounded by the server's
    // declared content-length anyway.
     
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        opts.onProgress?.(loaded, total);
      }
    }

    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    bytes = merged.buffer;
  } else {
    bytes = await response.arrayBuffer();
    opts.onProgress?.(bytes.byteLength, total);
  }

  // 3. Persist for next launch.
  await cacheModel(model.id, bytes);

  void emitModelDownloaded({
    model_id: model.id,
    model_bytes: bytes.byteLength,
    download_duration_ms: durationSince(startedAt),
    cache_origin: 'cdn',
  });

  return bytes;
}

function durationSince(startedAt: number): number {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  return Math.max(0, Math.round(now - startedAt));
}

/**
 * Fire-and-forget analytics emit. Dynamic import keeps the loader's
 * import graph minimal and matches the orchestrator's pattern (see
 * `orchestrator.ts`); failures are swallowed because a missed event must
 * never break model availability.
 */
async function emitModelDownloaded(props: {
  model_id: string;
  model_bytes: number;
  download_duration_ms: number;
  cache_origin: 'cdn' | 'pre_packaged';
}): Promise<void> {
  try {
    const { analytics } = await import('../analytics');
    await analytics.track('slm.model.downloaded', props);
  } catch {
    /* swallow */
  }
}
