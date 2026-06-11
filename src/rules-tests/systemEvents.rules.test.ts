// SPDX-License-Identifier: MIT
//
// A4 re-scope — projects/{pid}/system_events rules.
//
// The SystemEngine bus (ADR-0013) writes typed events CLIENT-side via
// src/services/systemEngine/eventLog.ts and subscribes via useSystemEvent.
// It previously targeted tenants/{tid}/system_events — default-denied by the
// tenants catch-all AND keyed by a tenant id (`__GP_TENANT_ID__`) no install
// ever assigned, so every cross-device emit was PERMISSION_DENIED. The bus is
// now project-scoped: member read + member create with envelope schema
// validation, path-bound projectId, emitter anti-spoof on `actorUid`, and
// full immutability (`update,delete:false` — the event log is append-only;
// audit_logs mirroring happens server-side).
//
// Uses the F1 fail-closed harness (authenticatedContext; Admin-SDK only to
// seed preconditions, never in an assertion).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-sysev-1';
const OTHER_PID = 'proj-sysev-2';
const MEMBER = 'member-uid-1';
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

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Faena Norte', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    // A second project MEMBER does NOT belong to — cross-project checks.
    await setDoc(doc(db, 'projects', OTHER_PID), {
      name: 'Faena Sur', members: ['someone-else'], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: 'someone-else',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(ctxDb: CtxDb, id: string, pid = PID) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', pid, 'system_events', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
async function seed(id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'system_events', id), data);
  });
}

// A valid SystemEvent envelope exactly as eventLog.ts writes it
// (validated event + serverTs sentinel; here a literal for simplicity).
const event = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  tenantId: 'default',
  projectId: PID,
  actorUid: MEMBER,
  ts: 1_717_000_000_000,
  idempotencyKey: 'idem-evt-1',
  type: 'tier_changed',
  payload: { userId: MEMBER, fromTier: 'free', toTier: 'pro', source: 'webhook' },
  ...over,
});

describe('projects/{pid}/system_events — firestore.rules (A4 re-scope)', () => {
  // member-create-allow
  it('a project member can CREATE a valid system event', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'evt-1'), event()));
  });

  // member-read-allow
  it('a project member can READ a system event', async () => {
    await seed('evt-1', event());
    await assertSucceeds(getDoc(ref(authed(MEMBER), 'evt-1')));
  });

  // non-member-deny (create)
  it('a non-member CANNOT create a system event', async () => {
    await assertFails(
      setDoc(ref(authed(OUTSIDER), 'evt-1'), event({ actorUid: OUTSIDER })),
    );
  });

  // non-member-deny (read — cross-project isolation)
  it('a non-member CANNOT read a system event', async () => {
    await seed('evt-1', event());
    await assertFails(getDoc(ref(authed(OUTSIDER), 'evt-1')));
  });

  // schema-violation-deny
  it('a member CANNOT create an event missing required envelope fields', async () => {
    const { payload: _p, ...noPayload } = event();
    await assertFails(setDoc(ref(authed(MEMBER), 'evt-1'), noPayload));
    const { idempotencyKey: _k, ...noIdem } = event();
    await assertFails(setDoc(ref(authed(MEMBER), 'evt-2'), noIdem));
  });

  // server-field-spoof-deny (emitter identity)
  it('a member CANNOT spoof actorUid (emit as someone else)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'evt-1'), event({ actorUid: 'victim-uid' })),
    );
  });

  // path-bound projectId — no cross-project inject
  it("a member CANNOT write an event whose projectId differs from the path (cross-project inject)", async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'evt-1'), event({ projectId: OTHER_PID })),
    );
    // …and cannot write into a project they are not a member of, even with
    // a matching projectId field.
    await assertFails(
      setDoc(ref(authed(MEMBER), 'evt-1', OTHER_PID), event({ projectId: OTHER_PID })),
    );
  });

  // doc-id-binding — eventId must equal the envelope id (idempotent setDoc)
  it('a member CANNOT write an event whose doc id differs from the envelope id', async () => {
    await assertFails(setDoc(ref(authed(MEMBER), 'evt-OTHER'), event()));
  });

  // post-write update-deny — the event log is immutable
  it('NOBODY can UPDATE a persisted event (immutability)', async () => {
    await seed('evt-1', event());
    await assertFails(updateDoc(ref(authed(MEMBER), 'evt-1'), { ts: 1 }));
    await assertFails(
      setDoc(ref(authed(MEMBER), 'evt-1'), event({ ts: 1 }), { merge: true }),
    );
  });

  // delete-deny — even privileged roles cannot erase bus history
  it('NOBODY can DELETE a persisted event (append-only, admin included)', async () => {
    await seed('evt-1', event());
    await assertFails(deleteDoc(ref(authed(MEMBER), 'evt-1')));
    await assertFails(deleteDoc(ref(authed('admin-uid-1', 'admin'), 'evt-1')));
  });
});
