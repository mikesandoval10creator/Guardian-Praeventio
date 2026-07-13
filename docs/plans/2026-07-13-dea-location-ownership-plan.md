# DEA Location Ownership Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close cross-project takeover of the public DEA registry while preserving universal anonymous discovery and legitimate project-owned management.

**Architecture:** Keep `dea_locations` and its sanitized schema unchanged. Add a fail-closed direct-project-association helper that excludes the broad global-role shortcut, then evaluate update/delete authorization from the existing owner and require a trusted management role. Treat Firestore Emulator tests and `security_spec.md` as the executable and written authorization matrix.

**Tech Stack:** Firestore Security Rules v2, Firebase Rules Unit Testing, Firebase Emulator Suite, Vitest 4, TypeScript 5.8.

## Global Constraints

- `allow read: if true` for `dea_locations` must remain unchanged.
- Life-safety DEA discovery must never require authentication, project membership, or a paid tier.
- Do not remove create, update, or delete capabilities.
- Do not add PII or caller identity to the public document schema.
- Test assertions must use `authenticatedContext`; Admin SDK/rules-disabled contexts are seed-only.
- Production rules change only after the new takeover tests fail for the expected authorization reason.

---

### Task 1: Pin the cross-project exploit and management matrix

**Files:**
- Modify: `src/rules-tests/deaLocations.rules.test.ts`

**Interfaces:**
- Consumes: `createRulesTestEnv()`, `verifiedToken(role)`, the real `firestore.rules` file, and Firestore `setDoc`/`updateDoc`/`deleteDoc` operations.
- Produces: an executable authorization matrix for anonymous readers, project A/B workers, and project A/B supervisors.

- [x] **Step 1: Expand the fixture to two projects and role-bearing callers**

Use stable identities and seed both projects with explicit member arrays:

```ts
const PROJECT_A = 'proj-dea-a';
const PROJECT_B = 'proj-dea-b';
const WORKER_A = 'worker-a';
const SUPERVISOR_A = 'supervisor-a';
const WORKER_B = 'worker-b';
const SUPERVISOR_B = 'supervisor-b';

function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
```

Seed `members: [WORKER_A, SUPERVISOR_A]` for A and the equivalent list for B.

- [x] **Step 2: Write failing takeover and role tests**

Add real-emulator assertions for these operations:

```ts
await assertFails(updateDoc(ref(authed(WORKER_B), 'seeded-a'), {
  projectId: PROJECT_B,
}));

await assertFails(updateDoc(ref(authed(SUPERVISOR_B, 'supervisor'), 'seeded-a'), {
  status: 'warning',
}));

await assertFails(updateDoc(ref(authed(WORKER_A), 'seeded-a'), {
  status: 'warning',
}));

await assertFails(deleteDoc(ref(authed(WORKER_A), 'seeded-a')));
await assertFails(deleteDoc(ref(authed(SUPERVISOR_B, 'supervisor'), 'seeded-a')));
```

Also assert that a directly associated A supervisor can update/delete, cannot
change `projectId`, and an unassociated global supervisor cannot publish for A.
Keep the anonymous-read, member-create, schema, and PII-smuggling assertions.

- [x] **Step 3: Run the focused suite and verify RED**

Run:

```text
firebase emulators:exec --only firestore --project praeventio-rules-test ".\\node_modules\\.bin\\vitest.cmd run --config vitest.rules.config.ts src/rules-tests/deaLocations.rules.test.ts --reporter=dot"
```

Expected: failures show current rules wrongly allow cross-project takeover,
unassociated supervisor management, and worker update/delete. Existing
anonymous read and schema tests remain green.

### Task 2: Enforce existing-owner authorization

**Files:**
- Modify: `firestore.rules`
- Test: `src/rules-tests/deaLocations.rules.test.ts`

**Interfaces:**
- Produces: `isDirectProjectMember(projectId)` and `canManagePublicDeaLocation(projectId)` rule helpers.
- Enforces: create from direct association; update/delete from existing owner plus management role; immutable `projectId`.

- [x] **Step 1: Add fail-closed direct association helpers**

Add near the project membership helpers:

```text
function isDirectProjectMember(projectId) {
  return isEmailVerified() && isValidId(projectId) && (
    request.auth.uid in get(/databases/$(database)/documents/projects/$(projectId)).data.get('members', []) ||
    get(/databases/$(database)/documents/projects/$(projectId)).data.get('createdBy', '') == request.auth.uid
  );
}

function canManagePublicDeaLocation(projectId) {
  return isDirectProjectMember(projectId) && (isAdmin() || isSupervisor());
}
```

The helper name and comment must state that global role alone does not establish
project ownership.

- [x] **Step 2: Split create/update/delete rules by operation**

Replace the combined write rule with:

```text
allow create: if isDirectProjectMember(incoming().projectId)
  && isValidDeaLocation(incoming());
allow update: if canManagePublicDeaLocation(existing().projectId)
  && incoming().projectId == existing().projectId
  && isValidDeaLocation(incoming());
allow delete: if canManagePublicDeaLocation(existing().projectId);
```

Leave `allow read: if true` byte-for-byte unchanged.

- [x] **Step 3: Run focused tests and verify GREEN**

Run the Task 1 emulator command again.

Expected: every DEA location test passes, including anonymous read and all new
project/role cases.

- [x] **Step 4: Run rules lint**

Run: `npm run lint:rules`

Expected: exit code 0 with no Firestore rule errors.

### Task 3: Record the threat model and evidence

**Files:**
- Modify: `security_spec.md`
- Modify: `docs/plans/2026-07-13-dea-location-ownership-plan.md`

**Interfaces:**
- Consumes: the final rule conditions and passing emulator matrix.
- Produces: reviewer-readable rejected payloads and an updated execution record.

- [x] **Step 1: Update the public DEA security model**

Replace the stale claim that all writes use incoming membership. Document:

- universal anonymous read;
- direct association for create;
- existing-owner association plus manager role for update/delete;
- immutable `projectId`;
- unchanged sanitized schema.

- [x] **Step 2: Add explicit rejected attacks**

Add named entries for:

```text
Cross-project DEA Takeover
Global-role Ownership Bypass
Worker Public-DEA Delete
DEA Owner Reassignment
```

Each entry must name the attempted operation and the exact rule invariant that
denies it.

- [x] **Step 3: Mark completed plan checkboxes only after evidence exists**

Record the focused test count, full rules-suite count, lint/typecheck/build
results, and any pre-existing warnings separately from failures.

### Task 4: Full verification and publication

**Files:**
- Review every changed file; stage no generated emulator logs, caches, or unrelated files.

**Interfaces:**
- Produces: one scoped commit series, one draft PR, and a Notion task in `Review`.

- [x] **Step 1: Run the full Firestore/Storage rules suite**

Run: `npm run test:rules`

Expected: exit code 0; no skipped emulator assertions.

- [x] **Step 2: Run repository gates**

Run:

```text
npm run typecheck:ci
npm run test -- --reporter=dot
npm run lint:rules
npx eslint src/rules-tests/deaLocations.rules.test.ts
npm run build
```

Expected: all commands exit 0. Existing warnings must be recorded, not described
as new failures.

- [x] **Step 3: Review and stage the exact scope**

Run:

```text
git status --short
git diff --check
git diff -- firestore.rules src/rules-tests/deaLocations.rules.test.ts security_spec.md docs/plans/2026-07-13-dea-location-ownership-*.md
```

Confirm anonymous read remains, the test uses the real emulator harness, no
secret is present, and no generated `firestore-debug.log` is staged.

- [x] **Step 4: Commit, push, and open a draft PR**

Use conventional commits, push `codex/dea-location-ownership`, and create one
draft PR against `main`. The PR body must link the Notion task, state the root
cause, list exact verification, and call out universal anonymous DEA access.

- [x] **Step 5: Update Notion**

Set the task to `Review`, attach the PR URL, record exact verification commands,
and set `Estado E2E` from actual emulator evidence rather than assumption.

## Verification record (2026-07-13)

- TDD RED: focused Firestore Emulator run produced 7 expected authorization
  failures and 9 passes before the production rule change.
- Focused GREEN: 1 file, 16/16 tests passed against the real Firestore Emulator.
- Full rules gate: 51/51 files and 739/739 tests passed with Firestore and Storage
  emulators. One intervening run ended with a transient Vitest worker exit after
  733/739 tests and no failed assertion; an isolated rerun passed completely.
- Rules lint: exit 0, 0 errors, 4 deliberate open-read warnings. The DEA warning
  is retained because universal anonymous discovery is a life-safety invariant.
- Test-file lint: exit 0, no findings.
- Typecheck: `npm run typecheck:ci` exited 0.
- General Vitest gate: exit 0; JSON report recorded 18,800 passed, 0 failed, and
  1 todo. Existing jsdom not-implemented diagnostics remain non-failing.
- Production build: exit 0 with the expected chunk-size/dynamic-import warnings.
- Scope review: only `firestore.rules`, the DEA rules test, `security_spec.md`,
  and the two task plan/design documents are intended for the PR; generated
  emulator/build files remain unstaged.
- Publication: draft PR #1265 opened against `main` at
  `https://github.com/mikesandoval10creator/Guardian-Praeventio/pull/1265`.
- Tracking: Notion task moved to `Review`, linked to PR #1265, populated with
  reproducible verification commands, and set to `Estado E2E: Completa` from
  the passing Firestore Emulator matrix.
