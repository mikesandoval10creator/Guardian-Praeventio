// M-1 Phase 2 — unit tests for the PURE planners of
// scripts/backfill-project-tenantid.cjs (the CLI/Firestore side runs only
// against production credentials and is exercised by its dry-run mode).
//
// Contract pinned here (founder decision 2026-07-02 + design doc §4):
//   • tenantId = createdBy, NEVER guessed when createdBy is absent.
//   • claim mint preserves existing custom claims (setCustomUserClaims
//     overwrites wholesale — a bare {tenantId} would drop `role`).
//   • legacy `tenants/{projectId}` namespaces are healed only when the
//     resolved tenant actually differs.

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { planProjectStamps, planClaimUpdate, planTenantDataMoves, resolveBackfillDb } = require_(
  '../../../scripts/backfill-project-tenantid.cjs',
) as {
  planProjectStamps: (
    projects: Array<{ id: string; tenantId?: unknown; createdBy?: unknown }>,
  ) => { stamps: Array<{ id: string; tenantId: string }>; needsReview: string[]; skipped: number };
  planClaimUpdate: (
    uid: string,
    existing: Record<string, unknown> | undefined,
  ) => Record<string, unknown> | null;
  planTenantDataMoves: (
    resolved: Array<{ id: string; tenantId: string }>,
  ) => Array<{ projectId: string; from: string; to: string }>;
  resolveBackfillDb: (
    adminNs: { app: () => unknown; firestore: () => unknown },
    cfg: { firestoreDatabaseId?: unknown },
    emulatorHost: string | undefined,
    getFirestoreImpl?: (app: unknown, dbId: string) => unknown,
  ) => unknown;
};

describe('planProjectStamps', () => {
  it('stamps tenantId = createdBy for docs missing tenantId', () => {
    const { stamps, needsReview, skipped } = planProjectStamps([
      { id: 'p1', createdBy: 'uid-a' },
      { id: 'p2', createdBy: 'uid-b' },
    ]);
    expect(stamps).toEqual([
      { id: 'p1', tenantId: 'uid-a' },
      { id: 'p2', tenantId: 'uid-b' },
    ]);
    expect(needsReview).toEqual([]);
    expect(skipped).toBe(0);
  });

  it('skips docs that already carry a non-empty tenantId (idempotent)', () => {
    const { stamps, skipped } = planProjectStamps([
      { id: 'p1', tenantId: 'uid-a', createdBy: 'uid-a' },
    ]);
    expect(stamps).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('NEVER guesses: docs without createdBy land on needs-review', () => {
    const { stamps, needsReview } = planProjectStamps([
      { id: 'orphan-1' },
      { id: 'orphan-2', createdBy: '' },
    ]);
    expect(stamps).toEqual([]);
    expect(needsReview).toEqual(['orphan-1', 'orphan-2']);
  });

  it('treats a non-string tenantId as missing (stamps it)', () => {
    const { stamps } = planProjectStamps([{ id: 'p1', tenantId: 42, createdBy: 'uid-a' }]);
    expect(stamps).toEqual([{ id: 'p1', tenantId: 'uid-a' }]);
  });
});

describe('planClaimUpdate', () => {
  it('mints tenantId = uid PRESERVING existing claims (role survives)', () => {
    expect(planClaimUpdate('uid-a', { role: 'prevencionista' })).toEqual({
      role: 'prevencionista',
      tenantId: 'uid-a',
    });
  });

  it('returns null (no-op) when the user already has a tenantId claim', () => {
    expect(planClaimUpdate('uid-a', { role: 'admin', tenantId: 't-1' })).toBeNull();
  });

  it('handles users with no claims at all', () => {
    expect(planClaimUpdate('uid-a', undefined)).toEqual({ tenantId: 'uid-a' });
  });
});

describe('planTenantDataMoves', () => {
  it('heals only namespaces where resolved tenant ≠ projectId', () => {
    expect(
      planTenantDataMoves([
        { id: 'p1', tenantId: 'uid-a' }, // legacy fallback wrote tenants/p1 → move
        { id: 'uid-b', tenantId: 'uid-b' }, // tenant == id → nothing to heal
      ]),
    ).toEqual([{ projectId: 'p1', from: 'tenants/p1', to: 'tenants/uid-a' }]);
  });
});

describe('resolveBackfillDb (named-database targeting — the silent-wrong-target guard)', () => {
  // Production Firestore lives in the NAMED database from
  // firebase-applet-config.json (`firestoreDatabaseId`), same rule server.ts
  // applies at boot. A bare `admin.firestore()` scans the empty "(default)"
  // DB and the whole backfill reports "nothing to do" — these tests pin that
  // the script can never regress into that failure mode.
  const cfgNamed = { firestoreDatabaseId: 'ai-studio-test-db' };

  it('selects the NAMED database from the applet config (production path)', () => {
    const getFs = vi.fn(() => 'NAMED_DB');
    const adminNs = { app: () => 'APP', firestore: vi.fn(() => 'DEFAULT_DB') };
    expect(resolveBackfillDb(adminNs, cfgNamed, undefined, getFs)).toBe('NAMED_DB');
    expect(getFs).toHaveBeenCalledWith('APP', 'ai-studio-test-db');
    expect(adminNs.firestore).not.toHaveBeenCalled();
  });

  it('keeps the default handle under the emulator (same exception as server.ts)', () => {
    const getFs = vi.fn(() => 'NAMED_DB');
    const adminNs = { app: () => 'APP', firestore: vi.fn(() => 'DEFAULT_DB') };
    expect(resolveBackfillDb(adminNs, cfgNamed, 'localhost:8080', getFs)).toBe('DEFAULT_DB');
    expect(getFs).not.toHaveBeenCalled();
  });

  it('falls back to the default handle for "(default)" or a missing databaseId', () => {
    const getFs = vi.fn(() => 'NAMED_DB');
    const adminNs = { app: () => 'APP', firestore: vi.fn(() => 'DEFAULT_DB') };
    expect(
      resolveBackfillDb(adminNs, { firestoreDatabaseId: '(default)' }, undefined, getFs),
    ).toBe('DEFAULT_DB');
    expect(resolveBackfillDb(adminNs, {}, undefined, getFs)).toBe('DEFAULT_DB');
    expect(getFs).not.toHaveBeenCalled();
  });
});
