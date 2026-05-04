# Guardian Praeventio — Tracking Plan v1.0.0

**Status**: design (not implemented)
**Source-of-truth**: this document
**Audit baseline**: `.telemetry/current-state.yaml` and `.telemetry/audits/2026-05-04.md` (commit `ef73331`, seventh wave). Greenfield: zero analytics events exist today; only Sentry is wired for error tracking.
**Generated for**: Sprint 20 eighth wave
**Owner**: Identity + Safety + Platform pods (per-event ownership in `event-catalog.md`)
**Companion files**:
- `event-catalog.md` — table of every proposed event
- `property-glossary.md` — type, shape, PII risk for every property
- `../../.telemetry/proposed-events.yaml` — machine-readable manifest for future codegen

> This is a *plan*, not code. No SDK is selected; no events are emitted. Future buckets implement against this spec. PRs that change events MUST update this file, the catalog, and the YAML manifest in lockstep.

---

## 1. Scope

### In scope (v1)
- The web SPA (Vite + React) running in any Chromium-based browser, including the WebView container that ships under Capacitor.
- Server-side billing webhooks (Webpay/Khipu/MercadoPago/Google Play) where the server is the *only* place that knows the final transaction outcome.
- The on-device SLM orchestrator (`src/services/slm/`) — online vs offline branch, queue depth, reconciliation outcome.
- Emergency surfaces: SOS long-press, fall detection, evacuation, scheduled check-ins.

### Out of scope (v1)
- Native iOS/Android binaries: when Capacitor reaches feature parity (Brecha A, see `product_strategic_gaps_2026-05-04`), the same bridge fires the same web events through a thin native wrapper. No native-only events in v1.
- Marketing surfaces (parent site `praeventio.cl`) — owned by a separate property; out of scope.
- Sentry replays / traces — already configured, not duplicated here.
- Internal infra metrics (Cloud Run latencies, Firestore reads). Those stay in Cloud Monitoring.

### Audience
- **Engineers** wiring `track()` calls — read sections 4 (principles), 5 (taxonomy), 7 (governance) and the catalog.
- **PM / Customer Success** consuming dashboards — read sections 2 (goals), 6 (funnels), 8 (privacy).
- **Legal / DPO** reviewing for Ley 21.719 compliance — read section 8.

---

## 2. Goals

The plan exists to enable five outcomes:

1. **Activation funnel**: signup → first project → first member invite → first risk reported. Target: median ≤ 5 days for paid customers.
2. **Safety closed-loop**: predictive risk → action taken → resolution. Track elapsed time per risk class.
3. **SLM offline health**: prove the offline queue + reconciliation pattern is converging (queue depth stays bounded, reconciliation success rate ≥ 95%).
4. **Life-safety SLA**: emergency triggered → first responder acknowledges. Target ≤ 60 s for SOS, ≤ 120 s for fall detection.
5. **Revenue funnel**: checkout started → succeeded by gateway. Identify gateway-specific drop-offs (Webpay vs Khipu vs MP vs Play).

Every event in the catalog must serve at least one of those outcomes or be cut.

---

## 3. Audit chain

| Phase | Output | Status |
|---|---|---|
| Audit current state | `.telemetry/current-state.yaml`, `.telemetry/audits/2026-05-04.md`, `.telemetry/current-implementation.md` | Done — commit `ef73331` (seventh wave). |
| Design tracking plan | this file + `event-catalog.md` + `property-glossary.md` + `.telemetry/proposed-events.yaml` | This commit (eighth wave). |
| Pick backend + SDK | recommendation in §9, decision deferred | Open. |
| Generate instrumentation guide | `.telemetry/instrument.md` | Open. |
| Implement | typed wrapper under `src/services/analytics/` mirroring the `ErrorTrackingAdapter` facade | Open. |
| Per-feature deltas | mini-deltas via `product-tracking-instrument-new-feature` | Open. |

The audit established that there is no product analytics SDK installed and no `track()` / `capture()` / `identify()` call sites in `src/**`. This plan therefore designs the v1 layer from scratch; it is not extending an existing scheme.

---

## 4. Core principles

### 4.1 User identity is hashed
- The `user_id_hash` property is `sha256(firebaseUid + salt)` where `salt` is a server-rotated value. Never the raw UID. Never the email or phone number.
- The salt rotates yearly; the rotation date is recorded on the `event_version` bump. Cross-year longitudinal analysis requires a hash-history side table; that is acceptable.
- On signout, the client wrapper MUST call the SDK's `reset()` equivalent to drop the cached identity and start a new anonymous session id.

### 4.2 Project identity is direct
- Project is not PII. Use `project_id` directly (the Firestore doc id). Multi-tenant dashboards rely on this — hashing it would defeat the point.
- Where present, attach `project_id` to *every* event so downstream filters work.

### 4.3 Event schema versioning
- A top-level `event_version` property (semver) is sent on every event.
- Bump major (`1.0.0` → `2.0.0`) when removing or renaming a property.
- Bump minor (`1.0.0` → `1.1.0`) when adding an optional property.
- Bump patch (`1.0.0` → `1.0.1`) when changing only the description / docs.
- The version of an individual event is its row in `event-catalog.md` under `First version`. The plan-level version is the `v1.0.0` in this document's title.

### 4.4 PII redaction
- The analytics wrapper inherits the same `REDACT_KEYS` list used in `src/lib/sentry.ts` and `src/services/observability/sentryAdapter.ts` (`authorization`, `cookie`, `set-cookie`, `token_ws`, `code`, `token`, `session`, `state`, `email`, `phone`, plus `lat`, `lng`, `latitude`, `longitude` for breadcrumb-style nesting).
- Any property whose value matches a redaction key after stringification is dropped before send. This is the *transport-layer* belt; the *suspenders* are the per-event property allowlist enforced by the codegen layer (future work driven by `proposed-events.yaml`).

### 4.5 Sensitive event filter
- Emergency events (`emergency.*`) keep only: `timestamp_iso`, `project_id`, `user_id_hash`, `role_hash`, `sos_type`, `app_mode`, `app_version`, `online`, `device_class`. No latitude/longitude. No free-text. No accelerometer raw values.
- For geographic context where it is *legitimately* needed (regional dispatch dashboards), attach `commune_code` (Chilean comuna code, e.g. `13101` for Santiago) — bucketed at municipal granularity; never finer.

### 4.6 Offline queue (mirrors SLM pattern)
- Events fired while `navigator.onLine === false` are queued in IndexedDB under a new store `analytics_queue` in the `praeventio-slm` database (db version bump to v3 — coordinated upgrade callback, same approach as `offlineQueue.ts`).
- On `online` event the analytics wrapper flushes the queue in arrival order. On flush failure, the row is retained with an exponential backoff (60s, 5m, 30m, then drop after 24h with a single `analytics.queue.dropped` self-instrumentation event).
- Maximum queue depth: 5000 events. Beyond that, oldest non-`safety_critical` events are evicted first; `safety_critical` events are never evicted within 24h.

### 4.7 Mode-aware sampling
- `normal` mode: 100% (volume is moderate).
- `driving` mode: 50% (battery-conscious — driving sessions are long and sensor-heavy; halve non-critical traffic).
- `emergency` mode: 100% always. We want every emergency moment.
- `safety_critical` class events: 100% across all modes. Sampling never drops an emergency.
- The wrapper adds `sample_rate` to every event (the rate at which it was admitted). Dashboards reweight on read.

### 4.8 Common properties (sent on every event)
| Name | Source | Notes |
|---|---|---|
| `event_version` | this plan | semver string |
| `app_version` | `import.meta.env.VITE_APP_VERSION` (already used by `src/lib/sentry.ts`) | falls back to `dev` |
| `app_env` | `import.meta.env.VITE_APP_ENV` | `production`, `staging`, `dev` |
| `app_mode` | `useAppMode().mode` | `normal-light`, `normal-dark`, `driving`, `emergency` |
| `user_id_hash` | sha256(firebaseUid + salt) | omitted when no user |
| `project_id` | `useProject().selectedProject?.id` | omitted on auth pages |
| `locale` | `i18next.language` | `es-CL`, `es`, `en` |
| `device_class` | derived from UA + screen + capacitor | `web-desktop`, `web-mobile`, `web-tablet`, `capacitor-android`, `capacitor-ios` |
| `online` | `navigator.onLine` snapshot at fire time | boolean |
| `timestamp_iso` | `new Date().toISOString()` | client clock; server appends `received_at` |
| `sample_rate` | applied client-side | float 0..1 |

### 4.9 Naming
- Format: `<surface>.<entity>.<action>` (lowercase, dot-separated, snake_case within each segment).
- Past tense for actions that have happened (`signed_up`, `triggered`, `succeeded`).
- Imperative is reserved for self-instrumentation: `analytics.queue.dropped` is okay because the analytics layer is itself a self-observed surface.
- Never invent new top-level surfaces without a PR that updates this plan, the catalog, and the YAML manifest.

### 4.10 Classification
Every event has exactly one of:
- `lifecycle` — entity created/destroyed (signup, project archived).
- `engagement` — user interaction without state change of significance (doc viewed, mode switched, app opened).
- `safety_critical` — anything in the predictive-detection-to-resolution loop, plus emergencies. 100% sampled, 24-month retention, never sampled out.
- `commerce` — money moves. Webhook-confirmed; client-side checkout-started events are dashboards-only.

---

## 5. Taxonomy structure

Twelve surfaces. Each maps to a section in `event-catalog.md`:

| Surface | Examples |
|---|---|
| `auth` | sign-up, sign-in, sign-out, role grant/revoke |
| `project` | created, member invited/accepted/removed, archived |
| `cuadrilla` | created, member added, member swap |
| `proceso` / `tarea` | proceso created, tarea created/started/completed/blocked, escalated |
| `risk` | detected (predictive), reported (manual), resolved |
| `emergency` | sos triggered, fall detected, check-in, evacuation |
| `slm` | query online, query offline, queue grew, queue reconciled, model downloaded |
| `comite` | meeting scheduled, minutes drafted, action item assigned |
| `suseso` | form started, submitted, rejected |
| `payment` | checkout started, transaction succeeded, transaction failed |
| `knowledge` | doc viewed, doc downloaded, ZK node created, ZK link traversed |
| `app` | opened, backgrounded, mode switched |

Each surface has a single PM owner per row in `event-catalog.md`'s `Owner` column. Cross-surface events (rare; e.g. an emergency that escalates from a fall) fire one event per surface, joined by a shared `correlation_id`.

---

## 6. Funnels & dashboards the plan unlocks

### 6.1 Activation (lifecycle)
`auth.user.signed_up` → `project.created` → `project.member.invited` → `risk.reported.manual`
KPI: median elapsed time from first to fourth event for paid accounts. Target ≤ 5 days.

### 6.2 Safety closed loop (safety_critical)
`risk.detected.predictive` (or `.reported.manual`) → `tarea.created` (with `created_from_risk_id`) → `tarea.completed` → `risk.resolved`
KPI: % of risks resolved within their class-specific SLA. Class-specific SLAs live in `protocols/iper.ts` already.

### 6.3 SLM offline health (engagement + safety_critical)
`slm.query.offline` count vs `slm.queue.reconciled` count, plus `slm.queue.grew` peak depth.
KPI: reconciliation success rate ≥ 95% over a rolling 7-day window. Alarm when 7-day queue depth p95 > 500.

### 6.4 Life-safety SLA (safety_critical)
`emergency.sos.triggered` (client) → `emergency.responder.acknowledged` (responder client) — measure delta `responder_ack_seconds`. Same for `emergency.fall.detected`.
KPI: p50 ≤ 60 s for SOS, p50 ≤ 120 s for fall. Page on-call when 1-hour p95 > 5 min.

### 6.5 Revenue funnel (commerce)
`payment.checkout.started` → `payment.transaction.succeeded` (or `.failed`).
KPI: gateway-specific success rate. Drilldowns on `gateway` (`webpay` / `khipu` / `mercadopago` / `google_play`).

---

## 7. Versioning, governance, lifecycle

- This document is the source of truth. Conflicts between TRACKING_PLAN.md and `event-catalog.md` are bugs in the catalog; the catalog yields.
- Every PR that adds, renames, or removes an event MUST update:
  1. `docs/tracking/TRACKING_PLAN.md` — only if a *principle* changes.
  2. `docs/tracking/event-catalog.md` — always.
  3. `docs/tracking/property-glossary.md` — if any property is added or its shape changes.
  4. `.telemetry/proposed-events.yaml` — always; cardinality must match the catalog.
- A semver gate runs at PR time (future work, see Brecha D Playwright/CI): catalog-row count must equal YAML `events[]` length, and each `name` must match.
- New surfaces require a 1-line approval from the surface's PM owner in the PR description.
- `event_version` is bumped on the row whose schema changed; the plan-level version (top of this file) is bumped on the next *coherent* release of the plan as a whole.

---

## 8. Privacy & legal

### 8.1 Ley 21.719 (Chile)
- Data subjects under Chilean law. Their explicit consent is captured today via `src/components/legal/CookieConsent.tsx`. The analytics wrapper short-circuits when consent has not been granted (boots into queued mode that never flushes).
- Data residency: backend MUST be hosted in `southamerica-west1` (Santiago region) when self-hosted. SaaS choices are deferred but only those with a Chilean DPA signature qualify.
- Right of access / rectification / erasure: hashing the user id permits *erasure by hash purge* — the salt is rotated and the old hashes become uncorrelatable. Document the procedure in `docs/security/data-subject-rights.md` (out of scope for this PR).
- Retention: 18 months default for `lifecycle` and `engagement`. 24 months for `safety_critical` (legal / forensic). 18 months for `commerce`. Automatic purge job runs monthly.

### 8.2 Opt-out
- A user can short-circuit the client SDK by setting `localStorage.analytics_opt_out = '1'`. The wrapper checks this on every call and no-ops when set.
- The opt-out is also exposed in the in-app Settings → Privacy panel (component to add: `src/pages/Settings/PrivacySettings.tsx`, future work).
- Opt-out is per-device (because it's `localStorage`-backed). Cross-device opt-out requires the optional `users/{uid}.analyticsOptOut` Firestore flag, which the wrapper reads on identify.

### 8.3 Dual-write to existing observability
- The analytics layer does NOT replace Sentry. Errors keep flowing to `@sentry/react` / `@sentry/node`. Analytics is additive.
- The PII redaction logic SHOULD be extracted into a shared module (`src/utils/redact.ts`, not yet present) used by both Sentry's `beforeSend` hooks and the new analytics wrapper. Today the redaction is duplicated across `src/lib/sentry.ts` and `src/services/observability/sentryAdapter.ts`. Consolidating it is the prerequisite to keeping rules in lockstep when this plan is implemented.

---

## 9. Backend choice — recommendation, deferred decision

Four candidates evaluated. Decision is deferred to a follow-up bucket. Recommendation: **PostHog OSS, self-hosted in `southamerica-west1`**.

| Option | Pros | Cons | Fit score |
|---|---|---|---|
| **PostHog OSS, self-hosted (recommended)** | Apache 2.0 license; full event ownership; SDK supports identify/group/feature flags; can ride the existing GCP project (Cloud Run + Cloud SQL); Chile residency satisfied; native session-replay if we ever want it. | Operational cost: ~1 vCPU + 4 GB RAM + 100 GB managed Postgres baseline; we run a second stateful service. | High (8/10) |
| GA4 | Free; massive ecosystem; analyst familiarity. | PII redaction is opaque; data residency cannot be guaranteed inside Chile; group analytics for multi-tenant Praeventio is awkward; event property limits hurt our taxonomy. | Low (3/10) |
| Plausible (self-hosted) | Privacy-first; cookieless; lightweight. | Page-view oriented; weak event/property model; no group/identify primitives; would need a parallel pipeline for funnels. | Low (4/10) |
| Custom Firestore collection | Zero new infra; full control; same DPA we already signed. | We rebuild every dashboard primitive (funnels, retention, breakdowns) ourselves; engineering cost dominates. | Medium (5/10) — fine as a *fallback queue*, not a primary store. |

**Recommendation rationale**: PostHog OSS hits the residency constraint, gives us identify+group+feature-flags out of the box, and the operational cost is a single stateful pair. The instrumentation guide bucket should pick PostHog and produce a real wrapper unless leadership overrides.

---

## 10. Open questions
1. Salt rotation cadence — yearly is suggested. Confirm with DPO.
2. Should `correlation_id` be UUIDv7 (time-ordered) or UUIDv4? UUIDv7 helps debug chronologies; the choice flows into the typed wrapper.
3. Where does the responder-ack event fire — on the responder's client, or server-side from the FCM notification ack? Affects the `emergency.responder.acknowledged` definition.
4. Capacitor native parity — when Brecha A lands, do we add a `device_class=capacitor-*` discriminator, or a separate `platform` property? Recommendation: discriminator (already in §4.8).

---

## 11. Implementation handoff

Future buckets implementing this spec should:
1. Add a new dependency for the chosen SDK (PostHog client, per recommendation).
2. Create `src/services/analytics/` with an `AnalyticsAdapter` interface + `getAnalytics()` facade, mirroring `src/services/observability/index.ts`.
3. Add a `noop` adapter so dev/CI without keys never fail.
4. Hook the adapter into `FirebaseContext.onAuthStateChanged` to call `identify(user_id_hash)` on login and `reset()` on logout. This also fixes the audit's hygiene observation that `setUserContext` is wired but never invoked.
5. Wire one event per surface in the order of `event-catalog.md`. Land them in waves; do not big-bang.
6. Codegen typed call sites from `.telemetry/proposed-events.yaml` (future tooling). Until codegen runs, hand-write a typed enum and a thin wrapper.
7. Update `.telemetry/instrument.md` with the SDK-specific guide.

---

## 12. Changelog

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0.0 | 2026-05-04 | Bucket Tracking-design (Sprint 20 eighth wave) | Initial plan; greenfield. Follow-up to audit `ef73331`. |
