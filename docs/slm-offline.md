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
explicitly `false`, so the hook gracefully degrades to "online-only, no
fallback" without paying the dynamic-import cost. **B14 (2026-06-11):
the flag is ON by default** — `SLM_OFFLINE_ENABLED` is now a
kill-switch (`false`/`0` disables); see
`src/services/slm/slmFlag.ts#isSlmOfflineEnabled` for the resolution
order. The default model is the pre-packaged Qwen 2.5 0.5B
(`registry.ts#DEFAULT_MODEL_ID`), staged into `public/models/` by
`scripts/prepackage-slm-models.mjs` during `prebuild` — zero CDN bytes
in the default path. Phi-3 / Gemma remain opt-in multi-GB downloads
(`registry.ts#requiresExplicitDownloadConsent`).

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

- `src/services/slm/onnxAdapter.ts` — class API + real generation loop.
- `src/services/slm/onnxAdapter.test.ts` — Vitest suite (lifecycle + integration).
- `src/services/slm/sampling.ts` — sampling primitives (Bucket DD).
- `src/services/slm/sampling.test.ts` — pure-math sampler tests (Bucket DD).
- `src/services/slm/tokenizer.ts` — `@huggingface/transformers` adapter (Bucket DD).
- `src/hooks/useSlmOffline.ts` — React hook with fallback policy.
- `scripts/download-slm-model.mjs` — local weights fetcher.
- `server.ts` — `/models/slm/*` cross-origin-isolation middleware.
- `.gitignore` — excludes `public/models/slm/*.onnx`.

## Real generation loop (Sprint 23 Bucket DD)

The `OnnxSlmAdapter.generate()` placeholder from Ola 5b has been
replaced with a real autoregressive sampling loop. Two new modules
land alongside it:

- `src/services/slm/sampling.ts` — pure-math sampling primitives:
  `sampleGreedy`, `sampleNucleus` (temperature → top-K → top-P →
  multinomial), and `applyRepetitionPenalty` (CTRL-paper sign-flip
  rule). Includes a seedable Mulberry32 RNG for reproducible tests.
- `src/services/slm/tokenizer.ts` — narrow wrapper around
  `@huggingface/transformers`'s `AutoTokenizer` exposing
  `encode` / `decode` / `applyChatTemplate`. Lazy-imported, cached
  per model name, with a test seam for fakes.

Algorithm (per generated token):

1. Build int64 `input_ids` + `attention_mask` tensors over the running
   prompt (no KV cache yet — see "What's next").
2. `session.run` → `logits` of shape `[1, seqLen, vocabSize]`. Slice
   the last position's row.
3. Apply repetition penalty over the last 50 generated tokens
   (`penalty = 1.1` default).
4. Greedy if `temperature === 0`, otherwise nucleus
   (`topK=50`, `topP=0.9`).
5. Stream the detokenized fragment through `onToken`.
6. Stop on EOS (id 2 for the Llama tokenizer family),
   `signal.aborted`, or `maxTokens`.

### Performance

| Backend     | Hardware                  | Throughput      |
| ----------- | ------------------------- | --------------- |
| WebGPU      | Apple M1 / RTX 3060+      | ~30 tok/s       |
| WASM-SIMD   | Generic CPU (4 threads)   | ~5 tok/s        |

Numbers above are the upstream `onnxruntime-web` demo's; we will
re-measure once the model file is deployed. Without a KV cache the
per-token cost is currently `O(seqLen)` rather than `O(1)`, so long
responses will scale super-linearly until the next bucket lands the
`past_key_values` plumbing.

### Limitations of TinyLlama 1.1B Q4

- **No function calling.** TinyLlama's chat template is plain text;
  there is no JSON-schema-aware tool use. The orchestrator must keep
  function calling on the Gemini path.
- **Short context window** (2 K tokens). Long Asesor sessions
  truncate at the prompt level.
- **Response quality is below Gemini's bar.** The model is suitable
  for fallback when offline, not as the primary interactive path.
- **Quantization noise.** Q4 introduces mild perplexity loss vs
  FP16; rare tokens / domain-specific terms may drift.

## El Guardián Offline (Sprint 26 ZZ)

`GuardianOfflineService` (`src/services/slm/guardianOffline.ts`) es la
capa "Guardián" que une el adapter ONNX (`OnnxSlmAdapter`) con un
corpus de emergencia chileno + cache + FAQ pre-generadas. Es la
respuesta concreta al caso del usuario: terremoto, sin internet, un
trabajador con sangrado abundante, salida bloqueada — el SLM solo no
basta porque puede no estar descargado todavía.

### Pipeline de `ask(prompt)`

1. **FAQ exact-ish match** (Jaccard sobre tokens normalizados, umbral
   0.5). Source: `faq`. Cobertura garantizada incluso sin modelo
   descargado. Las preguntas canónicas (sangrado, evacuación, sismo,
   RCP, gas, números de emergencia, electrocución, quemadura) están
   pre-respondidas.
2. **Cache lookup** por `djb2(normalizado(prompt))` en IndexedDB
   `guardianOfflineCache`. Source: `cache`. TinyLlama Q4 a ~5 tok/s
   en CPU mobile sería desastroso para la UX en emergencia — cachear
   es no-negociable.
3. **Retrieval**: top-3 chunks por keyword overlap con
   `rankChunks()`. No usamos embeddings offline — se busca match
   simple sobre keywords + topic + primeras 30 palabras del cuerpo.
4. **Generación SLM** (si `OnnxSlmAdapter.fromEnv()` resuelve):
   prompt aumentado con los chunks + `SYSTEM_PROMPT_EMERGENCY` que
   instruye contestar SOLO desde el contexto entregado, sin inventar
   citaciones. Source: `slm`.
5. **Corpus-only fallback**: si no hay adapter o si la generación
   falla, devolvemos la concatenación de los chunks rankeados.
   Source: `corpus-only`. Siempre hay respuesta para el trabajador.

### Corpus

`/public/data/guardian-offline-corpus.json` — 35 chunks cubriendo
primeros auxilios (sangrado, RCP, fractura, quemadura, intoxicación,
electrocución, atragantamiento, hipotermia, golpe de calor, shock,
lesión espinal, crisis respiratoria, ojo), evacuación (salida
bloqueada, sismo, tsunami, incendio, derrame químico, espacio
confinado, punto de reunión, discapacidad, post-réplica),
identificación de peligros (gas/olor, clases de fuego, eléctrico,
trabajo en altura, atmósfera explosiva, derrumbe, máquinas), EPP
(respiratorio, básico) y comunicación (números de emergencia, cadena
de aviso, contacto familia). Citaciones: DS 109, DS 594, DS 148,
DS 132, NCh 1410, NCh 433, NCh 1430, NCh 934, NCh 2055, NCh 2120,
NCh Elec 4, Ley 16.744, GHS UN, AHA, NIOSH, ONEMI, SHOA, CITUC.

### FAQs pre-generadas

8 preguntas tap-friendly que la UI puede mostrar como sugerencias
cuando se detecta offline. Cada una tiene respuesta y citaciones de
fuente. Disponibles vía `service.getFAQ()`.

### Cache strategy

- Store: IndexedDB `guardianOfflineCache.responses`
- Key: `q:<djb2-hex>` del prompt normalizado (lowercase, sin acentos,
  sin puntuación)
- Value: respuesta serializada como string
- TTL: ninguno. La emergencia no caduca; el usuario puede limpiar
  manualmente desde Configuración > Privacidad si lo desea.
- Fallback in-memory `Map` cuando IndexedDB no está disponible (SSR /
  tests sin polyfill).

### Wire en `AsesorChat`

El componente construye `GuardianOfflineService.fromEnv()` una sola
vez (memo), llama `preload()` en idle (`requestIdleCallback`), y
añade el service a la cadena de fallback del catch del `handleSend`:

```
try { ask(prompt) }
catch {
  if (offlineService) offlineService.ask(prompt)
  else getOfflineResponse(prompt, nodes)  // legacy
}
```

Cuando el banner emergencia se renderiza (sin conexión + service
activo), el chat anuncia: "Estás sin conexión. El Guardián tiene
respuestas básicas de emergencia disponibles (sangrado, evacuación,
RCP, gas, sismo)."

### Performance esperado

- Corpus parse: <50 ms en mobile gama media (35 chunks ~30 KB)
- FAQ match + retrieval: O(N) con N=35 chunks → <5 ms
- Cache hit: <10 ms IndexedDB read
- SLM generate: ver tabla arriba (~5 tok/s CPU, ~30 tok/s WebGPU)
- Cache miss típico: 20-50 s para 256 tokens en CPU mobile, 8-12 s
  en WebGPU. La UI debe mostrar streaming via `onToken` para que la
  experiencia se sienta progresiva.

### Test mode

Los tests inyectan un `adapter` mock + un `cacheImpl` en memoria, así
que el suite (`guardianOffline.test.ts`, 19 tests) no descarga el
modelo de 600 MB ni toca IndexedDB real. Este es el patrón que el
resto del repo usa para SLM (ver `onnxAdapter.test.ts`).

## What's next

- KV cache: hold `past_key_values` across loop iterations to drop the
  per-token cost from `O(seqLen)` to `O(1)`.
- Wire `useSlmOffline` into `AsesorChat` as a feature-flagged path.
- Pin `EXPECTED_SHA256` in `download-slm-model.mjs` after a manual
  audit of the upstream blob.
- WebGPU fast-path for the sampler itself (currently CPU JS).
