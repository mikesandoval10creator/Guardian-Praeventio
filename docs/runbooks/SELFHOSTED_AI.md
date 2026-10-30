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

Regression coverage uses a synthetic loopback HTTP server, not a real model or
credentials:

```bash
npm test -- src/services/ai/selfHostedProvider.timeout.test.ts
```

The test verifies headers-before-timeout, stalled body, successful completion,
dispatch failure metrics and Gemini-breaker isolation, shared retry deadline,
timer/stream cleanup, and sanitized stream errors. It does not demonstrate a
production endpoint, deployment, physical-device behavior, or a full UI flow.

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
