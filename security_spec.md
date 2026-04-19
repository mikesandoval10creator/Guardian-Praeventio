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

## Test Runner (firestore.rules.test.ts)
*Note: This is a placeholder for the logic that would be tested.*
