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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';
import { normalizeSafetyCapsule } from '../lib/safetyCapsule';

const PID = 'proj-missing-1';
const OTHER_PID = 'proj-missing-2';
const MEMBER = 'member-uid-1';
const OWNER = 'owner-uid-1';
const OUTSIDER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';
const SUPERVISOR = 'supervisor-uid-1';

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
      name: 'P1', members: [MEMBER, ADMIN, SUPERVISOR], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: OWNER,
    });
    await setDoc(doc(db, 'projects', OTHER_PID), {
      name: 'P2', members: ['someone-else'], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: 'someone-else',
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
    await setDoc(doc(db, 'users', SUPERVISOR), {
      uid: SUPERVISOR, role: 'supervisor', email: `${SUPERVISOR}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
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
  const cap = () => ({ ...normalizeSafetyCapsule('Texto heredado.'), projectId: PID, userId: MEMBER, userName: 'Usuario', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE a capsule', async () => {
    const ref = await assertSucceeds(addDoc(c(authed(MEMBER), 'projects', PID, 'training_capsules'), cap()));
    expect((await getDoc(ref)).data()).toEqual(cap());
  });
  it('accepts the structured DTO emitted by the current client', async () => {
    const payload = { ...cap(), ...normalizeSafetyCapsule({ title: 'Título', content: 'Contenido', keyTip: 'Consejo', duration: '1 minuto' }) };
    const ref = await assertSucceeds(addDoc(c(authed(MEMBER), 'projects', PID, 'training_capsules'), payload));
    expect((await getDoc(ref)).data()).toEqual(payload);
  });
  it('a member CANNOT attribute a capsule to another uid', async () => {
    await assertFails(addDoc(c(authed(MEMBER), 'projects', PID, 'training_capsules'), { ...cap(), userId: OUTSIDER }));
  });
  it.each([
    { override: { projectId: OTHER_PID } },
    { override: { userName: 'Another worker' } },
    { override: { userName: '' } },
    { override: { schemaVersion: 2 } },
    { override: { title: '' } },
    { override: { title: 'x'.repeat(301) } },
    { override: { content: { nested: 'not text' } } },
    { override: { content: 'x'.repeat(20001) } },
    { override: { keyTip: 'x'.repeat(2001) } },
    { override: { duration: 60 } },
    { override: { duration: 'x'.repeat(101) } },
    { override: { createdAt: 123 } },
    { override: { createdAt: 'not-a-date' } },
    { override: { hidden: 'unapproved field' } },
  ])('rejects invalid actor, scope or DTO fields %#', async ({ override }) => {
    await assertFails(addDoc(c(authed(MEMBER), 'projects', PID, 'training_capsules'), { ...cap(), ...override }));
  });
  it('binds the display label to the signed name claim', async () => {
    const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker', 'member@x.cl', { name: 'Ana' })).firestore();
    await assertSucceeds(addDoc(c(db, 'projects', PID, 'training_capsules'), { ...cap(), userName: 'Ana' }));
    await assertFails(addDoc(c(db, 'projects', PID, 'training_capsules'), { ...cap(), userName: 'Beatriz' }));
  });
  it('rejects cross-project and unauthenticated create', async () => {
    await assertFails(addDoc(c(authed(MEMBER), 'projects', OTHER_PID, 'training_capsules'), { ...cap(), projectId: OTHER_PID }));
    await assertFails(addDoc(c(requireEnv().unauthenticatedContext().firestore(), 'projects', PID, 'training_capsules'), cap()));
  });
  it('requires all canonical fields on create', async () => {
    const { schemaVersion: _version, ...legacy } = cap();
    await assertFails(addDoc(c(authed(MEMBER), 'projects', PID, 'training_capsules'), legacy));
  });
  it('permits a scoped admin content revision, but keeps actor/path/time immutable', async () => {
    await seed(['projects', PID, 'training_capsules', 'immutable'], cap());
    const ref = d(authed(ADMIN, 'admin'), 'projects', PID, 'training_capsules', 'immutable');
    await assertSucceeds(updateDoc(ref, { content: 'Revised text' }));
    for (const change of [{ userId: ADMIN }, { userName: 'Forged' }, { projectId: OTHER_PID }, { createdAt: '2026-06-09T00:00:00.000Z' }]) {
      await assertFails(updateDoc(ref, change));
    }
    await assertFails(updateDoc(ref, { content: {} }));
    await assertFails(updateDoc(d(authed(MEMBER), 'projects', PID, 'training_capsules', 'immutable'), { content: 'Worker edit' }));
    expect((await getDoc(ref)).data()).toEqual({ ...cap(), content: 'Revised text' });
  });
  it('does not let an unrelated global admin update or delete a capsule', async () => {
    await seed(['projects', OTHER_PID, 'training_capsules', 'foreign'], { ...cap(), projectId: OTHER_PID });
    const ref = d(authed(ADMIN, 'admin'), 'projects', OTHER_PID, 'training_capsules', 'foreign');
    await assertFails(updateDoc(ref, { content: 'foreign edit' }));
    await assertFails(deleteDoc(ref));
  });
  it('rejects an unverified project member', async () => {
    const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker', 'member@x.cl', { email_verified: false })).firestore();
    await assertFails(addDoc(c(db, 'projects', PID, 'training_capsules'), cap()));
  });
  it('preserves scoped supervisor revision and deletion', async () => {
    await seed(['projects', PID, 'training_capsules', 'review'], cap());
    const ref = d(authed(SUPERVISOR, 'supervisor'), 'projects', PID, 'training_capsules', 'review');
    await assertSucceeds(updateDoc(ref, { title: 'Revisado' }));
    await assertSucceeds(deleteDoc(ref));
  });
  it('keeps legacy records readable and privileged cleanup available', async () => {
    const legacy = { projectId: PID, userId: MEMBER, content: { old: 'shape' } };
    await seed(['projects', PID, 'training_capsules', 'legacy'], legacy);
    expect((await getDoc(d(authed(MEMBER), 'projects', PID, 'training_capsules', 'legacy'))).data()).toEqual(legacy);
    await assertSucceeds(deleteDoc(d(authed(ADMIN, 'admin'), 'projects', PID, 'training_capsules', 'legacy')));
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
  it('a member can query only top-level events constrained to their own project', async () => {
    await seed(['calendar_events', 'e1'], { ...ev(PID), relatedObjectId: 'ext-1' });
    await seed(['calendar_events', 'e2'], { ...ev(OTHER_PID), relatedObjectId: 'ext-1' });

    const snapshot = await assertSucceeds(getDocs(query(
      c(authed(MEMBER), 'calendar_events'),
      where('projectId', '==', PID),
      where('relatedObjectId', '==', 'ext-1'),
    )));

    expect(snapshot.docs.map((event) => event.data().projectId)).toEqual([PID]);
  });
  it('a member CANNOT list top-level calendar events without a project scope', async () => {
    await seed(['calendar_events', 'e1'], { ...ev(PID), relatedObjectId: 'ext-1' });
    await assertFails(getDocs(query(
      c(authed(MEMBER), 'calendar_events'),
      where('relatedObjectId', '==', 'ext-1'),
    )));
  });
  it('a member CANNOT query events from another project by choosing its projectId', async () => {
    await seed(['calendar_events', 'e1'], { ...ev(OTHER_PID), relatedObjectId: 'ext-1' });
    await assertFails(getDocs(query(
      c(authed(MEMBER), 'calendar_events'),
      where('projectId', '==', OTHER_PID),
      where('relatedObjectId', '==', 'ext-1'),
    )));
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


describe('users/{uid}/personal_passports — owner read, server-only immutable write', () => {
  const passport = () => ({
    schemaVersion: '1.0.0', subjectUid: OWNER, sourceProjectId: PID,
    checksumSha256: 'a'.repeat(64), capabilities: ['trabajo-altura'],
  });

  it('the offboarded worker can READ their own passport', async () => {
    await seed(['users', OWNER, 'personal_passports', 'p1'], passport());
    await assertSucceeds(getDoc(d(authed(OWNER), 'users', OWNER, 'personal_passports', 'p1')));
  });
  it('a former employer/project member CANNOT read the passport', async () => {
    await seed(['users', OWNER, 'personal_passports', 'p1'], passport());
    await assertFails(getDoc(d(authed(MEMBER), 'users', OWNER, 'personal_passports', 'p1')));
  });
  it('a global admin CANNOT read the worker-owned passport', async () => {
    await seed(['users', OWNER, 'personal_passports', 'p1'], passport());
    await assertFails(getDoc(d(authed(ADMIN, 'admin'), 'users', OWNER, 'personal_passports', 'p1')));
  });
  it('the worker CANNOT forge or overwrite a passport', async () => {
    await assertFails(setDoc(d(authed(OWNER), 'users', OWNER, 'personal_passports', 'p1'), passport()));
    await seed(['users', OWNER, 'personal_passports', 'p1'], passport());
    await assertFails(setDoc(d(authed(OWNER), 'users', OWNER, 'personal_passports', 'p1'), { checksumSha256: 'forged' }, { merge: true }));
  });
  it('the worker CANNOT delete immutable passport evidence', async () => {
    await seed(['users', OWNER, 'personal_passports', 'p1'], passport());
    await assertFails(deleteDoc(d(authed(OWNER), 'users', OWNER, 'personal_passports', 'p1')));
  });
});


describe('users/{uid}/personal_passport_shares — server-only grant metadata', () => {
  const share = () => ({ tokenHash: 'a'.repeat(64), recipientUid: MEMBER, targetProjectId: PID });
  it('owner cannot read the share hash', async () => {
    await seed(['users', OWNER, 'personal_passport_shares', 's1'], share());
    await assertFails(getDoc(d(authed(OWNER), 'users', OWNER, 'personal_passport_shares', 's1')));
  });
  it('owner cannot forge, modify or delete grants', async () => {
    await assertFails(setDoc(d(authed(OWNER), 'users', OWNER, 'personal_passport_shares', 's1'), share()));
    await seed(['users', OWNER, 'personal_passport_shares', 's1'], share());
    await assertFails(setDoc(d(authed(OWNER), 'users', OWNER, 'personal_passport_shares', 's1'), { revokedAt: null }, { merge: true }));
    await assertFails(deleteDoc(d(authed(OWNER), 'users', OWNER, 'personal_passport_shares', 's1')));
  });
  it('recipient and former employer cannot read a grant', async () => {
    await seed(['users', OWNER, 'personal_passport_shares', 's1'], share());
    await assertFails(getDoc(d(authed(MEMBER), 'users', OWNER, 'personal_passport_shares', 's1')));
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
