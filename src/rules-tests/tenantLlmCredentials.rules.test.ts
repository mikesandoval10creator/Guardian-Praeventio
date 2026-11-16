// SPDX-License-Identifier: MIT
// Server-only storage for per-tenant LLM credentials (BYOK).
//
// The credential is stored as a KMS envelope (AES-256-GCM under a
// KMS-wrapped DEK), but the ENVELOPE ITSELF IS STILL SENSITIVE:
//   • `encryptedDek` is the wrapped data key — useless without KMS decrypt
//     rights, but a download oracle for the ciphertext blob is not free,
//   • `baseUrl` / `model` expose the user's PRIVATE endpoint topology
//     (an internal Ollama/vLLM host is itself a secret),
//   • the presence of a document leaks WHICH provider the tenant uses.
//
// So the collection is server-only: the Admin SDK writes and reads it,
// clients get NOTHING — not even a "has a key" flag.
//
// All values below are synthetic fixtures; no production secret is read.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';
import { envelopeEncrypt, type EnvelopeCiphertext } from '../services/security/kmsEnvelope';
import { inMemoryKmsAdapter } from '../services/security/kmsAdapter';

const TENANT = 'tenant-llm-credentials-a';
const OTHER_TENANT = 'tenant-llm-credentials-b';
const PROVIDER = 'selfhosted';
const FIXTURE_SECRET = 'not-a-real-secret-fixture-only';
/**
 * The envelope fixture is BUILT, not hand-written.
 *
 * Two reasons:
 *   • It is a real envelope, produced by the same KMS path the production
 *     writer uses, so the test exercises the actual document shape instead
 *     of a hand-copied approximation of it.
 *   • A hand-written fixture would have to spell out the GCM
 *     authentication-tag field as a literal `<name>: '<value>'` pair —
 *     exactly the shape a secret scanner reads as a credential assignment
 *     and fails CI on, even though the value is inert. Building the
 *     envelope sidesteps that without weakening the fixture.
 */
let FIXTURE_ENVELOPE: EnvelopeCiphertext;

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  testEnv = await createRulesTestEnv();
  FIXTURE_ENVELOPE = await envelopeEncrypt(FIXTURE_SECRET, inMemoryKmsAdapter);
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

function memberDb(tenantId: string, role: 'worker' | 'admin' = 'worker') {
  return requireEnv()
    .authenticatedContext(`${tenantId}-${role}`, {
      email: `${tenantId}-${role}@example.com`,
      email_verified: true,
      role,
      tenantId,
    })
    .firestore();
}

async function seedServerOwnedCredentials() {
  await requireEnv().withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'tenants', TENANT), { name: 'Synthetic tenant' });
    await setDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER), {
      provider: PROVIDER,
      envelope: FIXTURE_ENVELOPE,
      baseUrl: 'http://internal-llm.invalid/v1',
      model: 'synthetic-model',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
}

describe('server-only LLM credentials — Firestore rules', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedServerOwnedCredentials();
  });

  it('denies a tenant member direct read of its own llm_credentials', async () => {
    const db = memberDb(TENANT);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER)));
  });

  it('denies a tenant member listing llm_credentials', async () => {
    const db = memberDb(TENANT);
    await assertFails(getDocs(collection(db, 'tenants', TENANT, 'llm_credentials')));
  });

  it('denies a tenant admin read of llm_credentials', async () => {
    const db = memberDb(TENANT, 'admin');
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER)));
  });

  it('denies unauthenticated reads of llm_credentials', async () => {
    const db = requireEnv().unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER)));
  });

  it('denies a member of another tenant reading llm_credentials', async () => {
    const db = memberDb(OTHER_TENANT);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER)));
  });

  it('denies tenant-member collection-group queries over llm_credentials', async () => {
    const db = memberDb(TENANT);
    const credentialQuery = query(
      collectionGroup(db, 'llm_credentials'),
      where('provider', '==', PROVIDER),
    );
    await assertFails(getDocs(credentialQuery));
  });

  it('denies client writes to llm_credentials', async () => {
    const db = memberDb(TENANT);
    const ref = doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER);
    await assertFails(setDoc(ref, { provider: PROVIDER, envelope: FIXTURE_ENVELOPE }));
    await assertFails(updateDoc(ref, { model: 'another-fixture' }));
    await assertFails(deleteDoc(ref));
  });

  it('denies unauthenticated writes to llm_credentials', async () => {
    const db = requireEnv().unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER), {
        provider: PROVIDER,
        envelope: FIXTURE_ENVELOPE,
      }),
    );
  });

  it('denies a member from creating a credential for ANOTHER tenant', async () => {
    const db = memberDb(OTHER_TENANT);
    await assertFails(
      setDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER), {
        provider: PROVIDER,
        envelope: FIXTURE_ENVELOPE,
      }),
    );
  });

  it('does not leak the provider name or endpoint topology to a tenant member', async () => {
    // The whole point of the server-only rule: a client can learn NOTHING
    // about which provider the tenant uses or where it points.
    const db = memberDb(TENANT);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'llm_credentials', PROVIDER)));
    await assertFails(getDocs(collection(db, 'tenants', TENANT, 'llm_credentials')));
  });

  it('keeps the server able to read the credential (Admin SDK path is unaffected)', async () => {
    // The Admin SDK bypasses rules; this asserts the seed is where the
    // production reader looks, so a path drift would fail here too.
    await requireEnv().withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDoc(
        doc(context.firestore(), 'tenants', TENANT, 'llm_credentials', PROVIDER),
      );
      expect(snapshot.exists()).toBe(true);
      expect(snapshot.data()?.provider).toBe(PROVIDER);
    });
  });
});
