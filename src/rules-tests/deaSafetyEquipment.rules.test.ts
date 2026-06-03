// SPDX-License-Identifier: MIT
//
// B1 — DEA (defibrillator) safety equipment rules (Ley 21.156).
//
// `projects/{pid}/deas/{id}` and the nested `.../inspections/{id}` are written
// by the CLIENT SDK (DEAZones.tsx) but had NO write rule, so every register /
// inspection was default-denied (masked locally by the open test rules). These
// are life-saving equipment records — losing them silently is unacceptable.
//
// This suite pins the conservative write model: any project member can register
// /update a DEA (anti-spoof on createdBy), an inspection is an IMMUTABLE
// compliance record (anti-spoof on performedByUid), and deleting a DEA is
// restricted to admin/supervisor. Reads are covered by the project
// sub-collection master-gate (isProjectMember). Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-dea-1';
const MEMBER = 'member-uid-1';
const OTHER = 'member-uid-2';
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
      name: 'DEA Test Project',
      members: [MEMBER, OTHER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN,
      email: `${ADMIN}@example.com`,
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function deaRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'deas', id);
}
function inspRef(ctxDb: CtxDb, deaId: string, id: string) {
  return doc(
    ctxDb as unknown as Parameters<typeof doc>[0],
    'projects', PID, 'deas', deaId, 'inspections', id,
  );
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
async function seedDea(id: string, createdBy = MEMBER) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'deas', id), {
      location: 'Bodega A', batteryExpiry: '2027-01-01', padsExpiry: '2027-01-01',
      lastCheck: '2026-06-01', assignedToUid: createdBy, createdBy,
      createdAt: '2026-06-01T00:00:00Z',
    });
  });
}

const deaDoc = (createdBy: string) => ({
  location: 'Bodega A', description: 'DEA principal',
  batteryExpiry: '2027-01-01', padsExpiry: '2027-01-01', lastCheck: '2026-06-01',
  assignedToUid: createdBy, assignedToName: 'Responsable', createdBy,
  createdAt: '2026-06-01T00:00:00Z',
});

describe('deas (DEA equipment register) — firestore.rules (B1)', () => {
  it('member registers a DEA with createdBy == caller', async () => {
    await assertSucceeds(setDoc(deaRef(authed(MEMBER), 'd1'), deaDoc(MEMBER)));
  });
  it('non-member cannot register a DEA', async () => {
    await assertFails(setDoc(deaRef(authed(OUTSIDER), 'd2'), deaDoc(OUTSIDER)));
  });
  it('member cannot spoof createdBy on create (server-field-spoof-deny)', async () => {
    await assertFails(setDoc(deaRef(authed(MEMBER), 'd3'), deaDoc(OTHER)));
  });
  it('member can update their DEA (lastCheck/criticalOverride) keeping createdBy', async () => {
    await seedDea('d4', MEMBER);
    await assertSucceeds(
      setDoc(deaRef(authed(MEMBER), 'd4'), { lastCheck: '2026-06-03', criticalOverride: true }, { merge: true }),
    );
  });
  it('cannot change createdBy on update', async () => {
    await seedDea('d5', MEMBER);
    await assertFails(
      setDoc(deaRef(authed(MEMBER), 'd5'), { createdBy: OTHER }, { merge: true }),
    );
  });
  it('member cannot delete a DEA; admin can', async () => {
    await seedDea('d6', MEMBER);
    await assertFails(deleteDoc(deaRef(authed(MEMBER), 'd6')));
    await assertSucceeds(deleteDoc(deaRef(authed(ADMIN, 'admin'), 'd6')));
  });
});

describe('deas/{id}/inspections — immutable compliance record (B1)', () => {
  it('member records an inspection with performedByUid == caller', async () => {
    await seedDea('dea1');
    await assertSucceeds(
      setDoc(inspRef(authed(MEMBER), 'dea1', 'i1'), {
        deaId: 'dea1', performedAt: '2026-06-03', performedByUid: MEMBER,
        performedByName: 'Inspector', checklist: { battery: true },
      }),
    );
  });
  it('member cannot spoof performedByUid', async () => {
    await seedDea('dea2');
    await assertFails(
      setDoc(inspRef(authed(MEMBER), 'dea2', 'i2'), {
        deaId: 'dea2', performedAt: '2026-06-03', performedByUid: OTHER, checklist: {},
      }),
    );
  });
  it('non-member cannot record an inspection', async () => {
    await seedDea('dea3');
    await assertFails(
      setDoc(inspRef(authed(OUTSIDER), 'dea3', 'i3'), {
        deaId: 'dea3', performedAt: '2026-06-03', performedByUid: OUTSIDER, checklist: {},
      }),
    );
  });
  it('an inspection is immutable — update is denied', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', PID, 'deas', 'dea4', 'inspections', 'i4'), {
        deaId: 'dea4', performedAt: '2026-06-03', performedByUid: MEMBER, checklist: { battery: true },
      });
    });
    await assertFails(
      setDoc(inspRef(authed(MEMBER), 'dea4', 'i4'), { checklist: { battery: false } }, { merge: true }),
    );
  });
  it('an inspection cannot be deleted', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', PID, 'deas', 'dea5', 'inspections', 'i5'), {
        deaId: 'dea5', performedAt: '2026-06-03', performedByUid: MEMBER, checklist: {},
      });
    });
    await assertFails(deleteDoc(inspRef(authed(MEMBER), 'dea5', 'i5')));
  });
});
