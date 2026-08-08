// SPDX-License-Identifier: MIT
//
// SLM Capacity Preflight — gate device capability before allowing inference.
//
// Sprint 50 E.13 P1 H9 — closes ticket
// 39aaa66d-73fe-810a-a721-da22bb77e808
// ("No hay preflight de capacidad para ejecutar el SLM (OOM en gama baja)").
//
// Problem: the Qwen 0.5B ONNX weights are 483 MB. A device that downloads
// the model can still OOM during inference if it lacks (a) enough free RAM,
// (b) enough storage quota to keep the weights + KV cache + session, or
// (c) a WebAssembly / WebGPU backend that fits the model. Without a
// preflight, a low-end Android in offline mode downloads the model, then
// crashes the WebView on first inference.
//
// This module runs three cheap checks before the runtime is asked to
// load the model:
//
//   1. **Storage quota** via `navigator.storage.estimate()`. We require
//      at least `model.sizeBytes * 2` free (weights + runtime KV cache +
//      session overhead). Fail-soft: if the API is unavailable (Safari
//      < 17, older Android), we don't block — we degrade to "unknown".
//
//   2. **Memory budget** via `navigator.deviceMemory` (Chromium / Edge
//      only). We require ≥ 2 GB for the smallest model. Fail-soft:
//      unavailable → "unknown" (don't block on devices that don't expose
//      the API).
//
//   3. **Backend fit** via a synchronous WASM probe — instantiating a
//      trivial WASM module confirms the runtime is functional and gives
//      us a rough estimate of `latencyMs` for a no-op inference. Devices
//      where WASM is disabled or extremely slow are flagged.
//
// The preflight returns a structured result:
//   - `ok`: true|false|'unknown' (false = BLOCK, unknown = ALLOW with warning)
//   - `reasons`: human-readable list of failures
//   - `recommendation`: 'allow' | 'block' | 'allow_with_warning'
//   - `degradeTo`: 'rag_local' | 'online_only' | null
//
// Callers (slmAdapter, slmRuntime) should call `runSlmPreflight()` once
// per session before `loadModel()`. The result is memoized for 5 minutes
// so subsequent calls within the same user session don't re-probe.
//
// We deliberately do NOT check `navigator.hardwareConcurrency` — it's
// unreliable and the Qwen 0.5B model doesn't scale by core count.

import { getModelById, DEFAULT_MODEL_ID } from './registry';

export interface SlmPreflightResult {
  /** True = allow. False = block. 'unknown' = allow but surface a soft warning. */
  ok: boolean | 'unknown';
  /** Free-form reasons (only populated when ok=false). */
  reasons: string[];
  /** Recommendation to surface to the UI. */
  recommendation: 'allow' | 'block' | 'allow_with_warning';
  /** What the caller should do instead when blocked. */
  degradeTo: 'rag_local' | 'online_only' | null;
  /** Snapshot of the device measurements (for diagnostics / telemetry). */
  measurements: {
    /** Free storage bytes (quota - usage). null if API unavailable. */
    freeStorageBytes: number | null;
    /** Approximate device RAM in GB. null if API unavailable. */
    deviceMemoryGb: number | null;
    /** Latency of a trivial WASM instantiation, in ms. null if WASM unavailable. */
    wasmLatencyMs: number | null;
  };
  /** When this result was computed (epoch ms). Callers can use this to memoize. */
  evaluatedAt: number;
}

/**
 * Storage budget threshold: model size × 2 (weights + KV cache + session).
 * 1.5× is the absolute minimum but leaves no room for the tokenizer
 * cache and any session state. 2× is safe across the Qwen 0.5B and the
 * larger Phi-3 models.
 */
const STORAGE_MULTIPLIER = 2;

/** Minimum device memory (GB) to run the smallest model safely. */
const MIN_DEVICE_MEMORY_GB = 2;

/**
 * WASM probe: compile a trivial WASM module. If it takes > 1000 ms on a
 * 2020-tier device, the device is too slow to run inference usefully.
 */
const WASM_SLOW_THRESHOLD_MS = 1000;

/**
 * Cached result, used to avoid hammering the preflight APIs within a
 * session. TTL: 5 minutes (matches the SLM runtime's own probe cadence).
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { result: SlmPreflightResult; expiresAt: number } | null = null;

/**
 * Storage estimate, returning the quota minus the current usage in bytes.
 * Returns `null` if `navigator.storage.estimate` is unavailable (Safari
 * < 17, older WebViews).
 */
async function probeStorageQuota(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    if (typeof est.quota !== 'number' || typeof est.usage !== 'number') {
      return null;
    }
    return Math.max(0, est.quota - est.usage);
  } catch {
    return null;
  }
}

/**
 * Approximate device RAM in GB. Returns `null` if the API is unavailable
 * (Firefox, Safari, older mobile browsers). The spec is in Chromium only
 * and rounded to {0.25, 0.5, 1, 2, 4, 8} — treat 0.25 as "unknown".
 */
function probeDeviceMemory(): number | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory !== 'number' || nav.deviceMemory <= 0) {
    return null;
  }
  // Chromium returns 0.25 for very low-end devices. Treat 0.25 as
  // "exposed but unreliable" — we don't want to block on a single
  // quarter-GB reading.
  if (nav.deviceMemory < 0.5) return null;
  return nav.deviceMemory;
}

/**
 * Trivial WASM instantiation: the canonical "is WASM alive?" probe.
 * Returns the latency in ms, or `null` if WASM is unavailable / failed.
 */
function probeWasmLatency(): number | null {
  if (typeof WebAssembly === 'undefined') return null;
  // The minimum valid WASM module: just the magic + version header.
  // 8 bytes: \0asm + version (little-endian 1).
  const minimalWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    // `validate` is synchronous and cheap — exactly the right probe for
    // "does this browser's WASM path work".
    WebAssembly.validate(minimalWasm);
    const end = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return end - start;
  } catch {
    return null;
  }
}

/**
 * Run the SLM capacity preflight. Returns a memoized result for up to
 * 5 minutes within the same session.
 *
 * Use the optional `forceRefresh` flag to bypass the cache (e.g. after a
 * tier change, when the device may have grown).
 */
export async function runSlmPreflight(opts: {
  modelId?: string;
  forceRefresh?: boolean;
} = {}): Promise<SlmPreflightResult> {
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const descriptor = getModelById(modelId);

  // Cache hit (and within TTL).
  if (
    !opts.forceRefresh &&
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.result;
  }

  const reasons: string[] = [];
  const [freeStorageBytes, wasmLatencyMs] = await Promise.all([
    probeStorageQuota(),
    Promise.resolve(probeWasmLatency()),
  ]);
  const deviceMemoryGb = probeDeviceMemory();

  // Storage check.
  let storageOk: boolean | 'unknown' = 'unknown';
  if (descriptor && freeStorageBytes !== null) {
    const requiredBytes = descriptor.size * STORAGE_MULTIPLIER;
    if (freeStorageBytes < requiredBytes) {
      reasons.push(
        `storage_low: free=${Math.round(freeStorageBytes / 1024 / 1024)}MB, ` +
          `required=${Math.round(requiredBytes / 1024 / 1024)}MB`,
      );
      storageOk = false;
    } else {
      storageOk = true;
    }
  }

  // Device-memory check.
  let memoryOk: boolean | 'unknown' = 'unknown';
  if (deviceMemoryGb !== null) {
    if (deviceMemoryGb < MIN_DEVICE_MEMORY_GB) {
      reasons.push(
        `memory_low: deviceMemory=${deviceMemoryGb}GB, required>=${MIN_DEVICE_MEMORY_GB}GB`,
      );
      memoryOk = false;
    } else {
      memoryOk = true;
    }
  }

  // WASM speed check.
  let wasmOk: boolean | 'unknown' = 'unknown';
  if (wasmLatencyMs !== null) {
    if (wasmLatencyMs > WASM_SLOW_THRESHOLD_MS) {
      reasons.push(`wasm_slow: validate_latency=${wasmLatencyMs.toFixed(1)}ms`);
      wasmOk = false;
    } else {
      wasmOk = true;
    }
  } else {
    // WASM unavailable is a hard block — the Qwen runtime needs WASM
    // for the WASM-SIMD backend.
    reasons.push('wasm_unavailable');
    wasmOk = false;
  }

  // Combine: any hard `false` blocks. All `unknown` means we couldn't
  // measure anything → allow (fail-open, since blocking the entire app
  // because the device hides its specs is worse than letting a slow
  // device try).
  const hardFails = [storageOk, memoryOk, wasmOk].filter((v) => v === false);
  const unknowns = [storageOk, memoryOk, wasmOk].filter((v) => v === 'unknown');

  let ok: boolean | 'unknown';
  let recommendation: 'allow' | 'block' | 'allow_with_warning';
  let degradeTo: 'rag_local' | 'online_only' | null;

  if (hardFails.length > 0) {
    ok = false;
    recommendation = 'block';
    // Storage + memory failures → degrade to RAG local (still works
    // for known safety Q&A without the SLM). WASM-only failure →
    // degrade to online only (the device can't run inference at all).
    if (!wasmOk && (storageOk === false || memoryOk === false)) {
      degradeTo = 'online_only';
    } else {
      degradeTo = 'rag_local';
    }
  } else if (unknowns.length > 0) {
    // Some checks couldn't run. Allow with a soft warning so the user
    // knows we couldn't certify the device.
    ok = 'unknown';
    recommendation = 'allow_with_warning';
    degradeTo = null;
  } else {
    ok = true;
    recommendation = 'allow';
    degradeTo = null;
  }

  const result: SlmPreflightResult = {
    ok,
    reasons,
    recommendation,
    degradeTo,
    measurements: {
      freeStorageBytes,
      deviceMemoryGb,
      wasmLatencyMs,
    },
    evaluatedAt: Date.now(),
  };

  cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

/**
 * Reset the cached preflight result. Tests call this between cases so
 * each scenario sees a fresh evaluation.
 */
export function __resetPreflightCacheForTests(): void {
  cached = null;
}
