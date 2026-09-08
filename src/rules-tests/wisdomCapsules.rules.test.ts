// SPDX-License-Identifier: MIT
//
// Wisdom capsule tenant/project isolation. These tests use authenticated
// Firestore client contexts; Admin SDK is used only to seed preconditions.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PROJECT_A = 'wisdom-project-a';
const PROJECT_B = 'wisdom-project-b';
const TENANT_A = 'wisdom-tenant-a';
const TENANT_B = 'wisdom-tenant-b';
const MEMBER_A = 'wisdom-member-a';
const MEMBER_B = 'wisdom-member-b';
const ADMIN_A = 'wisdom-admin-a';
const ADMIN_B = 'wisdom-admin-b';

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

function authed(uid: string, role = 'worker', tenantId?: string) {
  return requireEnv()
    .authenticatedContext(
      uid,
      verifiedToken(role, `${uid}@example.cl`, tenantId ? { tenantId } : {}),
    )
    .firestore();
}

function capsule(
  projectId = PROJECT_A,
  tenantId = TENANT_A,
  over: Record<string, unknown> = {},
) {
  return {
    tenantId,
    projectId,
    title: 'Bloqueo antes de operar',
    content: 'Verifica el aislamiento y el estado de la máquina.',
    lat: -33.45,
    lng: -70.66,
    radius: 50,
    ...over,
  };
}

async function seed(path: [string, ...string[]], data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...path), data);
  });
}

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PROJECT_A), {
      name: 'Faena A',
      tenantId: TENANT_A,
      members: [MEMBER_A, ADMIN_A],
      createdBy: MEMBER_A,
    });
    await setDoc(doc(db, 'projects', PROJECT_B), {
      name: 'Faena B',
      tenantId: TENANT_B,
      members: [MEMBER_B, ADMIN_B],
      createdBy: MEMBER_B,
    });
    await setDoc(doc(db, 'wisdomCapsules', 'capsule-a'), capsule());
    await setDoc(
      doc(db, 'wisdomCapsules', 'capsule-cross-tenant'),
      capsule(PROJECT_A, TENANT_B),
    );
    await setDoc(doc(db, 'wisdomCapsules', 'capsule-b'), capsule(PROJECT_B, TENANT_B));
  });
});

describe('wisdomCapsules tenant/project reads', () => {
  it('allows a member to read a capsule in their own project', async () => {
    await assertSucceeds(getDoc(doc(authed(MEMBER_A, 'worker', TENANT_A), 'wisdomCapsules', 'capsule-a')));
  });

  it('allows a scoped query with tenant, project, and limit constraints', async () => {
    const db = authed(MEMBER_A, 'worker', TENANT_A);
    const scoped = query(
      collection(db, 'wisdomCapsules'),
      where('tenantId', '==', TENANT_A),
      where('projectId', '==', PROJECT_A),
      limit(10),
    );
    const snapshot = await assertSucceeds(getDocs(scoped));
    expect(snapshot.size).toBe(1);
  });

  it('denies a member from another tenant reading project A', async () => {
    await assertFails(getDoc(doc(authed(MEMBER_B, 'worker', TENANT_B), 'wisdomCapsules', 'capsule-a')));
  });

  it('denies a global admin from tenant B reading project A', async () => {
    await assertFails(getDoc(doc(authed(ADMIN_B, 'admin', TENANT_B), 'wisdomCapsules', 'capsule-a')));
  });

  it('denies unauthenticated reads', async () => {
    await assertFails(getDoc(doc(requireEnv().unauthenticatedContext().firestore(), 'wisdomCapsules', 'capsule-a')));
  });

  it('denies a capsule whose document tenant disagrees with its project', async () => {
    await assertFails(getDoc(doc(authed(MEMBER_A, 'worker', TENANT_A), 'wisdomCapsules', 'capsule-cross-tenant')));
  });
});

describe('wisdomCapsules anti-spoof writes', () => {
  it('allows an in-tenant admin to create a valid capsule', async () => {
    await assertSucceeds(
      setDoc(doc(authed(ADMIN_A, 'admin', TENANT_A), 'wisdomCapsules', 'capsule-new'), capsule()),
    );
  });

  it('denies a regular member from creating a capsule', async () => {
    await assertFails(
      setDoc(doc(authed(MEMBER_A, 'worker', TENANT_A), 'wisdomCapsules', 'capsule-worker'), capsule()),
    );
  });

  it('denies an admin that spoofs the project tenant', async () => {
    await assertFails(
      setDoc(
        doc(authed(ADMIN_A, 'admin', TENANT_A), 'wisdomCapsules', 'capsule-spoof-project'),
        capsule(PROJECT_B, TENANT_A),
      ),
    );
  });

  it('denies an admin that spoofs the document tenant', async () => {
    await assertFails(
      setDoc(
        doc(authed(ADMIN_A, 'admin', TENANT_A), 'wisdomCapsules', 'capsule-spoof-tenant'),
        capsule(PROJECT_A, TENANT_B),
      ),
    );
  });

  it('denies invalid shape or oversized content', async () => {
    await assertFails(
      setDoc(
        doc(authed(ADMIN_A, 'admin', TENANT_A), 'wisdomCapsules', 'capsule-invalid'),
        capsule(PROJECT_A, TENANT_A, { content: 'x'.repeat(10_001) }),
      ),
    );
  });

  it('denies updates that change immutable tenant/project stamps', async () => {
    const db = authed(ADMIN_A, 'admin', TENANT_A);
    await assertFails(updateDoc(doc(db, 'wisdomCapsules', 'capsule-a'), { tenantId: TENANT_B }));
    await assertFails(updateDoc(doc(db, 'wisdomCapsules', 'capsule-a'), { projectId: PROJECT_B }));
  });

  it('denies a cross-tenant admin delete', async () => {
    await assertFails(deleteDoc(doc(authed(ADMIN_B, 'admin', TENANT_B), 'wisdomCapsules', 'capsule-a')));
  });
});
