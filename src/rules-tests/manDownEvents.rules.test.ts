// SPDX-License-Identifier: MIT
//
// ManDown life-safety authorization contract.
//
// A member must not be able to hide a worker's active ManDown alert by writing
// acknowledgedBy/resolvedBy directly. The worker may acknowledge their own
// active alert (the local "Estoy bien" fallback), while a supervisor/admin role
// bound to the project's tenant may acknowledge or resolve it. Every actor
// field must equal the authenticated uid and lifecycle transitions are
// monotonic.
//
// This suite uses the real Firestore emulator and the client SDK for every
// assertion. Admin SDK is used only to seed preconditions through the shared
// harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, Timestamp, updateDoc, setDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PROJECT_A = 'proj-mandown-a';
const PROJECT_B = 'proj-mandown-b';
const TENANT_A = 'tenant-mandown-a';
const TENANT_B = 'tenant-mandown-b';
const EVENT_ID = 'event-active-a';
const EVENT_ACK_ID = 'event-ack-a';
const WORKER_A = 'worker-mandown-a';
const MEMBER_A = 'member-mandown-a';
const SUPERVISOR_A = 'supervisor-mandown-a';
const SUPERVISOR_B = 'supervisor-mandown-b';
const EVENT_TIME = Timestamp.fromDate(new Date('2026-09-15T12:00:00Z'));

let testEnv: RulesTestEnvironment | null = null;

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

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

function authed(uid: string, role = 'worker', tenantId?: string): CtxDb {
  return requireEnv()
    .authenticatedContext(
      uid,
      verifiedToken(role, `${uid}@example.com`, tenantId ? { tenantId } : {}),
    )
    .firestore();
}

function eventRef(db: CtxDb, projectId = PROJECT_A, eventId = EVENT_ID) {
  return doc(
    db as unknown as Parameters<typeof doc>[0],
    'projects',
    projectId,
    'mandown_events',
    eventId,
  );
}

const activeEvent = {
  projectId: PROJECT_A,
  workerId: WORKER_A,
  workerName: 'Worker A',
  status: 'active',
  triggeredAt: EVENT_TIME,
  location: '-33.45, -70.66',
  acknowledgedBy: null,
  acknowledgedByName: null,
  acknowledgedAt: null,
};

async function seedState() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PROJECT_A), {
      name: 'ManDown Project A',
      members: [WORKER_A, MEMBER_A, SUPERVISOR_A],
      status: 'active',
      createdAt: EVENT_TIME,
      createdBy: WORKER_A,
      tenantId: TENANT_A,
    });
    await setDoc(doc(db, 'projects', PROJECT_B), {
      name: 'ManDown Project B',
      members: [SUPERVISOR_B],
      status: 'active',
      createdAt: EVENT_TIME,
      createdBy: SUPERVISOR_B,
      tenantId: TENANT_B,
    });
    await setDoc(doc(db, 'projects', PROJECT_A, 'mandown_events', EVENT_ID), activeEvent);
    await setDoc(doc(db, 'projects', PROJECT_A, 'mandown_events', EVENT_ACK_ID), {
      ...activeEvent,
      status: 'acknowledged',
      acknowledgedBy: WORKER_A,
      acknowledgedByName: 'Worker A',
      acknowledgedAt: EVENT_TIME,
    });
  });
}

describe('mandown_events — actor binding and monotonic lifecycle', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedState();
  });

  it('denies a regular project member from acknowledging another worker\'s event', async () => {
    await assertFails(
      updateDoc(eventRef(authed(MEMBER_A)), {
        status: 'acknowledged',
        acknowledgedBy: MEMBER_A,
        acknowledgedByName: 'Member A',
        acknowledgedAt: Timestamp.now(),
      }),
    );
  });

  it('denies a regular project member from resolving a ManDown event', async () => {
    await assertFails(
      updateDoc(eventRef(authed(MEMBER_A)), {
        status: 'resolved',
        resolvedBy: MEMBER_A,
        resolvedAt: Timestamp.now(),
      }),
    );
  });

  it('denies a worker from spoofing the acknowledgement actor', async () => {
    await assertFails(
      updateDoc(eventRef(authed(WORKER_A)), {
        status: 'acknowledged',
        acknowledgedBy: MEMBER_A,
        acknowledgedAt: Timestamp.now(),
      }),
    );
  });

  it('allows the affected worker to acknowledge their own active event', async () => {
    await assertSucceeds(
      updateDoc(eventRef(authed(WORKER_A)), {
        status: 'acknowledged',
        acknowledgedBy: WORKER_A,
        acknowledgedByName: 'Worker A',
        acknowledgedAt: Timestamp.now(),
      }),
    );
  });

  it('allows a supervisor bound to the project tenant to acknowledge the event', async () => {
    await assertSucceeds(
      updateDoc(eventRef(authed(SUPERVISOR_A, 'supervisor', TENANT_A)), {
        status: 'acknowledged',
        acknowledgedBy: SUPERVISOR_A,
        acknowledgedByName: 'Supervisor A',
        acknowledgedAt: Timestamp.now(),
      }),
    );
  });

  it('allows a tenant supervisor to resolve an already acknowledged event', async () => {
    await assertSucceeds(
      updateDoc(eventRef(authed(SUPERVISOR_A, 'supervisor', TENANT_A), PROJECT_A, EVENT_ACK_ID), {
        status: 'resolved',
        resolvedBy: SUPERVISOR_A,
        resolvedAt: Timestamp.now(),
      }),
    );
  });

  it('denies a tenant-B supervisor from updating a project-A event', async () => {
    await assertFails(
      updateDoc(eventRef(authed(SUPERVISOR_B, 'supervisor', TENANT_B)), {
        status: 'acknowledged',
        acknowledgedBy: SUPERVISOR_B,
        acknowledgedAt: Timestamp.now(),
      }),
    );
  });

  it('denies reopening an acknowledged event through a client update', async () => {
    await assertFails(
      updateDoc(eventRef(authed(WORKER_A), PROJECT_A, EVENT_ACK_ID), {
        status: 'active',
      }),
    );
  });

  it('denies a worker from resolving their own event without supervisor authority', async () => {
    await assertFails(
      updateDoc(eventRef(authed(WORKER_A), PROJECT_A, EVENT_ACK_ID), {
        status: 'resolved',
        resolvedBy: WORKER_A,
        resolvedAt: Timestamp.now(),
      }),
    );
  });
});
