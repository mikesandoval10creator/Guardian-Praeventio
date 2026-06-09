// SPDX-License-Identifier: MIT
//
// Phase 5 · 🔵 missing Firestore rules — default-denied collections that the UI
// reads/writes but no rule covered (so every access silently failed in prod):
//
//   slo_metrics/{id}/daily            — SLO error-budget (admin/supervisor read, server write)
//   projects/{pid}/training_capsules  — AI safety capsule (member create)
//   projects/{pid}/calendar_events    — auto inspection reminders (member create/update)
//   calendar_events (top-level)       — digital-twin lifecycle events (projectId-gated)
//   users/{uid}/focus_blocks          — private deep-work blocks (owner only)
//   users/{uid}/awards                — portable-curriculum badges (owner read, server write)
//
// F1 fail-closed harness (authenticatedContext; Admin SDK only seeds
// preconditions). Run via `npm run test:rules` (JDK 21).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, addDoc, deleteDoc, collection } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-missing-1';
const OTHER_PID = 'proj-missing-2';
const MEMBER = 'member-uid-1';
const OWNER = 'owner-uid-1';
const OUTSIDER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';

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
      name: 'P1', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'projects', OTHER_PID), {
      name: 'P2', members: ['someone-else'], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: 'someone-else',
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function d(ctxDb: CtxDb, ...segs: string[]) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], ...(segs as [string, ...string[]]));
}
function c(ctxDb: CtxDb, ...segs: string[]) {
  return collection(ctxDb as unknown as Parameters<typeof collection>[0], ...(segs as [string, ...string[]]));
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
async function seed(path: string[], data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...(path as [string, ...string[]])), data);
  });
}

describe('slo_metrics — admin/supervisor read, server-only write', () => {
  const sample = () => ({ value: 0.5, date: '2026-06-08' });

  it('an admin can READ a daily SLO sample', async () => {
    await seed(['slo_metrics', 'slo-1', 'daily', 'd1'], sample());
    await assertSucceeds(getDoc(d(authed(ADMIN, 'admin'), 'slo_metrics', 'slo-1', 'daily', 'd1')));
  });
  it('a plain worker CANNOT read SLO samples', async () => {
    await seed(['slo_metrics', 'slo-1', 'daily', 'd1'], sample());
    await assertFails(getDoc(d(authed(MEMBER), 'slo_metrics', 'slo-1', 'daily', 'd1')));
  });
  it('nobody can client-WRITE an SLO sample (server-only)', async () => {
    await assertFails(setDoc(d(authed(ADMIN, 'admin'), 'slo_metrics', 'slo-1', 'daily', 'd1'), sample()));
  });
  it('nobody can client-write the parent slo_metrics doc', async () => {
    await assertFails(setDoc(d(authed(ADMIN, 'admin'), 'slo_metrics', 'slo-1'), { name: 'x' }));
  });
  it('an admin can read the parent slo_metrics doc', async () => {
    await seed(['slo_metrics', 'slo-1'], { name: 'error_rate' });
    await assertSucceeds(getDoc(d(authed(ADMIN, 'admin'), 'slo_metrics', 'slo-1')));
  });
});

describe('projects/{pid}/training_capsules — member create', () => {
  const cap = () => ({ projectId: PID, userId: MEMBER, content: '...', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE a capsule', async () => {
    await assertSucceeds(addDoc(c(authed(MEMBER), 'projects', PID, 'training_capsules'), cap()));
  });
  it('a member can READ a capsule (Master Gate)', async () => {
    await seed(['projects', PID, 'training_capsules', 't1'], cap());
    await assertSucceeds(getDoc(d(authed(MEMBER), 'projects', PID, 'training_capsules', 't1')));
  });
  it('a non-member CANNOT create a capsule', async () => {
    await assertFails(addDoc(c(authed(OUTSIDER), 'projects', PID, 'training_capsules'), cap()));
  });
  it('a non-member CANNOT read a capsule', async () => {
    await seed(['projects', PID, 'training_capsules', 't1'], cap());
    await assertFails(getDoc(d(authed(OUTSIDER), 'projects', PID, 'training_capsules', 't1')));
  });
  it('a plain member CANNOT delete; an admin CAN', async () => {
    await seed(['projects', PID, 'training_capsules', 't1'], cap());
    await assertFails(deleteDoc(d(authed(MEMBER), 'projects', PID, 'training_capsules', 't1')));
    await assertSucceeds(deleteDoc(d(authed(ADMIN, 'admin'), 'projects', PID, 'training_capsules', 't1')));
  });
});

describe('projects/{pid}/calendar_events — member create/update', () => {
  const ev = () => ({ type: 'Inspección', autoGenerated: true, createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE an auto calendar event', async () => {
    await assertSucceeds(addDoc(c(authed(MEMBER), 'projects', PID, 'calendar_events'), ev()));
  });
  it('a non-member CANNOT create one', async () => {
    await assertFails(addDoc(c(authed(OUTSIDER), 'projects', PID, 'calendar_events'), ev()));
  });
  it('a member can READ project calendar events', async () => {
    await seed(['projects', PID, 'calendar_events', 'e1'], ev());
    await assertSucceeds(getDoc(d(authed(MEMBER), 'projects', PID, 'calendar_events', 'e1')));
  });
  it('a non-member CANNOT read project calendar events', async () => {
    await seed(['projects', PID, 'calendar_events', 'e1'], ev());
    await assertFails(getDoc(d(authed(OUTSIDER), 'projects', PID, 'calendar_events', 'e1')));
  });
  it('a plain member CANNOT delete; an admin CAN', async () => {
    await seed(['projects', PID, 'calendar_events', 'e1'], ev());
    await assertFails(deleteDoc(d(authed(MEMBER), 'projects', PID, 'calendar_events', 'e1')));
    await assertSucceeds(deleteDoc(d(authed(ADMIN, 'admin'), 'projects', PID, 'calendar_events', 'e1')));
  });
});

describe('calendar_events (top-level) — projectId-gated', () => {
  const ev = (projectId: string) => ({ projectId, title: 'Mantención', syncStatus: 'pending', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE an event bound to their project', async () => {
    await assertSucceeds(addDoc(c(authed(MEMBER), 'calendar_events'), ev(PID)));
  });
  it('a member CANNOT create an event for a project they are not in', async () => {
    await assertFails(addDoc(c(authed(MEMBER), 'calendar_events'), ev(OTHER_PID)));
  });
  it('a member can READ an event of their project', async () => {
    await seed(['calendar_events', 'e1'], ev(PID));
    await assertSucceeds(getDoc(d(authed(MEMBER), 'calendar_events', 'e1')));
  });
  it('a non-member CANNOT read an event of another project', async () => {
    await seed(['calendar_events', 'e1'], ev(PID));
    await assertFails(getDoc(d(authed(OUTSIDER), 'calendar_events', 'e1')));
  });
  it('client UPDATE/DELETE are denied (syncStatus is server-owned)', async () => {
    await seed(['calendar_events', 'e1'], ev(PID));
    await assertFails(setDoc(d(authed(MEMBER), 'calendar_events', 'e1'), { syncStatus: 'synced' }, { merge: true }));
    await assertFails(deleteDoc(d(authed(MEMBER), 'calendar_events', 'e1')));
  });
});

describe('users/{uid}/focus_blocks — owner only', () => {
  const block = () => ({ kind: 'deep-work', note: 'n', startsAt: '2026-06-08T08:00:00.000Z', endsAt: '2026-06-08T10:00:00.000Z', createdAt: '2026-06-08T00:00:00.000Z' });

  it('the owner can CREATE a focus block', async () => {
    await assertSucceeds(setDoc(d(authed(OWNER), 'users', OWNER, 'focus_blocks', 'b1'), block()));
  });
  it('the owner can READ their focus blocks', async () => {
    await seed(['users', OWNER, 'focus_blocks', 'b1'], block());
    await assertSucceeds(getDoc(d(authed(OWNER), 'users', OWNER, 'focus_blocks', 'b1')));
  });
  it('another user CANNOT read the owner\'s focus blocks', async () => {
    await seed(['users', OWNER, 'focus_blocks', 'b1'], block());
    await assertFails(getDoc(d(authed(OUTSIDER), 'users', OWNER, 'focus_blocks', 'b1')));
  });
  it('another user CANNOT write into the owner\'s focus blocks', async () => {
    await assertFails(setDoc(d(authed(OUTSIDER), 'users', OWNER, 'focus_blocks', 'b1'), block()));
  });
  it('the owner can DELETE their own block', async () => {
    await seed(['users', OWNER, 'focus_blocks', 'b1'], block());
    await assertSucceeds(deleteDoc(d(authed(OWNER), 'users', OWNER, 'focus_blocks', 'b1')));
  });
});

describe('users/{uid}/awards — owner read, server-only write', () => {
  const award = () => ({ name: 'Salvaste una vida', awardedAt: '2026-06-08T00:00:00.000Z' });

  it('the owner can READ their awards', async () => {
    await seed(['users', OWNER, 'awards', 'a1'], award());
    await assertSucceeds(getDoc(d(authed(OWNER), 'users', OWNER, 'awards', 'a1')));
  });
  it('another user CANNOT read the owner\'s awards', async () => {
    await seed(['users', OWNER, 'awards', 'a1'], award());
    await assertFails(getDoc(d(authed(OUTSIDER), 'users', OWNER, 'awards', 'a1')));
  });
  it('the owner CANNOT self-award (client write denied)', async () => {
    await assertFails(setDoc(d(authed(OWNER), 'users', OWNER, 'awards', 'a1'), award()));
  });
  it('a stranger CANNOT write an award into the owner\'s collection', async () => {
    await assertFails(setDoc(d(authed(OUTSIDER), 'users', OWNER, 'awards', 'a1'), award()));
  });
  it('the owner CANNOT delete an award (immutable from the client)', async () => {
    await seed(['users', OWNER, 'awards', 'a1'], award());
    await assertFails(deleteDoc(d(authed(OWNER), 'users', OWNER, 'awards', 'a1')));
  });
});
