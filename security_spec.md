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
16. **Signed SiteBook Tamper**: `update /projects/p1/site_book_entries/e1`
    where `signedAt` is already set.
17. **Compliance Delete**: `delete /projects/p1/stoppages/s1` (even as admin).

## Test Runner (firestore.rules.test.ts)
*Note: This is a placeholder for the logic that would be tested.*
