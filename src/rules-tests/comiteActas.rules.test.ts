// SPDX-License-Identifier: MIT
//
// #B12 — `projects/{pid}/comite_actas` (CPHS committee minutes, DS54) write
// rules. The ComiteParitario page creates an acta then appends acuerdos; the
// sub-collection previously had NO write rule → default-denied (the Comité
// Paritario feature was broken in prod). Pins: member-gated create/update,
// schema-validated (no PII smuggling onto a legal record), immutable creation
// stamp + meeting date. F7 (2026-07-02): actas are legal evidence — NO
// client deletes at all (full client-side immutability). F1 harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-cphs-1';
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

const validActa = {
  fecha: '2026-06-08',
  tipo: 'Ordinaria',
  asistentes: ['Ana', 'Luis'],
  acuerdos: [],
  createdAt: '2026-06-08T00:00:00Z',
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'CPHS Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'projects', PID, 'comite_actas', 'seeded'), validActa);
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'projects', PID, 'comite_actas', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('comite_actas (CPHS minutes) — firestore.rules (#B12)', () => {
  it('SERVER-ONLY: a project member CANNOT create an acta via a direct client write', async () => {
    // A CPHS acta is a legal minute → writes go through the audited server
    // route (cphsMinute.ts), Admin SDK only. Even a valid member + valid shape
    // is denied at the client SDK (CLAUDE.md #3).
    await assertFails(setDoc(ref(authed(MEMBER), 'a1'), validActa));
  });

  it('an anonymous user CANNOT create an acta', async () => {
    await assertFails(setDoc(ref(anonDb(), 'a2'), validActa));
  });

  it("a non-member CANNOT create an acta in someone else's project", async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'a3'), validActa));
  });

  it('rejects an extra top-level field (no PII smuggling onto the legal record)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'a4'), { ...validActa, workerRut: '11.111.111-1' }),
    );
  });

  it('rejects a malformed acta (missing required fecha)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'a5'), {
        tipo: 'Ordinaria',
        asistentes: [],
        acuerdos: [],
        createdAt: '2026-06-08T00:00:00Z',
      }),
    );
  });

  it('SERVER-ONLY: a member CANNOT append an acuerdo via a direct client update', async () => {
    await assertFails(
      updateDoc(ref(authed(MEMBER), 'seeded'), {
        acuerdos: [
          { id: 'ac1', descripcion: 'Reparar barandas', responsable: 'Ana', fechaPlazo: '2026-07-01', estado: 'Pendiente' },
        ],
      }),
    );
  });

  it('rejects an update that tampers with the creation stamp', async () => {
    await assertFails(
      updateDoc(ref(authed(MEMBER), 'seeded'), { createdAt: '2030-01-01T00:00:00Z' }),
    );
  });

  it('rejects an update that changes the meeting date', async () => {
    await assertFails(updateDoc(ref(authed(MEMBER), 'seeded'), { fecha: '2026-12-31' }));
  });

  it('a regular member CANNOT delete an acta (legal trail)', async () => {
    await assertFails(deleteDoc(ref(authed(MEMBER), 'seeded')));
  });

  it('F7: even an ADMIN cannot delete an acta client-side (evidencia legal)', async () => {
    await assertFails(deleteDoc(ref(authed('admin-uid', 'admin'), 'seeded')));
  });
});
