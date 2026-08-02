// SPDX-License-Identifier: MIT
//
// P0 — /nodes tenant isolation. These tests exercise the real Firestore rules
// through authenticated client SDK contexts. Admin SDK is used only while
// security rules are disabled to seed preconditions.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PROJECT_ID = 'project-nodes-tenant-a';
const OTHER_PROJECT_ID = 'project-nodes-tenant-b';
const MEMBER = 'member-a';
const MEMBER_ADMIN = 'admin-a';
const OUTSIDER = 'outsider-b';
const OUTSIDER_ADMIN = 'admin-b';
const REMOVED_AUTHOR = 'removed-author';
const NODE_ID = 'tenant-node-1';

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

function authed(
  uid: string,
  role = 'worker',
  extraClaims: Record<string, unknown> = {},
) {
  return requireEnv()
    .authenticatedContext(uid, verifiedToken(role, `${uid}@example.cl`, extraClaims))
    .firestore();
}

function nodeData(authorId: string, projectId = PROJECT_ID) {
  return {
    type: 'Riesgo',
    title: 'Riesgo de caída de altura',
    description: 'Trabajo sobre plataforma con borde abierto.',
    tags: ['altura'],
    connections: [],
    projectId,
    metadata: { authorId },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PROJECT_ID), {
      name: 'Faena A',
      tenantId: 'tenant-a',
      members: [MEMBER, MEMBER_ADMIN],
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'projects', OTHER_PROJECT_ID), {
      name: 'Faena B',
      tenantId: 'tenant-b',
      members: [OUTSIDER, OUTSIDER_ADMIN],
      createdBy: OUTSIDER,
    });
    await setDoc(doc(db, 'nodes', NODE_ID), nodeData(MEMBER));
    await setDoc(doc(db, 'nodes', 'removed-author-node'), nodeData(REMOVED_AUTHOR));
  });
});

describe('/nodes tenant-scoped reads and server-authoritative writes', () => {
  it('allows a project member to read an ordinary node in their own project', async () => {
    await assertSucceeds(getDoc(doc(authed(MEMBER), 'nodes', NODE_ID)));
  });

  it('denies an ordinary-node read by a verified non-member', async () => {
    await assertFails(getDoc(doc(authed(OUTSIDER), 'nodes', NODE_ID)));
  });

  it('denies a former author after project membership is removed', async () => {
    await assertFails(getDoc(doc(authed(REMOVED_AUTHOR), 'nodes', 'removed-author-node')));
  });

  it('denies a global admin from another tenant from reading the node', async () => {
    const db = authed(OUTSIDER_ADMIN, 'admin', { tenantId: 'tenant-b' });
    await assertFails(getDoc(doc(db, 'nodes', NODE_ID)));
  });

  it('denies direct create even to a legitimate member because writes are server-only', async () => {
    const db = authed(MEMBER);
    await assertFails(
      setDoc(doc(db, 'nodes', 'member-created'), nodeData(MEMBER)),
    );
  });

  it('denies direct create by a verified non-member even when authorId matches', async () => {
    const db = authed(OUTSIDER);
    await assertFails(
      setDoc(doc(db, 'nodes', 'cross-tenant-create'), nodeData(OUTSIDER)),
    );
  });

  it('denies identity spoofing on create by a legitimate project member', async () => {
    const db = authed(MEMBER);
    await assertFails(
      setDoc(doc(db, 'nodes', 'spoofed-author'), nodeData(OUTSIDER)),
    );
  });

  it('denies a direct connection update because reciprocal edges are server-transactional', async () => {
    const db = authed(MEMBER);
    await assertFails(
      updateDoc(doc(db, 'nodes', NODE_ID), {
        connections: ['control-1'],
        updatedAt: '2026-08-02T01:00:00.000Z',
      }),
    );
  });

  it('denies a connection update by a verified non-member', async () => {
    const db = authed(OUTSIDER);
    await assertFails(
      updateDoc(doc(db, 'nodes', NODE_ID), {
        connections: ['poisoned-cross-tenant-edge'],
        updatedAt: '2026-08-02T01:00:00.000Z',
      }),
    );
  });

  it('denies an expelled author from updating their former project node', async () => {
    const db = authed(REMOVED_AUTHOR);
    await assertFails(
      updateDoc(doc(db, 'nodes', 'removed-author-node'), {
        title: 'Título alterado tras expulsión',
        updatedAt: '2026-08-02T01:00:00.000Z',
      }),
    );
  });

  it('denies a global admin from another tenant from updating the node', async () => {
    const db = authed(OUTSIDER_ADMIN, 'admin', { tenantId: 'tenant-b' });
    await assertFails(
      updateDoc(doc(db, 'nodes', NODE_ID), {
        title: 'Admin cross-tenant',
        updatedAt: '2026-08-02T01:00:00.000Z',
      }),
    );
  });

  it('denies a global admin from another tenant from deleting the node', async () => {
    const db = authed(OUTSIDER_ADMIN, 'admin', { tenantId: 'tenant-b' });
    await assertFails(deleteDoc(doc(db, 'nodes', NODE_ID)));
  });

  it('denies direct delete even to an in-project admin because writes are server-only', async () => {
    const db = authed(MEMBER_ADMIN, 'admin', { tenantId: 'tenant-a' });
    await assertFails(deleteDoc(doc(db, 'nodes', NODE_ID)));
  });
});
