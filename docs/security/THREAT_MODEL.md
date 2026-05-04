# Guardian Praeventio — STRIDE Threat Model

**Sprint 20, eighth wave (Bucket B — STRIDE).**
**Date: 2026-05-04.**
**Status: living document; revisit each major release that touches the
auth, billing, or AI surfaces.**

This document is the security baseline for the Praeventio platform. It is
deliberately concrete to *this* codebase — every finding ties to a real
file:line and proposes a bounded mitigation. Generic advice has been kept
out.

Companion artefacts:
- [`data-flow-diagram.md`](./data-flow-diagram.md) — DFD with trust boundaries.
- [`STRIDE_findings.md`](./STRIDE_findings.md) — findings table (24 entries).
- [`incident-response.md`](./incident-response.md) — runbook on detection.
- [`severity-rubric.md`](./severity-rubric.md) — severity scoring (existing).
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
  envelope today is Chilean Ley 16.744, DS 54, DS 40, and Ley 19.628
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
| TM-T01 | Self-promote subscription tier from client | Worker writes `users/{uid}` with `subscriptionPlan='ilimitado'` | **mitigated** — diff-based deny at `firestore.rules:177-182`; `/api/subscription/upgrade` requires paid invoice |
| TM-T02 | Self-fabricate audit log entry | Worker writes a fake "I revoked admin X" entry | **mitigated** — `audit_logs:create=false` + server-side actor stamping |
| TM-T03 | Tamper IndexedDB offline queue before reconciliation | Local malware modifies `{query, response}` on disk; reconciliation writes attacker-controlled node into Zettelkasten | **open** — needs HMAC over queued entries keyed on a device-derived secret |
| TM-T04 | Webpay double-commit via redelivered token_ws | Browser refresh during Webpay return commits twice | **mitigated** — `processed_webpay/{token_ws}` lock-then-complete + 5-min stale window |

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
| TM-D03 | Firestore listener fan-out | Single onSnapshot pulling unfiltered collection | **mitigated** — listeners filtered per-tenant since Sprint Omicron |
| TM-D04 | Webpay double-spend exhausting refund budget | Same `token_ws` redelivered fast | **mitigated** — see TM-T04 |

### 7.6 Elevation of privilege (E)
| ID | Threat | Manifestation | Status |
|----|--------|---------------|--------|
| TM-E01 | Non-member user reads/writes another project's data | Crafted Firestore client call | **mitigated** — `isProjectMember` rules + `assertProjectMember` server-side |
| TM-E02 | Cloud Run service account over-privileged | Compromised process gets full project access | **open (verify)** — confirm SA holds only `roles/aiplatform.user` scoped to one model, not project-wide |
| TM-E03 | Self-promote to admin via custom claims | Worker calls `/api/admin/set-role` for own uid | **mitigated** — caller's `customClaims.role` checked first, `revokeRefreshTokens` invalidates old token |
| TM-E04 | E2E secret replay against production | Stolen `E2E_TEST_SECRET` used live | **mitigated** — boot-time guard refuses prod+E2E |

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
