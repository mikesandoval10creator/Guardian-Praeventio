// SPDX-License-Identifier: MIT
//
// B.2 (VIDA/LEGAL) — tenants/{tid}/projects/{pid}/incidents rules.
//
// Incidents are written ONLY by the audited server route (incidents.ts →
// incidentRagService.reportIncident, Admin SDK; reporterUid stamped from the
// verified token). Before B.2 the 6-segment path had NO match → default-deny:
// a worker could FILE an incident but never READ their own record. This suite
// pins the read model: owner-read via reporterUid (even after losing project
// membership — Ley 16.744, their own prevention trail), member-read via the
// path projectId (supervisors triage), everything else denied — including all
// client writes (forgery/tamper/erasure) and unprovable sweeps. No tenant
// claims involved (isMemberOfTenant claims are unminted until M-1). F1
// fail-closed harness.

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

const TENANT = 'tenant-inc-1';
const PID = 'proj-inc-1';
const PID_B = 'proj-inc-2';
const WORKER = 'worker-uid-1';      // reporter; NOT a member anymore
const SUPERVISOR = 'member-uid-1';  // current project member
const MEMBER_B = 'member-uid-b';    // member of ANOTHER project
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

const incidentsPath = `tenants/${TENANT}/projects/${PID}/incidents`;
const incidentPath = (id: string) => `${incidentsPath}/${id}`;

// Same shape the server writes (incidentRagService.reportIncident).
const incident = (id: string, reporterUid: string) => ({
  id,
  tenantId: TENANT,
  projectId: PID,
  reporterUid,
  incidentType: 'near_miss',
  severity: 'medium',
  description: 'Casi golpe por carga suspendida en patio de acopio',
  location: 'Patio de acopio',
  witnesses: [],
  ts: '2026-07-01T10:00:00Z',
  createdAt: '2026-07-01T10:00:05Z',
});

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // WORKER deliberately NOT in members: owner-read must survive
    // membership changes (their record stays theirs).
    await setDoc(doc(db, 'projects', PID), {
      name: 'INC', members: [SUPERVISOR], status: 'active',
      createdAt: '2026-07-01T00:00:00Z', createdBy: SUPERVISOR,
    });
    await setDoc(doc(db, 'projects', PID_B), {
      name: 'INC-B', members: [MEMBER_B], status: 'active',
      createdAt: '2026-07-01T00:00:00Z', createdBy: MEMBER_B,
    });
    await setDoc(doc(db, incidentPath('i1')), incident('i1', WORKER));
    await setDoc(doc(db, incidentPath('i2')), incident('i2', 'someone-else'));
  });
});

function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('tenants/{tid}/projects/{pid}/incidents — firestore.rules (B.2 VIDA/LEGAL)', () => {
  it('the reporter reads their OWN incident (owner-read, even without membership)', async () => {
    await assertSucceeds(getDoc(doc(authed(WORKER), incidentPath('i1'))));
  });

  it('the reporter lists THEIR incidents with a reporterUid filter', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(authed(WORKER), incidentsPath),
          where('reporterUid', '==', WORKER),
          limit(50),
        ),
      ),
    );
  });

  it('a current project member reads any incident of the project', async () => {
    await assertSucceeds(getDoc(doc(authed(SUPERVISOR), incidentPath('i2'))));
  });

  it('a current project member lists the whole collection', async () => {
    await assertSucceeds(
      getDocs(query(collection(authed(SUPERVISOR), incidentsPath), limit(50))),
    );
  });

  it("the reporter cannot read someone ELSE's incident (not a member)", async () => {
    await assertFails(getDoc(doc(authed(WORKER), incidentPath('i2'))));
  });

  it('an outsider cannot read (non-member-deny)', async () => {
    await assertFails(getDoc(doc(authed(OUTSIDER), incidentPath('i1'))));
  });

  it('a member of ANOTHER project cannot read (cross-project-deny)', async () => {
    await assertFails(getDoc(doc(authed(MEMBER_B), incidentPath('i1'))));
  });

  it('a non-member cannot sweep the collection unfiltered (unprovable-deny)', async () => {
    await assertFails(getDocs(collection(authed(WORKER), incidentsPath)));
  });

  it('clients cannot create an incident (server-only), even a member', async () => {
    await assertFails(
      setDoc(doc(authed(SUPERVISOR), incidentPath('i-new')), incident('i-new', SUPERVISOR)),
    );
  });

  it('clients cannot tamper or erase an incident (update/delete-deny)', async () => {
    await assertFails(
      updateDoc(doc(authed(SUPERVISOR), incidentPath('i1')), { severity: 'low' }),
    );
    await assertFails(deleteDoc(doc(authed(WORKER), incidentPath('i1'))));
  });
});
