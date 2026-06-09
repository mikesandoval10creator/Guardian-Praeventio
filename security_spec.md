# Security Specification for Praeventio Guard

## Data Invariants
1. **User Role Integrity**: A user cannot assign themselves the 'admin' or 'supervisor' role. This must be handled by an existing admin or backend.
2. **Project Isolation**: Users can only read/write data in projects where they are members.
3. **Node Ownership**: Only the creator or an admin/supervisor can modify a knowledge node (except for connecting nodes).
4. **Immutable Audit Trail**: Audit logs cannot be updated or deleted.
5. **PII Protection**: User profile data (like email) is restricted to the owner and admins.
6. **Temporal Integrity**: All `createdAt` and `updatedAt` fields must match `request.time`.
7. **Identity Spoofing**: Users cannot create posts or messages as other users.

## The "Dirty Dozen" Payloads (Expected to be REJECTED)

1. **Self-Promotion**:
```json
{ "uid": "attacker_id", "email": "attacker@example.com", "role": "admin" }
```
*Target*: `/users/attacker_id` (create/update)
*Reason*: Cannot set role to admin without being admin.

2. **Cross-Project Access**:
```json
{ "projectId": "victim_project", "text": "Fake Alert" }
```
*Target*: `/projects/victim_project/emergency_messages/new_id`
*Reason*: User is not a member of `victim_project`.

3. **Identity Spoofing in Posts**:
```json
{ "authorId": "victim_id", "content": "I am resigning." }
```
*Target*: `/nodes/new_id` or `/projects/p1/safety_posts/post1`
*Reason*: `authorId` does not match `request.auth.uid`.

4. **Arbitrary Points Increment**:
```json
{ "points": 999999 }
```
*Target*: `/user_stats/attacker_id`
*Reason*: Increment exceeds allowed thresholds (if strictly validated).

5. **PII Leakage (Broad Read)**:
*Target*: `get /users/victim_id`
*Action*: Read as a random worker.
*Reason*: Non-admins can only read their own profile.

6. **Shadow Field Injection**:
```json
{ "title": "Node", "description": "Desc", "type": "Riesgo", "isAdmin": true }
```
*Target*: `/nodes/n1`
*Reason*: `isAdmin` is not an allowed field in schema.

7. **Audit Log Tampering**:
*Target*: `update /audit_logs/log1`
*Reason*: Audit logs are immutable (read-only/write-once).

8. **Resource Poisoning (Large Data)**:
```json
{ "title": "A".repeat(1000) }
```
*Target*: `/nodes/n1`
*Reason*: Title size exceeds 200 characters.

9. **Terminal State Bypass**:
*Target*: `update /projects/p1/reports/r1` where status was 'Cerrado'
*Reason*: Terminal states should lock the document.

10. **Orphaned Record Creation**:
```json
{ "projectId": "non_existent_project", "title": "Task" }
```
*Target*: `/projects/non_existent_project/reports/r1`
*Reason*: Referenced project must exist.

11. **Client-Side Timestamp Forge**:
```json
{ "createdAt": "2020-01-01T00:00:00Z" }
```
*Target*: `/nodes/n1`
*Reason*: `createdAt` must match server time `request.time`.

12. **MFA Bypass (If implemented)**:
*Reason*: Access without valid MFA claims if required.

## Sprint-K client-SDK stores — write rules (added 2026-06-01)

These 13 `createProjectScopedStore` collections live under
`projects/{projectId}/<coll>` and are written via the Firebase **client SDK**.
They previously had no write rule (the `{subCollection=**}` master-gate is
read-only), so client `save()` was default-denied in production — masked by the
open `firestore.test.rules`. See `TODO.md §17 "HALLAZGO CRÍTICO"`. Rules tests:
`src/rules-tests/projectScopedStores.rules.test.ts`.

**Access model (conservative — pending per-collection review):**
- create: project member; the creator-uid field must equal the caller
  (`stoppages.declaredByUid`, `operational_changes.declaredByUid`,
  `root_causes.analyzedByUid`, `site_book(_entries).recordedByUid`,
  `lone_worker_*.workerUid`, `safety_talks_given.givenByUid`,
  `audit_portals.createdByUid`, `documents_for_read.authorUid`).
- update: project member; the creator-uid is immutable; `site_book(_entries)`
  are append-only once **signed** (gated on `status == 'signed'` / presence of
  the nested `signature` map — NOT a top-level `signedAt`, which no write-path
  emits; B9 fix 2026-06-08).
- delete: **false** for compliance records (`stoppages`, `operational_changes`,
  `root_causes`, `site_book`, `site_book_entries`); admin/supervisor otherwise.
- `exceptions`, `legal_obligations`, `shifts`: member-gated create/update (no
  confirmed creator-uid field — anti-spoof N/A, marked for review).

**Rejected payloads (Dirty-Dozen extension):**

13. **Stoppage Spoof**: `{ "declaredByUid": "victim_id", "status": "active" }`
    *Target*: `/projects/p1/stoppages/s1` (create) — `declaredByUid` ≠ caller.
14. **Non-member Store Write**: any create under `/projects/victim/<coll>/x`
    by a non-member of `victim`.
15. **Creator Reassignment**: update flipping `recordedByUid`/`declaredByUid`/…
    to another uid.

## DEA defibrillator equipment — write rules (B1, added 2026-06-03)

`projects/{projectId}/deas/{id}` and nested `.../inspections/{id}` (Ley 21.156)
are client-SDK written (`DEAZones.tsx`) and previously had no write rule (client
`setDoc` default-denied). Rules tests:
`src/rules-tests/deaSafetyEquipment.rules.test.ts`.
- `deas` create/update: project member; `createdBy` equals the caller and is
  immutable on update. delete: admin/supervisor only.
- `deas/{id}/inspections`: project member; `performedByUid` equals the caller;
  **immutable** (no update/delete) — compliance record.

**Rejected payloads (Dirty-Dozen extension):**

16. **DEA Creator Spoof**: `{ "createdBy": "victim_id" }` on `/projects/p1/deas/d1` (create).
17. **Inspection Tamper**: any update/delete on
    `/projects/p1/deas/d1/inspections/i1` (immutable compliance record).
18. **Inspector Spoof**: `{ "performedByUid": "victim_id" }` on inspection create.

## Survival ping (life beacon) — write rules (B1, added 2026-06-03)

`pings/{uid}` is a top-level per-worker beacon written ~every 60s by
`useSurvivalPing` (client SDK). It had no rule → default-denied (a worker in
distress emitted nothing). Rules tests: `src/rules-tests/survivalPings.rules.test.ts`.
- create/update: owner only (`isOwner(uid)`); fixed schema `{lat,lng,timestamp,status}`.
- read: owner + admin/supervisor (rescue coordinators).
- delete: **false** (append-only rescue trail).

**Rejected payloads (Dirty-Dozen extension):**

19. **Beacon Hijack**: writing `/pings/victim_uid` while authenticated as someone else.
20. **Beacon Field Injection**: `{ ...ping, "exfiltrate": "…" }` (schema `hasOnly`).
21. **Cross-worker Beacon Read**: a non-admin/supervisor reading `/pings/other_uid`.

## Critical-control validations — write rules (B2, added 2026-06-03)

`projects/{pid}/control_validations/{controlId__taskId}` (DS44 controles críticos,
client SDK via `controlValidationsStore`) had no write rule → default-denied.
Rules tests: `src/rules-tests/controlValidations.rules.test.ts`.
- create/update: project member; `validatedByUid` equals the caller and is
  immutable on update. delete: admin/supervisor only. Read via the
  project sub-collection master-gate.

**Rejected payloads (Dirty-Dozen extension):**

22. **Validation Spoof**: `{ "validatedByUid": "supervisor_id" }` (create) — falsely
    claim someone else verified a critical safety control.
23. **Validator Reassignment**: update flipping `validatedByUid` to another uid.

## Driving incidents + read receipts — write rules (B11/B6, added 2026-06-03)

`projects/{pid}/driving_incidents/{id}` (SafeDriving; no creator-uid field →
member-gated create/update, admin/supervisor delete) and
`projects/{pid}/read_receipts/{documentId__workerUid}` (DS44/RIOHS acuse;
worker-owned `workerUid == caller`, immutable, never deleted) had no write rule.
Rules tests: `src/rules-tests/drivingAndReceipts.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

24. **Receipt Forgery**: `{ "workerUid": "victim_id" }` on read_receipts create —
    claim another worker acknowledged a mandatory document.
25. **Receipt Hijack**: update flipping `workerUid` on an existing receipt.
26. **Incident Delete**: a non-admin/supervisor deleting a `driving_incident`.

## Personalized plans + morning check-ins — write rules (B7, added 2026-06-03)

`projects/{pid}/personalized_plans/{id}` (PersonalizedSafetyPlan; no creator-uid
field → member-gated, admin/supervisor delete) and
`users/{uid}/morning_checkins/{date}` (MorningRoutine wellness self-check —
private to the owner + occupational-health doctor `medico_ocupacional`,
owner-write, never deleted; the `users/{uid}` block has no master-gate so reads
are explicit). Rules tests: `src/rules-tests/b7PlansCheckins.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

27. **Wellness Snoop**: a non-owner / non-doctor reading `/users/victim/morning_checkins/*`.
28. **Check-in Forge**: writing `/users/victim/morning_checkins/*` while authenticated as someone else.

## Findings + placed objects — write rules (B3 / B-DigitalTwin, added 2026-06-03)

`projects/{pid}/findings/{id}` (BioAnalysis / Hallazgos; `reportedBy` is a display
name, not a uid → member-gated) and `projects/{pid}/placed_objects/{id}`
(digital-twin hazards/equipment, member-gated) had no write rule (default-denied).
Both: member-gated create/update, admin/supervisor delete; read via the project
sub-collection master-gate. Rules tests:
`src/rules-tests/findingsPlacedObjects.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

29. **Finding Injection**: a non-member creating `/projects/victim/findings/*`.
30. **Twin Object Delete**: a non-admin/supervisor deleting a placed safety object.

## Project documents — write rules (B5, added 2026-06-03)

`projects/{pid}/documents/{id}` (reports, emergency plans, EPP & SUSESO docs —
many client-SDK writers) had no write rule → the whole Documents feature was
default-denied in production. Member-gated create/update; admin/supervisor delete
(compliance/legal trail). Rules tests: `src/rules-tests/projectDocuments.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

31. **Document Injection**: a non-member creating/editing `/projects/victim/documents/*`.
32. **Compliance Doc Delete**: a non-admin/supervisor deleting a project document.

## Clinical alerts (non-diagnostic) — write rules (B7, added 2026-06-03)

`projects/{pid}/clinical_alerts/{id}` (VitalityMonitor — NON-diagnostic safety
recommendations after the ADR-0012 reconversion: signal + recommendation, no
CIE-10) had no write rule → default-denied. Member-gated with anti-spoof
`createdBy` (immutable on update); delete admin/supervisor; read via the project
sub-collection master-gate. Rules tests: `src/rules-tests/clinicalAlerts.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

33. **Alert Spoof**: `{ "createdBy": "victim_id" }` on a clinical_alerts create.
34. **Alert Owner Reassign**: update flipping `createdBy` to another uid.
16. **Signed SiteBook Tamper**: `update /projects/p1/site_book_entries/e1`
    where `status == 'signed'` (real shape: nested `signature` map, no
    top-level `signedAt`) — denied (B9, corrected 2026-06-08; see #52).
17. **Compliance Delete**: `delete /projects/p1/stoppages/s1` (even as admin).

## Public DEA registry (dea_locations) — public read, member write (#4, added 2026-06-08)

`dea_locations/{id}` is a TOP-LEVEL **public** AED registry: a bystander in a
cardiac arrest finds the nearest defibrillator WITHOUT login (life-safety public
good, ADR 0021). `read: if true`. Write is gated to members of the OWNING project
(`isProjectMember(incoming().projectId)`) plus a strict schema
(`isValidDeaLocation`: only `location` / `coordinates` / `status` / `projectId` /
`updatedAt`; coordinates required; no PII). Mirrored from a project's
`projects/{pid}/deas` by DEAZones. Rules tests:
`src/rules-tests/deaLocations.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

35. **Public Map Poison**: an anonymous (logged-out) `create /dea_locations/x` —
    randoms must not be able to pollute the public defibrillator map.
36. **Cross-project DEA Publish**: a non-member publishing a `dea_locations` doc
    for a project they do not belong to.
37. **PII Smuggle**: `{ ...dea, "assignedToName": "Juan Pérez" }` — fields beyond
    the public schema are rejected (no personal data leaks onto the public map).

## Mesh signing key (mesh_keys) — server-only, deny client read+write (Phase 5, added 2026-06-08)

`mesh_keys/{projectId}` holds the per-project HMAC-SHA-256 secret used to sign +
verify offline mesh packets (BLE/WiFi-Direct SOS relay). It is the trust root
that lets same-project peers reject a forged/spoofed SOS without a live network.
It is distributed ONLY through the server route `GET /api/mesh/key` (verifyAuth +
`assertProjectMember`, Admin SDK), which bypasses these rules. Clients must never
touch the collection directly: a member-readable secret would leak in the browser
console (any member could then forge mesh SOS packets), and a member-writable doc
would let one member overwrite the trust root for the whole project. Default-deny
both `read` and `write` for every actor (member, admin, anonymous). Rules tests:
`src/rules-tests/meshKeys.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

38. **Mesh Key Exfiltration**: a project member `get /mesh_keys/{projectId}` —
    the signing secret must never leave the server; reading it directly would let
    the member forge authentic-looking mesh SOS packets.
39. **Mesh Key Overwrite**: a member `set /mesh_keys/{projectId}` to replace the
    project secret — would poison the trust root so the attacker's forged packets
    verify for every peer.
40. **Cross-actor Mesh Read**: an admin OR an anonymous user reading the mesh key
    directly — server-only distribution is enforced regardless of role.

## CPHS committee minutes (projects/{pid}/comite_actas) — member write (#B12, added 2026-06-08)

`projects/{pid}/comite_actas/{actaId}` holds Comité Paritario actas (DS54 legal
compliance records). Written by the ComiteParitario page (create the acta, then
append `acuerdos`). Previously had NO write rule → default-denied (the feature
was broken in production). Now: member-gated create/update
(`isProjectMember(projectId)`), schema-validated (`isValidComiteActa`: only
`fecha` / `tipo` / `asistentes` / `acuerdos` / `createdAt`), the creation stamp
and meeting date are immutable on update, and delete is restricted to
admin/supervisor (legal trail). Rules tests:
`src/rules-tests/comiteActas.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

38. **Acta PII Smuggle**: `{ ...acta, "workerRut": "11.111.111-1" }` — any field
    beyond the fixed acta schema is rejected; a legal minute must not become a
    sink for smuggled personal data.
39. **Minute Backdating**: an update that mutates `createdAt` or `fecha` of an
    existing acta — the creation stamp and meeting date are immutable once set
    (tamper-evident compliance record).
40. **Cross-project / anonymous Acta Write**: a non-member (or logged-out) user
    creating an acta in a project they do not belong to.

## Curriculum referee co-sign — method-label integrity (#F4, added 2026-06-08)

The public, magic-link referee co-sign endpoint
`POST /api/curriculum/referee/:token` (`src/server/routes/curriculum.ts`) is
unauthenticated by design (the 256-bit token is the barrier). It previously
accepted `{ method: 'webauthn', signature }` from the client and persisted it
verbatim — stamping a co-signature as a *cryptographically verified* WebAuthn
assertion that was **never verified**. A real verification is structurally
impossible here: `verifyWebAuthnAssertion` (`src/server/auth/webauthnAssertion.ts`)
requires a Firebase `uid` plus a credential enrolled in `webauthn_credentials`
where `stored.uid === uid`; a magic-link referee has neither. Integrity
guarantee now enforced: the `webauthn` method label means **only** a
server-verified assertion against an enrolled credential. The route coerces a
client `webauthn` *intent* into the truthful `device_attested` (local device
proof-of-presence) on both the cosign and decline branches, and the service
chokepoint `recordRefereeEndorsement` throws (`400`) if asked to persist
`method='webauthn'` without `webauthnVerified:true`. The append-only audit
trail records the resolved `method` plus `webauthnVerified`.

**Rejected payloads (Dirty-Dozen extension):**

41. **Fabricated WebAuthn Co-sign**: `{ action: 'cosign', method: 'webauthn',
    signature: 'webauthn:<ISO>' }` from a token-holder with no enrolled
    credential — stored as `device_attested`, never as the cryptographic
    `webauthn` label, so a forged "verified" attestation cannot enter the
    immutable curriculum.
42. **Decline-path label spoof**: `{ action: 'decline', method: 'webauthn' }` —
    the rejected slot is coerced to `device_attested`/`standard`; the
    `webauthn` label never lands on an unauthenticated referee slot.

## HealthVault medical records + share tokens — owner-read, server-only write (Bucket VV, added 2026-06-08)

`users/{uid}/health_vault/{recordId}` (HealthRecord — medical records, KMS-
envelope-encrypted file blobs via `fileEncryptionKeyId`) and
`users/{uid}/health_vault_shares/{tokenId}` (VaultShareToken — QR share tokens)
had NO rule → default-denied. This silently broke the worker's own active-shares
list (`src/pages/HealthVaultShare.tsx:60` client read soft-failed). Both are
written ONLY by trusted server code (Admin SDK): `/api/health-vault/share`
(create), `/view/:id/:secret` (consume, public doctor endpoint), `/share/:id/revoke`.
Records: client read+write fully denied (only the server `/view` endpoint reveals
them, gated on a one-time share secret; the raw secret is never persisted —
only its SHA-256 `tokenHash`). Share tokens: owner / occupational-doctor / admin
read (mirrors the `medical_exams` privacy envelope); all client writes denied
(immutable + unforgeable). Rules tests: `src/rules-tests/healthVault.rules.test.ts`.
KMS: HealthRecord file blobs use the envelope DEK identified by
`fileEncryptionKeyId` — see KMS_ROTATION.md (KEK rotation; old envelopes stay
decryptable; no migration on rotation).

**Rejected payloads (Dirty-Dozen extension):**

43. **Vault Records Snoop**: an authenticated worker `get`/`list`
    `/users/{victim}/health_vault/*` (or even their OWN) via the client SDK —
    medical records are server-only; the client gets nothing.
44. **Share Token Forge**: a worker `create`/`update`/`delete`
    `/users/{self}/health_vault_shares/x` from the client (e.g. setting
    `revokedAt: null`, `consumeCount: 0`, or a hand-crafted `tokenHash`) — all
    client writes denied; only the server mutates share state.
45. **Cross-Worker Share Read**: worker B reads worker A's
    `/users/A/health_vault_shares/*` — read is owner/doctor/admin only.
57. **Revoked Share File Fetch**: a doctor who scanned the QR pre-revocation
    re-requests the medical file blob AFTER the worker revoked (or after expiry)
    via `GET /api/health-vault/view/:tokenId/:secret/file/:recordId`. The
    endpoint re-reads the share doc inside a `runTransaction` and runs
    `validateShareAccess` on FRESH data on EVERY fetch, returning `410 revoked`
    (likewise `410 expired`, `401 invalid_token` on a bad secret,
    `403 out_of_scope` for a recordId outside the share scope). The raw
    `fileUri` is NEVER sent to the client — the `/view` JSON only exposes the
    server-mediated `fileProxyPath`, and the blob is streamed via the Admin
    Storage SDK behind that per-access re-validation (`Cache-Control: no-store`).
    The file URL cannot outlive revocation. Denied.

## Conflict queue (safety-doc sync conflicts) — write rules (B16, added 2026-06-08)

`tenants/{tid}/conflict_queue/{queueId}` (§12.2.2) holds safety-doc sync
conflicts (Inspection / IncidentReport / EmergencyAlert / MedicalRecord /
TrainingCompletion) where two offline writers diverged on a legally-binding
field and human approval is required. The pure engine
`src/services/sync/conflictQueue.ts` had 0 consumers and no rules; it is now
written ONLY by the server route `src/server/routes/conflictQueue.ts` (Admin
SDK — identity, status transitions and the approver-role gate are
server-stamped). Rules tests: `src/rules-tests/conflictQueue.rules.test.ts`.
- read: supervisor-tier of the tenant (`isSupervisorOfTenant(tenantId)`).
- create/update/delete: **false** for ALL clients — resolution flows through
  the audited, approver-gated (`admin`/`gerente`) server route, never a direct
  client write.

**Rejected payloads (Dirty-Dozen extension):**

46. **Queue Write Forgery**: any client `setDoc` / `update` to
    `/tenants/t1/conflict_queue/q1` — the collection is server-only; clients
    cannot create, update or delete under any circumstance.
47. **Cross-tenant Queue Read**: a supervisor of tenant A reading
    `/tenants/t1/conflict_queue/q1` — per-tenant role governs; a supervisor
    claim in another tenant grants nothing here.
48. **Worker Queue Read**: a tenant member with worker-tier role reading
    `/tenants/t1/conflict_queue/q1` — the queue is supervisor-only, so workers
    never see other workers' conflict decisions.

## Worker documents — write rules (added 2026-06-08)

`src/components/workers/DocsModal.tsx` reads (live `onSnapshot`), creates
(`addDoc` after a Storage upload) and deletes (`deleteDoc`) worker documents
(certs, contracts, EPP records, SUSESO docs) at TWO paths:
`projects/{pid}/workers/{wid}/documents/{id}` when a project is selected, and
the top-level fallback `workers/{wid}/documents/{id}` when `projectId` is
undefined (`Workers.tsx` passes `projectId={selectedProject?.id}`). Neither had
a rule: the nested `match /workers/{workerId}` declared NO `documents`
sub-match (so create/update/delete were default-denied — read was already
granted by the project sub-collection master-gate), and there was no top-level
`match /workers` at all (so that path was fully default-denied). The worker
Documentación feature was therefore broken in production. The schema carries
`workerId` (the worker doc id, NOT a caller uid), so there is no anti-spoof
field to bind: the nested path is member-gated create/update with
admin/supervisor delete (compliance/legal trail), mirroring the sibling
`/documents` and `/findings` rules; the top-level fallback (a non-project-scoped
personnel record with no membership to check) is admin/supervisor-only for
read/create/update/delete. Rules tests:
`src/rules-tests/workerDocuments.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

49. **Worker-Doc Injection**: a non-member creating/editing
    `/projects/victim/workers/w1/documents/*` — only project members may attach
    or edit a worker's documents.
50. **Worker-Doc Snoop**: a non-member reading
    `/projects/victim/workers/w1/documents/*`, or a plain worker reading the
    top-level `/workers/w1/documents/*` — the top-level fallback is
    admin/supervisor-only.
51. **Worker-Doc Compliance Delete**: a non-admin/supervisor deleting a worker
    document (certs/contracts are a legal/compliance trail).

## SiteBook post-sign immutability — real-shape gate (B9, fixed 2026-06-08)

`projects/{pid}/site_book(_entries)/{id}` are DS-76 legally-binding records.
The immutability gate previously keyed on a top-level `signedAt` field that no
write-path (client `siteBookStore` save, server `SiteBookAdapter`, WebAuthn
`/api/sitebook/sign/verify`) ever wrote — signed state is `status == 'signed'`
+ a nested `signature` map. The gate was therefore vacuously satisfied and a
signed entry stayed mutable. Now any update is denied once `status == 'signed'`
(or a `signature` is present). Rules tests:
`src/rules-tests/projectScopedStores.rules.test.ts` (real signed shape).

**Rejected payloads (Dirty-Dozen extension):**

52. **Signed Libro-de-Obra Rewrite**: the recorder `update`s
    `/projects/p1/site_book_entries/e1` whose `status == 'signed'` (nested
    `signature` present, NO top-level `signedAt`) to flip `status` back to
    `open` or rewrite `description` — denied by the status-based gate.

## CPHS meeting minutes (cphs_meetings) — signatures append-only + prefix-preserved (added 2026-06-08)

`cphs_meetings/{meetingId}` holds Comité Paritario actas (DS54 / ISO 45001
§5.4). Once an acta carries >=1 WebAuthn co-signature the document is immutable
except for an APPEND to `signatures[]` (other attendees co-signing) — same
pattern as `audit_logs`. The update rule previously enforced only that the new
`signatures` array GREW BY ONE (`size() == old.size() + 1`); it did NOT assert
that the existing signatures prefix was preserved. A project member could
therefore submit a size-N+1 array whose first N entries were forged/rewritten
(swapping another member's `uid` / `credentialId` / `signature` / `signedAt`)
and pass. The rule now requires the new array to equal the existing array
plus exactly one appended tail element
(`incoming().signatures == existing().signatures.concat([tail])`), so prior
WebAuthn assertions are bit-for-bit immutable. The appended tail must also be
self-signed (`tail.uid == request.auth.uid`) so nobody can co-sign under
another member's identity. Rules tests:
`src/rules-tests/cphsMeetings.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

53. **Co-signature Prefix Rewrite**: an attendee `update`s a signed
    `cphs_meetings/{id}` with `signatures = [ {forged copy of member-A's slot},
    {own new signature} ]` (size old+1) — the rewrite of member-A's existing
    WebAuthn slot is denied because the new array must equal the old array
    concatenated with exactly one new tail element.
54. **Signature Truncation / Reorder**: an attendee submits a `signatures`
    array that drops a prior signature, or keeps the same length while
    reordering existing entries — denied; the array may only grow by one and
    must keep the existing prefix in place.
55. **Bulk Signature Replace**: an attendee replaces the entire `signatures`
    array (size old+1) with brand-new entries while leaving the meeting body
    (minutes/resolutions/attendees/status) untouched — denied; only a genuine
    append over the unchanged existing prefix is permitted.

### cphs_meetings — Caso A first-signature (0 -> 1) transition gating (added 2026-06-08)

Before the first signature, the Caso A branch previously constrained only
`committeeId` / `scheduledAt` and left the incoming `signatures` array ENTIRELY
unconstrained. Because production signs `cphs_meetings` directly via the
Firebase Web SDK (`src/pages/CphsModule.tsx` -> `cphsService.signMinutes` ->
`docRef.update({signatures})`), `firestore.rules` is the SOLE server-side gate.
On an unsigned acta any project member could in ONE write: plant the FIRST
signature under another member's `uid` (no self-binding), batch-plant N
pre-forged signatures (no `0 -> N` size cap) bypassing the per-member WebAuthn
ceremony, and mutate `minutes`/`resolutions`/`attendees`/`status` while locking
the doc (Caso B then makes the forged signatures bit-for-bit immutable —
irreversible repudiation on a legally binding DS54 / ISO 45001 acta). The rule
now splits Caso A into **A1** (draft: `signatures` stays empty, body freely
editable) and **A2** (first signature: EXACTLY one, `tail.uid ==
request.auth.uid`, body bit-for-bit identical), collapsing the first-sign into
the same self-binding discipline as Caso B. `committeeId` / `scheduledAt` /
`signatures is list` are hoisted invariants over all three sub-cases. Rules
tests (`src/rules-tests/cphsMeetings.rules.test.ts`, 15/15 under the emulator).

**Rejected payloads (Dirty-Dozen extension):**

64. **First-Signature Identity Spoof**: a member `update`s an unsigned
    `cphs_meetings/{id}` with `signatures = [ {uid: <another member>, ...} ]`
    (size `0 -> 1`) — denied; the first signature's `uid` must equal the caller
    (`request.auth.uid`), so nobody can plant the inaugural WebAuthn slot under
    someone else's identity.
65. **First-Signature Batch Plant**: a member `update`s an unsigned acta with
    `signatures` of size `0 -> 2` (or more) — N pre-forged WebAuthn assertions
    landed in one write — denied; Caso A2 caps the first-sign transition to
    exactly one signature, forcing the per-member ceremony for each subsequent
    co-signature via Caso B.
66. **First-Signature Body Tamper**: a member lands the first signature while
    also mutating `minutes` / `resolutions` / `attendees` / `status` /
    `scheduledAt` in the same write — denied; the `0 -> 1` transition must leave
    the acta body bit-for-bit identical, so the document that gets locked is the
    one the committee actually deliberated.

## Worker-RUT PII over-exposure in `nodes` — read gate (PRIVACY, fixed 2026-06-08)

The DS 67 (INCIDENT) and DS 109 (MEDICINE) legal-form modals
(`src/components/medicine/Ds67Modal.tsx:215`, `Ds109Modal.tsx:249`) build a
`nodes` document whose `metadata.workerRut` carries a worker's RAW RUT (Chilean
national ID). The `nodes` read rule granted read to **any** project member
(`isProjectMember(existing().projectId)`), so a single worker's national ID —
on an accident or occupational-disease record — was readable by **every**
co-worker on the project. Fix: ordinary nodes stay member-readable, but a node
carrying `metadata.workerRut` is restricted to the node author
(`metadata.authorId`, stamped server-side by `networkBackend.ts:83`), admin, and
supervisor — exactly the staff who file the DIAT/DIEP via `SusesoReports.tsx`
(reads `selectedIncident.metadata.workerRut`), so the RUT stays in the node and
the legal form still renders for authorized readers. Helper `nodeHasWorkerRut()`
is null-safe. Rules tests: `src/rules-tests/nodesWorkerRut.rules.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

56. **RUT Peer Snoop**: a plain project member (not author/admin/supervisor)
    `get`s `/nodes/n1` whose `metadata.workerRut` is set — denied; the national
    ID of an injured/diagnosed co-worker is not visible to all peers.

### `isPublic` bypass of the worker-RUT read gate (PRIVACY, fixed 2026-06-08, remaining half of #776)

The first half of #776 added the `nodeHasWorkerRut()` guard ONLY to the
`isProjectMember` branch of the `nodes` read rule, but the rule kept an
`existing().isPublic == true` disjunct OR'd **ahead** of that guard. `isValidNode()`
permits `isPublic:true` alongside `metadata.workerRut`, and the
author/admin/supervisor update rule can toggle a node public — so a DS 67/109
RUT-bearing node flagged `isPublic:true` became readable by **any verified
signed-in user, including a stranger from another project/tenant**, leaking the
worker's raw RUT. (The outer `isEmailVerified()` gate kept anonymous callers out;
the public-web `PublicNodeView.tsx` reads the separate `zettelkasten` collection,
not `nodes` — so the real leak audience was signed-in cross-tenant/peer users.)
Fix: guard the public branch with the same helper —
`(existing().isPublic == true && !nodeHasWorkerRut(existing()))` — so a RUT-bearing
node is **never** publicly readable regardless of `isPublic`; genuinely public
non-RUT nodes keep public-read (no regression). Rules tests:
`src/rules-tests/nodesWorkerRut.rules.test.ts` (`isPublic bypass` describe block).

**Rejected payloads (Dirty-Dozen extension):**

60. **Public-Flag RUT Leak (cross-tenant)**: a verified NON-MEMBER from another
    tenant `get`s `/nodes/n1` with `metadata.workerRut` set AND `isPublic == true`
    — denied; the public flag no longer overrides the worker-RUT gate.
61. **Public-Flag RUT Leak (in-project peer)**: a plain project peer `get`s the
    same public RUT-bearing node — denied; author/admin/supervisor still read it,
    and a public NON-RUT node remains readable (no regression).

### First-Responder presence feed (PII-position read endpoint)

`GET /api/sprint-k/:projectId/first-responder-map/responder-feed`
(`src/server/routes/firstResponderMap.ts`) surfaces brigade members' last-known
positions (from each worker's own `tenants/{tid}/emergency_alerts` ping) so the
dispatch engine can pick the nearest responder. No NEW Firestore collection is
created — it is a read-only derivation over existing `emergency_brigade` /
`emergency_alerts` / `users` (whose rules + rules-tests already exist) — but the
endpoint exposes worker location PII, so it is hardened and audited like a
write path (`verifyAuth` + `assertProjectMember`; one awaited `audit_logs`
entry per call, Ley 19.628 access trail).

**Rejected payloads (Dirty-Dozen extension):**

58. **Responder-Feed Non-Member Snoop**: a caller who is not a member of
    `:projectId` calls the feed — denied 403 (`assertProjectMember`); a
    stranger cannot harvest the live positions of a project's brigade.
59. **Fabricated-Position Injection (impossible-by-construction)**: a brigade
    member with no recent ping must NEVER be returned with coordinates. The
    handler leaves `currentPosition` undefined for any member lacking a fresh
    `emergency_alerts` fix; the engine then emits `no_position_known` and marks
    them honestly unavailable. Positions older than `POSITION_MAX_STALE_SECONDS`
    (30 min) are dropped so a stale GPS fix can never drive a dispatch decision.
64. **Structural-Load Spoof / Cross-project Injection**: a non-member POSTs to
    `:projectId/structural-loads` (or writes `projects/{pid}/structural_loads`
    directly) — denied 403 (`assertProjectMember`) / default-deny by rules. A
    project member cannot forge `createdBy` to another uid on create, and cannot
    change `createdBy` on update (owner is immutable). Deleting a structural-load
    record (a safety input that drives the Bernoulli wind-load predictive alert)
    is restricted to admin/supervisor. A record missing any physical input
    (area/Cp/maxForceN) produces NO probe — the predictive ladder stays honestly
    silent rather than firing on a fabricated wind. The predictive probe is fed
    only by REAL Open-Meteo HOURLY wind at the project's coordinates; with no
    coordinates or no forecast the answer is "no probe", never an invented speed.
    (Numbered #64: #60–#63 are reserved for in-flight blocks.)

### Signed lighting audits (DS 594 Art. 103 lighting-compliance certificate)

`lighting_audits/{id}` (`firestore.rules`) records workplace-lighting Lux
measurements vs DS 594 Art. 103 thresholds. The sole writer
(`src/pages/LightPollutionAudit.tsx` `save()`) persists a TOP-LEVEL boolean
`signed` as the immutability anchor — it never writes a `metadata` object. The
previous update rule gated immutability on `existing().metadata.signedAt ==
null`, which no write path ever set, so the clause was vacuously true and a
signed certificate stayed fully mutable (`signed` was even in the mutable
allowlist, so it could be reset). Same defect class already fixed for
`site_book` (#52). The rule now gates on the REAL field — `existing().signed !=
true` denies EVERY post-sign update, and `signed` may only move false→true.
Corrections are NEW audits, never in-place rewrites.

**Rejected payloads (Dirty-Dozen extension):**

62. **Signed Lighting-Audit Rewrite**: a project member `update`s a
    `lighting_audits` doc whose top-level `signed == true` — e.g.
    `{ averageLux: 999, measurementsLux: [999,999,999], compliant: true }` to
    fake DS 594 Art. 103 compliance after finalization. Denied: the update rule
    gates on `existing().signed != true` (the REAL field the writer sets), so
    any post-sign field rewrite is rejected. Closes the vacuous
    `metadata.signedAt` gate that never matched the writer's schema.
63. **Lighting-Audit Un-Sign Reset**: a project member `update`s a signed
    `lighting_audits` doc with `{ signed: false }` to reopen it for tampering.
    Denied: `signed` was removed from the mutable path and the `existing().signed
    != true` gate blocks the update outright, so a finalized certificate can
    never be un-signed and rewritten.

### Evidence chain-of-custody (audit H8 — content-addressed legal evidence)

`tenants/{tid}/evidence_artifacts/{hash}` (+ `.../events/{eid}`) is the
content-addressed legal evidence chain (photo/PDF/declaration/measurement hashes +
metadata) that an incident expediente promises. The custody engine + adapter
(`src/services/evidenceChain/*`) were inert dead-code (DEEP-EX-16 H8) until
`src/server/routes/custodyChain.ts` mounted them; the collection had NO Firestore
rule and fell to default-deny. ALL writes flow through that `verifyAuth` +
`assertProjectMember` route via the Admin SDK, which bypasses these rules and
server-stamps `uploadedByUid` / `actorUid` from the verified token (CLAUDE.md #3) —
the client SDK NEVER writes here. The artifact's SHA-256 is its identity, so
"replacement" is a NEW event + a server-applied `replacedByHash`, never an in-place
edit. The `/events` subcollection is APPEND-ONLY immutable (same anchor class as
`audit_logs` / `suseso_forms`): no client create, and update/delete denied to anyone
so no link in the custody trail can be rewritten or erased. Rules tests:
`src/rules-tests/evidenceArtifacts.rules.test.ts`; route tests:
`src/__tests__/server/custodyChain.router.test.ts`.

**Rejected payloads (Dirty-Dozen extension):**

67. **Forged-Custody Artifact Write**: a tenant member writes
    `tenants/{tid}/evidence_artifacts/{hash}` directly from the client — e.g. to
    forge `uploadedByUid` to another worker, or fabricate an artifact that was never
    captured. Denied: artifact create/update/delete is server-only (`if false`); the
    only writer is the Admin-SDK custody route, which stamps `uploadedByUid` from the
    verified token, so the chain's identity can never be spoofed.
68. **Custody-Log Tamper (append-only break)**: a member tries to `create` a forged
    `/events/{eid}` link, `update` an existing event (e.g. rewrite `actorRole` to
    `admin`), or `delete` a link to erase who accessed/exported the evidence. All
    denied: the events subcollection is hard `if false` for create/update/delete to
    everyone — the legal chain of custody is immutable and additions only ever happen
    server-side via a NEW Admin-SDK append.
69. **Cross-Tenant Evidence Snoop**: a verified member of tenant B `get`s an artifact
    (or a custody event) under tenant A's `evidence_artifacts` — denied by
    `isMemberOfTenant(tenantId)`; evidence (and its access trail) is readable only by
    members of the owning tenant, and the same gate also drops it from the generic
    sub-collection reader (added to the `evidence_artifacts` deny-list there).

### Photogrammetry reconstruction jobs (on-device digital-twin job tracking)

`projects/{pid}/reconstruction_jobs/{jobId}` is the on-device photogrammetry job
store (`reconstructionJobStore.ts`, client SDK). The worker running the scan
creates the job and persists progress/completion/failure client-side; it had NO
rule and fell to default-deny, so `createReconstructionJob()` failed and the
pipeline died before the GLB upload. Rule: member read + member create/update +
admin/supervisor delete (mirrors `placed_objects` — a job record is part of the
site's safety/inspection trail). Rules tests:
`src/rules-tests/reconstructionJobs.rules.test.ts` (7 cases, F1 harness).
(Storage side — `reconstructions/{projectId}/*.glb|usdz` — is a SEPARATE follow-up:
Cloud Storage rules cannot read Firestore, so securing it requires tenant-keying
the upload path; tracked in PHASE5 #356.)

**Rejected payloads (Dirty-Dozen extension):**

70. **Cross-Project Reconstruction-Job Snoop / Forge**: a non-member of `:pid`
    reads, creates, or updates `projects/{pid}/reconstruction_jobs/{jobId}` —
    denied by `isProjectMember(projectId)` (a stranger cannot see or fabricate a
    project's scan jobs). A member CANNOT delete a job record (delete is
    admin/supervisor-only) so the inspection trail cannot be silently erased; the
    phantom `digital_twin_jobs` path stays server-only (`write:false`) and is not
    the collection the on-device store actually writes.

## Test Runner (firestore.rules.test.ts)
*Note: This is a placeholder for the logic that would be tested.*
