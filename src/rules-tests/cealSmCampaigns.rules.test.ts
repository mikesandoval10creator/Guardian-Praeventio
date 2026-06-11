// SPDX-License-Identifier: MIT
//
// CEAL-SM/SUSESO (2026-06-11) — `ceal_sm_campaigns` (+ `responses`
// subcollection) rules. The collection is server-only: campaigns and
// anonymous worker responses are written and read exclusively through
// /api/sprint-k/:projectId/ceal-sm/* (verifyAuth + assertProjectMember,
// Admin SDK). The subcollection holds ANONYMOUS answers about the employer
// (Protocolo MINSAL oct. 2022 / Ley 19.628): doc id = peppered responder
// hash, never a uid. A client-readable rule would bypass the k>=10
// aggregate suppression gate and expose per-respondent answer sets; a
// client-writable rule would let a manager fabricate responses and tilt the
// center verdict, or tamper a campaign's totalWorkers to fake the 60%
// participation validity. Default-deny BOTH for every actor. Uses the F1
// fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-ceal-1';
const MEMBER = 'member-uid-1';
const OUTSIDER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';
const CAMPAIGN_ID = 'campaign-1';
const RESPONSE_HASH = 'a'.repeat(32); // shape of a responder hash doc id

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

const validCampaign = {
  projectId: PID,
  title: 'Evaluación CEAL-SM 2026',
  status: 'open',
  openAt: '2026-06-01T00:00:00.000Z',
  closeAt: '2026-07-01T00:00:00.000Z',
  totalWorkers: 30,
  createdAt: '2026-06-01T00:00:00.000Z',
  createdBy: MEMBER,
};

const validResponse = {
  responderHash: RESPONSE_HASH,
  answers: { QD1: 0, QD2: 0, QD3: 0 }, // truncated set — shape is enough for rules
  submittedAt: '2026-06-02T00:00:00.000Z',
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Seed the project (MEMBER is a member), one campaign AND one anonymous
    // response, so the read-deny tests prove that even a legitimate member
    // (or admin) cannot inspect raw responses when they exist — the only
    // read path is the k-gated server route.
    await setDoc(doc(db, 'projects', PID), {
      name: 'CEAL Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'ceal_sm_campaigns', CAMPAIGN_ID), validCampaign);
    await setDoc(
      doc(db, 'ceal_sm_campaigns', CAMPAIGN_ID, 'responses', RESPONSE_HASH),
      validResponse,
    );
  });
});

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function campaignRef(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'ceal_sm_campaigns', id);
}
function responseRef(db: CtxDb, hash: string) {
  return doc(
    db as unknown as Parameters<typeof doc>[0],
    'ceal_sm_campaigns',
    CAMPAIGN_ID,
    'responses',
    hash,
  );
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('ceal_sm_campaigns (CEAL-SM/SUSESO) — firestore.rules', () => {
  it('a project MEMBER cannot read a campaign directly (reads go through the server route)', async () => {
    await assertFails(getDoc(campaignRef(authed(MEMBER), CAMPAIGN_ID)));
  });

  it('an ADMIN cannot read a campaign directly (server-only access)', async () => {
    await assertFails(getDoc(campaignRef(authed(ADMIN, 'admin'), CAMPAIGN_ID)));
  });

  it('a non-member and an anonymous user cannot read a campaign', async () => {
    await assertFails(getDoc(campaignRef(authed(OUTSIDER), CAMPAIGN_ID)));
    await assertFails(getDoc(campaignRef(anonDb(), CAMPAIGN_ID)));
  });

  it('CRITICAL: nobody can read a raw anonymous response (k-gate bypass)', async () => {
    await assertFails(getDoc(responseRef(authed(MEMBER), RESPONSE_HASH)));
    await assertFails(getDoc(responseRef(authed(ADMIN, 'admin'), RESPONSE_HASH)));
    await assertFails(getDoc(responseRef(authed(OUTSIDER), RESPONSE_HASH)));
    await assertFails(getDoc(responseRef(anonDb(), RESPONSE_HASH)));
  });

  it('a member cannot CREATE a campaign client-side (must go through the audited route)', async () => {
    await assertFails(
      setDoc(campaignRef(authed(MEMBER), 'forged-1'), validCampaign),
    );
  });

  it('a member cannot UPDATE a campaign (e.g. inflate totalWorkers to fake 60% validity)', async () => {
    await assertFails(
      updateDoc(campaignRef(authed(MEMBER), CAMPAIGN_ID), { totalWorkers: 5 }),
    );
  });

  it('a member cannot FABRICATE a response (ballot stuffing tilts the center verdict)', async () => {
    await assertFails(
      setDoc(responseRef(authed(MEMBER), 'b'.repeat(32)), validResponse),
    );
  });

  it('a member cannot UPDATE or DELETE an existing anonymous response', async () => {
    await assertFails(
      updateDoc(responseRef(authed(MEMBER), RESPONSE_HASH), {
        'answers.QD1': 4,
      }),
    );
    await assertFails(deleteDoc(responseRef(authed(MEMBER), RESPONSE_HASH)));
  });

  it('a member cannot DELETE a campaign (legally-relevant surveillance history)', async () => {
    await assertFails(deleteDoc(campaignRef(authed(MEMBER), CAMPAIGN_ID)));
  });

  it('an anonymous user cannot write a campaign or a response', async () => {
    await assertFails(setDoc(campaignRef(anonDb(), 'forged-2'), validCampaign));
    await assertFails(setDoc(responseRef(anonDb(), 'c'.repeat(32)), validResponse));
  });
});
