// Server-only coordination: even the trip owner must use the authenticated API.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createRulesTestEnv(); });
afterAll(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', 'project-A'), {
      tenantId: 'tenant-A', members: ['owner', 'member'], createdBy: 'owner',
    });
    await setDoc(doc(ctx.firestore(), 'commute_active', 'pointer'), { sessionId: 'owned-trip' });
  });
});

const ownerDb = () => env.authenticatedContext('owner', verifiedToken('worker', 'owner@test.com', {
  tenantId: 'tenant-A',
})).firestore();

describe('commute_active server-only Firestore boundary', () => {
  it('denies anonymous reads', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'commute_active', 'pointer')));
  });

  it.each([
    ['owner', 'worker', 'tenant-A'],
    ['member', 'worker', 'tenant-A'],
    ['supervisor', 'supervisor', 'tenant-A'],
    ['admin', 'admin', 'tenant-A'],
    ['foreign', 'admin', 'tenant-B'],
  ])('denies direct reads for %s (%s, %s)', async (uid, role, tenantId) => {
    const db = env.authenticatedContext(uid, verifiedToken(role, `${uid}@test.com`, { tenantId })).firestore();
    await assertFails(getDoc(doc(db, 'commute_active', 'pointer')));
  });

  it('denies owner creation even with a valid-looking server payload', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'commute_active', 'forged'), { sessionId: 'owned-trip' }));
  });

  it('denies owner creation with spoofed identity and malformed schema', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'commute_active', 'forged'), {
      sessionId: 123, startedBy: 'another-driver', tenantId: 'tenant-B', server: true,
    }));
  });

  it('denies overwriting a server-created pointer', async () => {
    await assertFails(updateDoc(doc(ownerDb(), 'commute_active', 'pointer'), { sessionId: 'foreign-trip' }));
  });

  it('denies deleting a pointer to bypass the active-session guard', async () => {
    await assertFails(deleteDoc(doc(ownerDb(), 'commute_active', 'pointer')));
  });
});
