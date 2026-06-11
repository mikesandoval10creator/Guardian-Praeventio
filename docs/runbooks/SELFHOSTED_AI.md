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

- **Migrate first**: high-volume / simple text actions. Wired today:
  `getSafetyAdvice`, `getChatResponse`, `queryBCN` (the prompt specs live in
  `selfHostedActions.ts`; an action listed in env WITHOUT a spec silently
  keeps using Gemini and logs `selfhosted_unsupported_action`).
- **Keep on Gemini until evaluated**: legal-critical and structured-JSON
  actions (`auditLegalGap`, `generateEmergencyPlan*`, DIAT/SUSESO docs).
  Use the escape hatch `AI_PROVIDER_ACTIONS_GEMINI=...` if you flip
  `AI_PROVIDER_DEFAULT=selfhosted`.
- Adding a new action = add a prompt spec (mirror of its Gemini handler) to
  `selfHostedActions.ts` + tests, then list it in env.

## 4. Failure behavior (automatic)

`selfhosted fails` → retry on Gemini (`AI_SELFHOSTED_FALLBACK_GEMINI=1`,
default) → existing degraded ladder (RAG → canned). With fallback `=0` the
ladder runs directly, else 503. The self-hosted circuit breaker uses its own
key (`selfhosted`) — 5 failures/60 s opens it for 5 min with half-open
probes — fully isolated from the Gemini breaker.

## 5. Observe

- `GET /api/admin/circuit-state` → breaker states (`gemini`, `selfhosted`)
  + `aiProviders` per-provider success/failure/avg-latency counters.
- Logs: `[ai.provider] call {provider, outcome, latencyMs, action}` (never
  prompt content), `[ai.provider] selfhosted_call_failed {code}`.

## 6. Rollback

Unset `AI_SELFHOSTED_BASE_URL` (or `AI_SELFHOSTED_MODEL`) and restart —
everything routes to Gemini again, exactly as before the feature existed.
No data migration, no code change.
