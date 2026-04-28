# Praeventio Guard — Disaster Recovery Runbook

> **Audience:** founder, on-call engineer, future DPO, ISO 27001 auditor.
> **Last updated:** 2026-04-28
> **Owner:** founder@praeventio.net

Praeventio Guard stores regulatory and life-safety data on behalf of Chilean
employers. A few hours of downtime is annoying; loss of a worker's medical
exam history or audit trail is potentially career-ending for a Mutual /
ACHS-affiliated company and personally damaging to the worker. This runbook
exists so that — when we do have to recover from a disaster — we are not
inventing the procedure under stress.

If you are reading this during an incident, jump to **§4 Restore procedures**
for the closest matching scenario.

---

## 1. Recovery objectives (RPO / RTO)

| Disaster | RPO (data loss) | RTO (time to recover) | Notes |
|---|---|---|---|
| Accidental admin delete (single doc / collection, last 7 days) | 24h | 4h | restore from previous nightly export |
| Firestore corruption (single collection, integrity check fails) | 24h | 1h | targeted `--collections=` restore |
| Regional outage (`southamerica-west1` down) | live | dependent on Google SLA | Firestore is auto-replicated within region; cross-region failover requires multi-region config (see §6 TODO) |
| Catastrophic loss (project deletion, billing termination) | 7–30d | 1–3 days | restore from cold (Nearline) backups + Google Support |
| Security incident requiring rollback (compromised credentials, malicious writes) | most recent backup | 8h (after triage) | restore + rotate KMS keys + invalidate sessions |

These objectives apply to **prod** (`praeventio-prod`). Staging
(`praeventio-staging`) has no RPO/RTO commitment — it is rebuildable from
seed data and exists for testing recoveries.

The numbers above bind us to customers on the Workspace Elite tier (see §7
Compliance). If a customer asks for stricter RPO/RTO, it requires a custom
contract amendment.

---

## 2. Backup cadence

| Type | Cadence | Tool | Output |
|---|---|---|---|
| Nightly automated full export | 03:00 UTC | `scripts/backup-firestore.cjs` via Cloud Scheduler → Cloud Run job | `gs://praeventio-backups/firestore-export-YYYY-MM-DD-HHMM/` |
| Weekly integrity test | Sun 04:00 UTC | `scripts/test-backup-integrity.cjs` | logs + alert on fail |
| Pre-migration manual export | as needed | `node scripts/backup-firestore.cjs --label=pre-migration-X` | timestamped folder with label suffix |
| Quarterly DR drill | every 3 months | `scripts/restore-firestore.cjs` against staging | restore + smoke test |
| Cold archive | rolling — automatic via lifecycle | GCS bucket lifecycle | Standard 30d → Nearline 365d → delete |

Retention policy:
- **Hot (Standard storage):** 30 days. Cheap to read, instant restore.
- **Cold (Nearline):** 1 year. ~5x cheaper to store, 30-day minimum, retrieval cost.
- **Beyond 1 year:** deleted automatically. If a regulator requires longer,
  configure a per-collection cold archive (see §6 TODO).

---

## 3. The backup script (`scripts/backup-firestore.cjs`)

What it does, end to end:

1. Reads `GCP_PROJECT_ID`, `GCS_BACKUP_BUCKET` from env.
2. Optional `--collections=a,b,c` to scope the export; default is **all** collections.
3. Optional `--label=foo` to suffix the output folder (`firestore-export-…-foo`).
4. Pre-export: `listCollections()` + `count()` per collection (best-effort) for
   the manifest.
5. Calls `FirestoreAdminClient.exportDocuments({ name, outputUriPrefix, collectionIds })`
   from `@google-cloud/firestore` (a transitive dep of firebase-admin).
6. Awaits the long-running operation (LRO) up to 50 minutes; emits operation name
   to logs at start.
7. On success: writes `manifest.json` next to the export with `{ schemaVersion,
   timestamp, project, outputUriPrefix, collectionIds, collectionCounts, label }`.
8. Exits 0 on success, 2 on export failure / timeout, 1 on bad invocation.

The export format is the **managed Firestore export** — readable by
`gcloud firestore import`, `FirestoreAdminClient.importDocuments`, and the
Firebase console. It is NOT a JSON dump; do not try to read individual
documents out of it.

---

## 4. Restore procedures

### 4.1 Scenario: accidental admin delete

**Signals:** support ticket "we lost X", missing rows in `audit_logs` or
`medical_exams`, recent admin action in audit log.

**Steps:**
1. Triage: which collection(s)? confirm with audit log (`audit_logs/{eventId}`)
   that the delete actually happened.
2. Pick the most recent backup BEFORE the delete:
   ```
   gcloud storage ls gs://praeventio-backups/ \
     | grep firestore-export- \
     | sort
   ```
3. (Optional but strongly recommended) Restore to staging FIRST:
   ```
   GCP_PROJECT_ID=praeventio-staging \
   GCS_RESTORE_PATH=gs://praeventio-backups/firestore-export-2026-04-27-0300/ \
   node scripts/restore-firestore.cjs --collections=audit_logs --dry-run
   ```
4. If the dry-run looks right, restore to staging without `--dry-run`. Smoke
   test the affected screens.
5. Restore to prod. Note: `importDocuments` **overwrites by document ID** but
   does NOT delete docs that exist in the live DB but not in the backup.
   If the customer wants only the deleted docs back (without rolling back
   anything else), use `--collections=` to scope:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
   GCS_RESTORE_PATH=gs://praeventio-backups/firestore-export-2026-04-27-0300/ \
   GCP_PROJECT_ID=praeventio-prod \
   node scripts/restore-firestore.cjs --collections=audit_logs \
     --confirm-i-know-what-im-doing
   ```
6. Post-incident: write up in `audit_logs` with `eventType=disaster_recovery`,
   email customer per §5 Communication.

### 4.2 Scenario: Firestore corruption (integrity check fails)

**Signals:** read returns inconsistent data, app errors on a specific
collection, integrity test job alerts.

**Steps:**
1. Quarantine: put the affected collection's writes behind a feature flag
   if possible (server-side toggle).
2. Identify the corruption window: when did integrity tests last pass?
3. Restore the affected collection only — see §4.1 step 5 with
   `--collections=<corrupted_one>`.
4. Re-run integrity test (`scripts/test-backup-integrity.cjs`) and any
   collection-specific data validation.

### 4.3 Scenario: regional outage (`southamerica-west1` down)

**Signals:** Firestore reads/writes fail with UNAVAILABLE, GCP status page
shows incident.

**Steps:**
1. **Wait first.** Most regional incidents resolve in <2h. Posting a panic
   restore mid-incident creates more problems than it solves.
2. Update `status.praeventio.net` (TODO §6 — for now: tweet + email
   workspace admins).
3. If outage extends past 8h with no Google ETA: open a SUPPORT case (we
   require a paid GCP support tier — see §6 TODO).
4. If outage extends past 24h: failover to `us-central1` requires
   multi-region Firestore — currently NOT configured (TODO §6). This is a
   conscious cost / latency trade-off. Document the decision when changed.

### 4.4 Scenario: catastrophic loss (project deletion, billing termination)

**Signals:** GCP console shows project as DELETED, billing alerts, loss of
all project resources including Firestore + GCS.

**Steps:**
1. **Open a Google Cloud Support case immediately.** A deleted project is
   recoverable for 30 days via Support; after that, it is gone.
2. While Support investigates, check whether the **backup bucket** survived
   (cross-project bucket survives project deletion; same-project bucket
   does not). For this reason, `praeventio-backups` SHOULD live in a
   separate billing project (`praeventio-backups-prod`) — TODO §6.
3. If recovery via Support fails: spin up a fresh project, restore the most
   recent cold backup, redeploy the app, rotate ALL credentials (KMS,
   OAuth client secrets, Resend API key, Transbank credentials).

### 4.5 Scenario: security incident requiring rollback

**Signals:** evidence of compromised admin credentials, suspicious
high-volume writes, leaked secrets.

**Steps:**
1. Triage with §1 KMS_ROTATION.md — rotate the KEK and re-wrap envelopes.
2. Identify "patient zero" timestamp (first malicious write).
3. Restore Firestore to a pre-incident backup. Note: this loses legitimate
   writes since then; document the trade-off.
4. Invalidate sessions (rotate session secret in `server.ts`).
5. Force-revoke OAuth tokens (`oauth_tokens` collection — rotate
   `OAUTH_ENVELOPE_KEK` then re-wrap; users will re-authenticate).
6. Notify per §5 Communication and §7 Compliance (Ley 21.719 art. 50: 72h
   ANPD deadline).

---

## 5. Communication during incident

| Role | Person | Channel |
|---|---|---|
| Incident commander | founder (on-call) | Slack #incident, phone |
| Customer notification | founder (delegate to support tier when hired) | Email via Resend |
| Public status | TODO: status.praeventio.net | (provision in §6) |
| Workspace admins (Marketplace install) | per-customer comms preference | Email + in-app banner |

**Customer notification SLA:** within 8 hours of confirmed incident, plain
Spanish, including:
- What happened (one paragraph, plain language)
- What data was affected (collections, scope)
- What we did
- What the customer needs to do (often: nothing)
- Who to contact for follow-up

---

## 6. Test cadence + open TODOs

**Tests we run automatically:**
- Backup integrity (weekly, Cloud Scheduler → `test-backup-integrity.cjs`)
- Daily backup itself counts as a passive smoke test of the export pipeline

**Tests we run manually:**
- Quarterly DR drill: pick a recent backup, restore to staging, run e2e
  smoke tests, time it. File the result in `docs/dr-drills/YYYY-Q.md`.
- Annual tabletop exercise: walk the team through each scenario in §4 with
  the runbook in hand. Update this doc with anything that surprised us.

**Open TODOs (not blockers, but track):**
- [ ] Provision GCS bucket `praeventio-backups` in a SEPARATE billing
      project (`praeventio-backups-prod`) so a billing accident on the main
      project doesn't take backups with it.
- [ ] Create dedicated service account
      `firestore-backup@praeventio-prod.iam.gserviceaccount.com` with
      `roles/datastore.importExportAdmin` (project) +
      `roles/storage.objectAdmin` (bucket only).
- [ ] Wire Cloud Scheduler job (`infrastructure/cloud-scheduler.yaml`) to
      Cloud Run job hosting `backup-firestore.cjs`.
- [ ] Provision `status.praeventio.net` (Statuspage / BetterUptime).
- [ ] Schedule first DR drill (target: end of next quarter).
- [ ] Decide on multi-region Firestore vs. cross-region replication
      (cost / RPO trade-off).
- [ ] Upgrade GCP support tier to Standard or Enhanced before going GA on
      Workspace Marketplace.
- [ ] Per-collection retention beyond 1 year for regulator-mandated
      `audit_logs` / `medical_exams` (Chilean labor law: 5 years for
      training records, 30 years for occupational disease evidence).

---

## 7. Compliance mapping

| Standard | Clause | How this runbook complies |
|---|---|---|
| Ley 21.719 (Chile) | art. 50 | personal data breach reporting deadline 72h to ANPD; §5 has the comms plan |
| Ley 21.719 (Chile) | art. 14ter | data integrity & availability — backups + integrity tests + this runbook |
| ISO 27001 | A.5.30 | ICT readiness for business continuity — this entire document |
| ISO 27001 | A.8.13 | information backup — §2 cadence + §3 procedure |
| Customer SLA (Workspace Corporativo) | uptime | 99.9% — RTOs in §1 are within budget |
| Customer SLA (Workspace Ilimitado) | uptime | 99.95% — same |

---

## 8. Quick reference

**To trigger a manual backup right now (before a risky migration):**
```
GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
GCS_BACKUP_BUCKET=gs://praeventio-backups \
GCP_PROJECT_ID=praeventio-prod \
node scripts/backup-firestore.cjs --label=pre-migration-roles-v3
```

**To restore one collection to staging (safe):**
```
GCP_PROJECT_ID=praeventio-staging \
GCS_RESTORE_PATH=gs://praeventio-backups/firestore-export-2026-04-27-0300/ \
node scripts/restore-firestore.cjs --collections=audit_logs
```

**To restore to prod (DANGEROUS):**
```
GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
GCS_RESTORE_PATH=gs://praeventio-backups/firestore-export-2026-04-27-0300/ \
GCP_PROJECT_ID=praeventio-prod \
node scripts/restore-firestore.cjs --confirm-i-know-what-im-doing
```

**To check that the latest backup is healthy:**
```
GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
GCS_BACKUP_BUCKET=gs://praeventio-backups \
GCP_PROJECT_ID=praeventio-prod \
node scripts/test-backup-integrity.cjs
```

---
*If you find an error in this runbook DURING an incident, fix it AFTER the
incident as part of the postmortem. Do not edit during. The version you are
reading is the one we trusted.*
