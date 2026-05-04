# Event Catalog v1.0.0

Source-of-truth: [`TRACKING_PLAN.md`](./TRACKING_PLAN.md).
Companion: [`property-glossary.md`](./property-glossary.md), [`../../.telemetry/proposed-events.yaml`](../../.telemetry/proposed-events.yaml).

Every event in this catalog has a 1:1 entry in the YAML manifest. Cardinality is enforced (see TRACKING_PLAN §7).

Common properties (sent on every event, see TRACKING_PLAN §4.8) are not repeated per row: `event_version`, `app_version`, `app_env`, `app_mode`, `user_id_hash`, `project_id`, `locale`, `device_class`, `online`, `timestamp_iso`, `sample_rate`. The `Required props` and `Optional props` columns list event-specific additions only.

Total: **44 events** across **12 surfaces**.

Counts by class: lifecycle 22, engagement 10, safety_critical 9, commerce 3.

---

## Auth (5)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `auth.user.signed_up` | lifecycle | First successful auth (any provider). Fires once per user, ever. | `provider` | `invited_by_project_id` | identity | 1.0.0 |
| `auth.user.signed_in` | lifecycle | Successful auth where the user already existed. | `provider`, `mfa_used` |  | identity | 1.0.0 |
| `auth.user.signed_out` | lifecycle | User-initiated signout. SDK `reset()` fires immediately after. |  | `signout_reason` | identity | 1.0.0 |
| `auth.role.granted` | lifecycle | A new role was attached to the user in `users/{uid}.roles[]`. | `role`, `granted_by_user_id_hash` |  | identity | 1.0.0 |
| `auth.role.revoked` | lifecycle | A role was removed. | `role`, `revoked_by_user_id_hash` | `revocation_reason` | identity | 1.0.0 |

## Project (5)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `project.created` | lifecycle | New project doc written under `projects/`. | `project_tier`, `industry_code` |  | platform | 1.0.0 |
| `project.member.invited` | lifecycle | Invite link emitted via Firestore + FCM. | `target_role`, `invited_by_user_id_hash` | `invite_channel` | platform | 1.0.0 |
| `project.member.accepted` | lifecycle | Invite accepted; user now appears in `projects/{id}.members`. | `accepted_role` | `accept_latency_seconds` | platform | 1.0.0 |
| `project.member.removed` | lifecycle | Member removed from `projects/{id}.members`. | `target_user_id_hash`, `removed_by_user_id_hash` | `removal_reason` | platform | 1.0.0 |
| `project.archived` | lifecycle | Project moved to archived state. | `archived_by_user_id_hash` | `archive_reason` | platform | 1.0.0 |

## Cuadrilla (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `cuadrilla.created` | lifecycle | New cuadrilla under `projects/{id}/cuadrillas`. | `cuadrilla_id`, `member_count` | `parent_proceso_id` | safety | 1.0.0 |
| `cuadrilla.member.added` | lifecycle | Worker assigned to a cuadrilla. | `cuadrilla_id`, `target_user_id_hash`, `member_role` |  | safety | 1.0.0 |
| `cuadrilla.member.swapped` | lifecycle | One worker replaced by another within the same cuadrilla. | `cuadrilla_id`, `out_user_id_hash`, `in_user_id_hash` | `swap_reason` | safety | 1.0.0 |

## Procesos & Tareas (4)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `proceso.created` | lifecycle | A new proceso under a project. | `proceso_id`, `proceso_template` | `parent_proceso_id` | safety | 1.0.0 |
| `tarea.created` | lifecycle | New tarea row. | `tarea_id`, `proceso_id`, `task_priority` | `created_from_risk_id` | safety | 1.0.0 |
| `tarea.completed` | lifecycle | Tarea marked complete. | `tarea_id`, `proceso_id`, `time_to_complete_seconds` | `closed_by_user_id_hash` | safety | 1.0.0 |
| `tarea.blocked` | lifecycle | Worker reports blocker on a tarea. | `tarea_id`, `proceso_id`, `block_reason_code` | `block_note_length` | safety | 1.0.0 |

## Riesgos (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `risk.detected.predictive` | safety_critical | Predictive layer (IPER / PREXOR / TMERT / weather) flagged a risk. | `risk_id`, `risk_class`, `severity`, `detector_kind` | `confidence_pct`, `commune_code` | safety | 1.0.0 |
| `risk.reported.manual` | safety_critical | Worker manually reported a risk via the UI. | `risk_id`, `risk_class`, `severity` | `commune_code`, `reporter_role_hash` | safety | 1.0.0 |
| `risk.resolved` | safety_critical | Risk transitioned to `resolved` state. | `risk_id`, `risk_class`, `time_to_resolve_seconds`, `resolution_kind` |  | safety | 1.0.0 |

## Emergencies (4)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `emergency.sos.triggered` | safety_critical | SOS button confirmed (3 s long-press). Geo redacted to commune. | `sos_type`, `trigger_source`, `role_hash` | `commune_code`, `network_kind` | safety | 1.0.0 |
| `emergency.fall.detected` | safety_critical | Auto fall detection fired. | `confidence_pct`, `accel_window_ms`, `role_hash` | `commune_code` | safety | 1.0.0 |
| `emergency.checkin.completed` | safety_critical | Worker confirmed check-in (manual or scheduled). | `checkin_kind`, `status` | `scheduled_for_iso`, `delay_seconds` | safety | 1.0.0 |
| `emergency.evacuation.started` | safety_critical | Evacuation routine entered. | `evacuation_route_id`, `protocol_id` |  | safety | 1.0.0 |

## SLM (5)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `slm.query.online` | engagement | Orchestrator routed a query to `/api/ask-guardian`. | `query_kind`, `latency_ms`, `prompt_token_count`, `success` | `model_id` | platform | 1.0.0 |
| `slm.query.offline` | engagement | Orchestrator routed a query to the on-device SLM. | `query_kind`, `latency_ms`, `model_id`, `prompt_token_count` |  | platform | 1.0.0 |
| `slm.queue.grew` | engagement | Offline session enqueued (`offline_sessions` IndexedDB store). | `queue_depth_after`, `session_id` |  | platform | 1.0.0 |
| `slm.queue.reconciled` | safety_critical | Reconciliation pass finished. | `attempted`, `succeeded`, `failed` | `pass_duration_ms` | platform | 1.0.0 |
| `slm.model.downloaded` | engagement | A registry-listed model finished downloading + cached. | `model_id`, `model_bytes`, `download_duration_ms` | `cache_origin` | platform | 1.0.0 |

## Comité Paritario (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `comite.meeting.scheduled` | lifecycle | CPHS meeting added to the calendar (DS54 obligation). | `meeting_id`, `scheduled_for_iso` | `agenda_item_count` | compliance | 1.0.0 |
| `comite.minutes.drafted` | lifecycle | Acta de reunión generated (Gemini-assisted or manual). | `meeting_id`, `drafted_by_kind` |  | compliance | 1.0.0 |
| `comite.action_item.assigned` | lifecycle | New action item attached to a meeting. | `action_item_id`, `meeting_id`, `assignee_role_hash` | `due_in_days` | compliance | 1.0.0 |

## SUSESO (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `suseso.form.started` | engagement | User opened a SUSESO/ISTAS21 questionnaire. | `form_kind` |  | compliance | 1.0.0 |
| `suseso.form.submitted` | lifecycle | Form completed + submitted to the SUSESO API. | `form_kind`, `dimension_count`, `time_to_submit_seconds` |  | compliance | 1.0.0 |
| `suseso.form.rejected` | safety_critical | SUSESO API responded with rejection. | `form_kind`, `rejection_code` | `retry_count` | compliance | 1.0.0 |

## Payments (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `payment.checkout.started` | commerce | Client kicked off checkout (Webpay create / Khipu cobro / MP preference / Play purchase flow). | `gateway`, `plan_code`, `amount_clp` |  | billing | 1.0.0 |
| `payment.transaction.succeeded` | commerce | Server-side webhook confirmed authorization. Server-emitted (not client). | `gateway`, `plan_code`, `amount_clp`, `transaction_id_hash` | `auth_latency_ms` | billing | 1.0.0 |
| `payment.transaction.failed` | commerce | Authorization rejected or webhook returned a failure status. Server-emitted. | `gateway`, `plan_code`, `failure_code` | `amount_clp` | billing | 1.0.0 |

## Knowledge (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `knowledge.doc.viewed` | engagement | A doc opened in the in-app reader. | `doc_id`, `doc_kind` | `view_duration_seconds_estimate` | knowledge | 1.0.0 |
| `knowledge.zk.node.created` | lifecycle | New Zettelkasten node persisted (post-reconciliation, server-side). | `zk_node_id`, `zk_node_kind` | `source_session_id` | knowledge | 1.0.0 |
| `knowledge.zk.link.traversed` | engagement | User followed a link between two ZK nodes via the SmartConnections panel. | `zk_node_id_from`, `zk_node_id_to`, `link_kind` |  | knowledge | 1.0.0 |

## Engagement / app shell (3)

| Event | Class | Description | Required props | Optional props | Owner | First version |
|---|---|---|---|---|---|---|
| `app.opened` | engagement | App boot. Includes cold/warm discriminator. | `boot_kind` | `last_open_delta_seconds` | platform | 1.0.0 |
| `app.backgrounded` | engagement | Page went `visibilityState=hidden` for ≥ 3 s. |  | `foreground_duration_seconds` | platform | 1.0.0 |
| `app.mode.switched` | engagement | `useAppMode().setMode(...)` called or auto-trigger fired. | `from_mode`, `to_mode`, `trigger_kind` |  | platform | 1.0.0 |

---

## Cross-checks (manual until codegen runs)

- Row count above (excluding the headline rows): 44. Matches the YAML manifest.
- Every `Owner` is one of: `identity`, `platform`, `safety`, `compliance`, `billing`, `knowledge`.
- Every event in the `safety_critical` class is sampled at 100% (TRACKING_PLAN §4.7) and retained 24 months (§8.1).
- Three events that pulled extra discussion (see PR description / agent return message): `app.opened`, `slm.queue.reconciled`, `comite.minutes.drafted` — see TRACKING_PLAN §10 open questions.
