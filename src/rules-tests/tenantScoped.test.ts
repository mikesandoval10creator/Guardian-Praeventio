/**
 * Cross-tenant isolation tests — Fase D.4.
 *
 * Verifies that the tenant-claim helpers in firestore.rules properly
 * isolate /tenants/{tid}/** so that a supervisor of tenant A cannot
 * read tenants/B/** even when carrying a supervisor-tier role.
 *
 * Tested matrix:
 *   1. Single-tenant claim (token.tenantId == 'A') reads tenants/A   ✅
 *   2. Single-tenant claim (token.tenantId == 'A') reads tenants/B   ❌
 *   3. Multi-tenant claim (token.tenants.A = supervisor) reads tenants/A ✅
 *   4. Multi-tenant claim (token.tenants.A = supervisor) reads tenants/B ❌
 *   5. Multi-tenant claim (token.tenants.A = worker) — worker NOT
 *      acceptable on /tenants/{tid}/supervisor_only/** ❌
 *   6. Multi-tenant claim (token.tenants.A = supervisor) on
 *      /tenants/A/supervisor_only/** ✅
 *
 * Emulator dependency: same as firestore.rules.test.ts — auto-skipped
 * when @firebase/rules-unit-testing cannot reach the emulator.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setLogLevel } from 'firebase/firestore';

const PROJECT_ID = 'praeventio-tenant-scoped-test';
const RULES_PATH = resolve(__dirname, '../../firestore.rules');

let testEnv: RulesTestEnvironment | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  setLogLevel('error');
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(RULES_PATH, 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  } catch (err) {
    skipReason = err instanceof Error ? err.message : String(err);
    testEnv = null;
  }
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

function maybeSkip(ctx: { skip: (reason?: string) => void }) {
  if (!testEnv) ctx.skip(skipReason ?? 'firestore-emulator-unavailable');
}

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('Test environment is unavailable.');
  return testEnv;
}

// ────────────────────────────────────────────────────────────────────────
// Seed helpers
// ────────────────────────────────────────────────────────────────────────

async function seedTenant(tenantId: string, payload: Record<string, unknown> = {}) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .collection('tenants')
      .doc(tenantId)
      .set({ id: tenantId, createdAt: new Date().toISOString(), ...payload });
  });
}

async function seedSupervisorOnlyDoc(tenantId: string, docId: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .collection('tenants')
      .doc(tenantId)
      .collection('supervisor_only')
      .doc(docId)
      .set({ briefedAt: new Date().toISOString() });
  });
}

function singleTenantToken(role: string, tenantId: string) {
  return {
    email: `${role}@example.com`,
    email_verified: true,
    role,
    tenantId,
  };
}

function multiTenantToken(role: string, tenants: Record<string, string>) {
  return {
    email: `${role}@example.com`,
    email_verified: true,
    role,
    tenants,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Single-tenant claim
// ────────────────────────────────────────────────────────────────────────

describe('Single-tenant claim (token.tenantId)', () => {
  it('supervisor of tenant A reads tenants/A ✅', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    const sup = env.authenticatedContext(
      'sup-A',
      singleTenantToken('supervisor', 'A'),
    );
    await assertSucceeds(getDoc(doc(sup.firestore(), 'tenants', 'A')));
  });

  it('supervisor of tenant A does NOT read tenants/B ❌', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    await seedTenant('B');
    const sup = env.authenticatedContext(
      'sup-A',
      singleTenantToken('supervisor', 'A'),
    );
    await assertFails(getDoc(doc(sup.firestore(), 'tenants', 'B')));
  });

  it('unauthenticated read is denied ❌', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    const anon = env.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), 'tenants', 'A')));
  });
});

// ────────────────────────────────────────────────────────────────────────
// Multi-tenant claim
// ────────────────────────────────────────────────────────────────────────

describe('Multi-tenant claim (token.tenants map)', () => {
  it('supervisor in tenants.A reads tenants/A ✅', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    const sup = env.authenticatedContext(
      'sup-multi',
      multiTenantToken('supervisor', { A: 'supervisor', B: 'worker' }),
    );
    await assertSucceeds(getDoc(doc(sup.firestore(), 'tenants', 'A')));
  });

  it('supervisor in tenants.A reads tenants/B because worker membership ❌ on supervisor_only', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    await seedTenant('B');
    await seedSupervisorOnlyDoc('B', 'briefing-1');
    const userInBoth = env.authenticatedContext(
      'sup-A-worker-B',
      multiTenantToken('supervisor', { A: 'supervisor', B: 'worker' }),
    );
    // Worker membership lets them READ tenants/B basics (member)…
    await assertSucceeds(getDoc(doc(userInBoth.firestore(), 'tenants', 'B')));
    // …but the supervisor_only path requires supervisor-tier IN that tenant.
    await assertFails(
      getDoc(doc(userInBoth.firestore(), 'tenants', 'B', 'supervisor_only', 'briefing-1')),
    );
  });

  it('NO membership in tenants/X is denied ❌', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('X');
    const outsider = env.authenticatedContext(
      'outsider',
      multiTenantToken('supervisor', { A: 'supervisor' }),
    );
    await assertFails(getDoc(doc(outsider.firestore(), 'tenants', 'X')));
  });

  it('supervisor in tenants.A reads /tenants/A/supervisor_only/* ✅', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    await seedSupervisorOnlyDoc('A', 'briefing-1');
    const sup = env.authenticatedContext(
      'sup-A',
      multiTenantToken('supervisor', { A: 'supervisor' }),
    );
    await assertSucceeds(
      getDoc(doc(sup.firestore(), 'tenants', 'A', 'supervisor_only', 'briefing-1')),
    );
  });

  it('supervisor in tenants.A canNOT read /tenants/B/supervisor_only/* ❌', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('B');
    await seedSupervisorOnlyDoc('B', 'briefing-1');
    const sup = env.authenticatedContext(
      'sup-A',
      multiTenantToken('supervisor', { A: 'supervisor' }),
    );
    await assertFails(
      getDoc(doc(sup.firestore(), 'tenants', 'B', 'supervisor_only', 'briefing-1')),
    );
  });

  it('worker globally + supervisor in tenants.A CAN read /tenants/A/supervisor_only/* ✅', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('A');
    await seedSupervisorOnlyDoc('A', 'briefing-2');
    // Global role = worker, pero tenants.A.role = supervisor → debe pasar.
    const user = env.authenticatedContext(
      'worker-but-supA',
      multiTenantToken('worker', { A: 'supervisor' }),
    );
    await assertSucceeds(
      getDoc(doc(user.firestore(), 'tenants', 'A', 'supervisor_only', 'briefing-2')),
    );
  });

  it('global supervisor but tenants.B = worker NO accede a supervisor_only de B ❌', async (ctx) => {
    maybeSkip(ctx);
    const env = requireEnv();
    await seedTenant('B');
    await seedSupervisorOnlyDoc('B', 'briefing-3');
    const user = env.authenticatedContext(
      'sup-global',
      multiTenantToken('supervisor', { B: 'worker' }),
    );
    await assertFails(
      getDoc(doc(user.firestore(), 'tenants', 'B', 'supervisor_only', 'briefing-3')),
    );
  });
});
