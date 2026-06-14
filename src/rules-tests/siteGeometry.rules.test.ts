// SPDX-License-Identifier: MIT
//
// OLA 1 (VIDA, 2026-06-14) — digital-twin `site_geometry` Firestore rules.
//
// Path: tenants/{tid}/projects/{pid}/site_geometry/{geomId} (6 segments — a
// per-project subcollection that previously had NO rule and fell to the global
// default-deny, so the A* evacuation map in DynamicEvacuationMap was dead in
// prod). Polygons are DRAWN client-side by an admin/supervisor
// (siteGeometryStore.savePolygon → setDoc) and read live by every tenant member
// (the route is shown to workers during an evacuation). This suite pins:
//   • member-read-allow + cross-tenant read-deny
//   • admin/supervisor create/update-allow + plain-member authoring-deny
//   • schema-violation create-deny
//   • admin/supervisor delete-allow + plain-member delete-deny
//
// F1 fail-closed harness + authenticatedContext (NEVER the Admin SDK in an
// assertion). withSecurityRulesDisabled only seeds preconditions.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';

const TENANT = 'tenant-geo-1';
const OTHER_TENANT = 'tenant-geo-2';
const PID = 'proj-geo-1';
const GEOM = 'geom-bodega-3';

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

// Single-tenant claim binding the caller to `tenantId` with a given global role
// (isMemberOfTenant + isSupervisorOfTenant both read the single-tenant claim).
function tenantToken(tenantId: string, role = 'worker') {
  return { email: `${tenantId}-${role}@example.com`, email_verified: true, role, tenantId };
}
function authed(tenantId: string, role = 'worker') {
  return requireEnv().authenticatedContext(`${tenantId}-${role}-uid`, tenantToken(tenantId, role)).firestore();
}

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function geomRef(ctxDb: CtxDb, tenantId: string, geomId = GEOM) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'tenants', tenantId, 'projects', PID, 'site_geometry', geomId);
}

// A valid polygon record (mirrors SitePolygonRecord from siteGeometryStore.ts).
// Ring is stored as {lng,lat} MAPS — Firestore rejects directly-nested arrays.
const polygon = () => ({
  id: GEOM,
  type: 'building',
  label: 'Bodega 3',
  heightM: 4,
  coordinates: [
    { lng: -70.66, lat: -33.45 },
    { lng: -70.65, lat: -33.45 },
    { lng: -70.65, lat: -33.44 },
    { lng: -70.66, lat: -33.45 },
  ],
});

async function seedPolygon(tenantId = TENANT) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tenants', tenantId, 'projects', PID, 'site_geometry', GEOM), polygon());
  });
}

describe('site_geometry — firestore.rules (OLA 1 digital-twin A*)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  it('member-read — a tenant member CAN read site geometry (revives A* feed)', async () => {
    await seedPolygon();
    await assertSucceeds(getDoc(geomRef(authed(TENANT), TENANT)));
  });

  it('cross-tenant deny — a member of ANOTHER tenant CANNOT read the geometry', async () => {
    await seedPolygon();
    await assertFails(getDoc(geomRef(authed(OTHER_TENANT), TENANT)));
  });

  it('author-allow — a supervisor CAN create a valid polygon', async () => {
    await assertSucceeds(setDoc(geomRef(authed(TENANT, 'supervisor'), TENANT), polygon()));
  });

  it('author-allow — an admin CAN create a valid polygon', async () => {
    await assertSucceeds(setDoc(geomRef(authed(TENANT, 'admin'), TENANT), polygon()));
  });

  it('authoring-deny — a plain worker member CANNOT create geometry', async () => {
    await assertFails(setDoc(geomRef(authed(TENANT, 'worker'), TENANT), polygon()));
  });

  it('schema-violation deny — supervisor create with a degenerate ring (<3 pts) is denied', async () => {
    await assertFails(
      setDoc(geomRef(authed(TENANT, 'supervisor'), TENANT), { ...polygon(), coordinates: [{ lng: -70.66, lat: -33.45 }] }),
    );
  });

  it('schema-violation deny — supervisor create with non-list coordinates is denied', async () => {
    await assertFails(
      setDoc(geomRef(authed(TENANT, 'supervisor'), TENANT), { ...polygon(), coordinates: 'not-a-ring' }),
    );
  });

  it('delete-allow — a supervisor CAN delete geometry; a worker CANNOT', async () => {
    await seedPolygon();
    await assertFails(deleteDoc(geomRef(authed(TENANT, 'worker'), TENANT)));
    await assertSucceeds(deleteDoc(geomRef(authed(TENANT, 'supervisor'), TENANT)));
  });
});
