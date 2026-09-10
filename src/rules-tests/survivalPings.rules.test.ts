// SPDX-License-Identifier: MIT
//
// B1 — Survival ping (life beacon) rules.
//
// `useSurvivalPing` writes `pings/{uid}` via the CLIENT SDK every ~60s with the
// worker's coordinates so rescue can locate them. The collection had NO rule, so
// the beacon was default-denied in production — a worker in distress would emit
// nothing. This suite pins: the worker writes ONLY their own beacon (owner-gated,
// fixed schema), and admin/supervisor (rescue coordinators) can read any beacon.
// Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const WORKER = 'worker-uid-1';
const OTHER = 'worker-uid-2';
const ADMIN = 'admin-uid-1';
const SUPER = 'supervisor-uid-1';

const PING = { lat: -33.45, lng: -70.66, timestamp: '2026-06-03T00:00:00Z', status: 'alive', tenantId: 't1', projectId: 'p1' };
const LEGACY_PING = { lat: -33.45, lng: -70.66, timestamp: '2026-06-03T00:00:00Z', status: 'alive' };

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
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
    await setDoc(doc(db, 'users', SUPER), { uid: SUPER, role: 'supervisor', email: `${SUPER}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function pingRef(ctxDb: CtxDb, uid: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'pings', uid);
}
function authed(uid: string, role = 'worker') {
  // tenantId claim is required by the post-2026-09-10 survival ping rule
  // (firestore.rules:1239). Workers and admins live in tenant 't1' for this
  // test suite; the ping's tenantId stamp matches it.
  return requireEnv().authenticatedContext(uid, verifiedToken(role, 'user@example.com', { tenantId: 't1' })).firestore();
}
async function seedPing(uid: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pings', uid), PING);
  });
}

describe('pings (survival beacon) — firestore.rules (B1)', () => {
  it('worker can emit their own beacon (post-stamp schema)', async () => {
    await assertSucceeds(setDoc(pingRef(authed(WORKER), WORKER), PING));
  });

  it('stamped ping without tenantId is REJECTED (no cross-tenant leak)', async () => {
    const { lat, lng, timestamp, status, projectId } = PING;
    await assertFails(setDoc(pingRef(authed(WORKER), WORKER), { lat, lng, timestamp, status, projectId }));
  });

  it('legacy beacon (no tenantId) still readable by self/admin/supervisor', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'pings', WORKER), LEGACY_PING);
    });
    await assertSucceeds(getDoc(pingRef(authed(WORKER), WORKER)));
    await assertSucceeds(getDoc(pingRef(authed(ADMIN, 'admin'), WORKER)));
  });

  it('cross-tenant read is REJECTED when the doc carries a tenantId', async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'pings', WORKER), PING);
    });
    const crossCtx = requireEnv().authenticatedContext(ADMIN, verifiedToken('admin', 'a@x.cl', { tenantId: 't2' }));
    await assertFails(getDoc(doc(crossCtx.firestore() as unknown as Parameters<typeof doc>[0], 'pings', WORKER)));
  });

  it('worker can update their own beacon (merge)', async () => {
    await seedPing(WORKER);
    await assertSucceeds(
      setDoc(pingRef(authed(WORKER), WORKER), { timestamp: '2026-06-03T00:01:00Z', status: 'alive', tenantId: 't1', projectId: 'p1' }, { merge: true }),
    );
  });

  it('a worker cannot write someone else\'s beacon', async () => {
    await assertFails(setDoc(pingRef(authed(OTHER), WORKER), PING));
  });

  it('an unknown field is rejected (fixed schema)', async () => {
    await assertFails(setDoc(pingRef(authed(WORKER), WORKER), { ...PING, exfiltrate: 'secret' }));
  });

  it('worker can read their own beacon', async () => {
    await seedPing(WORKER);
    await assertSucceeds(getDoc(pingRef(authed(WORKER), WORKER)));
  });

  it('a worker cannot read another worker\'s beacon', async () => {
    await seedPing(WORKER);
    await assertFails(getDoc(pingRef(authed(OTHER), WORKER)));
  });

  it('an admin (rescue coordinator) can read any beacon', async () => {
    await seedPing(WORKER);
    await assertSucceeds(getDoc(pingRef(authed(ADMIN, 'admin'), WORKER)));
  });

  it('a supervisor (rescue coordinator) can read any beacon', async () => {
    await seedPing(WORKER);
    await assertSucceeds(getDoc(pingRef(authed(SUPER, 'supervisor'), WORKER)));
  });

  it('nobody can delete a beacon (append-only trail)', async () => {
    await seedPing(WORKER);
    await assertFails(deleteDoc(pingRef(authed(WORKER), WORKER)));
  });
});
