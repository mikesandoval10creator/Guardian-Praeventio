// SPDX-License-Identifier: MIT
//
// PRIVACY (2026-06-08) — `nodes` read gate for worker-RUT PII.
//
// The DS 67 (INCIDENT) and DS 109 (MEDICINE) legal-form modals
// (src/components/medicine/Ds67Modal.tsx:215, Ds109Modal.tsx:249) build a
// `nodes` document whose `metadata.workerRut` carries a worker's RAW RUT (the
// Chilean national ID). The previous `nodes` read rule granted read to ANY
// project member (`isProjectMember(existing().projectId)`), so a single
// worker's national ID — attached to an accident or occupational-disease
// record — was readable by EVERY co-worker on the project.
//
// The fix (firestore.rules `match /nodes/{nodeId}`) keeps ordinary nodes
// member-readable but, when a node carries `metadata.workerRut`, restricts the
// read to: the node author (`metadata.authorId` — stamped server-side by
// networkBackend.ts:83), admin, and supervisor. Those are exactly the staff
// who file the DIAT/DIEP via SusesoReports.tsx (which reads
// selectedIncident.metadata.workerRut), so the RUT stays in the node and the
// legal form still renders the real identifier for authorized readers.
//
// Uses the F1 fail-closed harness (`./_harness`): the emulator must be up or
// the suite FAILS (never silent-pass). Run via `npm run test:rules`.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-nodes-rut-1';
const AUTHOR = 'author-uid-1';     // member who created the DS 67/109 node
const PEER = 'peer-uid-2';         // another plain member of the same project
const NON_MEMBER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';
const SUPERVISOR = 'sup-uid-1';

const PII_NODE = 'node-ds67-pii';
const PLAIN_NODE = 'node-plain';

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  // Fail-closed: THROWS if the emulator is unreachable → suite fails, no fake green.
  testEnv = await createRulesTestEnv();
});
afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});
function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

// Mirrors a DS 67 INCIDENT node as persisted by networkBackend.ts (Admin SDK
// stamps metadata.authorId). The raw RUT is the over-exposed field under test.
const piiNode = () => ({
  type: 'INCIDENT',
  title: 'DS 67: Accidente — Juan Perez',
  description: 'Notificacion accidente trabajo.',
  projectId: PID,
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
  metadata: {
    authorId: AUTHOR,
    workerRut: '12.345.678-5',
    cieCode: 'S62',
    severity: 'grave',
  },
});

// An ordinary node WITHOUT a worker RUT — must stay member-readable (no regression).
const plainNode = () => ({
  type: 'RISK',
  title: 'Riesgo: piso resbaloso bodega 3',
  description: 'Control: senaletica + antideslizante.',
  projectId: PID,
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
  metadata: {
    authorId: AUTHOR,
  },
});

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Nodes RUT Test',
      createdBy: AUTHOR,
      members: [AUTHOR, PEER],
    });
    await setDoc(doc(db, 'nodes', PII_NODE), piiNode());
    await setDoc(doc(db, 'nodes', PLAIN_NODE), plainNode());
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role, `${uid}@x.cl`)).firestore();
}
function nodeRef(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'nodes', id);
}

describe('nodes worker-RUT read gate — firestore.rules (PRIVACY 2026-06-08)', () => {
  it('THE FIX — a plain project peer CANNOT read a node carrying metadata.workerRut', async () => {
    // Before the fix this succeeded (isProjectMember granted read) → the
    // worker's national ID leaked to every co-worker. Now denied.
    await assertFails(getDoc(nodeRef(authed(PEER), PII_NODE)));
  });

  it('the node author (metadata.authorId) CAN read their own RUT-bearing node', async () => {
    await assertSucceeds(getDoc(nodeRef(authed(AUTHOR), PII_NODE)));
  });

  it('an admin CAN read a RUT-bearing node (files the DIAT/DIEP)', async () => {
    await assertSucceeds(getDoc(nodeRef(authed(ADMIN, 'admin'), PII_NODE)));
  });

  it('a supervisor/prevencionista CAN read a RUT-bearing node (DIAT/DIEP filer)', async () => {
    await assertSucceeds(getDoc(nodeRef(authed(SUPERVISOR, 'prevencionista'), PII_NODE)));
  });

  it('NO REGRESSION — a plain project peer CAN still read an ordinary node (no workerRut)', async () => {
    await assertSucceeds(getDoc(nodeRef(authed(PEER), PLAIN_NODE)));
  });

  it('a non-member CANNOT read the RUT-bearing node (tenant isolation baseline)', async () => {
    await assertFails(getDoc(nodeRef(authed(NON_MEMBER), PII_NODE)));
  });

  it('a non-member CANNOT read an ordinary node either (tenant isolation baseline)', async () => {
    await assertFails(getDoc(nodeRef(authed(NON_MEMBER), PLAIN_NODE)));
  });
});
