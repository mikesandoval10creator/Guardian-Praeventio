// SPDX-License-Identifier: MIT
//
// B4 / audit H8 — Evidence chain-of-custody Firestore rules.
//
// `tenants/{tid}/evidence_artifacts/{hash}` (+ `.../events/{eid}`) is the
// content-addressed legal evidence chain. ALL writes flow through the audited
// server route (src/server/routes/custodyChain.ts) via the Admin SDK, which
// bypasses these rules and server-stamps uploadedByUid/actorUid from the
// verified token. The client SDK must therefore NEVER write here, and the
// custody `/events` log is APPEND-ONLY immutable (no update/delete by anyone).
//
// This suite pins that model with the F1 fail-closed harness +
// authenticatedContext (NEVER the Admin SDK in an assertion — that would bypass
// the rules under test). withSecurityRulesDisabled is used ONLY to seed the
// server-written preconditions.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';

const TENANT = 'tenant-ev-1';
const OTHER_TENANT = 'tenant-ev-2';
const MEMBER = 'member-uid-1';
const HASH = 'a'.repeat(64); // SHA-256 hex-shaped doc id (content-addressed).

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

// Single-tenant claim binding the caller to `tenantId` (isMemberOfTenant).
function tenantToken(tenantId: string) {
  return { email: `${tenantId}-user@example.com`, email_verified: true, role: 'worker', tenantId };
}

function authed(tenantId: string) {
  return requireEnv()
    .authenticatedContext(`${tenantId}-uid`, tenantToken(tenantId))
    .firestore();
}

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function artifactRef(ctxDb: CtxDb, tenantId: string, hash: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'tenants', tenantId, 'evidence_artifacts', hash);
}
function eventRef(ctxDb: CtxDb, tenantId: string, hash: string, eventId: string) {
  return doc(
    ctxDb as unknown as Parameters<typeof doc>[0],
    'tenants', tenantId, 'evidence_artifacts', hash, 'events', eventId,
  );
}

const artifactDoc = () => ({
  id: HASH,
  kind: 'photo',
  mimeType: 'image/jpeg',
  byteSize: 1234,
  uploadedByUid: MEMBER,
  uploadedAt: '2026-06-08T00:00:00.000Z',
});
const eventDoc = () => ({
  artifactHash: HASH,
  eventKind: 'upload',
  actorUid: MEMBER,
  actorRole: 'worker',
  at: '2026-06-08T00:00:00.000Z',
});

/** Seed an artifact (+ optional event) the way the SERVER would (Admin SDK). */
async function seedArtifact(tenantId = TENANT, withEvent = false) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants', tenantId, 'evidence_artifacts', HASH), artifactDoc());
    if (withEvent) {
      await setDoc(
        doc(db, 'tenants', tenantId, 'evidence_artifacts', HASH, 'events', 'evt-1'),
        eventDoc(),
      );
    }
  });
}

describe('evidence_artifacts — firestore.rules (B4 / H8)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  // owner/member-allow
  it('a tenant member can READ an evidence artifact', async () => {
    await seedArtifact(TENANT);
    await assertSucceeds(getDoc(artifactRef(authed(TENANT), TENANT, HASH)));
  });

  // owner/member-allow (subcollection)
  it('a tenant member can READ a custody event', async () => {
    await seedArtifact(TENANT, true);
    await assertSucceeds(getDoc(eventRef(authed(TENANT), TENANT, HASH, 'evt-1')));
  });

  // non-member-deny (cross-tenant isolation)
  it('a member of ANOTHER tenant cannot READ the artifact', async () => {
    await seedArtifact(TENANT);
    await assertFails(getDoc(artifactRef(authed(OTHER_TENANT), TENANT, HASH)));
  });

  // non-member-deny (subcollection)
  it('a member of ANOTHER tenant cannot READ a custody event', async () => {
    await seedArtifact(TENANT, true);
    await assertFails(getDoc(eventRef(authed(OTHER_TENANT), TENANT, HASH, 'evt-1')));
  });

  // server-field-spoof-deny — client cannot create an artifact at all
  // (uploadedByUid is server-stamped via the Admin-SDK route; a direct client
  // write would let the caller forge the chain identity).
  it('a tenant member CANNOT create an artifact directly (server-only write)', async () => {
    await assertFails(setDoc(artifactRef(authed(TENANT), TENANT, HASH), artifactDoc()));
  });

  // schema-violation / direct-write deny on the append-only events log
  it('a tenant member CANNOT create a custody event directly (server-only append)', async () => {
    await seedArtifact(TENANT);
    await assertFails(
      setDoc(eventRef(authed(TENANT), TENANT, HASH, 'evt-forged'), eventDoc()),
    );
  });

  // immutable-event update-deny — the custody log is APPEND-ONLY
  it('a custody event is IMMUTABLE — update is denied (append-only chain)', async () => {
    await seedArtifact(TENANT, true);
    await assertFails(
      setDoc(eventRef(authed(TENANT), TENANT, HASH, 'evt-1'), { actorRole: 'admin' }, { merge: true }),
    );
  });

  // immutable-event delete-deny — no link can be erased
  it('a custody event cannot be deleted (chain integrity)', async () => {
    await seedArtifact(TENANT, true);
    await assertFails(deleteDoc(eventRef(authed(TENANT), TENANT, HASH, 'evt-1')));
  });

  // artifact tamper-deny — content-addressed record is not client-mutable
  it('a tenant member CANNOT update an artifact (e.g. forge replacedByHash)', async () => {
    await seedArtifact(TENANT);
    await assertFails(
      setDoc(artifactRef(authed(TENANT), TENANT, HASH), { replacedByHash: 'b'.repeat(64) }, { merge: true }),
    );
  });
});
