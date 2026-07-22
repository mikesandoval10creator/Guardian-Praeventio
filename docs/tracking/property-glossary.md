# Property Glossary v1.0.0

Source-of-truth: [`TRACKING_PLAN.md`](./TRACKING_PLAN.md).
Companion: [`event-catalog.md`](./event-catalog.md), [`../../.telemetry/proposed-events.yaml`](../../.telemetry/proposed-events.yaml).

Every property used in the catalog appears here. PRs that introduce a new property add a row here in the same commit.

PII risk legend:
- `none` — no individual is identifiable from this value alone or in combination with other plan properties.
- `low` — combined with another plan property (e.g. `project_id`), the value could narrow down to a small group; quasi-identifier.
- `medium` — could identify an individual within a small project; never sent in raw form.
- `high` — direct PII; this plan FORBIDS sending it raw. Hashed/redacted only.

---

## Common (sent on every event)

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `event_version` | string | semver | `"1.0.0"` | none | Bumped per row in `event-catalog.md` (TRACKING_PLAN §4.3). |
| `app_version` | string | semver-ish, falls back to `"dev"` | `"2026.05.04+abc1234"` | none | Mirrors `import.meta.env.VITE_APP_VERSION` already used by `src/lib/sentry.ts`. |
| `app_env` | enum | `production` \| `staging` \| `dev` | `"production"` | none | From `import.meta.env.VITE_APP_ENV`. |
| `app_mode` | enum | `normal-light` \| `normal-dark` \| `driving` \| `emergency` | `"emergency"` | none | Derived from `useAppMode().mode` + resolved appearance for `normal`. |
| `user_id_hash` | string | sha256 hex (64 chars) | `"a1b2c3...e9f0"` | none | sha256(firebaseUid + salt). Salt rotates yearly. Never raw UID. |
| `project_id` | string | Firestore doc id | `"prj_KdLm9zX"` | low | Not PII; multi-tenant key. Always attached when in a project context. |
| `locale` | string | BCP-47 | `"es-CL"` | none | From `i18next.language`. |
| `device_class` | enum | `web-desktop` \| `web-mobile` \| `web-tablet` \| `capacitor-android` \| `capacitor-ios` | `"capacitor-android"` | none | Derived from UA + screen width + Capacitor presence. |
| `online` | boolean |  | `true` | none | `navigator.onLine` snapshot at fire time. |
| `timestamp_iso` | string | ISO-8601 UTC | `"2026-05-04T13:42:11.512Z"` | none | Client clock; server appends `received_at` server-side. |
| `sample_rate` | number | float in `[0, 1]` | `0.5` | none | Rate at which the event was admitted client-side (TRACKING_PLAN §4.7). |

## Auth-specific

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `provider` | enum | `google` \| `webauthn` \| `email_link` | `"google"` | none | Maps to Firebase provider id. |
| `mfa_used` | boolean |  | `true` | none | From `MFASetupModal` flow. |
| `signout_reason` | enum | `user_initiated` \| `session_expired` \| `forced_logout` | `"session_expired"` | none | From `useSessionExpiry`. |
| `role` | enum | `worker` \| `supervisor` \| `prevencionista` \| `admin` \| `executive` | `"prevencionista"` | none | Same set as `users/{uid}.roles[]`. |
| `granted_by_user_id_hash` | string | sha256 hex | `"a1b2..."` | none | Same hashing as `user_id_hash`. |
| `revoked_by_user_id_hash` | string | sha256 hex | `"a1b2..."` | none | Same as above. |
| `revocation_reason` | enum | `policy_change` \| `offboarding` \| `manual_admin` | `"offboarding"` | none |  |
| `invited_by_project_id` | string | Firestore doc id | `"prj_KdLm9zX"` | low | Set when sign-up came from an invite. |

## Project-specific

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `project_tier` | enum | `free` \| `essentials` \| `professional` \| `enterprise` \| `government` \| `api_climate` \| `api_hazmat` \| `api_normativa` | `"professional"` | none | From `services/pricing/tiers.ts` plus the B2D API tiers. |
| `industry_code` | enum | `mining` \| `construction` \| `agriculture` \| `manufacturing` \| `energy` \| `transport` \| `services` \| `other` | `"mining"` | none | Mirrors the onboarding selector. |
| `target_role` | enum | same as `role` |  | none |  |
| `target_user_id_hash` | string | sha256 hex |  | none |  |
| `invited_by_user_id_hash` | string | sha256 hex |  | none |  |
| `accepted_role` | enum | same as `role` |  | none |  |
| `accept_latency_seconds` | integer | seconds | `86400` | low | Time between invite and acceptance. |
| `invite_channel` | enum | `link` \| `email` \| `sms` \| `whatsapp` | `"link"` | none |  |
| `removed_by_user_id_hash` | string | sha256 hex |  | none |  |
| `removal_reason` | enum | `offboarding` \| `policy_change` \| `manual` | `"offboarding"` | none |  |
| `archived_by_user_id_hash` | string | sha256 hex |  | none |  |
| `archive_reason` | enum | `completed` \| `cancelled` \| `merged` | `"completed"` | none |  |

## Cuadrilla / Proceso / Tarea

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `cuadrilla_id` | string | Firestore doc id | `"cua_J2"` | low |  |
| `member_count` | integer | `>= 1` | `5` | none |  |
| `member_role` | enum | same as `role` |  | none |  |
| `out_user_id_hash` | string | sha256 hex |  | none | For swap events: outgoing worker. |
| `in_user_id_hash` | string | sha256 hex |  | none | For swap events: incoming worker. |
| `swap_reason` | enum | `vacation` \| `injury` \| `transfer` \| `manual` | `"injury"` | low | `injury` correlates with safety status; treat as quasi-PII. |
| `parent_proceso_id` | string | Firestore doc id |  | none |  |
| `proceso_id` | string | Firestore doc id |  | none |  |
| `proceso_template` | enum | `iper` \| `prexor` \| `tmert` \| `custom` | `"iper"` | none | From `services/protocols/`. |
| `tarea_id` | string | Firestore doc id |  | none |  |
| `task_priority` | enum | `low` \| `medium` \| `high` \| `critical` | `"high"` | none |  |
| `time_to_complete_seconds` | integer | seconds, `>= 0` | `7200` | none |  |
| `closed_by_user_id_hash` | string | sha256 hex |  | none |  |
| `block_reason_code` | enum | `missing_epp` \| `weather` \| `dependency` \| `injury` \| `other` | `"missing_epp"` | none |  |
| `block_note_length` | integer | character count of the worker's note (NOT the note itself) | `120` | none | We never send the note text; only its length, for "do workers write detailed blocks?" analysis. |
| `created_from_risk_id` | string | Firestore doc id |  | none | Joins safety closed-loop. |

## Risk

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `risk_id` | string | Firestore doc id |  | none |  |
| `risk_class` | enum | `chemical` \| `mechanical` \| `electrical` \| `ergonomic` \| `psychosocial` \| `noise` \| `fall` \| `weather` \| `seismic` | `"chemical"` | none |  |
| `severity` | enum | `low` \| `medium` \| `high` \| `critical` | `"high"` | none |  |
| `detector_kind` | enum | `iper` \| `prexor` \| `tmert` \| `weather` \| `seismic` \| `wearable` \| `cv_model` | `"iper"` | none |  |
| `confidence_pct` | integer | `0..100` | `82` | none |  |
| `commune_code` | string | Chilean comuna code (5 digits) | `"13101"` | low | Geo bucket; never raw lat/lng. |
| `reporter_role_hash` | string | sha256 hex | `"a1b2..."` | none | Hashed role for cross-event correlation without exposing identity. |
| `time_to_resolve_seconds` | integer | seconds | `14400` | none |  |
| `resolution_kind` | enum | `tarea_completed` \| `protocol_applied` \| `escalated` \| `false_positive` | `"tarea_completed"` | none |  |

## Emergency

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `sos_type` | enum | `medical` \| `accident` \| `evacuation` \| `assault` \| `unknown` | `"medical"` | none | From `SOSButton` payload. |
| `trigger_source` | enum | `long_press` \| `auto_fall` \| `auto_geofence` \| `voice` | `"long_press"` | none |  |
| `role_hash` | string | sha256 hex of `<role>+salt` | `"7c9f..."` | none | Fixed-cardinality hash so dashboards can group safely. |
| `network_kind` | enum | `wifi` \| `cellular_4g` \| `cellular_5g` \| `bluetooth_mesh` \| `unknown` | `"cellular_4g"` | none | From `useBluetoothMesh` + Network Information API. |
| `accel_window_ms` | integer | ms | `1200` | none | Length of accelerometer window that triggered fall. |
| `checkin_kind` | enum | `manual` \| `scheduled` \| `geofence` | `"manual"` | none |  |
| `status` | enum | `safe` \| `danger` \| `unknown` | `"safe"` | low | Same enum used in `EmergencyDashboard` stats. |
| `scheduled_for_iso` | string | ISO-8601 |  | none | Scheduled check-in expected time. |
| `delay_seconds` | integer | signed seconds (negative = early) |  | none |  |
| `evacuation_route_id` | string | Firestore doc id |  | none |  |
| `protocol_id` | string | Firestore doc id |  | none |  |

## SLM

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `query_kind` | enum | `chat` \| `triage` \| `compliance_check` \| `anomaly` | `"triage"` | none |  |
| `latency_ms` | integer | ms | `812` | none |  |
| `prompt_token_count` | integer | tokens | `145` | none | Length only; never the prompt text. |
| `success` | boolean |  | `true` | none |  |
| `model_id` | string | registry id | `"slm-es-cl-2026Q1"` | none | From `services/slm/registry.ts`. |
| `queue_depth_after` | integer | `>= 0` | `12` | none |  |
| `session_id` | string | UUID |  | low | Pseudo-id for joins; rotates per offline session. |
| `attempted` | integer | `>= 0` | `12` | none | Reconciliation aggregate: number of pending sessions found at pass start. |
| `succeeded` | integer | `>= 0` | `11` | none | Reconciliation aggregate: number of writes that flipped to reconciled. |
| `failed` | integer | `>= 0` | `1` | none | Reconciliation aggregate: number of writes that errored. `attempted = succeeded + failed`. |
| `pass_duration_ms` | integer | ms | `820` | none |  |
| `model_bytes` | integer | bytes | `12582912` | none |  |
| `download_duration_ms` | integer | ms |  | none |  |
| `cache_origin` | enum | `cdn` \| `peer` \| `pre_packaged` | `"cdn"` | none |  |

## Comité Paritario

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `meeting_id` | string | Firestore doc id |  | none |  |
| `scheduled_for_iso` | string | ISO-8601 |  | none |  |
| `agenda_item_count` | integer | `>= 0` |  | none |  |
| `drafted_by_kind` | enum | `manual` \| `gemini_assist` | `"gemini_assist"` | none |  |
| `action_item_id` | string | Firestore doc id |  | none |  |
| `assignee_role_hash` | string | sha256 hex |  | none |  |
| `due_in_days` | integer | `>= 0` |  | none |  |

## SUSESO

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `form_kind` | enum | `istas21_short` \| `istas21_full` | `"istas21_short"` | none |  |
| `dimension_count` | integer | usually `5` | `5` | none |  |
| `time_to_submit_seconds` | integer | seconds |  | none |  |
| `rejection_code` | string | SUSESO API code | `"E_INCOMPLETE"` | none | Vocabulary lives in `services/normativa/`. |
| `retry_count` | integer | `>= 0` |  | none |  |

## Payments

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `gateway` | enum | `webpay` \| `khipu` \| `mercadopago` \| `google_play` | `"webpay"` | none | Stripe is intentionally absent (see `project_business_decisions_2026-05-03`). |
| `plan_code` | string | from `services/pricing/tiers.ts` | `"professional_monthly"` | none |  |
| `amount_clp` | integer | CLP, no decimals | `49990` | none | Currency is CLP-only at v1. |
| `transaction_id_hash` | string | sha256 hex of gateway transaction id | `"f1c7..."` | none | Hashed because gateway tx ids leak across logs. |
| `auth_latency_ms` | integer | ms |  | none |  |
| `failure_code` | string | gateway-specific code | `"REJECTED"` | none |  |

## Knowledge

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `doc_id` | string | Firestore doc id |  | none |  |
| `doc_kind` | enum | `regulatory` \| `manual` \| `incident_report` \| `training` \| `other` | `"regulatory"` | none |  |
| `view_duration_seconds_estimate` | integer | seconds | `45` | none | Estimate from foreground time, not exact. |
| `zk_node_id` | string | Firestore doc id |  | none | The single ZK node referenced by the event. |
| `zk_node_id_from` | string | Firestore doc id |  | none | Origin node of a traversed link. |
| `zk_node_id_to` | string | Firestore doc id |  | none | Destination node of a traversed link. |
| `zk_node_kind` | enum | `concept` \| `incident` \| `protocol` \| `worker_note` \| `risk_pattern` | `"concept"` | none |  |
| `source_session_id` | string | UUID |  | low | Joins ZK back to an SLM offline session. |
| `link_kind` | enum | `cites` \| `contradicts` \| `extends` \| `applies_to` | `"cites"` | none |  |

## App shell

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `boot_kind` | enum | `cold` \| `warm` \| `pwa_resume` | `"cold"` | none |  |
| `last_open_delta_seconds` | integer | seconds since prior `app.opened` | `360` | none |  |
| `foreground_duration_seconds` | integer | seconds | `120` | none |  |
| `from_mode` | enum | same set as `app_mode` |  | none | Mode the user was leaving. |
| `to_mode` | enum | same set as `app_mode` |  | none | Mode the user is entering. |
| `trigger_kind` | enum | `manual` \| `auto_fall` \| `auto_geofence` \| `auto_seismic` \| `auto_climate` | `"auto_seismic"` | none | From `services/emergency/autoTrigger.ts`. |

## Health Vault professional funnel

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `country` | enum | `CL` | `"CL"` | none | Deployment jurisdiction only; never a precise location. |
| `verification_status` | enum | `pending` \| `provisional` \| `verified` | `"provisional"` | none | Closed assurance state; no registry number or specialty. |
| `channel` | enum | `qr` \| `directory` | `"qr"` | none | How the professional was connected, not who they are. |
| `duration_bucket` | enum | `under_1h` \| `1_to_24h` \| `1_to_7d` | `"1_to_24h"` | none | Coarse consent duration; exact timestamps are excluded. |
| `outcome_code` | enum | `success` \| `cancelled` \| `not_eligible` \| `webauthn_failed` \| `expired` \| `revoked` \| `service_unavailable` | `"success"` | none | Closed operational result; never a raw exception or clinical reason. |

Health analytics explicitly prohibit UID, RUT, patient names, specialty, clinical purpose, record IDs, diagnoses and medications.

## Reserved / system

| Property | Type | Allowed values / shape | Example | PII risk | Notes |
|---|---|---|---|---|---|
| `correlation_id` | string | UUID v4 (v7 deferred — see TRACKING_PLAN §10) |  | none | Threads a multi-event flow (e.g., fall → emergency → tarea). |
| `received_at` | string | ISO-8601 UTC | `"2026-05-04T13:42:12.001Z"` | none | Server-assigned. Never set by client. |

---

## Cross-checks

- Total event-specific properties listed: ~50 (plus 11 common = ~60). Within the 30–50 spec range when the common set is treated as one block.
- No property here has PII risk `medium` or `high`. Anything that would have been `high` is hashed (`*_id_hash`, `transaction_id_hash`) or replaced (`commune_code` instead of lat/lng, `block_note_length` instead of note text).
- Every enum lists its full allowed set so the future codegen layer can produce closed-set TypeScript types.
