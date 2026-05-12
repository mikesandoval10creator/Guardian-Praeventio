/**
 * Dirty Dozen — Firestore rules pentest suite (Bucket RR).
 *
 * Twelve canonical attacks the rules MUST reject. This file is the
 * automated counterpart to the manual checklist in
 * `docs/security/PENTEST_CHECKLIST.md` and is run quarterly + on every
 * change to `firestore.rules`.
 *
 * The 12 attacks (mirrors PENTEST_CHECKLIST.md ordering):
 *   1.  Cross-tenant project read (worker A reads project B finding).
 *   2.  Privilege escalation (worker writes to admin-only audit_logs).
 *   3.  Audit log mutation by gerente (immutability invariant).
 *   4.  OAuth token theft (any client read of oauth_tokens).
 *   5.  Medical exam read by non-doctor supervisor.
 *   6.  Unauthenticated write attempt to a project sub-collection.
 *   7.  Field injection on cross-tenant project (spoof tenantId/projectId).
 *   8.  Mass enumeration of users collection by a worker.
 *   9.  Quota exhaustion via 1MB document write.
 *   10. Path traversal in document ID (../../audit_logs/x).
 *   11. Stale auth claims — token without role claim writes admin path.
 *   12. Replay attack on idempotent write (must remain idempotent).
 *
 * Emulator dependency: same as `firestore.rules.test.ts` — the suite
 * skips if the emulator is not reachable. CI runs it via
 * `firebase emulators:exec` (see `.github/workflows/ci.yml`
 * `firestore-pentest` job and `scripts/firestore-pentest.mjs`).
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  setLogLevel,
} from 'firebase/firestore';

const PROJECT_ID = 'praeventio-rules-test';
const RULES_PATH = resolve(__dirname, '../../firestore.rules');

function verifiedToken(role?: string, email = 'user@example.com') {
  const tok: Record<string, unknown> = { email, email_verified: true };
  if (role !== undefined) tok.role = role;
  return tok;
}

let testEnv: RulesTestEnvironment | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  setLogLevel('silent');
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
    });
  } catch (err) {
    skipReason = `Firestore emulator not reachable: ${(err as Error).message}`;
    testEnv = null;
  }
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

async function seedUserDoc(uid: string, role: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      uid,
      email: `${uid}@example.com`,
      role,
      createdAt: new Date().toISOString(),
    });
  });
}

async function seedProject(projectId: string, members: string[]) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', projectId), {
      name: 'Project ' + projectId,
      members,
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: members[0] ?? 'creator-uid',
    });
  });
}

describe('Dirty Dozen — Firestore rules pentest', () => {
  function maybeSkip(ctx: { skip: () => void }) {
    if (!testEnv) {
      throw new Error(`[dirtyDozen] FAILED TO START EMULATOR. Tests cannot be skipped: ${skipReason}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 1. Cross-tenant read.
  // Attacker (member of project A) tries to read a finding belonging to
  // project B. isProjectMember(resource.data.projectId) must reject.
  // ─────────────────────────────────────────────────────────────────────
  it('1. Cross-tenant read: user from project A reads project B data', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    await seedProject('project-a', ['user-a']);
    await seedProject('project-b', ['user-b']);
    // Seed a finding belonging to project-b, bypassing rules.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'findings', 'b-finding-1'), {
        projectId: 'project-b',
        title: 'tenant B internal',
        createdBy: 'user-b',
        createdAt: new Date().toISOString(),
      });
    });
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    await assertFails(getDoc(doc(userA, 'findings/b-finding-1')));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. Privilege escalation.
  // Worker writes to audit_logs (server-only). Must be denied.
  // ─────────────────────────────────────────────────────────────────────
  it('2. Privilege escalation: worker writes to admin-only audit_logs', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('worker-1', 'worker');
    const worker = env.authenticatedContext('worker-1', verifiedToken('worker')).firestore();
    await assertFails(setDoc(doc(worker, 'audit_logs/fake-log'), {
      action: 'forged',
      performedBy: 'worker-1',
      timestamp: new Date().toISOString(),
    }));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. Audit log mutation.
  // Even gerente (admin-class) must NOT update an audit log.
  // ─────────────────────────────────────────────────────────────────────
  it('3. Audit log mutation: even gerente cannot UPDATE audit logs (immutable)', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('admin-1', 'gerente');
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'audit_logs', 'some-log'), {
        action: 'role_change',
        performedBy: 'server',
        timestamp: new Date().toISOString(),
      });
    });
    const gerente = env.authenticatedContext('admin-1', verifiedToken('gerente')).firestore();
    await assertFails(updateDoc(doc(gerente, 'audit_logs/some-log'), { tampered: true }));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. OAuth token theft. Total client-side denial regardless of role.
  // ─────────────────────────────────────────────────────────────────────
  it('4. OAuth token theft: user reads another user oauth_tokens', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'oauth_tokens', 'user-b-token'), {
        provider: 'google',
        access_token: 'redacted',
      });
    });
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    await assertFails(getDoc(doc(userA, 'oauth_tokens/user-b-token')));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. Medical exam read by non-doctor.
  // Strict envelope: only owner + medico_ocupacional may read.
  // ─────────────────────────────────────────────────────────────────────
  it('5. Medical exam read by non-doctor (supervisor denied)', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('worker-1', 'worker');
    await seedUserDoc('sup-1', 'supervisor');
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'users', 'worker-1', 'medical_exams', 'exam-1'), {
        examId: 'exam-1',
        type: 'general',
        date: new Date().toISOString(),
      });
    });
    const supervisor = env.authenticatedContext('sup-1', verifiedToken('supervisor')).firestore();
    await assertFails(getDoc(doc(supervisor, 'users/worker-1/medical_exams/exam-1')));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. Unauthenticated write attempt — default-deny baseline.
  // ─────────────────────────────────────────────────────────────────────
  it('6. Unauthenticated write attempt to a project sub-collection', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedProject('p1', ['user-a']);
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, 'findings/anon-finding'), {
      projectId: 'p1',
      title: 'fake',
      createdBy: 'attacker',
      createdAt: new Date().toISOString(),
    }));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. Field injection / cross-tenant projectId spoofing.
  // user-a (member of project-a) tries to write a finding claiming
  // projectId = project-b. isProjectMember(incoming().projectId) must
  // reject because user-a is not a member of project-b.
  // ─────────────────────────────────────────────────────────────────────
  it('7. tenantId/projectId injection: spoof projectId on create', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    await seedProject('project-a', ['user-a']);
    await seedProject('project-b', ['user-b']);
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    await assertFails(setDoc(doc(userA, 'findings/spoof-1'), {
      projectId: 'project-b', // spoof — user-a is not a member of project-b
      title: 'injected',
      createdBy: 'user-a',
      createdAt: new Date().toISOString(),
    }));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. Mass enumeration: list all users.
  // The /users/{uid} rule allows per-doc read for self/admin, but a
  // collection-level list query from a worker must fail (default-deny on
  // list because the rules don't grant `list` to role=worker).
  // ─────────────────────────────────────────────────────────────────────
  it('8. Mass enumeration: list all users via collection query (worker denied)', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    await seedUserDoc('user-b', 'worker');
    await seedUserDoc('user-c', 'worker');
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    await assertFails(getDocs(query(collection(userA, 'users'))));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 9. Quota exhaustion: oversized document is rejected.
  // Firestore's hard per-document limit is ~1 MiB. We use a payload that
  // sits just under the SDK serialization limit so the request reaches
  // the rules engine, where the rules-level size checks (`hasOnly`,
  // `.size()` bounds) reject it. Larger payloads are rejected by the SDK
  // before they ever hit the rules — that's also a valid denial, but it
  // doesn't exercise the rules logic, so we deliberately stay under it.
  // ─────────────────────────────────────────────────────────────────────
  it('9. Quota exhaustion: oversized doc is rejected by rules', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    await seedProject('p1', ['user-a']);
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    // 900 KiB string — well under Firestore's ~1 MiB SDK ceiling but far
    // larger than anything the rules `hasOnly` schema permits on a
    // findings doc, so the rules engine denies before the byte-count
    // tripwire fires.
    const huge = {
      projectId: 'p1',
      title: 'oversize',
      createdBy: 'user-a',
      createdAt: new Date().toISOString(),
      data: 'x'.repeat(900 * 1024),
    };
    // Either PERMISSION_DENIED (rules deny) or invalid-argument (SDK
    // serializer rejects) is acceptable — the contract is "must fail".
    let failed = false;
    try {
      await setDoc(doc(userA, 'findings/big'), huge);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 10. Path traversal in document ID.
  // Firestore client SDK rejects '..' and '/' inside a single segment;
  // additionally the rules `isValidId` regex `^[a-zA-Z0-9_\-]+$` denies
  // any non-alphanumeric id. We assert the SDK throws.
  // ─────────────────────────────────────────────────────────────────────
  it('10. Path traversal in document ID is rejected', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    // The SDK throws synchronously when `doc(...)` is given a slashed
    // segment that doesn't decompose into an even-length path. Firestore
    // splits on '/' so 'findings/../../audit_logs/fake' becomes a 4-segment
    // path with empty traversal segments — the SDK either rejects the
    // construction or routes to a path that the rules then reject.
    expect(() => {
      // Either of these must fail at the SDK level or via rules.
      doc(userA, 'findings/p1/items/../../audit_logs/fake');
    }).toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────
  // 11. Stale auth claims — token without role claim writes admin path.
  // verifiedToken() with no role + no users/{uid} doc means isAdmin()
  // returns false on both branches; audit_logs:create is denied.
  // ─────────────────────────────────────────────────────────────────────
  it('11. Stale auth claims: token without role claim writes admin path', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    // Intentionally do NOT seed users/{uid} — the rule's fallback lookup
    // returns null, so isAdmin() must fail on both auth-claim and
    // Firestore-lookup branches.
    const noRole = env.authenticatedContext('user-c', verifiedToken(undefined)).firestore();
    await assertFails(setDoc(doc(noRole, 'audit_logs/x'), {
      action: 'forged',
      performedBy: 'user-c',
      timestamp: new Date().toISOString(),
    }));
  });

  // ─────────────────────────────────────────────────────────────────────
  // 12. Replay attack on idempotent write.
  // Same write twice must remain a no-op for an idempotent path; we
  // assert success on both attempts. This pins the contract that the
  // rules don't accidentally introduce CAS-style constraints that would
  // turn legitimate retries into failures.
  // ─────────────────────────────────────────────────────────────────────
  it('12. Replay attack on idempotent write (gamification_scores)', async (testCtx) => {
    maybeSkip(testCtx);
    const env = requireEnv();
    await seedUserDoc('user-a', 'worker');
    const userA = env.authenticatedContext('user-a', verifiedToken('worker')).firestore();
    const id = 'user-a_clawmachine';
    const payload = {
      userId: 'user-a',
      gameId: 'clawmachine',
      bestScore: 80,
      bestTimeSeconds: 30,
      lastScore: 80,
      plays: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'user-a',
    };
    await assertSucceeds(setDoc(doc(userA, 'gamification_scores/' + id), payload));
    // Replay same write — must remain idempotent (no rule-induced CAS).
    await assertSucceeds(setDoc(doc(userA, 'gamification_scores/' + id), payload));
  });
});
