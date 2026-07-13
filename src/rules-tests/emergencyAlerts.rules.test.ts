// SPDX-License-Identifier: MIT
//
// B.3 (VIDA) — tenants/{tid}/emergency_alerts rules.
//
// The SOS server route (src/server/routes/emergency.ts) writes worker SOS
// alerts via Admin SDK to tenants/{tenantId}/emergency_alerts with
// tenantId = projects/{pid}.tenantId || pid. The dashboard subscribes with
// where('projectId','==',pid). This suite pins the read model: members of
// the REFERENCED project read alerts (life-safety visibility, ADR 0021 —
// tenant claims NOT required: isMemberOfTenant claims are unminted until
// M-1); outsiders and cross-project members are denied; the collection is
// server-only (client create/update/delete denied); an unfiltered
// tenant-wide list is unprovable and denied. F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc,
  updateDoc, where,
} from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const TENANT = 'tenant-ea-1';
const PID = 'proj-ea-1';
const PID_B = 'proj-ea-2';
const MEMBER = 'member-uid-1';
const MEMBER_B = 'member-uid-b';
const OUTSIDER = 'outsider-uid-9';

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

const alertPath = (id: string) => `tenants/${TENANT}/emergency_alerts/${id}`;

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'EA', members: [MEMBER], status: 'active',
      createdAt: '2026-07-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'projects', PID_B), {
      name: 'EA-B', members: [MEMBER_B], status: 'active',
      createdAt: '2026-07-01T00:00:00Z', createdBy: MEMBER_B,
    });
    // Server-written SOS alerts (Admin SDK in prod).
    await setDoc(doc(db, alertPath('a1')), {
      type: 'sos', uid: 'worker-1', userEmail: 'w1@x.cl', projectId: PID,
      geo: { lat: -33.45, lng: -70.66 }, clientTimestamp: null,
      createdAt: '2026-07-01T10:00:00Z',
    });
    await setDoc(doc(db, alertPath('a2')), {
      type: 'sos', uid: 'worker-2', userEmail: 'w2@x.cl', projectId: PID_B,
      geo: null, clientTimestamp: null, createdAt: '2026-07-01T11:00:00Z',
    });
    // Schema violation: no projectId → unreadable by anyone.
    await setDoc(doc(db, alertPath('a3')), { type: 'sos', uid: 'worker-3' });
  });
});

function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('tenants/{tid}/emergency_alerts — firestore.rules (B.3 VIDA)', () => {
  it('project member reads an SOS alert of their project (get)', async () => {
    await assertSucceeds(getDoc(doc(authed(MEMBER), alertPath('a1'))));
  });

  it('project member lists alerts filtered by their projectId', async () => {
    const db = authed(MEMBER);
    await assertSucceeds(
      getDocs(
        query(
          collection(db, `tenants/${TENANT}/emergency_alerts`),
          where('projectId', '==', PID),
          limit(50),
        ),
      ),
    );
  });

  it('non-member cannot read (non-member-deny)', async () => {
    await assertFails(getDoc(doc(authed(OUTSIDER), alertPath('a1'))));
  });

  it('member of ANOTHER project cannot read a foreign alert (cross-project-deny)', async () => {
    await assertFails(getDoc(doc(authed(MEMBER_B), alertPath('a1'))));
  });

  it('unfiltered tenant-wide list is denied (unprovable)', async () => {
    await assertFails(
      getDocs(collection(authed(MEMBER), `tenants/${TENANT}/emergency_alerts`)),
    );
  });

  it('alert without projectId is unreadable (schema-violation-deny)', async () => {
    await assertFails(getDoc(doc(authed(MEMBER), alertPath('a3'))));
  });

  it('client cannot create an SOS alert (server-only), even a project member', async () => {
    await assertFails(
      setDoc(doc(authed(MEMBER), alertPath('a-new')), {
        type: 'sos', uid: MEMBER, projectId: PID,
        createdAt: '2026-07-01T12:00:00Z',
      }),
    );
  });

  it('client cannot tamper or erase an alert (update/delete-deny)', async () => {
    await assertFails(updateDoc(doc(authed(MEMBER), alertPath('a1')), { geo: null }));
    await assertFails(deleteDoc(doc(authed(MEMBER), alertPath('a1'))));
  });
});
