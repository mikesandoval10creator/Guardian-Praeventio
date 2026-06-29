// SPDX-License-Identifier: MIT
//
// Spaced-repetition learning cards — close the default-deny gap on
// `learning_cards`.
//
// Path: learning_cards/{cardId} — a worker's OWN SM-2 study cards for a project
// (seeded when a training completes, updated as they review). CLIENT-written
// (Training.tsx addDoc + SpacedRepetitionReviewQueue updateDoc), so the threat
// model is a worker forging someone else's study record, escalating to another
// project, or peeking at a peer's cards. This suite pins owner-scoped read +
// own-card create + immutable-ownership update + no client delete.
// (CLAUDE.md #4 — ≥5 rules-tests; Dirty Dozen in security_spec.md.)
//
// authenticatedContext only (NEVER the Admin SDK in an assertion);
// withSecurityRulesDisabled only seeds preconditions.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-sr-1';
const OWNER = 'worker-sr-owner';
const MEMBER2 = 'worker-sr-peer'; // same project, NOT the card owner
const OUTSIDER = 'worker-sr-outsider'; // not in the project at all
const CARD_ID = 'card-sr-1';

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

function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role, `${uid}@x.cl`)).firestore();
}

function ref(ctxDb: CtxDb, id = CARD_ID) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'learning_cards', id);
}

const cardDoc = {
  projectId: PID,
  workerUid: OWNER,
  topic: 'altura R1',
  initiallyLearnedAt: '2026-05-01T00:00:00.000Z',
  reviewCount: 0,
  easeFactor: 2.5,
  intervalDays: 1,
  nextReviewAt: '2026-05-02T00:00:00.000Z',
};

async function seedProjectAndCard() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'SR Project',
      members: [OWNER, MEMBER2],
      status: 'active',
      createdAt: '2026-05-01T00:00:00.000Z',
      createdBy: OWNER,
    });
    await setDoc(doc(db, 'learning_cards', CARD_ID), cardDoc);
  });
}

describe('learning_cards — firestore.rules (client-write, owner-scoped)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedProjectAndCard();
  });

  it('owner-allow — the owner CAN read their own card', async () => {
    await assertSucceeds(getDoc(ref(authed(OWNER))));
  });

  it('owner-allow — the owner CAN create their own card', async () => {
    await assertSucceeds(
      setDoc(ref(authed(OWNER), 'card-sr-new'), { ...cardDoc, topic: 'químicos' }),
    );
  });

  it('peer-deny — a project member who is NOT the owner CANNOT read the card', async () => {
    await assertFails(getDoc(ref(authed(MEMBER2))));
  });

  it('non-member-deny — an outsider CANNOT read the card', async () => {
    await assertFails(getDoc(ref(authed(OUTSIDER))));
  });

  it('unauthenticated-deny — an anonymous client CANNOT read', async () => {
    const anon = requireEnv().unauthenticatedContext().firestore() as unknown as CtxDb;
    await assertFails(getDoc(ref(anon)));
  });

  it('owner-spoof-deny — a member CANNOT create a card owned by someone else', async () => {
    await assertFails(
      setDoc(ref(authed(OWNER), 'card-sr-spoof'), { ...cardDoc, workerUid: MEMBER2 }),
    );
  });

  it('non-member-create-deny — an outsider CANNOT create a card in a project they are not in', async () => {
    await assertFails(
      setDoc(ref(authed(OUTSIDER), 'card-sr-outsider'), {
        ...cardDoc,
        workerUid: OUTSIDER,
      }),
    );
  });

  it('schema-violation-deny — a malformed create (reviewCount not a number) is denied', async () => {
    await assertFails(
      setDoc(ref(authed(OWNER), 'card-sr-bad'), {
        projectId: PID,
        workerUid: OWNER,
        topic: 'x',
        reviewCount: 'zero',
      }),
    );
  });

  it('owner-update-allow — the owner CAN reschedule their own card (review)', async () => {
    await assertSucceeds(
      updateDoc(ref(authed(OWNER)), {
        reviewCount: 1,
        easeFactor: 2.6,
        intervalDays: 6,
        nextReviewAt: '2026-05-08T00:00:00.000Z',
      }),
    );
  });

  it('immutable-deny — the owner CANNOT move their card to another project', async () => {
    await assertFails(updateDoc(ref(authed(OWNER)), { projectId: 'other-project' }));
  });

  it('owner-delete-deny — the worker CANNOT delete their own card (admin/supervisor only)', async () => {
    await assertFails(deleteDoc(ref(authed(OWNER))));
  });
});
