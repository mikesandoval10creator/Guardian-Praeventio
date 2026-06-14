// SPDX-License-Identifier: MIT
//
// OLA 1 (VIDA, 2026-06-14) — live evacuation headcount `evacuations` rules.
//
// Path: tenants/{tid}/projects/{pid}/evacuations/{drillId} (+ /scans/{workerUid})
// — a per-project subcollection that previously had NO rule and fell to the
// global default-deny, so the live evacuation headcount (who is safe vs missing
// in a REAL evacuation) was invisible in prod. Drills are written ONLY by the
// audited server route (evacuationHeadcount.ts: start/scan/end via Admin SDK,
// server-stamping startedByUid/scannedByUid); clients never write. Read by every
// tenant member (supervisors AND workers see the headcount live). This suite pins:
//   • member-read-allow (drill + scan) + cross-tenant read-deny
//   • client create/update/delete-deny (server-only) for drill + scan
//
// F1 fail-closed harness + authenticatedContext (NEVER the Admin SDK in an
// assertion). withSecurityRulesDisabled only seeds the server-written drill.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';

const TENANT = 'tenant-evac-1';
const OTHER_TENANT = 'tenant-evac-2';
const PID = 'proj-evac-1';
const DRILL = 'drill-2026-06-14';
const WORKER = 'worker-uid-7';

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

function tenantToken(tenantId: string, role = 'worker') {
  return { email: `${tenantId}-${role}@example.com`, email_verified: true, role, tenantId };
}
function authed(tenantId: string, role = 'worker') {
  return requireEnv().authenticatedContext(`${tenantId}-${role}-uid`, tenantToken(tenantId, role)).firestore();
}

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function drillRef(ctxDb: CtxDb, tenantId: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'tenants', tenantId, 'projects', PID, 'evacuations', DRILL);
}
function scanRef(ctxDb: CtxDb, tenantId: string) {
  return doc(
    ctxDb as unknown as Parameters<typeof doc>[0],
    'tenants', tenantId, 'projects', PID, 'evacuations', DRILL, 'scans', WORKER,
  );
}

const drillDoc = () => ({
  status: 'active',
  startedByUid: 'sup-uid-1',
  startedAt: '2026-06-14T00:00:00.000Z',
  expectedWorkers: 12,
  meetingPointId: 'mp-1',
});
const scanDoc = () => ({ workerUid: WORKER, scannedByUid: 'sup-uid-1', at: '2026-06-14T00:01:00.000Z', safe: true });

async function seedDrill(tenantId = TENANT, withScan = false) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants', tenantId, 'projects', PID, 'evacuations', DRILL), drillDoc());
    if (withScan) {
      await setDoc(doc(db, 'tenants', tenantId, 'projects', PID, 'evacuations', DRILL, 'scans', WORKER), scanDoc());
    }
  });
}

describe('evacuations — firestore.rules (OLA 1 live headcount)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  it('member-read — a tenant member CAN read a live drill (revives the headcount feed)', async () => {
    await seedDrill();
    await assertSucceeds(getDoc(drillRef(authed(TENANT), TENANT)));
  });

  it('member-read — a tenant member CAN read a scan row', async () => {
    await seedDrill(TENANT, true);
    await assertSucceeds(getDoc(scanRef(authed(TENANT), TENANT)));
  });

  it('cross-tenant deny — a member of ANOTHER tenant CANNOT read the drill', async () => {
    await seedDrill();
    await assertFails(getDoc(drillRef(authed(OTHER_TENANT), TENANT)));
  });

  it('cross-tenant deny — a member of ANOTHER tenant CANNOT read a scan row', async () => {
    await seedDrill(TENANT, true);
    await assertFails(getDoc(scanRef(authed(OTHER_TENANT), TENANT)));
  });

  it('server-only — a member CANNOT create a drill directly (start flows through the audited route)', async () => {
    await assertFails(setDoc(drillRef(authed(TENANT, 'supervisor'), TENANT), drillDoc()));
  });

  it('server-only — a member CANNOT update a drill (e.g. forge status=ended)', async () => {
    await seedDrill();
    await assertFails(updateDoc(drillRef(authed(TENANT, 'supervisor'), TENANT), { status: 'ended' }));
  });

  it('server-only — a member CANNOT create a scan row directly (ghost-scan defence)', async () => {
    await seedDrill();
    await assertFails(setDoc(scanRef(authed(TENANT, 'supervisor'), TENANT), scanDoc()));
  });

  it('server-only — a member CANNOT delete a drill', async () => {
    await seedDrill();
    await assertFails(deleteDoc(drillRef(authed(TENANT, 'admin'), TENANT)));
  });
});
