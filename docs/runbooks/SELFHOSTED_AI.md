# Runbook — Self-hosted AI provider (OpenAI-compatible)

Per-action routing of `/api/gemini` whitelisted actions to a self-hosted
open-weights model, removing the hard dependence on Gemini quotas. Any
endpoint speaking the OpenAI `/v1/chat/completions` dialect works (vLLM,
Ollama, llama.cpp server, …) — MiMo-7B today, Qwen tomorrow, one env var.

Code map: client `src/services/ai/selfHostedProvider.ts` · routing
`src/services/ai/providerRouter.ts` · per-action prompts
`src/services/ai/selfHostedActions.ts` · wiring at the dispatch chokepoint
`src/server/routes/gemini.ts`.

## 1. Stand up a server

### Option A — Ollama (simplest)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull mimo-7b          # or qwen2.5:7b, llama3.1:8b, …
# Bind beyond localhost if the app runs on another host:
OLLAMA_HOST=0.0.0.0:11434 ollama serve
curl http://localhost:11434/v1/models   # sanity check (OpenAI-compatible API)
```

### Option B — vLLM (GPU, production throughput)

```bash
pip install vllm
vllm serve XiaomiMiMo/MiMo-7B-RL --host 0.0.0.0 --port 8000
# Optional auth: add --api-key <token> and set AI_SELFHOSTED_API_KEY.
curl http://localhost:8000/v1/models
```

## 2. Point the app at it

In `.env.local` / Cloud Run env (full annotations in `.env.example`):

```bash
AI_SELFHOSTED_BASE_URL=http://localhost:11434/v1   # /v1 optional, normalized
AI_SELFHOSTED_MODEL=mimo-7b                        # vLLM: XiaomiMiMo/MiMo-7B-RL
# AI_SELFHOSTED_API_KEY=                           # only if the server requires it
# AI_SELFHOSTED_TIMEOUT_MS=30000
AI_PROVIDER_ACTIONS_SELFHOSTED=getSafetyAdvice,getChatResponse
```

`npm run validate:env` checks the URL shape and that `AI_SELFHOSTED_MODEL`
is present whenever the base URL is set.

## 3. Choose which actions to migrate

- **Migrate incrementally**: six current prompt specs: `getSafetyAdvice`,
  `getChatResponse`, `queryBCN`, `calculateStructuralLoad`, `designHazmatStorage`,
  `evaluateMinsalCompliance`. A selected action WITHOUT a spec is an explicit
  miss: internal baseline/canned if available, otherwise 503. It never silently
  authorizes Gemini. Model quality/guardrails must be evaluated per action.
- **Keep on Gemini until evaluated**: legal-critical and structured-JSON
  actions (`auditLegalGap`, `generateEmergencyPlan*`, DIAT/SUSESO docs).
  Use the escape hatch `AI_PROVIDER_ACTIONS_GEMINI=...` if you flip
  `AI_PROVIDER_DEFAULT=selfhosted`.
- Adding a new action = add a prompt spec (mirror of its Gemini handler) to
  `selfHostedActions.ts` + tests, then list it in env.

## 4. Failure behavior (automatic)

**Default: do not switch provider.** Failure, an open breaker, missing config
or an unsupported selected action uses the existing deterministic emergency
baseline, or the internal canned tier for the three wired text actions, else
an honest 503. Canned output carries its existing fallback disclaimer; it is
not a replacement for generated analysis. The no-switch fallback skips normative
RAG because its embedding implementation can still contact Google.

Only `AI_SELFHOSTED_FALLBACK_GEMINI=1` explicitly authorizes retrying through the
legacy Gemini path. Absent/empty/0/mistyped values do not. The explicit
`AI_PROVIDER_ACTIONS_GEMINI` list remains an operator escape hatch.

The self-hosted breaker uses its own key (`selfhosted`) — 5 failures/60 s opens
it for 5 min with half-open probes — isolated from the Gemini breaker.

**Current retrieval boundary:** successful self-hosted builders for chat, BCN
and MINSAL now share the deterministic lexical public-law retriever with MCP,
without query-time embeddings (`src/server/rag/publicLawReader.ts`). Its scan is
bounded and provenance is `indexed-unverified`; no vector-recall equivalence or
legal currency is asserted. Corpus ingestion and other legacy RAG consumers can
still use Google. The no-switch failure tier above remains internal-only.
This does not remove the legacy provider for actions not selected for migration.
MCP client-owned inference and the opt-in normative UI are documented in
`docs/mcp/README.md`. No global provider independence is claimed here.

`AI_SELFHOSTED_TIMEOUT_MS` is one end-to-end deadline for a completion call:
receiving headers does not stop it. It covers response-body consumption and the
optional retry without `response_format` (the retry does not get a fresh budget).
A stalled body aborts with the sanitized `selfhosted_timeout` code, returning
control to the dispatcher so its existing fallback policy can run. Discarded
HTTP-error bodies are canceled; the timer is cleared on every settled path.
Cancellation/read cleanup waits also share that deadline: a non-cooperative
stream cancel cannot block forever or authorize a retry after expiration. This
bounds local waiting; it does not prove remote generation or billing stopped.

**Response budget:** the client accepts at most **256 KiB of decoded UTF-8 HTTP
JSON**, including the entire completion envelope/metadata, before `JSON.parse`.
The chunk crossing the cap may be read to detect overflow, but is never appended.
A declared Content-Length above the cap is rejected before reading;
small/missing/invalid declarations do not bypass the actual byte counter. Gzip
responses are checked after fetch decompression. Oversized chunks are not
appended, the reader is canceled and its lock released; oversize/invalid UTF-8
produce the existing sanitized `selfhosted_bad_response` (or `selfhosted_timeout`
if cleanup exhausts the call deadline). No output-driven retry, provider switch,
new error code, credential or environment-variable bypass is introduced.

This is a payload bound, not an exact bound on JS heap, transport/decompression
buffers or remote compute. It does not replace max_output_tokens, distributed
quotas or cost controls. Exactly-at-limit valid JSON/Unicode remains supported.
No migration or provider change is needed; reverting the code removes this guard
without changing routing or stored data.

Additional tests:

```bash
npm run test:ci -- src/services/ai/selfHostedProvider.bounds.test.ts src/services/ai/selfHostedProvider.bounds.http.test.ts
```

The HTTP tests call the actual client/dispatcher against loopback fixtures:
exact byte boundary, chunked oversize socket closure before EOF, compressed
response with small Content-Length, failure metrics without false success or
Gemini counters, and metadata-only error logging. Controlled Stream tests cover
split UTF-8, false headers, early cancellation, reader release and hung cleanup.
These budget-only tests do not invoke a commercial model or demonstrate full
application/UI, production IAM/corpus or remote-stop billing. Caller disconnect
wiring is covered separately below.

Regression coverage uses a synthetic loopback HTTP server, not a real model or
credentials:

```bash
npm test -- src/services/ai/selfHostedProvider.timeout.test.ts
```

The test verifies headers-before-timeout, stalled body, successful completion,
dispatch failure metrics and Gemini-breaker isolation, shared retry deadline,
timer/stream cleanup, and sanitized stream errors. It does not demonstrate a
production endpoint, deployment, physical-device behavior, or a full UI flow.

### Caller cancellation for selected self-hosted RPCs

`SelfHostedCallOptions.signal` and `SelfHostedDispatchOptions.signal` accept a
backend-owned AbortSignal. `/api/gemini` binds it for self-hosted-selected AI
actions before quota lookup: incoming `aborted` or a premature **response** close
aborts it. Normal `req.close` means request-body completion, not cancellation;
successful response completion must not abort. Existing closed states are checked
on binding. Request/response listeners are disposed in `finally` on every exit.

The provider snapshots that signal, relays abort to its original deadline
controller and removes the listener on settlement, including reused options.
Pre-aborted calls do not fetch. Caller abort is the sanitized
`selfhosted_cancelled`, distinct from the unchanged `selfhosted_timeout`; the
reason is never sent or logged. It cannot become a late successful DTO after
reader release or trigger a JSON-mode retry. The 256KiB bound remains in force.

The dispatcher returns terminal `{status:'cancelled'}`: not success, not vendor
failure, no breaker penalty or reset. In-flight cancellations get only the fixed
metadata event `selfhosted_cancelled`. No new public health-counter schema or
billing ledger is implied. Normal live success and real timeout/outage retain
their original metrics. No success quota outcome is emitted for a canceled
self-hosted attempt; admission quotas/rate limits are not bypassed or changed.

The route does not invoke canned/RAG/Gemini fallback for cancellation, even with
the cross-provider fallback flag on. It also rechecks caller state before
starting an opted-in legacy call after its quota/import await. A closed socket
gets no JSON write; an internally canceled result on a still-writable connection
has the defensive 499 `{error:'ai_request_cancelled'}` response. Live requests
retain their deterministic life-safety baselines and sync-write paths.

```bash
npm run test:ci -- src/services/ai/selfHostedProvider.cancel.test.ts src/services/ai/providerRouter.cancel.test.ts src/server/middleware/callerCancellation.test.ts src/__tests__/server/gemini.providerRouter.test.ts
```

API tests use the real Express route/dispatcher/client/fetch against loopback
HTTP: a real client disconnect closes the deliberately unfinished provider body,
with no fallback, JSON write, success-accounting or false health failure; a live
completed POST succeeds. A separate controlled-quota probe proves a Google
fallback is not started if the client closes while its gate is pending.
Identity, quota/data/legacy handlers are explicit fixtures, not real Firebase
IAM or a paid model. That HTTP-only proof does not exercise the UI; the text
consumer's browser contract is described separately below.
Already-started Firestore/context/quota reads may still settle; guards prevent
new inference afterward. Already-running legacy Gemini or durable sync writes
are not canceled here. Local abort does not prove remote compute/billing stopped.

### Keyboard-text consumer: owned waiting and transport cancellation

`GuardianVoiceAssistant` now exposes **Detener espera** for a text query only.
Its single AbortController is passed separately from serialized RPC arguments
to `semanticSearch` (fifth parameter) and `getChatResponse` (sixth parameter).
`GeminiCallOptions.signal` is snapshotted before authentication; pre-aborted calls
do not authenticate, an abort during auth prevents fetch, and an abort during
JSON completion cannot become late success. Abort reasons are not logged or
returned; other RPCs, including durable sync, stay opt-out and keep their payloads.

A text owner starts a 45,000ms UI deadline before import/auth/first RPC. Cancel or
expiry releases the UI without waiting for an uncooperative promise. Every await,
error and finalizer checks ownership; a retired result cannot overwrite or
release a newer query. Both close controls, unmount, committed project/UID/pathname
changes invalidate text ownership. The React Router pathname also defines the
domain; clearing the visible draft/result is not server-side authorization.

The owned 800ms offline delay is canceled before execution on retirement, so a
closed/canceled delayed query does not newly enter the pending queue. Normal
local advice and persistence remain. If a write already began, cancellation does
not undo it; if it fails or exceeds the UI budget, computed local advice is kept
with an honest failed/unconfirmed-save notice. No queue entries are deleted.
An in-scope microphone grant retires text ownership before the existing voice
path owns the shared busy state. A grant arriving after close/scope/unmount is
stopped before recorder creation and cannot cancel a newer text owner. This
handoff guard is not a full voice-permission/privacy audit; already-running voice
work is unchanged. The stop-wait button never advertises cancellation of voice
processing or its operational writes.

```bash
npm run test:ci -- src/services/geminiService.cancel.test.ts src/components/ai/GuardianVoiceAssistant.text.test.tsx src/components/ai/GuardianVoiceAssistant.test.tsx
```

Scoped Chromium proof mounts the actual widget and client service, then executes
the real API/router/dispatcher/self-hosted client/global fetch against loopback.
It proves stop → upstream close before EOF, a later live visible reply, project
change, deadline while auth is held, and an old auth finalizer not releasing a new
query. Browser cases use fixture auth/quota/corpus/semantic retrieval and disabled
voice hooks; not production IAM, a paid model, microphone/consent or Android.
The existing `semanticSearch` legacy path can still invoke Google embeddings in
production; fixture retrieval and client cancellation do **not** prove provider
independence, remote billing stop or cancellation of already-running Google.
This widget is distinct from the default resilient SLM AsesorChat; no BYOK/gateway,
global offline-queue scope migration or voice privacy/write authorization is
claimed here. Existing persisted work and provider policy are not changed.

## 5. Observe

- `GET /api/admin/circuit-state` → breaker states (`gemini`, `selfhosted`)
  + `aiProviders` per-provider success/failure/avg-latency counters.
- Logs: `[ai.provider] call {provider, outcome, latencyMs, action}` (never
  prompt content), `[ai.provider] selfhosted_call_failed {code}`.

## 6. Rollback

Rollback requires an explicit routing decision: add the intended actions to
`AI_PROVIDER_ACTIONS_GEMINI`, or remove their selfhosted selection and restore
the legacy default. Merely unsetting BASE_URL/MODEL does **not** authorize
another provider. No data migration is involved.

This is a compatibility escape hatch, not a deployment instruction or default
authorization to incur Gemini cost. Provider/model configuration remains
server-side; do not put credentials in frontend build variables.
