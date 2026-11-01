# Guardian Praeventio — STRIDE Threat Model

**Sprint 20, eighth wave (Bucket B — STRIDE).**
**Date: 2026-09-07.**
**Status: living document; revisit each major release that touches the
auth, billing, or AI surfaces.**

This document is the security baseline for the Praeventio platform. It is
deliberately concrete to *this* codebase — every finding ties to a real
file:line and proposes a bounded mitigation. Generic advice has been kept
out.

Companion artefacts:
- [`data-flow-diagram.md`](./data-flow-diagram.md) — DFD with trust boundaries.
- [`STRIDE_findings.md`](./STRIDE_findings.md) — findings table (33 entries).
- [`incident-response.md`](./incident-response.md) — runbook on detection.
- [`severity-rubric.md`](./severity-rubric.md) — severity scoring (existing).
- [`PENTEST_CHECKLIST.md`](./PENTEST_CHECKLIST.md) — Dirty Dozen automated
  pentest of `firestore.rules` (Bucket RR). Tampering / Elevation rows
  in §7 are cross-linked to specific test cases.
- [`docs/audit/auditoria777.md`](../audit/auditoria777.md) — Sprint 19 audit
  cross-linked from individual findings.

---

## 1. Scope

### In scope
- Express API entry (`server.ts`) and the 21 mounted routers under
  `src/server/routes/*` and middleware under `src/server/middleware/*`.
- Firestore Security Rules (`firestore.rules`) and the server-side
  membership helper (`src/services/auth/projectMembership.ts`).
- Authentication and session lifecycle: Firebase ID token verify
  (`verifyAuth.ts`), session cookies, OAuth Google (`oauthGoogle.ts`),
  WebAuthn credential store (`src/services/auth/webauthnCredentialStore.ts`).
- Payment flow: Webpay/Transbank (`webpayAdapter.ts`), MercadoPago IPN
  (`mercadoPagoIpn.ts`), Google Play RTDN (`billing.ts`).
- AI inference path: `/api/ask-guardian`, `/api/gemini`, allowlist gate
  (`src/server/routes/gemini.ts`), Vertex AI client.
- Offline path: on-device SLM, IndexedDB queue
  (`src/services/slm/offlineQueue.ts`), reconciliation against the
  Zettelkasten endpoint.
- Observability sinks: Sentry server (`sentryAdapter.ts`,
  `sentryInstrumentation.ts`) and Sentry browser (`src/lib/sentry.ts`).

### Out of scope (covered elsewhere or accepted risk)
- GCP infrastructure hardening (VPC-SC, Org Policies, BeyondCorp,
  network egress controls). Tracked separately under "platform
  hardening". Cloud Run DDoS at the L4 layer is mitigated by Google
  Front-End and is not Praeventio's responsibility to address.
- Build / CI supply chain: GitHub Actions secret hygiene, npm registry
  threats, container base image vulnerability scanning. Partially
  covered in `docs/security/incident-response.md`; full SLSA work
  deferred.
- Physical device security on the Capacitor mobile shell: rooted phones,
  jailbreak detection, root-of-trust attestation. Not in product
  roadmap.
- Multi-region disaster recovery and Firestore backup policy.
- Compliance certification (ISO 27001, SOC 2). Praeventio's regulatory
  envelope today is Chilean Ley 16.744, DS 54, DS 44/2024, and Ley 19.628
  (privacy). ISO 45001 §7.5.3 informs the audit trail design but is not
  a security boundary.

---

## 2. System overview

Guardian Praeventio is a multi-tenant occupational-safety platform built
as a React SPA + Express API on Cloud Run, persisting to Firestore. AI
inference goes to Vertex AI Gemini (`gemini-3.1-pro-preview`). Payments
go through Transbank Webpay (Chile, CLP) and MercadoPago (LATAM, USD/BRL).
A Capacitor mobile shell wraps the SPA for Android/iOS.

End-user flows that matter for security:
1. **Sign-in**: Firebase Auth (Google SSO or email-link). The browser
   holds the ID token and attaches it as `Authorization: Bearer` on
   every API call.
2. **Project work**: project-scoped CRUD on Firestore via the SPA, gated
   by `firestore.rules`. Server-side endpoints layer `assertProjectMember`
   on top for sensitive operations (gamification, Zettelkasten writes).
3. **Asesor (AI chat)**: SPA -> `/api/ask-guardian` -> Vertex AI. The
   server injects environmental context (climate, seismic) before
   dispatching to Gemini.
4. **Payment**: SPA -> `/api/billing/checkout` returns a Webpay redirect
   URL. The user lands on Transbank, returns to `/billing/webpay/return`,
   the server commits the transaction, writes the audit row, and updates
   the invoice.
5. **Offline**: when `navigator.onLine === false`, queries are answered
   by an on-device SLM and pushed into an IndexedDB queue. On
   reconnection, the queue is drained into the Zettelkasten via a
   reconciliation pass.
6. **Mobile push**: the Capacitor shell registers an FCM token; the
   server fans out emergency notifications via
   `admin.messaging().sendEachForMulticast`.

See [the DFD](./data-flow-diagram.md) for the visual.

---

## 3. Trust boundaries

| # | Boundary | Crossing example | Defenses |
|---|----------|------------------|----------|
| 1 | Internet edge | Browser -> Cloud Run | TLS, helmet CSP, global rate-limit (100 req / 15 min), per-uid limiters (`limiters.ts`), 64 kb body limit |
| 2 | Authentication | Bearer header -> verified `req.user` | `verifyAuth.ts`: Admin SDK `verifyIdToken` (signature, expiry, audience, revoked) |
| 3 | Tenant isolation | Authed user -> project resources | Firestore rules `isProjectMember`, server-side `assertProjectMember` |
| 4 | GCP project | Express -> Vertex/Firestore/FCM | Cloud Run service account IAM bindings |
| 5 | Browser sandbox | SPA -> SW -> IndexedDB | Origin isolation; IDB unencrypted at rest (TM-T03) |
| 6 | Third-party processors | Express -> Transbank, Sentry, Resend, Play | Vendor-specific secrets, signed callbacks |
| 7 | Observability | Errors -> Sentry SaaS | Server `sentryInstrumentation.ts` redacts; client `lib/sentry.ts` `redactPii` |

### MCP operator-to-client boundary (implementation delta)

The stdio server is an operator-managed read-only process, **not** a new HTTP
multi-user identity boundary. The operator tenant whitelist and explicit
project context opt-in gate the six shared action prompts. Each get checks
scope before retrieving project records; existing tenant scoping in the data
adapter remains. Prompt preparation works without sampling, but it does not
execute an LLM or grant the host permission to mutate Guardian.

- **Disclosure / prompt injection:** project text and indexed law excerpts are
  untrusted data. Minimized project fields and text redaction reduce exposure;
  names and other sensitive details can remain. Operator opt-in is not proof
  of regulatory consent. Host/user approval is still required. Instructions
  and advisory labels do not prove semantic compliance by an external model.
- **Source tampering:** native legal retrieval reads only canonical `law-*`
  candidates, excludes project/tenant/node-bearing rows, and preserves literal
  IDs/excerpts. `indexed-unverified` is explicit: index-writer privileges,
  authenticity, currency, web provenance and legal validity remain trust
  assumptions, not properties inferred from a generated URL or lexical match.
- **Cost / availability:** prompt and legal-tool calls share six attempts per
  minute and one concurrent operation per process. Public-law reads cap at
  201 candidates, omit embeddings and report a truncated scan. This is not a
  distributed quota, complete-corpus search, or remote Firestore cancellation.
- **Safety / elevation:** medical, legal, engineering and emergency material
  stays consultative and requires competent professional review. Prepared
  prompts do not authorize work, certify capacity/compliance, diagnose, write
  records or trigger life-safety actions. No returned model output is ingested
  by this path. This delta does not validate the legacy generation UI.
- **Credentials:** model selection and API credentials remain in the user's
  host. Guardian adds no inference credential vault or mandatory provider.
  Firestore read-only credentials remain the existing separate storage concern.

Local negative protocol tests cover foreign scope, disabled opt-in, malformed
arguments, arbitrary action names, error redaction and session read budget;
compiled stdio tests use controlled data, not production IAM or real inference.
CI, deployment and live corpus provenance/recall are separate acceptance levels.

**Typed-relation read delta (`zk.listEdges`):** the operator must additionally
set `PRAEVENTIO_MCP_TYPED_EDGES=1`; tenant/project context allowlists still apply.
The SDK-only tool is hidden without the reader/allowlist and shares the local
context budget. Admin SDK bypasses rules: the reader itself queries tenant
edges with a project predicate before its limit and checks both endpoint
documents in that tenant/project. It rejects malformed/contradictory stored
records without inferring types from adjacency or materializing inverses.

- **Disclosure / spoofing:** output is an allowlisted relation projection,
  excluding creator IDs, arbitrary metadata and node text. Original relation
  and endpoint IDs remain potentially sensitive, not anonymized. A conflicting
  endpoint tenant stamp fails closed; absent legacy stamps are trusted only by
  the tenant collection plus required project match. No global-store fallback.
- **Availability:** at most 51 edge candidates, 100 distinct endpoint reads,
  and 64 KiB UTF-8 JSON payload before MCP envelope. Local budget remains six
  attempts/minute, one operation; no distributed quotas or remote SDK abort.
  A failed read is an error, not an empty successful graph.
- **Integrity / safety:** weights, dates, type and inverse labels are stored
  values, not real-world causal or barrier-effectiveness evidence. Bounded,
  omitted/truncated results do not prove a complete graph. No writes, model
  calls, inverse creation, emergency activation or automatic decision authority.
- **Residual:** operator/service-account compromise, host retention, individual
  consent/revocation, production IAM/corpus, historical-store convergence and
  HTTP multiuser exposure remain outside this read-only stdio proof. Regression
  gates: `typedEdgesReader.test.ts`, `typedEdges.protocol.test.ts` and the actual
  compiled-reader/SDK/stdio fixture in `scripts/mcp-build.test.mjs`.

**Explicit typed sampling delta:** `zk.analyzeProject` only shares relations
when the caller supplies boolean `includeTypedEdges: true` and the operator
already enabled the reader/project. Tenant/project authorization precedes data
reads. The consumer revalidates the reader envelope and each stored relation,
retains only endpoints in the existing 12-node subset, strips metadata/creator
and scope stamps, and never fetches extra context or infers missing relations.
At most 13 edge candidates/24 endpoint reads are additional to the existing node
query; failure is explicit, never silent node-only fallback or provider switch.

- **Integrity:** returned node/edge citations must match the actually shared
  IDs; malformed syntax mixed with valid citations fails closed. This does NOT
  validate truth, causal reasoning, effective barrier strength or legal currency.
  Stored labels/weights/dates remain untrusted advisory data, not instructions.
- **Availability:** sampling parameters, including system prompt and escaped
  data, cap at 64 KiB UTF-8 before the JSON-RPC envelope. Existing sampling
  cancellation/deadline and separate six-attempt/minute single-analysis budget
  remain; the deterministic context/read budget is a separate bucket, not one
  global concurrency quota. Remote Firestore cancellation is not asserted.
- **Residual:** model approval/retention and possible unsafe prose remain host
  and professional-review concerns. No writes, automatic operational action,
  production IAM, real commercial inference or browser integration demonstrated.
  Gates: `projectAnalysis.typed.test.ts`, actual SDK sampling protocol, and
  compiled stdio with the real reader/tenant adapter plus controlled fixtures.

**Sampling free-text minimization delta:** shared authorized project context
redacts known PII-shaped patterns in type/title/description before its length
cuts; client-sampling question is also redacted before constructing outbound
parameters. This uses the same pure redactor as MCP prompts, not another model
or key. Field-level projection preserves literal node/edge IDs and citations,
does not mutate adapter records and avoids corrupting identifiers by redacting
the whole JSON string. Scope, budgets, approval and output validation remain.

The heuristic covers known RUT/email/CL mobile/card-like/API-key-prefix forms,
not names, arbitrary secrets, already-truncated upstream identifiers or all
reidentification risk. Preserved IDs may contain PII. This is minimization,
NOT anonymization or legal/host-retention compliance. No raw-text telemetry,
production IAM or real inference is added. Gates include truncation-crossing
tokens, sensitive-shaped literal citation IDs, Unicode/no-PII controls and
canonical pattern categories in `projectAnalysis.privacy.test.ts`, plus actual
SDK and compiled real-reader/stdio fixtures with synthetic sensitive text.

**Application → internal MCP bridge delta:** authenticated
`POST /api/mcp/project` is a fixed application dispatcher, NOT public MCP HTTP,
remote stdio spawning or a user-URL connector. Per-request real SDK sessions
have no sampling/model capabilities and expose only catalog, minimized project
records, stored typed relations, native legal search and six prepared prompts.
Unknown fields/tools/URLs/tenant overrides are rejected before resource reads.

- Identity is verified by existing Firebase middleware. Current project
  membership and canonical tenant come from the SAME project snapshot, without
  a stale positive membership claim shortcut. Missing tenant is409, explicit
  contradictory tenant claim/foreign membership403; no tenant inference or
  legacy migration. Current project creation server-stamps tenant from owner.
- Internal adapter projects at most12 nodes, omits tags/adjacency (empty arrays
  are omission, not proof of no links), and retains literal IDs. `getNode`/BFS
  are not accepted by the bridge; legacy stdio is unchanged. Typed reader
  independently checks edge endpoints. Prompt preparation requires explicit
  context review, not automatic third-party sharing or operational action.
- Known text patterns are minimized, not anonymized. Rendering is plain text;
  no HTML/tool-output execution or secret-entry fields. Audit attempts include
  operation/scope, never prompt/query/result text; best-effort failure is
  explicit in API/UI. Business graph data is read-only; audit metadata writes
  still occur through the standard sink.
- Separate application budget:6 attempts/minute per verified UID,1 pending job
  per UID/4 per router-process, fresh SDK sessions cannot reset it. Input
  logical JSON32KiB and result256KiB before their envelopes. `no-store` precedes
  auth/limit inside the router. HTTP deadline15s after auth/validation, SDK12s,
  UI20s including client-auth wait; abort closes sessions, but remote Firestore
  cancellation is not promised. Pending work retains its slot until settled.
- Default surface is authenticated, project-member-only and button-driven; a
  literal server `PRAEVENTIO_MCP_APP_DISABLED=1` kill switch denies data access
  without removing native/offline features or existing stdio. No new public
  listener, provider, credentials, writes to nodes/edges or automatic model use.
- Residual: no distributed quota, proof of live IAM/corpus/host-retention,
  remote-host auth, revocation linearizability, complete graph/safety truth or
  production/deployment acceptance. Stalled storage can occupy bounded slots.
  Details/rollback: [`../mcp/APP_BRIDGE.md`](../mcp/APP_BRIDGE.md). Gates:
  real SDK route tests + mounted UI tests + Chromium actual Normatives page
  through HTTP/SDK/readers, replacing only explicit identity/data/shell fixtures.

**Guided MCP input delta:** the six input schemas are extracted unchanged into
pure `actionPromptInputs.ts`, shared by the server and UI without provider/SDK
imports. Guided fields emit the existing positional arrays; no model action,
new argument, permission, storage write or template change. Missing measurements
are omitted, not coerced to0; decimal/finite/range validation precedes preparing.
Chat emits explicit empty context/history slots rather than JSONnull holes;
server still replaces context. Advanced JSON/history remains available, with
per-edit/action/project/mode approval reset and visible exact argument preview.
The same full decoded HTTP JSON32KiB budget is checked server-side and before
fetch (UTF-8/nested escaping, not input-character count). Client validation is
not an authorization boundary. Hazardous-material units/class remain a declared
legacy limitation; fields do not certify engineering/medical/legal truth.
Verification: pure compiler/registry tests, mounted panel payload tests, all six
actual Normatives form→HTTP→SDK→builder→visible prepared-message flows with
explicit fixture identities/storage. No full-app/real-corpus/model claim.

**LLM HTTP payload/cancellation delta:** the existing self-hosted completion
client replaces unbounded `res.json()` with a reader accepting <=256KiB decoded
UTF-8 HTTP JSON (including unused envelope/metadata). Oversized declared length
is rejected before pulling; actual bytes remain authoritative for chunked/gzip
or absent/false lengths. The crossing chunk can be received, never appended.
Malformed UTF-8/oversize use existing sanitized `selfhosted_bad_response`, not
partial/fabricated text, new error content, provider choice or inference.
Reader locks are released; cancellation/read/error-body cleanup waits use the
existing one-shot controller deadline, including the optional HTTP400 JSON-mode
retry. A stalled cleanup cannot turn into late success or a new retry. No claim
that abort stops remote compute/billing; no absolute JS-heap/transport-buffer,
distributed quota, caller HTTP-disconnect or model quality guarantee. No keys,
URLs from the browser, new listeners/routes or env bypass knobs introduced.
Gates: adversarial real Streams plus actual loopback HTTP for boundary Unicode,
chunked cutoff/socket closure, gzip decoded overflow and real production action
dispatcher failure1/success0/Gemini counters0 with fixed metadata-only error log.
Request schemas and normal typed error/fallback policy remain unchanged.

**Self-hosted caller-lifecycle delta:** only self-hosted-selected AI RPCs bind
backend-owned request-aborted/premature-response-close state; normal incoming
body `close` is not cancellation. Scope/allowlist/auth, durable sync and live
deterministic baselines are unchanged. An optional caller signal is snapshotted
and relayed to the existing provider deadline controller with sanitized
`selfhosted_cancelled`, no arbitrary reason. Listeners/timers are disposed on
settlement; late reader completion cannot become success. Dispatcher cancellation
is terminal, neither vendor success nor failure, with metadata-only event and
no health-breaker poisoning. Route blocks fallback/response/quota-success for an
aborted attempt and rechecks before opted-in legacy invocation after quota/import
await. No cancellation RPC/ID capability, client keys/URLs or provider changes.
Real HTTP probes cover API disconnect → actual upstream close, zero JSON writes,
zero fallback/success outcome and normal request completion. Controlled probes
cover pending context, repeated cancellations + later live success, split
deadline/caller errors, reused options, reader-release race and listener cleanup.
No claim of remote cancellation/billing, cost accounting, canceling already-started
Firestore/legacy Gemini/persistence, new UI, production IAM or inference quality.

**Text-query UI lifecycle delta:** the existing voice widget's keyboard-text
consumer owns a signal/45s budget started before auth, never serialized with RPC
arguments. Pre/post-auth and post-JSON checks sanitize caller abort without raw
reason logging. Text ownership is retired on explicit wait-stop, both panel
closes, unmount or committed project/UID/pathname change; late results/errors and
finally blocks cannot seed or release a new consumer. This is a UI boundary, not
a replacement for backend identity/membership. Deferred offline work is canceled
before creating a new pending query; already-started persistence is not undone.
Local advice survives failed/unconfirmed saving, without a false persisted claim.
An in-scope microphone grant transfers busy-state ownership away from retired
text. A capture epoch rejects/stops a delayed granted stream after close,
committed identity/context change or unmount, before it can retire a newer text
owner or create a recorder. This does not audit every voice callback or rewrite
voice generation/incident/plan persistence/consent policy.
Chromium verifies actual widget/service/API/dispatcher/client/fetch with HTTP
provider fixtures, including pre-auth stall and causal late-finalizer/new-request
ordering. Auth/quota/corpus/semanticSearch/voice are fixtures. Existing legacy
semanticSearch Google dependency, global offline pending queue scope and voice
privacy/operational-write authorization are not closed by this change; no new
provider/key/URL, model quality, paid inference, Android/OEM or remote billing-stop
claim. Default resilient AsesorChat and durable sync paths are unchanged.

**Opt-in local context delta:** the text widget can bypass its auxiliary semantic
RPC using experimental lexical selection over an already-loaded client snapshot.
Exact project filtering precedes a500-unique-candidate budget,64 query terms,
positive lexical matches/title3-description1 and deterministic literal-ID ties.
Only ID/title/description/type are projected; recognized PII is redacted before
Unicode-safe field cuts. Oversized raw fields are omitted whole before regex
work; oversized IDs are omitted rather than rewritten. Complete JSON (metadata
included) is capped at4000 UTF-16 units/5 records; partial coverage, limits and
truncation reach the model, including empty projections. This is not server
identity/membership, a full graph scan, legal truth or prompt-injection resistance.
Literal IDs, names and unrecognized secrets may remain sensitive; downstream
prompt redaction still applies. Existing caller-ownership/cancel/deadline guards
remain active. No hidden semantic retry on empty/error. Enter/server retrieval,
voice/offline/persistence and provider policy are preserved. The mode is explicit
experimental opt-in because corpus-recall equivalence is unproved; “local” is
not on-device inference or no outbound data. Chromium observes actual model HTTP
messages from real helper/widget/client/route/builders with mixed-project fixture
records; auth/quota/legal corpus/legacy retrieval/voice are fixtures. No global
Google independence, BYOK/consent compliance, Android or production claim.

Every finding in [`STRIDE_findings.md`](./STRIDE_findings.md) is anchored
to one of these boundaries.

---

## 4. Assets and value

| Asset | Where it lives | Sensitivity | Notes |
|-------|----------------|-------------|-------|
| Firebase ID tokens | Browser memory, Authorization header | medium | Short-lived (~1 h). Refresh tokens managed by Firebase SDK in IndexedDB scoped to origin. |
| Worker PII (RUT, name, email, role, project membership) | Firestore | medium | Chilean Ley 19.628 personal data; Ley 16.744 retention. |
| Worker medical exams sub-collection | `users/{uid}/medical_exams/*` | high | Strict envelope: only owner + `medico_ocupacional` can read (`firestore.rules:186-189`). |
| GPS / location traces | Firestore + Sentry breadcrumbs | medium | Scrubbed from Sentry breadcrumbs (`lib/sentry.ts:60-79`). |
| Audit log trail | `audit_logs/*`, append-only | high | Required for ISO 45001 §7.5.3 and SUSESO investigations. |
| Zettelkasten knowledge graph | `zettelkasten_nodes/*` | medium | Server-only writes; project-scoped reads. NEVER exposed via public API per product policy (B2D). |
| `GEMINI_API_KEY` | Secret Manager | high | Cost lever — leak = unbounded Vertex spend until rotation. |
| `WEBPAY_API_KEY`, `WEBPAY_COMMERCE_CODE` | Secret Manager | high | Production Transbank credentials. Defaults route to integration sandbox. |
| `SESSION_SECRET` | Secret Manager (prod), random in dev | high | Boot fails in production if missing (`server.ts:231-243`). |
| `IOT_WEBHOOK_SECRET`, `MP_IPN_SECRET` | Secret Manager | high | HMAC keys for telemetry and MP IPN. Per-tenant rotation via `/api/admin/iot/rotate-secret`. |
| `SENTRY_DSN` | Secret Manager | medium | Public-key DSN; loss = noise capture by attacker, not a privacy leak. |

---

## 5. Adversary models

### 5.1 External attacker (untrusted internet)
- **Goals**: data theft, credential abuse, cost-burning DoS, payment
  fraud.
- **Capabilities**: HTTP requests, basic JS, public OSINT. Does not have
  a valid Firebase ID token.
- **Defenses they hit first**: TLS, rate-limit (100/15min), helmet CSP,
  64 kb body, `verifyAuth` 401.

### 5.2 Malicious authenticated user (insider, low privilege)
- **Goals**: privilege escalation, cross-tenant read/write, manipulate
  audit log, self-promote subscription, exfiltrate PII via AI prompt.
- **Capabilities**: a valid Firebase ID token, ability to call any
  endpoint that `verifyAuth` admits, ability to write Firestore docs
  the rules permit.
- **Defenses they hit first**: Firestore rules `isProjectMember`,
  `assertProjectMember` server-side, subscription mutation block at
  `firestore.rules:177-182`, audit log immutability at
  `firestore.rules:375-386`, `audit_logs:create=false`.

### 5.3 Compromised dependency (npm supply-chain or stolen 3rd-party token)
- **Goals**: outbound PII exfiltration, run-time injection, ransom.
- **Capabilities**: malicious npm package or rogue CI step that gets
  bundled into the SPA or server.
- **Defenses they hit first**: CSP `connectSrc`/`scriptSrc` allowlist
  (limits exfil destinations), Sentry redaction for any errors that try
  to ride observability, Firestore rules default-deny for any unknown
  collection. `vite.config.ts:106-120` mangles names + drops console.

(See TM-I05 for an open finding tightening `*.googleapis.com` wildcard.)

---

## 6. Methodology note

We applied **STRIDE per element** rather than per-trust-boundary or
per-threat. The three highest-risk elements were walked through every
STRIDE category:
1. **Express API** at the internet edge — every category.
2. **Offline IndexedDB queue + reconciliation** — Tampering, Information
   disclosure, Repudiation.
3. **Payment flow** (Webpay return + RTDN webhook) — Spoofing,
   Tampering, Repudiation.

Lower-risk elements (gamification, organic structure, ergonomic
assessments) were reviewed only for the categories that the rules
trivially apply (Tampering, Elevation). Keeping the focus on the three
hot paths is what made the findings table actionable rather than
encyclopedic.

---

## 7. STRIDE walkthrough

### 7.1 Spoofing (S)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-S01 | E2E_MODE token bypass leaked into prod | Attacker forges `E2E <secret>:<uid>` header | **mitigated** by boot-time fail-closed guard (`verifyAuth.ts:33-38`) |
| TM-S02 | Forged ID token / wrong audience | Cross-project token replay | **mitigated** — `admin.auth().verifyIdToken()` validates audience for the configured project (`verifyAuth.ts:83`) |
| TM-S03 | OAuth callback CSRF (state nonce) | Attacker tricks user into binding their Google account | **partial** — needs explicit unit test in `oauthGoogle.test.ts` confirming state mismatch returns 401 |
| TM-S04 | Curriculum referee magic-link enumeration | Attacker brute-forces co-sign tokens | **mitigated** — 256-bit token, hash at rest, `refereeLimiter` 30/15min |
| TM-S05 | Telemetry HMAC forgery | Attacker submits `/api/telemetry/ingest` for another tenant | **mitigated** — per-tenant HMAC over canonical body |

### 7.2 Tampering (T)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-T01 | Self-promote subscription tier from client | Worker writes `users/{uid}` with `subscriptionPlan='ilimitado'` | **mitigated** — diff-based deny at `firestore.rules:177-182`; `/api/subscription/upgrade` requires paid invoice. **Validated by `dirtyDozen.test.ts` #2 (privilege escalation) and #11 (stale claims).** |
| TM-T02 | Self-fabricate audit log entry | Worker writes a fake "I revoked admin X" entry | **mitigated** — `audit_logs:create=false` + server-side actor stamping. **Validated by `dirtyDozen.test.ts` #2 (worker create denied) and #3 (gerente update denied).** |
| TM-T03 | Tamper IndexedDB offline queue before reconciliation | Local malware modifies `{query, response}` on disk; reconciliation writes attacker-controlled node into Zettelkasten | **open** — needs HMAC over queued entries keyed on a device-derived secret |
| TM-T04 | Webpay double-commit via redelivered token_ws | Browser refresh during Webpay return commits twice | **mitigated** — `processed_webpay/{token_ws}` lock-then-complete + 5-min stale window |
| TM-T05 | DTE queue duplicate emission during concurrent drain/recovery | Two workers or a crash after a provider timeout can repeat a tax-document side effect | **partial (merged; deployment pending)** — dedicated transactional `dte_issue_claims/{idempotencyKey}` lease plus Bsale `salesId` deduplication are integrated by PR #1638; local Emulator is 8/8, while deployed PSE evidence remains pending. |
| TM-T06 | CargoCog/stowage safety label | Non-finite cargo data or payload overage can be presented as operationally safe | **partial (merged; deployment pending)** — PR #1641 (`a72ff325e0e032fe9c87358d6bf3e3b0058a2a9`) integrated runtime validators, overflow guards and the global `SEGURO` gate; local CargoCog tests are 28/28 and CI passed. Real cargo source, persistence and physical dispatch validation remain out of scope. |
| TM-T07 | Top-level wisdomCapsules read | A verified user can read capsules from another tenant/project | **partial (merged; deployment pending)** — PR #1643 is integrated: the scope requires `tenantId` claim plus `selectedProject.id`, the Firestore rule binds both to project membership, and malformed client records fail closed. Emulator coverage includes member/outsider/no-auth/admin and spoofed writes. Deployed cross-tenant/Auth-claim evidence remains pending. |

| TM-T08 | ZK get-edges project isolation | Same-tenant project A receives typed edges stamped for project B | **partial (merged; deployment pending)** — PR #1644 (`7a6400a974b6b452ca14c68061b110b84c5a5672`) integrates `listByProject(tenantId, projectId, limit)` in the adapter and a fail-closed route. Local router is 14/14 and GitHub CI completed all required checks; deployed two-project/Auth evidence and legacy edge inventory remain pending. |

| TM-T09 | ZK materializer source projection | Flat/nested legacy ZK writers remain invisible to canonical `nodes`; a transient write can also leave projection stale | **partial (merged; deployment pending)** — PR #1646 is integrated: listener observes tenant-scoped collectionGroup plus top-level legacy source, normalizes both shapes, validates project→tenant, retries transient writes and is wired into server boot with SIGTERM cleanup. Focal integration/wiring tests pass; deployed backfill, cost and restart evidence remain pending. |

| TM-T10 | Offline replay operation identity | A partial `update` can lose its queued `op.id`/project/tenant context and create a new or global node | **partial (merged; deployment pending)** — PR #1648 (`b5bd00f17bba5b9925a7d6f27e4f948ee1929aea`) is integrated; batch replay now forces `op.id`, reads the existing target, preserves project/tenant and rejects moves. Deployed offline/restart evidence remains pending. |

| TM-T11 | ZK materializer invalid payload | Direct or batch materialization can diverge on blank IDs/title, unknown type, non-finite metadata or malformed arrays | **partial (merged; deployment pending)** — PR #1650 (`79e96a5f198b3190f7703f4049682a16eff730ea`) is integrated; shared runtime validation gates `materializeNode`/`materializeBatch`, `materializeOne` fails closed before writes, and the trigger reuses the supported-type contract. Deployed legacy/backfill evidence remains pending. |

### 7.3 Repudiation (R)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-R01 | Customer disputes paid invoice without server record | "I never authorized this charge" | **partial** — audit row exists for AUTHORIZED but actor is `null`; needs `createdBy` join |
| TM-R02 | Rejected/failed Webpay outcomes have no audit row | Customer disputes a "card declined" | **open** — add audit rows mirroring the AUTHORIZED case |

### 7.4 Information disclosure (I)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-I01 | Server-side Sentry leaks API keys / prompts | Stack trace captured includes `process.env.GEMINI_API_KEY` | **mitigated** — `sentryInstrumentation.ts:152-164` redact set |
| TM-I02 | Browser Sentry leaks user email / GPS | Replay shows worker's Asesor session | **mitigated** — `lib/sentry.ts:16-83` redacts user, headers, lat/lng |
| TM-I03 | Worker pastes RUT / medical detail into Asesor prompt | Sent verbatim to Vertex AI | **partial** — needs server-side regex sweep before prompt build |
| TM-I04 | Production stack traces returned to client | Eases attacker recon | **mitigated** — `gemini.ts:323-330` returns generic `'Internal server error'` in prod |
| TM-I05 | CSP `connectSrc` wildcard `*.googleapis.com` | Compromised dep exfiltrates to attacker-controlled subdomain | **open** — replace wildcard with explicit list |
| TM-I06 | Audit log omits full URL by design | Investigator may miss query-string context | **mitigated** — intentional; document in incident-response runbook |

### 7.5 Denial of service (D)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-D01 | Cost-DoS via unbounded Gemini calls | One actor exhausts daily budget | **mitigated** — `geminiGlobalDailyLimiter` 1000/day default |
| TM-D02 | Oversize body DoS / heap exhaustion | 100 MB JSON body to any endpoint | **mitigated** — 64 kb default, opt-in 2 MB for PDF route |
| TM-D03 | Firestore listener fan-out | Background notification/RAG triggers use bounded onSnapshot listeners | **mitigated for those triggers** — `backgroundTriggers.ts` mantiene filtros por `projectId`/`tenantId`; el listener global del materializer queda rastreado aparte como **TM-T09** y protegido por `MATERIALIZER_ENABLED`. |
| TM-D04 | Webpay double-spend exhausting refund budget | Same `token_ws` redelivered fast | **mitigated** — see TM-T04 |

### 7.6 Elevation of privilege (E)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-E01 | Non-member user reads/writes another project's data | Crafted Firestore client call | **mitigated** — `isProjectMember` rules + `assertProjectMember` server-side. **Validated by `dirtyDozen.test.ts` #1 (cross-tenant read), #6 (anon write), #7 (projectId spoof).** |
| TM-E02 | Cloud Run service account over-privileged | Compromised process gets full project access | **open (verify)** — confirm SA holds only `roles/aiplatform.user` scoped to one model, not project-wide |
| TM-E03 | Self-promote to admin via custom claims | Worker calls `/api/admin/set-role` for own uid | **mitigated** — caller's `customClaims.role` checked first, `revokeRefreshTokens` invalidates old token. **Validated by `dirtyDozen.test.ts` #11 (token without role claim cannot reach admin paths).** |
| TM-E04 | E2E secret replay against production | Stolen `E2E_TEST_SECRET` used live | **mitigated** — boot-time guard refuses prod+E2E |
| TM-E05 | Tenant-scoped admin ARCO operation | Admin of tenant A targets an access/erasure request whose subject is in tenant B | **partial (merged; deployment pending)** — `tenantAuthorization.ts` re-reads caller/target Auth tenant claims before ARCO mutation; real-router tests cover cross-tenant, tenant-less and same-tenant cases. PR #1635 is merged in `main` as `488ec967`; deployed/Auth-claims evidence remains pending. |
---

## 8. Prioritized open backlog

In order of severity / blast radius. All cross-linked from
[`STRIDE_findings.md`](./STRIDE_findings.md).

1. **TM-I03 — Vertex AI prompt PII redaction** — high.
   Worker may paste a Chilean RUT, medical exam result, or supervisor
   email into the Asesor input. The prompt is sent verbatim to Vertex.
   Mitigation: server-side regex sweep in `src/server/routes/gemini.ts`
   before prompt assembly + Asesor UI privacy notice. Owner: AI bucket
   in next sprint. Estimate: 3 h.
   *(Cross-link: similar concern raised at high level in
   `auditoria777.md` privacy notes section.)*

2. **TM-T03 — IndexedDB offline queue HMAC** — medium.
   The reconciliation path trusts disk-resident `{query, response}`
   payloads. A local attacker (shared device, malware) can poison the
   Zettelkasten with attacker-controlled nodes via reconciliation.
   Mitigation: HMAC over queued entries keyed on a device-derived secret
   (e.g. SHA-256 of refresh-token-tail + hardcoded salt) verified at
   reconcile. Owner: SLM bucket. Estimate: 4 h.

3. **TM-E02 — Cloud Run SA scope verification** — medium, ops-led.
   Audit `gcloud run services describe` output and ensure the runtime
   SA holds only the bindings needed: `roles/aiplatform.user` scoped to
   the Vertex region/model; `roles/datastore.user` on the project's
   Firestore database; `roles/secretmanager.secretAccessor` on the
   Praeventio secrets only. Document binding in
   `docs/security/iam-policy.md` (does not yet exist — create alongside).
   Owner: ops. Estimate: 2 h.

Secondary backlog (lower priority, still tracked):
- TM-I05 — replace `*.googleapis.com` CSP wildcard with explicit list (1 h + smoke test).
- TM-R01 — enrich AUTHORIZED audit row with `createdBy` lookup (30 min).
- TM-R02 — add audit rows for REJECTED / FAILED Webpay outcomes (20 min).

---

## 9. Living document

This file should be revisited:
- before any release that adds a new payment processor, AI provider, or
  authentication mechanism.
- after any incident classified as `S2` or worse per
  [`severity-rubric.md`](./severity-rubric.md).
- annually, even if no triggers fire — the threat landscape evolves
  even when the code does not.

When updating: keep findings traceable to file:line, prefer adding new
TM-* IDs over editing existing ones (an open finding may become
mitigated; preserve the history), and re-render the DFD if the system
shape changed.
