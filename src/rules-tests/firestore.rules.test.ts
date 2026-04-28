/**
 * Firestore security-rules unit tests.
 *
 * These tests run the rules against the in-memory Firestore emulator via
 * `@firebase/rules-unit-testing`. They verify the contract documented at
 * `firestore.rules`, with focus on:
 *
 *   1. `audit_logs` immutability + server-only writes (no client role can
 *      ever `create`/`update`/`delete`; only `gerente`/`admin` can read).
 *   2. `oauth_tokens` total client-side denial.
 *   3. `users/{uid}/medical_exams` privacy envelope (owner reads + doctor
 *      read/write; everyone else denied).
 *
 * IMPORTANT — emulator dependency:
 *   `@firebase/rules-unit-testing` does NOT bundle the Firestore emulator
 *   binary. The emulator must be started separately, e.g.:
 *
 *     firebase emulators:start --only firestore --project praeventio-rules-test
 *
 *   When the emulator is unreachable the test suite is auto-skipped at module
 *   load time (we attempt a one-shot `initializeTestEnvironment` and skip if
 *   it throws). This keeps CI green on hosts that don't have the firebase
 *   CLI installed without silently dropping coverage when it is available.
 *
 *   The CI workflow (`.github/workflows/ci.yml`) has a separate
 *   `rules-tests` job that installs `firebase-tools` and runs these tests
 *   against a real emulator instance.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
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
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  setLogLevel,
} from 'firebase/firestore';

const PROJECT_ID = 'praeventio-rules-test';
const RULES_PATH = resolve(__dirname, '../../firestore.rules');

// Common token shape used throughout. The rules call `email_verified == true`
// on essentially every privileged path, so unverified-email contexts behave
// like unauthenticated for those branches.
function verifiedToken(role: string, email = 'user@example.com') {
  return { email, email_verified: true, role };
}

let testEnv: RulesTestEnvironment | null = null;
let skipReason: string | null = null;

/**
 * Probe the Firestore emulator. If it's not reachable, capture the reason and
 * skip the suite — see file header for why. We do this in a top-level
 * `beforeAll` rather than at module scope so vitest's discovery still works.
 */
beforeAll(async () => {
  // Silence noisy "WebChannel transport errored" logs when the emulator is
  // briefly unreachable during the probe.
  setLogLevel('silent');
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(RULES_PATH, 'utf8'),
      },
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

// --- Helpers -------------------------------------------------------------

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

/** Seed `users/{uid}` with a role, bypassing rules. Needed because some rule
 *  helpers (`isAdmin()`, `isSupervisor()`, `isDoctor()`) fall back to a
 *  Firestore lookup when the auth token doesn't carry a role claim. We set
 *  both for redundancy. */
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

/** Seed an audit log doc bypassing rules so we can test read/update/delete. */
async function seedAuditLog(logId: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'audit_logs', logId), {
      action: 'role_change',
      performedBy: 'server',
      timestamp: new Date().toISOString(),
    });
  });
}

async function seedMedicalExam(uid: string, examId: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', uid, 'medical_exams', examId),
      { examId, type: 'general', date: new Date().toISOString() },
    );
  });
}

async function seedOAuthToken(tokenId: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'oauth_tokens', tokenId), {
      provider: 'google',
      access_token: 'redacted',
    });
  });
}

// --- Tests ---------------------------------------------------------------

describe('firestore.rules', () => {
  // Vitest doesn't have a native "skip whole describe based on async state",
  // so each `it` checks the flag. The cost is one branch per test; the win
  // is that vitest still reports skipped tests rather than crashing.
  function maybeSkip(ctx: { skip: () => void }) {
    if (!testEnv) {
      // eslint-disable-next-line no-console
      console.warn(`[rules-tests] skipping: ${skipReason}`);
      ctx.skip();
    }
  }

  describe('audit_logs/{logId} — server-only audit trail', () => {
    it('denies client create for unauthenticated user', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      const unauthed = env.unauthenticatedContext();
      await assertFails(
        addDoc(collection(unauthed.firestore(), 'audit_logs'), {
          action: 'forged',
          performedBy: 'attacker',
          timestamp: new Date().toISOString(),
        }),
      );
    });

    it('denies client create for a regular worker', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('worker-uid', 'worker');
      const worker = env.authenticatedContext(
        'worker-uid',
        verifiedToken('worker'),
      );
      await assertFails(
        addDoc(collection(worker.firestore(), 'audit_logs'), {
          action: 'forged',
          performedBy: 'worker-uid',
          timestamp: new Date().toISOString(),
        }),
      );
    });

    it('denies client create for a supervisor', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('sup-uid', 'supervisor');
      const sup = env.authenticatedContext(
        'sup-uid',
        verifiedToken('supervisor'),
      );
      await assertFails(
        addDoc(collection(sup.firestore(), 'audit_logs'), {
          action: 'forged',
          performedBy: 'sup-uid',
          timestamp: new Date().toISOString(),
        }),
      );
    });

    it('denies client create for a gerente (admin role)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('boss-uid', 'gerente');
      const boss = env.authenticatedContext(
        'boss-uid',
        verifiedToken('gerente'),
      );
      // Even an admin must not be able to forge audit entries from the client
      // — the Admin SDK is the only legitimate writer.
      await assertFails(
        addDoc(collection(boss.firestore(), 'audit_logs'), {
          action: 'forged',
          performedBy: 'boss-uid',
          timestamp: new Date().toISOString(),
        }),
      );
    });

    it('allows read for gerente', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('boss-uid', 'gerente');
      await seedAuditLog('log-1');
      const boss = env.authenticatedContext(
        'boss-uid',
        verifiedToken('gerente'),
      );
      await assertSucceeds(getDoc(doc(boss.firestore(), 'audit_logs', 'log-1')));
    });

    it('allows read for admin', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('admin-uid', 'admin');
      await seedAuditLog('log-2');
      const admin = env.authenticatedContext(
        'admin-uid',
        verifiedToken('admin'),
      );
      await assertSucceeds(
        getDoc(doc(admin.firestore(), 'audit_logs', 'log-2')),
      );
    });

    it('denies read for supervisor', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('sup-uid', 'supervisor');
      await seedAuditLog('log-3');
      const sup = env.authenticatedContext(
        'sup-uid',
        verifiedToken('supervisor'),
      );
      await assertFails(getDoc(doc(sup.firestore(), 'audit_logs', 'log-3')));
    });

    it('denies read for worker', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('worker-uid', 'worker');
      await seedAuditLog('log-4');
      const worker = env.authenticatedContext(
        'worker-uid',
        verifiedToken('worker'),
      );
      await assertFails(
        getDoc(doc(worker.firestore(), 'audit_logs', 'log-4')),
      );
    });

    it('denies read for unauthenticated', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedAuditLog('log-5');
      const unauthed = env.unauthenticatedContext();
      await assertFails(
        getDoc(doc(unauthed.firestore(), 'audit_logs', 'log-5')),
      );
    });

    it('denies update even for gerente (immutable)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('boss-uid', 'gerente');
      await seedAuditLog('log-6');
      const boss = env.authenticatedContext(
        'boss-uid',
        verifiedToken('gerente'),
      );
      await assertFails(
        updateDoc(doc(boss.firestore(), 'audit_logs', 'log-6'), {
          action: 'tampered',
        }),
      );
    });

    it('denies delete even for gerente (immutable)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('boss-uid', 'gerente');
      await seedAuditLog('log-7');
      const boss = env.authenticatedContext(
        'boss-uid',
        verifiedToken('gerente'),
      );
      await assertFails(
        deleteDoc(doc(boss.firestore(), 'audit_logs', 'log-7')),
      );
    });
  });

  describe('oauth_tokens/{tokenId} — server-only', () => {
    it('denies read for unauthenticated', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedOAuthToken('uid_google');
      const unauthed = env.unauthenticatedContext();
      await assertFails(
        getDoc(doc(unauthed.firestore(), 'oauth_tokens', 'uid_google')),
      );
    });

    it('denies read for owner (uid prefix matches)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('owner-uid', 'worker');
      await seedOAuthToken('owner-uid_google');
      const owner = env.authenticatedContext(
        'owner-uid',
        verifiedToken('worker'),
      );
      await assertFails(
        getDoc(doc(owner.firestore(), 'oauth_tokens', 'owner-uid_google')),
      );
    });

    it('denies read for admin', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('admin-uid', 'admin');
      await seedOAuthToken('owner-uid_google');
      const admin = env.authenticatedContext(
        'admin-uid',
        verifiedToken('admin'),
      );
      await assertFails(
        getDoc(doc(admin.firestore(), 'oauth_tokens', 'owner-uid_google')),
      );
    });

    it('denies write for admin', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc('admin-uid', 'admin');
      const admin = env.authenticatedContext(
        'admin-uid',
        verifiedToken('admin'),
      );
      await assertFails(
        setDoc(doc(admin.firestore(), 'oauth_tokens', 'admin-uid_google'), {
          provider: 'google',
          access_token: 'forged',
        }),
      );
    });
  });

  describe('users/{uid}/medical_exams/{examId} — privacy envelope', () => {
    const OWNER = 'patient-uid';
    const EXAM = 'exam-1';

    it('allows read for owner', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedMedicalExam(OWNER, EXAM);
      const owner = env.authenticatedContext(OWNER, verifiedToken('worker'));
      await assertSucceeds(
        getDoc(
          doc(owner.firestore(), 'users', OWNER, 'medical_exams', EXAM),
        ),
      );
    });

    it('allows read for medico_ocupacional (any uid)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('doc-uid', 'medico_ocupacional');
      await seedMedicalExam(OWNER, EXAM);
      const medic = env.authenticatedContext(
        'doc-uid',
        verifiedToken('medico_ocupacional'),
      );
      await assertSucceeds(
        getDoc(
          doc(medic.firestore(), 'users', OWNER, 'medical_exams', EXAM),
        ),
      );
    });

    it('denies read for non-doctor supervisor', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('sup-uid', 'supervisor');
      await seedMedicalExam(OWNER, EXAM);
      const sup = env.authenticatedContext(
        'sup-uid',
        verifiedToken('supervisor'),
      );
      await assertFails(
        getDoc(doc(sup.firestore(), 'users', OWNER, 'medical_exams', EXAM)),
      );
    });

    it('denies read for prevencionista (supervisor-class but not doctor)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('prev-uid', 'prevencionista');
      await seedMedicalExam(OWNER, EXAM);
      const prev = env.authenticatedContext(
        'prev-uid',
        verifiedToken('prevencionista'),
      );
      await assertFails(
        getDoc(
          doc(prev.firestore(), 'users', OWNER, 'medical_exams', EXAM),
        ),
      );
    });

    it('denies read for gerente (admin) — strict envelope excludes admins', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('boss-uid', 'gerente');
      await seedMedicalExam(OWNER, EXAM);
      const boss = env.authenticatedContext(
        'boss-uid',
        verifiedToken('gerente'),
      );
      // The rule is `isOwner(userId) || isDoctor()` — admins explicitly
      // excluded per the medical-confidentiality envelope.
      await assertFails(
        getDoc(
          doc(boss.firestore(), 'users', OWNER, 'medical_exams', EXAM),
        ),
      );
    });

    it('denies read for unrelated worker', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('peer-uid', 'worker');
      await seedMedicalExam(OWNER, EXAM);
      const peer = env.authenticatedContext(
        'peer-uid',
        verifiedToken('worker'),
      );
      await assertFails(
        getDoc(
          doc(peer.firestore(), 'users', OWNER, 'medical_exams', EXAM),
        ),
      );
    });

    it('allows write for medico_ocupacional', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('doc-uid', 'medico_ocupacional');
      const medic = env.authenticatedContext(
        'doc-uid',
        verifiedToken('medico_ocupacional'),
      );
      await assertSucceeds(
        setDoc(
          doc(medic.firestore(), 'users', OWNER, 'medical_exams', 'new-exam'),
          { examId: 'new-exam', type: 'audiometry', date: '2026-04-28' },
        ),
      );
    });

    it('denies write for owner (only doctor can write)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      const owner = env.authenticatedContext(OWNER, verifiedToken('worker'));
      await assertFails(
        setDoc(
          doc(owner.firestore(), 'users', OWNER, 'medical_exams', 'self-exam'),
          { examId: 'self-exam', type: 'self-reported', date: '2026-04-28' },
        ),
      );
    });

    it('denies write for admin (only doctor can write)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(OWNER, 'worker');
      await seedUserDoc('admin-uid', 'admin');
      const admin = env.authenticatedContext(
        'admin-uid',
        verifiedToken('admin'),
      );
      await assertFails(
        setDoc(
          doc(admin.firestore(), 'users', OWNER, 'medical_exams', 'admin-exam'),
          { examId: 'admin-exam', type: 'general', date: '2026-04-28' },
        ),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Round 14 (R5) — curriculum_claims/{claimId}.
  //
  // Pin the security envelope:
  //   • Worker can create their own claim (workerId == uid, status =
  //     pending_referees, ≤500-char text, exactly 2 referees).
  //   • Worker can read their own claims; admins can read any.
  //   • Updates and deletes are server-only — even the worker themselves
  //     cannot mutate the claim from the client (referee co-signature
  //     happens via /api/curriculum/referee/:token using the Admin SDK).
  // ───────────────────────────────────────────────────────────────────
  describe('curriculum_claims/{claimId} — server-managed verification', () => {
    const WORKER = 'worker-curriculum-uid';
    const VALID_BODY = {
      workerId: WORKER,
      workerEmail: 'worker-curriculum-uid@example.com',
      claim: 'He trabajado 5 años como capataz de seguridad sin incidentes graves.',
      category: 'experience',
      signedByWorker: { signedAt: new Date().toISOString(), fallbackAttest: false },
      referees: [
        { email: 'a@ref.cl', name: 'Ana', tokenHash: 'h1', signedAt: null },
        { email: 'b@ref.cl', name: 'Bruno', tokenHash: 'h2', signedAt: null },
      ],
      status: 'pending_referees',
      createdAt: new Date().toISOString(),
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };

    async function seedClaim(claimId: string, overrides: Partial<typeof VALID_BODY> = {}) {
      await requireEnv().withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'curriculum_claims', claimId),
          { ...VALID_BODY, ...overrides },
        );
      });
    }

    it('allows worker to create their own claim with valid shape', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertSucceeds(
        setDoc(doc(w.firestore(), 'curriculum_claims', 'c-new'), VALID_BODY),
      );
    });

    it('denies create when workerId does not match auth.uid', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertFails(
        setDoc(doc(w.firestore(), 'curriculum_claims', 'c-spoof'), {
          ...VALID_BODY,
          workerId: 'someone-else-uid',
        }),
      );
    });

    it('denies create when status is not pending_referees', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertFails(
        setDoc(doc(w.firestore(), 'curriculum_claims', 'c-prefab'), {
          ...VALID_BODY,
          status: 'verified',
          verifiedAt: new Date().toISOString(),
        }),
      );
    });

    it('denies create when claim text exceeds 500 chars', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertFails(
        setDoc(doc(w.firestore(), 'curriculum_claims', 'c-long'), {
          ...VALID_BODY,
          claim: 'x'.repeat(501),
        }),
      );
    });

    it('denies create when referees count is not exactly 2', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertFails(
        setDoc(doc(w.firestore(), 'curriculum_claims', 'c-one-ref'), {
          ...VALID_BODY,
          referees: [VALID_BODY.referees[0]],
        }),
      );
    });

    it('allows worker to read their own claim', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      await seedClaim('c-read');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertSucceeds(getDoc(doc(w.firestore(), 'curriculum_claims', 'c-read')));
    });

    it('denies read for an unrelated worker', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      await seedUserDoc('peer-uid', 'operario');
      await seedClaim('c-other');
      const peer = env.authenticatedContext('peer-uid', verifiedToken('operario'));
      await assertFails(getDoc(doc(peer.firestore(), 'curriculum_claims', 'c-other')));
    });

    it('allows read for admin', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      await seedUserDoc('admin-uid', 'admin');
      await seedClaim('c-admin-read');
      const a = env.authenticatedContext('admin-uid', verifiedToken('admin'));
      await assertSucceeds(getDoc(doc(a.firestore(), 'curriculum_claims', 'c-admin-read')));
    });

    it('denies update from the worker (server-only via Admin SDK)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      await seedClaim('c-update');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertFails(
        updateDoc(doc(w.firestore(), 'curriculum_claims', 'c-update'), {
          status: 'verified',
        }),
      );
    });

    it('denies update from admin (server-only)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      await seedUserDoc('admin-uid', 'admin');
      await seedClaim('c-admin-update');
      const a = env.authenticatedContext('admin-uid', verifiedToken('admin'));
      await assertFails(
        updateDoc(doc(a.firestore(), 'curriculum_claims', 'c-admin-update'), {
          status: 'verified',
        }),
      );
    });

    it('denies delete (immutable record of professional reputation)', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedUserDoc(WORKER, 'operario');
      await seedClaim('c-del');
      const w = env.authenticatedContext(WORKER, verifiedToken('operario', VALID_BODY.workerEmail));
      await assertFails(deleteDoc(doc(w.firestore(), 'curriculum_claims', 'c-del')));
    });

    it('denies any access for unauthenticated', async (ctx) => {
      maybeSkip(ctx);
      const env = requireEnv();
      await seedClaim('c-anon');
      const u = env.unauthenticatedContext();
      await assertFails(getDoc(doc(u.firestore(), 'curriculum_claims', 'c-anon')));
      await assertFails(
        setDoc(doc(u.firestore(), 'curriculum_claims', 'c-anon-2'), VALID_BODY),
      );
    });
  });
});
