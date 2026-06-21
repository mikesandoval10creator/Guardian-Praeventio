// SPDX-License-Identifier: MIT
//
// Operational-pressure capture — close the default-deny gap on
// `workforce_periods`.
//
// Path: workforce_periods/{projectId_YYYY-MM} — the captured absenteeism days,
// overtime hours and headcount for a project+period, the inputs the
// `computeOperationalPressure` engine derives the workforce-pressure signals
// from (absenteeismRate, overtimeHoursWeekTotal, totalActiveWorkers). WRITTEN
// ONLY by the Admin SDK from POST /api/sprint-k/:projectId/workforce-period,
// which role-gates (admin/gerente/prevencionista-tier) and stamps
// `recordedBy`/`recordedAt` from the verified token. READ is open to any member
// of the doc's project (the OperationalPressureGauge renders it).
//
// A client write is a spoof/integrity vector: forge `recordedBy`, or downplay
// `absenteeismDays`/`overtimeHours` to mask operational strain (hide a
// workforce-pressure signal from the mandante/CPHS). This suite pins
// member-read-allow + total client write denial.
// (CLAUDE.md #4 — ≥5 rules-tests; Dirty Dozen in security_spec.md.)
//
// F1 fail-closed harness + authenticatedContext (NEVER the Admin SDK in an
// assertion). withSecurityRulesDisabled only seeds preconditions.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-wf-1';
const MEMBER = 'member-wf-1';
const OUTSIDER = 'outsider-wf-9';
const DOC_ID = `${PID}_2026-05`;

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

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

// `worker` role so member access is granted PURELY via projects.members[] —
// not via the role-based isSupervisor() shortcut.
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role, `${uid}@x.cl`)).firestore();
}

function ref(ctxDb: CtxDb, id = DOC_ID) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'workforce_periods', id);
}

const workforceDoc = {
  projectId: PID,
  period: '2026-05',
  absenteeismDays: 24,
  overtimeHours: 320,
  headcount: 50,
  recordedBy: MEMBER,
  recordedAt: '2026-05-31T00:00:00.000Z',
};

async function seedProjectAndDoc() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Workforce Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-05-01T00:00:00.000Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'workforce_periods', DOC_ID), workforceDoc);
  });
}

describe('workforce_periods — firestore.rules (server-write, member-read)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedProjectAndDoc();
  });

  it('owner-allow — a project member CAN read the workforce-period doc', async () => {
    await assertSucceeds(getDoc(ref(authed(MEMBER))));
  });

  it('non-member-deny — an authenticated outsider CANNOT read', async () => {
    await assertFails(getDoc(ref(authed(OUTSIDER))));
  });

  it('unauthenticated-deny — an anonymous client CANNOT read', async () => {
    const anon = requireEnv().unauthenticatedContext().firestore() as unknown as CtxDb;
    await assertFails(getDoc(ref(anon)));
  });

  it('server-field-spoof-deny — a member CANNOT forge recordedBy on create', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), `${PID}_2026-06`), {
        ...workforceDoc,
        period: '2026-06',
        recordedBy: MEMBER,
      }),
    );
  });

  it('schema-violation-deny — even a malformed client create is denied (server-only)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), `${PID}_2026-07`), {
        projectId: PID,
        period: 'not-a-period',
        absenteeismDays: -5,
        overtimeHours: -10,
        headcount: 0,
      }),
    );
  });

  it('role-deny — a prevencionista-tier client STILL cannot write directly (Admin-SDK only)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER, 'prevencionista'), `${PID}_2026-08`), {
        ...workforceDoc,
        period: '2026-08',
      }),
    );
  });

  it('integrity-deny — a member CANNOT downplay absenteeismDays via update', async () => {
    await assertFails(updateDoc(ref(authed(MEMBER)), { absenteeismDays: 0 }));
  });

  it('immutable-from-client — a member CANNOT delete the workforce-period record', async () => {
    await assertFails(deleteDoc(ref(authed(MEMBER))));
  });
});
