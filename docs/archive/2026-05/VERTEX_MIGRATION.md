# Vertex AI Migration — Data Residency Santiago

Runbook for migrating Praeventio's generative AI calls from the **Gemini
consumer endpoint** (`@google/genai`, US-routed) to **Vertex AI** in the
`southamerica-west1` (Santiago) region.

This document is the operational companion to the typed adapter scaffolding
shipped in `src/services/ai/`. The scaffolding is in place; the SDK install
and the wire-up of the real Vertex client are deferred to Round 2.

---

## 1. Why migrate

| Concern | Gemini consumer (today) | Vertex AI in Santiago |
|---|---|---|
| Data residency | US (`us-central1`) — data leaves Chile | `southamerica-west1` — Santiago, in-country |
| Regulatory fit | Borderline for Ley 19.628 / 21.719 | Direct fit; defensible to enterprise legal |
| Fine-tuning | Not supported on consumer endpoint | Supported on Vertex; tune on the Praeventio safety corpus |
| SLA | Best-effort | Enterprise SLA + HIPAA/SOC compliance posture |
| Billing | Pay-as-you-go tokens only | Tokens + committed-use options |
| Rate limits | Public-API quotas | Project-scoped quotas, raisable |

**Strategic value to Praeventio:** the Chilean enterprise sales conversation
(mining majors, retail HSE departments, LRSST consultants under Ley 21.643)
turns on data residency. Vertex Santiago lets us answer "where does the AI
process my workers' assessment data?" with "in Chile" instead of a footnote
about Google data-processing addenda.

---

## 2. Prerequisites

Before Round 2 starts:

1. **GCP project** — production project with billing enabled. Reuse the
   existing project that hosts Cloud KMS (`KMS_KEY_RESOURCE_NAME` already
   points at `southamerica-west1`; we co-locate AI in the same region for
   the same legal reason).
2. **Enable APIs:**
   ```sh
   gcloud services enable aiplatform.googleapis.com \
     --project=<PROJECT_ID>
   ```
3. **Service account** — the Cloud Run service identity needs the Vertex
   AI predict role:
   ```sh
   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member="serviceAccount:<RUN_SA>@<PROJECT_ID>.iam.gserviceaccount.com" \
     --role="roles/aiplatform.user"
   ```
   For prediction-only paths the narrower `roles/aiplatform.endpoints.predict`
   suffices; we use the broader `aiplatform.user` so future fine-tuning
   jobs from the same SA do not need a second role grant.
4. **Region** — confirm `southamerica-west1` is enabled for the model you
   intend to call. Gemini 1.5 Pro / Flash are GA there as of late 2025;
   re-verify in the Cloud Console before Round 2 cutover.
5. **Quotas** — request a quota raise for `online_prediction_requests_per_minute`
   in `southamerica-west1` if you anticipate >60 RPM. Consumer-endpoint
   traffic patterns are a good baseline.
6. **Authentication** — locally, `gcloud auth application-default login`.
   In Cloud Run, the service identity above is picked up automatically by
   the `@google-cloud/aiplatform` SDK via Application Default Credentials.

---

## 3. Round 2: install SDK + implement the real `vertexAdapter`

```sh
npm install @google-cloud/aiplatform
```

Replace the stub body in `src/services/ai/vertexAdapter.ts`:

```ts
import { PredictionServiceClient } from '@google-cloud/aiplatform';

class VertexAdapter implements AiAdapter {
  readonly name: AiProvider = 'vertex-ai';
  readonly region: string;
  readonly isAvailable: boolean;
  private client: PredictionServiceClient | null = null;
  private projectId: string;

  constructor() {
    this.region = process.env.VERTEX_REGION ?? 'southamerica-west1';
    this.projectId = process.env.GCP_PROJECT_ID ?? '';
    this.isAvailable = Boolean(this.projectId);
    if (this.isAvailable) {
      this.client = new PredictionServiceClient({
        apiEndpoint: `${this.region}-aiplatform.googleapis.com`,
      });
    }
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.client) {
      throw new Error('vertexAdapter: GCP_PROJECT_ID is not configured.');
    }
    const endpoint = `projects/${this.projectId}/locations/${this.region}/publishers/google/models/${req.model}`;
    const [response] = await this.client.predict({
      endpoint,
      instances: [{ structValue: { fields: { /* ... */ } } } as any],
      parameters: { /* temperature, maxOutputTokens, ... */ } as any,
    });
    // Map response → AiGenerateResponse (text, finishReason, usage).
    return { text: '...', provider: 'vertex-ai' };
  }
}
```

The exact request/response shape on `predict()` for Gemini-on-Vertex differs
from `@google/genai`; consult the [Vertex AI Gemini API
reference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)
when wiring this up. Pin the SDK major version in `package.json` once
chosen.

Required env in production:

| Var | Example | Purpose |
|---|---|---|
| `AI_ADAPTER` | `vertex-ai` | Selects this adapter via `getAiAdapter()`. |
| `VERTEX_REGION` | `southamerica-west1` | Default; override only for DR. |
| `GCP_PROJECT_ID` | `praeventio-prod` | Project hosting the Vertex API. |

---

## 4. Migration of `geminiBackend.ts`

`src/services/geminiBackend.ts` is 2664 LOC with ~25 separate
`ai.models.generateContent({...})` call sites. Big-bang rewrite is risky;
**migrate per call site**, oldest to newest by feature:

1. At the top of each function, swap:
   ```ts
   const ai = new GoogleGenAI({ apiKey: API_KEY });
   const response = await ai.models.generateContent({ model, contents, config });
   const text = response.text;
   ```
   for:
   ```ts
   const adapter = getAiAdapter();
   const response = await adapter.generate({ model, prompt: contents, ... });
   const text = response.text;
   ```
2. Where the call uses `responseSchema` (Type.OBJECT etc.), keep the
   direct SDK path for now — the adapter doesn't expose schemas yet. Add
   a `responseSchema?` field on `AiGenerateRequest` in a follow-up round
   when you migrate those call sites.
3. Where the call uses `embedContent`, leave it on direct `@google/genai`
   for now. The adapter does not expose embeddings; add `embedContent` to
   the interface in a follow-up.
4. **Rollout strategy:** ship each migrated call site behind the
   `AI_ADAPTER` env var. Default stays `gemini-consumer` until enough
   call sites are migrated to flip it project-wide. Gradual swap, no
   feature-flag service required.
5. Telemetry: emit `provider=` from `AiGenerateResponse.provider` on
   every AI call. After cutover, dashboards should show 0% gemini-consumer
   for Chilean tenants.

---

## 5. Cost analysis

**Verify pricing before committing budget.** Quote the relevant cells from
[cloud.google.com/vertex-ai/pricing](https://cloud.google.com/vertex-ai/pricing)
into the budget doc; do not rely on this runbook for live numbers.

Approximate as of Q4 2025 (Gemini 1.5 Pro, `southamerica-west1`,
input + output token mix typical for Praeventio):

- Input tokens: ~3.5x consumer pricing.
- Output tokens: ~3.5x consumer pricing.
- Premium reflects regional infra + enterprise SLA.

**Mitigation:** committed-use discounts (1y / 3y) bring effective cost back
under 2x consumer for steady-state traffic. Negotiate the commit *after*
2-4 weeks of post-cutover data so the commit size is calibrated.

---

## 6. Fine-tuning roadmap

The fine-tuning pipeline is the strategic moat. It is *not* part of Round 2;
this is the longer-horizon plan.

- **Phase 1 — Stock Gemini in Santiago (Round 2).** Just swap the endpoint;
  use the same prompts. Validate that quality is equal-or-better than the
  consumer endpoint on the Praeventio eval set.
- **Phase 2 — Corpus collection.** Anonymise IPER / REBA / Fast Check
  assessments. Strip PII (worker names, RUTs, GPS coordinates). Target:
  10k–50k labelled assessments before tuning is worthwhile.
- **Phase 3 — Supervised fine-tuning.** Use Vertex AI's tuning pipeline on
  the corpus. Start with a single specialised task (e.g. classify
  observations into RISK/FINDING/MITIGATION — see
  `analyzeFastCheck()` in `geminiBackend.ts`).
- **Phase 4 — A/B test.** Route 10% of production traffic for the targeted
  task to the tuned model. Compare against stock Gemini on:
  classification accuracy, hallucination rate (especially on
  Chilean-specific norms — DS 594, Ley 16.744 article references), latency.
- **Phase 5 — Productionise.** Promote the tuned model behind a new
  `model:` value passed through `AiGenerateRequest`. The adapter contract
  does not change.

---

## 7. Disaster recovery

The adapter pattern handles three independent failure modes cleanly:

1. **`southamerica-west1` is degraded.** Operator sets
   `VERTEX_REGION=us-central1` and restarts. Adapter reads the new region
   on construction. Data leaves Chile temporarily — log this loudly,
   notify Legal, treat as an incident.
2. **Vertex AI is fully down (rare).** Operator sets
   `AI_ADAPTER=gemini-consumer` and restarts. Falls back to the consumer
   endpoint. Same data-egress incident handling.
3. **Both Vertex and consumer down (extremely rare; usually a Google-wide
   outage).** Operator sets `AI_ADAPTER=noop`. AI features degrade to
   empty completions — call sites should already handle empty `text` (the
   existing `geminiBackend.ts` pattern is "if not API_KEY, return []").

The facade `getAiAdapter()` already encodes the silent
`vertex-ai → gemini-consumer → noop` fallback chain so a partially
configured environment doesn't immediately break the app, but operators
who care about data residency should monitor `AiGenerateResponse.provider`
and alert on `provider !== 'vertex-ai'` for Chilean tenants.

---

## 8. Testing

- **Unit tests** — `src/services/ai/aiAdapter.test.ts` covers the facade
  selection logic and the gemini-consumer adapter (with `@google/genai`
  mocked). The vertex adapter has stub-throw coverage.
- **Round 2 unit tests** — once the real Vertex client is wired, mock
  `@google-cloud/aiplatform`'s `PredictionServiceClient` with the same
  pattern as the KMS adapter's `KeyManagementServiceClient` mock.
- **Integration tests** — stand up a Vertex AI sandbox project (separate
  from prod) with a $50 monthly cap. Run a small smoke-test corpus
  (~10 prompts) on every CI green-light to catch regional-quota or
  model-availability breakage early.
- **Cutover test** — before flipping `AI_ADAPTER=vertex-ai` in prod, run
  the Praeventio eval set against both adapters with identical prompts
  and diff the outputs. Expect lexical drift on free-text outputs but
  zero drift on JSON-mode classifier outputs.
