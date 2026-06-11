// SPDX-License-Identifier: MIT
//
// B-protocols (2026-06-11) — `protocol_assessments` (TMERT-EESS / PREXOR
// MINSAL evaluations) rules. The collection is server-only: assessments are
// computed + persisted by /api/sprint-k/:projectId/protocols/* (verifyAuth +
// assertProjectMember, Admin SDK) which recomputes the verdict from raw
// inputs and stamps `metadata.author` from the verified token. A
// client-writable rule would let a member persist a spoofed verdict
// ("riesgo bajo" over a real "alto") or a spoofed author; a client-readable
// rule would bypass the server's member gate. Default-deny BOTH for every
// actor. Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-protocols-1';
const MEMBER = 'member-uid-1';
const OUTSIDER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';
const DOC_ID = 'assessment-1';

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

const validAssessment = {
  projectId: PID,
  protocol: 'TMERT',
  taskName: 'Ensacado manual',
  workerId: null,
  inputs: {
    repetitividad: { A: true, B: false, C: false },
    fuerza: { A: false, B: false, C: false },
    posturaForzada: { A: false, B: false, C: false },
    otros: { A: false, B: false, C: false },
    exposureHoursPerDay: 8,
  },
  result: { overallRisk: 'medio', factorsAtRisk: ['repetitividad'] },
  computedAt: '2026-06-11T12:00:00.000Z',
  metadata: { author: MEMBER, signedAt: null },
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Seed the project (MEMBER is a member) AND a pre-existing assessment,
    // so the read-deny tests prove members are blocked even when the doc
    // exists (the legitimate read path is the server route).
    await setDoc(doc(db, 'projects', PID), {
      name: 'Protocols Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'protocol_assessments', DOC_ID), validAssessment);
  });
});

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'protocol_assessments', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('protocol_assessments (TMERT/PREXOR MINSAL) — firestore.rules', () => {
  it('a project MEMBER cannot read an assessment directly (reads go through the server route)', async () => {
    await assertFails(getDoc(ref(authed(MEMBER), DOC_ID)));
  });

  it('a non-member cannot read an assessment', async () => {
    await assertFails(getDoc(ref(authed(OUTSIDER), DOC_ID)));
  });

  it('an admin cannot read an assessment directly (server-only access)', async () => {
    await assertFails(getDoc(ref(authed(ADMIN, 'admin'), DOC_ID)));
  });

  it('an anonymous user cannot read an assessment', async () => {
    await assertFails(getDoc(ref(anonDb(), DOC_ID)));
  });

  it('a project member cannot CREATE an assessment (cannot self-fabricate a verdict)', async () => {
    await assertFails(setDoc(ref(authed(MEMBER), 'forged-1'), validAssessment));
  });

  it('a member cannot UPDATE an existing assessment (cannot downgrade a risk verdict)', async () => {
    await assertFails(
      updateDoc(ref(authed(MEMBER), DOC_ID), {
        'result.overallRisk': 'bajo',
      }),
    );
  });

  it('a member cannot DELETE an assessment (legally-binding history)', async () => {
    await assertFails(deleteDoc(ref(authed(MEMBER), DOC_ID)));
  });

  it('an anonymous user cannot write an assessment', async () => {
    await assertFails(setDoc(ref(anonDb(), 'forged-2'), validAssessment));
  });
});
