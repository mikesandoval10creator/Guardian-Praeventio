// SPDX-License-Identifier: MIT
//
// Attendance anti-forge (2026-07-02 end-to-end audit §3.2). The rule
// `projects/{pid}/attendance/{id}` previously allowed create+update for ANY
// project member with NO schema validation and NO identity binding, so any
// member could forge or backdate attendance for any worker — corrupting the
// legal payroll (attendance = hours worked) AND the evacuation headcount seed
// (EvacuationDashboard reads this collection).
//
// This suite pins the hardened rule: a member records attendance with the
// payload shape validated + `recordedBy` bound to the caller (anti-spoof),
// updates restricted to admin/supervisor with the recorder immutable. Uses the
// F1 harness (real rules, real emulator — no Admin SDK, no gate-field seeding).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-att-1';
const OPERATOR = 'operator-uid-1'; // gate operator (a project member)
const OTHER = 'member-uid-2';       // another project member
const OUTSIDER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';
const WORKER = 'worker-uid-7';       // the worker being checked in (not the caller)

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  testEnv = await createRulesTestEnv();
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Attendance Test Project', members: [OPERATOR, OTHER], status: 'active',
      createdAt: '2026-07-01T00:00:00Z', createdBy: OPERATOR,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-07-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function attRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'attendance', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
const record = (recordedBy: string, over: Record<string, unknown> = {}) => ({
  workerId: WORKER,
  workerName: 'Worker Seven',
  type: 'Check-In',
  timestamp: '2026-07-02T13:00:00Z',
  location: 'Torniquete Principal',
  projectId: PID,
  recordedBy,
  createdAt: '2026-07-02T13:00:00Z',
  ...over,
});
async function seedRecord(id: string, recordedBy = OPERATOR) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'attendance', id), record(recordedBy));
  });
}

describe('projects/{pid}/attendance — anti-forge (firestore.rules)', () => {
  it('member (gate operator) records attendance for a worker, recordedBy == caller', async () => {
    await assertSucceeds(setDoc(attRef(authed(OPERATOR), 'att-1'), record(OPERATOR)));
  });

  it('non-member cannot record attendance', async () => {
    await assertFails(setDoc(attRef(authed(OUTSIDER), 'att-2'), record(OUTSIDER)));
  });

  it('member cannot spoof recordedBy to another uid (server-field-spoof-deny)', async () => {
    await assertFails(setDoc(attRef(authed(OPERATOR), 'att-3'), record(OTHER)));
  });

  it('schema-violation: an arbitrary/backdated shape is denied', async () => {
    await assertFails(
      setDoc(attRef(authed(OPERATOR), 'att-4'), { note: 'anything', recordedBy: OPERATOR }),
    );
  });

  it('invalid type is denied (only Check-In / Check-Out)', async () => {
    await assertFails(setDoc(attRef(authed(OPERATOR), 'att-5'), record(OPERATOR, { type: 'Ghost' })));
  });

  it('cross-project injection is denied (doc projectId must match its path)', async () => {
    await assertFails(
      setDoc(attRef(authed(OPERATOR), 'att-xproj'), record(OPERATOR, { projectId: 'some-other-project' })),
    );
  });

  it('a line worker cannot update (rewrite) an existing attendance record', async () => {
    await seedRecord('att-6', OPERATOR);
    await assertFails(
      setDoc(attRef(authed(OPERATOR), 'att-6'), record(OPERATOR, { timestamp: '2026-06-01T08:00:00Z' })),
    );
  });

  it('admin can correct an attendance record but cannot change the recorder', async () => {
    await seedRecord('att-7', OPERATOR);
    await assertSucceeds(
      setDoc(attRef(authed(ADMIN, 'admin'), 'att-7'), record(OPERATOR, { location: 'Portón 2' })),
    );
    await assertFails(
      setDoc(attRef(authed(ADMIN, 'admin'), 'att-7'), record(OTHER)),
    );
  });
});
