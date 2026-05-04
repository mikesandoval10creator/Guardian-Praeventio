# SLM Offline (Brecha B)

Bucket O — Sprint 21, Ola 5b. On-device fallback model so the app can
keep answering questions when Gemini is unreachable (no connectivity,
rate limit, server outage).

## Why

The audit `product_strategic_gaps_2026-05-04.md` flagged "Brecha B: SLM
offline" — today the assistant requires Gemini online for every answer.
This bucket lands the runtime + adapter scaffolding so the next wave can
flip the feature flag and ship a real on-device model.

## Stack

| Layer        | Choice                                  | Rationale                                                       |
| ------------ | --------------------------------------- | --------------------------------------------------------------- |
| Runtime      | `onnxruntime-web` (MIT)                 | More mature web story than llama.cpp WASM, smaller bundle.      |
| Model        | TinyLlama 1.1B Chat Q4 (Apache-2.0)     | ~600 MB — fits PWA cache. Phi-3-mini (1.8 GB) is alternative.   |
| Tokenizer    | `@huggingface/transformers` (Apache-2.0)| Already in `package.json`; provides AutoTokenizer.              |
| Storage      | IndexedDB via `idb` (MIT)               | Re-uses `services/slm/cache/modelCache.ts` from Sprint 20.      |
| Backend      | WebGPU → WASM-SIMD                      | Auto-fallback in `OnnxSlmAdapter.loadModel()`.                  |

## Bundle policy

**The 600 MB ONNX file is NOT committed to the repo.**

- `.gitignore` excludes `public/models/slm/*.onnx`.
- Devs run `node scripts/download-slm-model.mjs` to fetch the weights
  locally for testing.
- Production serves the file from Cloud Storage + CDN with
  cross-origin-isolation headers (see "Server headers" below).

## Performance

| Backend     | Hardware                  | Throughput      |
| ----------- | ------------------------- | --------------- |
| WebGPU      | Apple M1 / RTX 3060+      | ~30 tok/s       |
| WASM-SIMD   | Generic CPU (4 threads)   | ~5 tok/s        |

These are TinyLlama Q4 numbers; Phi-3-mini at FP16 would roughly halve
the WebGPU figure. Numbers measured in the upstream `onnxruntime-web`
demo, not yet re-measured against our fork.

## Fallback chain

`useSlmOffline` (the hook) implements the policy:

1. `forceSlm === true`               → SLM
2. `navigator.onLine === false`      → SLM
3. otherwise                         → Gemini first; on throw → SLM
4. SLM unavailable + Gemini unavailable → `unavailable` status

`OnnxSlmAdapter.fromEnv()` returns `null` when `SLM_OFFLINE_ENABLED` is
off, so the hook gracefully degrades to "online-only, no fallback"
without paying the dynamic-import cost.

## Privacy

When the SLM path serves a query, **the prompt never leaves the device**.
This is the durable privacy guarantee callers can advertise to operators
in regulated environments.

The offline reconciliation queue (`services/slm/offlineQueue.ts`) does
persist the (query, response) pair to IndexedDB so the
`reconciliationRunner` can replay it against Gemini once connectivity
returns — but that replay is opt-in at the call-site level (AsesorChat
enqueues, the model-management UI doesn't).

## Server headers

`/models/slm/*` is served with:

- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Cache-Control: public, max-age=31536000, immutable`

The first two enable cross-origin isolation, which `onnxruntime-web`'s
WASM threading + SharedArrayBuffer paths require. The middleware lives
in `server.ts` (Bucket O middleware block) and is scoped to the
`/models/slm` prefix so the rest of the app's embedded third-party
content (Google Maps, Stripe, OAuth callbacks) keeps working.

## Files in this bucket

- `src/services/slm/onnxAdapter.ts` — class API.
- `src/services/slm/onnxAdapter.test.ts` — Vitest suite (8 tests).
- `src/hooks/useSlmOffline.ts` — React hook with fallback policy.
- `scripts/download-slm-model.mjs` — local weights fetcher.
- `server.ts` — `/models/slm/*` cross-origin-isolation middleware.
- `.gitignore` — excludes `public/models/slm/*.onnx`.

## What's next (Ola 5c)

- Real generation loop: replace the placeholder in
  `OnnxSlmAdapter.generate()` with a sampling scheduler that drives
  `session.run({ input_ids, attention_mask, position_ids, past_kv })`.
- Tokenizer wire: pull `AutoTokenizer.from_pretrained()` from
  `@huggingface/transformers` (already in deps) and tokenize prompts /
  detokenize sampled ids.
- KV cache: hold past_key_values across loop iterations to avoid
  re-prefilling the prompt on every token.
- Wire `useSlmOffline` into `AsesorChat` as a feature-flagged path.
- Pin `EXPECTED_SHA256` in `download-slm-model.mjs` after a manual
  audit of the upstream blob.
