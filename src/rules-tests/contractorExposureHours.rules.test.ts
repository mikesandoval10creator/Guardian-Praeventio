// SPDX-License-Identifier: MIT
//
// Contractor man-hours — close the default-deny gap on
// `contractor_exposure_hours`.
//
// Path: contractor_exposure_hours/{projectId_contractorId_YYYY-MM} — the
// captured man-hours worked by ONE contractor in a period, the standard
// exposure input for that contractor's TRIR/LTIFR. WRITTEN ONLY by the Admin
// SDK from POST /api/sprint-k/:projectId/contractors/exposure, which
// role-gates (admin/gerente/prevencionista-tier) and stamps
// `recordedBy`/`recordedAt` from the verified token. READ is open to any
// member of the doc's project (the contractor-performance dashboard renders
// it).
//
// A client write is a spoof/integrity vector: forge `recordedBy`, or inflate
// `totalHoursWorked` to dilute the contractor's incident rate (fewer apparent
// incidents per hour). This suite pins member-read-allow + total client write
// denial. (CLAUDE.md #4 — ≥5 rules-tests; Dirty Dozen in security_spec.md.)
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

const PID = 'proj-cexp-1';
const CID = 'contractor-7';
const MEMBER = 'member-cexp-1';
const OUTSIDER = 'outsider-cexp-9';
const DOC_ID = `${PID}_${CID}_2026-05`;

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
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'contractor_exposure_hours', id);
}

const exposureDoc = {
  projectId: PID,
  contractorId: CID,
  contractorName: 'Constructora Andes SpA',
  period: '2026-05',
  totalHoursWorked: 120000,
  recordedBy: MEMBER,
  recordedAt: '2026-05-31T00:00:00.000Z',
};

async function seedProjectAndDoc() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Contractor Exposure Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-05-01T00:00:00.000Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'contractor_exposure_hours', DOC_ID), exposureDoc);
  });
}

describe('contractor_exposure_hours — firestore.rules (server-write, member-read)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedProjectAndDoc();
  });

  it('owner-allow — a project member CAN read the contractor exposure doc', async () => {
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
      setDoc(ref(authed(MEMBER), `${PID}_${CID}_2026-06`), {
        ...exposureDoc,
        period: '2026-06',
        recordedBy: MEMBER,
      }),
    );
  });

  it('schema-violation-deny — even a malformed client create is denied (server-only)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), `${PID}_${CID}_2026-07`), {
        projectId: PID,
        contractorId: CID,
        period: 'not-a-period',
        totalHoursWorked: -50,
      }),
    );
  });

  it('role-deny — a supervisor-tier client STILL cannot write directly (Admin-SDK only)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER, 'prevencionista'), `${PID}_${CID}_2026-08`), {
        ...exposureDoc,
        period: '2026-08',
      }),
    );
  });

  it('integrity-deny — a member CANNOT inflate totalHoursWorked via update', async () => {
    await assertFails(updateDoc(ref(authed(MEMBER)), { totalHoursWorked: 999999999 }));
  });

  it('immutable-from-client — a member CANNOT delete the contractor exposure record', async () => {
    await assertFails(deleteDoc(ref(authed(MEMBER))));
  });
});
