// Praeventio Guard — Sprint 24 differentiators (Bucket MM) tests.
//
// Vitest harness for `registry.ts`. Verifies:
//   1. applyMigrations upgrades a v0 legacy node (no schemaVersion) to current.
//   2. applyMigrations is idempotent — calling twice is a no-op.
//   3. Backward migration (down) for v1 strips schemaVersion.
//   4. Forward gap returns node unchanged (does not throw).
//   5. needsUpgrade reports correctly for outdated and current nodes.
//   6. Per-migration: tags string normalization (v3) splits comma list.
//   7. Per-migration: connections defaulting (v4) tolerates missing field.

import { describe, it, expect } from 'vitest';
import {
  applyMigrations,
  CURRENT_RISK_NODE_VERSION,
  getCurrentVersion,
  needsUpgrade,
  RISK_NODE_MIGRATIONS,
} from './registry';

describe('migration registry', () => {
  it('upgrades a legacy v0 node to current schema version', () => {
    const legacy = {
      id: 'n1',
      type: 'Riesgo',
      title: 'Legacy node',
      description: 'old',
      tags: ['Crítico'],
      metadata: {},
      connections: ['n2'],
    };
    const upgraded = applyMigrations(legacy);
    expect(upgraded.schemaVersion).toBe(CURRENT_RISK_NODE_VERSION);
    expect(upgraded.metadata.geo).toBeNull();
    expect(upgraded.tags).toEqual(['Crítico']);
    expect(upgraded.connections).toEqual(['n2']);
  });

  it('is idempotent — applying twice yields the same node', () => {
    const node = { id: 'n1', tags: [], metadata: {}, connections: [] };
    const once = applyMigrations(node);
    const twice = applyMigrations(once);
    expect(twice).toEqual(once);
  });

  it('walks backward via down() to strip schemaVersion at v1', () => {
    const node = { id: 'n1', schemaVersion: 1, tags: [], metadata: {}, connections: [] };
    const down = applyMigrations(node, 1, 0);
    expect(down.schemaVersion).toBeUndefined();
  });

  it('returns node unchanged when target version is beyond known migrations (forward gap)', () => {
    const node = { id: 'n1', schemaVersion: 1, tags: [], metadata: {}, connections: [] };
    const tooFar = CURRENT_RISK_NODE_VERSION + 10;
    const result = applyMigrations(node, 1, tooFar);
    // Should walk as far as it can without throwing — last known version applied.
    expect(result.schemaVersion).toBe(CURRENT_RISK_NODE_VERSION);
  });

  it('needsUpgrade reflects whether a node lags current version', () => {
    expect(needsUpgrade({ schemaVersion: 0 })).toBe(true);
    expect(needsUpgrade({ schemaVersion: CURRENT_RISK_NODE_VERSION })).toBe(false);
    expect(needsUpgrade({})).toBe(true); // no schemaVersion → treated as 0
    expect(getCurrentVersion()).toBe(CURRENT_RISK_NODE_VERSION);
  });

  it('v3 normalizes a comma-joined tags string into an array', () => {
    const node = {
      id: 'n1',
      schemaVersion: 2,
      tags: 'Crítico, Alto, Mecánico',
      metadata: { geo: null },
      connections: [],
    };
    const upgraded = applyMigrations(node, 2, 3);
    expect(upgraded.tags).toEqual(['Crítico', 'Alto', 'Mecánico']);
  });

  it('v4 defaults missing or non-array connections to []', () => {
    const node = {
      id: 'n1',
      schemaVersion: 3,
      tags: [],
      metadata: { geo: null },
      // connections intentionally missing
    } as any;
    const upgraded = applyMigrations(node, 3, 4);
    expect(upgraded.connections).toEqual([]);
    expect(upgraded.schemaVersion).toBe(4);
  });

  it('registry is dense (no version gaps)', () => {
    const versions = RISK_NODE_MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    for (let i = 0; i < versions.length; i++) {
      expect(versions[i]).toBe(i + 1);
    }
  });
});
