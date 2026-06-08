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
  are append-only once `signedAt` is set.
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
    where `signedAt` is already set.
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

## Test Runner (firestore.rules.test.ts)
*Note: This is a placeholder for the logic that would be tested.*
