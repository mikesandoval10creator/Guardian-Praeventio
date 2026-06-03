// SPDX-License-Identifier: MIT
//
// B7 — personalized_plans + users/{uid}/morning_checkins rules.
//
// Two client-SDK collections that had no write rule (default-denied):
//   • projects/{pid}/personalized_plans (PersonalizedSafetyPlan) — no creator-uid
//     field → member-gated; admin/supervisor delete.
//   • users/{uid}/morning_checkins/{date} (MorningRoutine wellness self-check) —
//     private to the worker + occupational-health doctor; owner writes; never
//     deleted. (The users/{uid} block has no master-gate, so this needs explicit
//     read+write rules.)
// Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-b7-1';
const WORKER = 'worker-uid-1';
const OTHER = 'worker-uid-2';
const OUTSIDER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';
const DOCTOR = 'doctor-uid-1';

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
      name: 'B7 Project', members: [WORKER, OTHER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: WORKER,
    });
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
    await setDoc(doc(db, 'users', DOCTOR), { uid: DOCTOR, role: 'medico_ocupacional', email: `${DOCTOR}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function planRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'personalized_plans', id);
}
function checkinRef(ctxDb: CtxDb, uid: string, date: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'users', uid, 'morning_checkins', date);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

const plan = { projectId: PID, workerId: 'w1', workerName: 'Juan', plan: { steps: [] }, createdAt: '2026-06-01T00:00:00Z' };
const checkin = { date: '2026-06-03', fatigue: 2, sleepHours: 7 };

describe('personalized_plans — firestore.rules (B7)', () => {
  it('member can save a plan', async () => {
    await assertSucceeds(setDoc(planRef(authed(WORKER), 'p1'), plan));
  });
  it('non-member cannot save a plan', async () => {
    await assertFails(setDoc(planRef(authed(OUTSIDER), 'p2'), plan));
  });
  it('member cannot delete; admin can', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', PID, 'personalized_plans', 'p3'), plan);
    });
    await assertFails(deleteDoc(planRef(authed(WORKER), 'p3')));
    await assertSucceeds(deleteDoc(planRef(authed(ADMIN, 'admin'), 'p3')));
  });
});

describe('users/{uid}/morning_checkins — private wellness (B7)', () => {
  it('worker can record their own morning check-in', async () => {
    await assertSucceeds(setDoc(checkinRef(authed(WORKER), WORKER, '2026-06-03'), checkin));
  });
  it('another worker cannot write someone else\'s check-in', async () => {
    await assertFails(setDoc(checkinRef(authed(OTHER), WORKER, '2026-06-03'), checkin));
  });
  it('worker can read their own check-in', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', WORKER, 'morning_checkins', '2026-06-03'), checkin);
    });
    await assertSucceeds(getDoc(checkinRef(authed(WORKER), WORKER, '2026-06-03')));
  });
  it('another worker cannot read someone else\'s check-in (privacy)', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', WORKER, 'morning_checkins', '2026-06-03'), checkin);
    });
    await assertFails(getDoc(checkinRef(authed(OTHER), WORKER, '2026-06-03')));
  });
  it('the occupational-health doctor can read a worker\'s check-in', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', WORKER, 'morning_checkins', '2026-06-03'), checkin);
    });
    await assertSucceeds(getDoc(checkinRef(authed(DOCTOR, 'medico_ocupacional'), WORKER, '2026-06-03')));
  });
  it('a check-in cannot be deleted', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', WORKER, 'morning_checkins', '2026-06-03'), checkin);
    });
    await assertFails(deleteDoc(checkinRef(authed(WORKER), WORKER, '2026-06-03')));
  });
});
