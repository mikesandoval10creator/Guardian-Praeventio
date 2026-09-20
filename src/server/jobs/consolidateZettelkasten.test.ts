import { describe, expect, it, vi } from 'vitest';

import { consolidateZettelkasten } from './consolidateZettelkasten';

interface FakeDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: { delete: ReturnType<typeof vi.fn> };
}

function makeFakeDoc(id: string, data: Record<string, unknown>): FakeDoc {
  return {
    id,
    data: () => data,
    ref: { delete: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeFakeDb(opts: {
  legacyNodes: FakeDoc[];
  topLevel: FakeDoc[];
  targetExists?: boolean;
}) {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const targetRef = {
    get: vi.fn().mockResolvedValue({ exists: !!opts.targetExists, data: () => ({}) }),
    set: setSpy,
  };
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === 'nodes') {
      return {
        limit: () => ({ get: () => Promise.resolve({ docs: opts.legacyNodes, size: opts.legacyNodes.length }) }),
      };
    }
    if (name === 'zettelkasten_nodes') {
      return {
        limit: () => ({ get: () => Promise.resolve({ docs: opts.topLevel, size: opts.topLevel.length }) }),
      };
    }
    if (name.startsWith('tenants/')) {
      return { doc: () => targetRef };
    }
    return { doc: () => targetRef };
  });
  return { db: { collection } as never, setSpy, targetRef };
}

describe('consolidateZettelkasten', () => {
  it('defaults to dry-run mode and writes nothing', async () => {
    const { db, setSpy } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { tenantId: 'tA', idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    const report = await consolidateZettelkasten({ db });
    expect(report.mode).toBe('dry-run');
    expect(report.consolidated).toBe(1);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('writes to canonical path in commit mode', async () => {
    const { db, setSpy, targetRef } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { tenantId: 'tA', idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    const report = await consolidateZettelkasten({ db, mode: 'commit', confirmMigration: true });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(report.consolidated).toBe(1);
    expect(targetRef.set).toHaveBeenCalled();
  });

  it('skips docs without a tenantId and no resolver', async () => {
    const { db } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    const report = await consolidateZettelkasten({ db, mode: 'commit', confirmMigration: true });
    expect(report.skippedNoTenant).toBe(1);
    expect(report.consolidated).toBe(0);
  });

  it('uses the resolver to back-fill missing tenantId', async () => {
    const resolver = vi.fn().mockResolvedValue('tInferred');
    const { db, setSpy } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    const report = await consolidateZettelkasten({ db, mode: 'commit', confirmMigration: true, resolveTenantId: resolver });
    expect(resolver).toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalled();
    expect(report.consolidated).toBe(1);
  });

  it('reports per-doc errors without stopping the run', async () => {
    const fail = makeFakeDoc('bad', { tenantId: 'tA' });
    fail.ref.delete = vi.fn().mockRejectedValue(new Error('boom'));
    const ok = makeFakeDoc('good', { tenantId: 'tA', idempotencyKey: 'k2', title: 'Y' });
    const { db } = makeFakeDb({ legacyNodes: [fail, ok], topLevel: [] });
    const report = await consolidateZettelkasten({ db, mode: 'commit', confirmMigration: true });
    expect(report.errors.length).toBeGreaterThanOrEqual(1);
    // The "good" doc still consolidates.
    expect(report.consolidated).toBeGreaterThanOrEqual(1);
  });

  // [Hy3-audit] Adversarial probes — confirmMigration safety net.
  it('rejects commit mode without confirmMigration (throws ConsolidationGuardError, no deletion)', async () => {
    const { db, targetRef, setSpy } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { tenantId: 'tA', idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    await expect(
      consolidateZettelkasten({ db, mode: 'commit' }),
    ).rejects.toThrow(/confirmMigration=true/);
    // CRITICAL: NO write and NO delete must happen when the guard fires.
    expect(setSpy).not.toHaveBeenCalled();
    expect(targetRef.set).not.toHaveBeenCalled();
  });

  it('rejects commit mode when confirmMigration is explicitly false', async () => {
    const { db } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { tenantId: 'tA', idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    await expect(
      consolidateZettelkasten({ db, mode: 'commit', confirmMigration: false }),
    ).rejects.toThrow(/confirmMigration=true/);
  });

  it('dry-run mode NEVER requires confirmMigration (safe to call freely)', async () => {
    const { db, setSpy } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { tenantId: 'tA', idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    // No confirmMigration flag, mode dry-run (default). Should NOT throw.
    const report = await consolidateZettelkasten({ db });
    expect(report.mode).toBe('dry-run');
    expect(setSpy).not.toHaveBeenCalled(); // dry-run never writes
  });

  it('commit WITH confirmMigration=true proceeds (legacy happy path)', async () => {
    const { db, setSpy, targetRef } = makeFakeDb({
      legacyNodes: [makeFakeDoc('n1', { tenantId: 'tA', idempotencyKey: 'k1', title: 'X' })],
      topLevel: [],
    });
    const report = await consolidateZettelkasten({ db, mode: 'commit', confirmMigration: true });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(targetRef.set).toHaveBeenCalled();
    expect(report.consolidated).toBe(1);
  });
});
