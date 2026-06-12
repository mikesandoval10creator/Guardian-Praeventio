// SPDX-License-Identifier: MIT
//
// Phase 5 · §365 root-cause — emergency orchestration + ops sub-collections.
//
// The seismic-orchestration dashboard (src/pages/EmergenciaAvanzada.tsx) and the
// AI plan / EPP / training / notification writers persisted to project
// sub-collections that had NO write rule. The Master Gate grants member READ
// but NO write, so every write was default-denied in production. This suite
// pins the new member-gated rules (life-safety = FREE on every tier, ADR 0021):
//
//   projects/{pid}/emergency_chat     — append-only, member create
//   projects/{pid}/emergency_safety   — member create/update (roll-call)
//   projects/{pid}/emergency_plans    — member create, admin/supervisor mutate
//   projects/{pid}/notifications      — member create/update, admin delete
//   projects/{pid}/epp_verifications  — member create, immutable, admin delete
//   projects/{pid}/trainings          — member create/update, admin delete
//   projects/{pid}/seismic_events     — member create, path-bound, immutable
//
// A4 follow-up re-scope (2026-06): seismic_events moved from
// tenants/{tid} (unreachable in prod — `window.__GP_TENANT_ID__` never
// assigned + isMemberOfTenant claims never minted) to projects/{pid},
// mirroring the PR #847 system_events re-scope. The tenant-scoped suite
// below now PINS the deny (the old path must stay dead).
//
// F1 fail-closed harness (authenticatedContext; Admin SDK only seeds
// preconditions, never an assertion). Run via `npm run test:rules` (JDK 21).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-emerg-1';
const TID = 'tenant-emerg-1';
const MEMBER = 'member-uid-1';
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
      name: 'Emergency Project', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function coll(ctxDb: CtxDb, name: string) {
  return collection(ctxDb as unknown as Parameters<typeof collection>[0], 'projects', PID, name);
}
function ref(ctxDb: CtxDb, name: string, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, name, id);
}
// Project member (role worker; membership is by the `members` array on the project).
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
// Tenant member — single-tenant claim binds token.tenantId to the path tenant.
function tenantAuthed(uid: string, tenantId: string, role = 'worker') {
  return requireEnv()
    .authenticatedContext(uid, { ...verifiedToken(role), tenantId })
    .firestore();
}
function tenantColl(ctxDb: CtxDb, tenantId: string, name: string) {
  return collection(ctxDb as unknown as Parameters<typeof collection>[0], 'tenants', tenantId, name);
}
async function seed(name: string, id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, name, id), data);
  });
}

describe('emergency_chat — firestore.rules (§365)', () => {
  const msg = () => ({ text: 'Estado: zona despejada', sender: 'Ana', senderRole: 'Trabajador', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE a chat message', async () => {
    await assertSucceeds(addDoc(coll(authed(MEMBER), 'emergency_chat'), msg()));
  });
  it('a member can READ chat (Master Gate)', async () => {
    await seed('emergency_chat', 'm1', msg());
    await assertSucceeds(getDoc(ref(authed(MEMBER), 'emergency_chat', 'm1')));
  });
  it('a non-member CANNOT create a chat message', async () => {
    await assertFails(addDoc(coll(authed(OUTSIDER), 'emergency_chat'), msg()));
  });
  it('a non-member CANNOT read chat (cross-project isolation)', async () => {
    await seed('emergency_chat', 'm1', msg());
    await assertFails(getDoc(ref(authed(OUTSIDER), 'emergency_chat', 'm1')));
  });
  it('chat is append-only — nobody can UPDATE or DELETE', async () => {
    await seed('emergency_chat', 'm1', msg());
    await assertFails(updateDoc(ref(authed(MEMBER), 'emergency_chat', 'm1'), { text: 'edited' }));
    await assertFails(deleteDoc(ref(authed(ADMIN, 'admin'), 'emergency_chat', 'm1')));
  });
});

describe('emergency_safety — firestore.rules (§365)', () => {
  const status = (s: string) => ({ workerId: 'w1', status: s, confirmedAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE a roll-call entry', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'emergency_safety', 'w1'), status('unknown')));
  });
  it('a member can UPDATE a roll-call status (supervisor marks a worker)', async () => {
    await seed('emergency_safety', 'w1', status('unknown'));
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'emergency_safety', 'w1'), status('safe'), { merge: true }));
  });
  it('a non-member CANNOT create a roll-call entry', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'emergency_safety', 'w1'), status('safe')));
  });
  it('a roll-call entry can never be DELETED', async () => {
    await seed('emergency_safety', 'w1', status('safe'));
    await assertFails(deleteDoc(ref(authed(ADMIN, 'admin'), 'emergency_safety', 'w1')));
  });
});

describe('emergency_plans — firestore.rules (§365)', () => {
  const plan = () => ({ title: 'PE IA', content: '...', generatedBy: MEMBER, status: 'draft', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE an emergency plan', async () => {
    await assertSucceeds(addDoc(coll(authed(MEMBER), 'emergency_plans'), plan()));
  });
  it('a non-member CANNOT create an emergency plan', async () => {
    await assertFails(addDoc(coll(authed(OUTSIDER), 'emergency_plans'), plan()));
  });
  it('a plain member CANNOT update/delete a plan; an admin CAN', async () => {
    await seed('emergency_plans', 'p1', plan());
    await assertFails(updateDoc(ref(authed(MEMBER), 'emergency_plans', 'p1'), { status: 'approved' }));
    await assertSucceeds(updateDoc(ref(authed(ADMIN, 'admin'), 'emergency_plans', 'p1'), { status: 'approved' }));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), 'emergency_plans', 'p1')));
  });
});

describe('notifications — firestore.rules (§365)', () => {
  const notif = () => ({ title: 'Riesgo Huérfano', message: '...', type: 'orphan_risk', relatedId: 'r1', read: false, severity: 'high', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE a notification', async () => {
    await assertSucceeds(addDoc(coll(authed(MEMBER), 'notifications'), notif()));
  });
  it('a member can UPDATE (mark read)', async () => {
    await seed('notifications', 'n1', notif());
    await assertSucceeds(updateDoc(ref(authed(MEMBER), 'notifications', 'n1'), { read: true }));
  });
  it('a non-member CANNOT create a notification', async () => {
    await assertFails(addDoc(coll(authed(OUTSIDER), 'notifications'), notif()));
  });
  it('a plain member CANNOT delete; an admin CAN', async () => {
    await seed('notifications', 'n1', notif());
    await assertFails(deleteDoc(ref(authed(MEMBER), 'notifications', 'n1')));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), 'notifications', 'n1')));
  });
});

describe('epp_verifications — firestore.rules (§365)', () => {
  const ver = () => ({ projectId: PID, workerId: 'w1', isCompliant: true, detectedEPP: ['casco'], missingEPP: [], confidence: 0.9, createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE an EPP verification', async () => {
    await assertSucceeds(addDoc(coll(authed(MEMBER), 'epp_verifications'), ver()));
  });
  it('a non-member CANNOT create an EPP verification', async () => {
    await assertFails(addDoc(coll(authed(OUTSIDER), 'epp_verifications'), ver()));
  });
  it('an EPP verification is IMMUTABLE — even an admin cannot update', async () => {
    await seed('epp_verifications', 'v1', ver());
    await assertFails(updateDoc(ref(authed(MEMBER), 'epp_verifications', 'v1'), { isCompliant: false }));
    await assertFails(updateDoc(ref(authed(ADMIN, 'admin'), 'epp_verifications', 'v1'), { isCompliant: false }));
  });
  it('a plain member CANNOT delete; an admin CAN', async () => {
    await seed('epp_verifications', 'v1', ver());
    await assertFails(deleteDoc(ref(authed(MEMBER), 'epp_verifications', 'v1')));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), 'epp_verifications', 'v1')));
  });
});

describe('trainings — firestore.rules (§365)', () => {
  const tr = () => ({ projectId: PID, workerId: 'w1', title: 'Trabajo en altura', priority: 'high', status: 'assigned', createdAt: '2026-06-08T00:00:00.000Z' });

  it('a member can CREATE a training assignment', async () => {
    await assertSucceeds(addDoc(coll(authed(MEMBER), 'trainings'), tr()));
  });
  it('a member can UPDATE training status', async () => {
    await seed('trainings', 't1', tr());
    await assertSucceeds(updateDoc(ref(authed(MEMBER), 'trainings', 't1'), { status: 'done' }));
  });
  it('a non-member CANNOT create a training assignment', async () => {
    await assertFails(addDoc(coll(authed(OUTSIDER), 'trainings'), tr()));
  });
  it('a plain member CANNOT delete; an admin CAN', async () => {
    await seed('trainings', 't1', tr());
    await assertFails(deleteDoc(ref(authed(MEMBER), 'trainings', 't1')));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), 'trainings', 't1')));
  });
});

describe('seismic_events — firestore.rules (A4 follow-up, project-scoped)', () => {
  // Exactly the shape SismicAutoOverlay writes (EmergencyOverlay.tsx):
  // detectedAt + peakG + location (nullable) + projectId + createdAt.
  const ev = (projectId: string = PID) => ({
    detectedAt: '2026-06-11T00:00:00.000Z',
    peakG: 0.42,
    location: null,
    projectId,
    createdAt: '2026-06-11T00:00:00.000Z',
  });

  it('a project member can CREATE a seismic event bound to their project', async () => {
    await assertSucceeds(addDoc(coll(authed(MEMBER), 'seismic_events'), ev()));
  });
  it('a project member can READ seismic events', async () => {
    await seed('seismic_events', 'e1', ev());
    await assertSucceeds(getDoc(ref(authed(MEMBER), 'seismic_events', 'e1')));
  });
  it('a non-member CANNOT create a seismic event', async () => {
    await assertFails(addDoc(coll(authed(OUTSIDER), 'seismic_events'), ev()));
  });
  it('a non-member CANNOT read seismic events (cross-project isolation)', async () => {
    await seed('seismic_events', 'e1', ev());
    await assertFails(getDoc(ref(authed(OUTSIDER), 'seismic_events', 'e1')));
  });
  it('a member CANNOT forge an event whose projectId differs from the path (cross-project inject)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'seismic_events', 'spoof'), ev('other-project')),
    );
  });
  it('a member CANNOT create a schema-violating event (missing peakG / detectedAt / wrong types)', async () => {
    const { peakG: _g, ...noPeakG } = ev();
    await assertFails(setDoc(ref(authed(MEMBER), 'seismic_events', 'e2'), noPeakG));
    const { detectedAt: _d, ...noDetectedAt } = ev();
    await assertFails(setDoc(ref(authed(MEMBER), 'seismic_events', 'e3'), noDetectedAt));
    await assertFails(
      setDoc(ref(authed(MEMBER), 'seismic_events', 'e4'), { ...ev(), peakG: 'alto' }),
    );
  });
  it('a seismic event is IMMUTABLE — no update or delete (admin included)', async () => {
    await seed('seismic_events', 'e1', ev());
    await assertFails(updateDoc(ref(authed(MEMBER), 'seismic_events', 'e1'), { peakG: 9 }));
    await assertFails(deleteDoc(ref(authed(MEMBER), 'seismic_events', 'e1')));
    await assertFails(deleteDoc(ref(authed(ADMIN, 'admin'), 'seismic_events', 'e1')));
  });

  // Supersession pin: the old tenants/{tid}/seismic_events path must STAY
  // dead — its match block was removed (no writer; dormant client-writable
  // surface) and writes fall to the tenant catch-all default-deny.
  it('the superseded tenants/{tid}/seismic_events path DENIES create (even with tenant claims)', async () => {
    await assertFails(
      addDoc(tenantColl(tenantAuthed(MEMBER, TID), TID, 'seismic_events'), {
        detectedAt: '2026-06-11T00:00:00.000Z',
        peakG: 0.42,
        location: null,
        tenantId: TID,
        createdAt: '2026-06-11T00:00:00.000Z',
      }),
    );
  });
});
