// SPDX-License-Identifier: MIT
//
// OLA 2 (blindaje, 2026-06-14) — server-only-write tenant stores rules.
//
// Path: tenants/{tid}/projects/{pid}/{positive_observations|photo_evidence|
// splat_captures|bbs_observations}/{docId} — per-project subcollections that previously had NO
// rule (this `tenants/{tid}/projects/{pid}` block has no recursive catch-all,
// unlike projects/{pid}/** which the master-gate covers) and fell to global
// default-deny. All three are written ONLY by audited server routes via the
// Admin SDK (which bypasses rules + server-stamps identity); clients NEVER
// write. The rule makes that posture EXPLICIT: tenant members may READ, all
// client writes are denied (so a future client read works, and an accidental
// client write can never land). Per collection this pins:
//   • member-read-allow · cross-tenant read-deny
//   • client create / update / delete-deny (server-only)
// (CLAUDE.md #4 — ≥5 rules-tests per collection.)
//
// F1 fail-closed harness + authenticatedContext (NEVER the Admin SDK in an
// assertion). withSecurityRulesDisabled only seeds the server-written doc.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';

const TENANT = 'tenant-sw-1';
const OTHER_TENANT = 'tenant-sw-2';
const PID = 'proj-sw-1';
const DOC_ID = 'doc-1';

// The genuine OLA 2 gaps confirmed by the rules-gap investigation: all
// server-only-write, all under tenants/{tid}/projects/{pid}/.
// photo_evidence is split out below: it carries PII so its read is supervisor-
// tier, not member-wide (the others stay member-read).
// bbs_observations (feat/wire-bbs-profile): Behavior-Based Safety observations,
// same posture — member-read, server-only-write (bbs.ts Admin SDK stamps
// observerUid/tenantId/observedAt; a client write could forge observerUid or
// inject at_risk rows to skew the profile).
const COLLECTIONS = [
  'positive_observations',
  'splat_captures',
  'bbs_observations',
] as const;

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

function tenantToken(tenantId: string, role = 'worker') {
  return { email: `${tenantId}-${role}@example.com`, email_verified: true, role, tenantId };
}
function authed(tenantId: string, role = 'worker') {
  return requireEnv()
    .authenticatedContext(`${tenantId}-${role}-uid`, tenantToken(tenantId, role))
    .firestore();
}

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function refFor(ctxDb: CtxDb, tenantId: string, coll: string) {
  return doc(
    ctxDb as unknown as Parameters<typeof doc>[0],
    'tenants', tenantId, 'projects', PID, coll, DOC_ID,
  );
}

async function seed(coll: string, tenantId = TENANT) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'tenants', tenantId, 'projects', PID, coll, DOC_ID),
      { server: true, createdAt: '2026-06-14T00:00:00.000Z' },
    );
  });
}

describe('server-only-write tenant stores — firestore.rules (OLA 2 blindaje)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  for (const coll of COLLECTIONS) {
    describe(coll, () => {
      it('member-read — a tenant member CAN read', async () => {
        await seed(coll);
        await assertSucceeds(getDoc(refFor(authed(TENANT), TENANT, coll)));
      });

      it('cross-tenant deny — a member of ANOTHER tenant CANNOT read', async () => {
        await seed(coll);
        await assertFails(getDoc(refFor(authed(OTHER_TENANT), TENANT, coll)));
      });

      it('server-only — a member CANNOT create directly (Admin SDK is the only writer)', async () => {
        await assertFails(setDoc(refFor(authed(TENANT, 'supervisor'), TENANT, coll), { server: true }));
      });

      it('server-only — a member CANNOT update (no client tampering)', async () => {
        await seed(coll);
        await assertFails(updateDoc(refFor(authed(TENANT, 'supervisor'), TENANT, coll), { tampered: true }));
      });

      it('server-only — a member CANNOT delete', async () => {
        await seed(coll);
        await assertFails(deleteDoc(refFor(authed(TENANT, 'admin'), TENANT, coll)));
      });
    });
  }

  // photo_evidence — PII → supervisor-tier read (NOT member-wide). A plain
  // worker must NOT read another project's incident photos.
  describe('photo_evidence (supervisor-read, PII)', () => {
    const C = 'photo_evidence';
    it('supervisor-read — a tenant supervisor CAN read', async () => {
      await seed(C);
      await assertSucceeds(getDoc(refFor(authed(TENANT, 'supervisor'), TENANT, C)));
    });
    it('worker-read DENY — a plain tenant worker CANNOT read PII evidence', async () => {
      await seed(C);
      await assertFails(getDoc(refFor(authed(TENANT, 'worker'), TENANT, C)));
    });
    it('cross-tenant deny — a supervisor of ANOTHER tenant CANNOT read', async () => {
      await seed(C);
      await assertFails(getDoc(refFor(authed(OTHER_TENANT, 'supervisor'), TENANT, C)));
    });
    it('server-only — even a supervisor/admin CANNOT create/update/delete', async () => {
      await seed(C);
      await assertFails(setDoc(refFor(authed(TENANT, 'supervisor'), TENANT, C), { server: true }));
      await assertFails(updateDoc(refFor(authed(TENANT, 'supervisor'), TENANT, C), { tampered: true }));
      await assertFails(deleteDoc(refFor(authed(TENANT, 'admin'), TENANT, C)));
    });
  });
});
