// Tests para scratch calculations storage (Regla #3).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveScratchCalculation,
  listScratchCalculations,
  promoteScratchToProject,
  promoteAllScratchToProject,
  deleteScratchCalculation,
} from './scratchCalculations';
import type { RiskNodePayload } from '../zettelkasten/types';

function makePayload(overrides: Partial<RiskNodePayload> = {}): RiskNodePayload {
  return {
    title: 'Scaffold uplift test',
    description: 'F = 1234 N',
    type: 'scaffold-uplift',
    severity: 'high',
    metadata: { forceN: 1234 },
    connections: ['surface:test'],
    references: ['NCh432'],
    ...overrides,
  } as RiskNodePayload;
}

describe('scratchCalculations', () => {
  beforeEach(async () => {
    // Limpiar IndexedDB entre tests
    const { clear } = await import('idb-keyval');
    await clear();
  });

  it('save + list devuelve el cálculo persistido', async () => {
    const entry = await saveScratchCalculation(makePayload(), 'user-1');
    expect(entry.id).toMatch(/^[0-9a-f]+$/);
    expect(entry.userUid).toBe('user-1');
    const list = await listScratchCalculations('user-1');
    expect(list).toHaveLength(1);
    expect(list[0].node.title).toBe('Scaffold uplift test');
  });

  it('IDs determinísticos: mismo payload → mismo id (no duplica)', async () => {
    const a = await saveScratchCalculation(makePayload({ metadata: { forceN: 100 } }), 'u');
    const b = await saveScratchCalculation(makePayload({ metadata: { forceN: 100 } }), 'u');
    expect(a.id).toBe(b.id);
    const list = await listScratchCalculations('u');
    expect(list).toHaveLength(1);
  });

  it('payloads distintos → ids distintos', async () => {
    await saveScratchCalculation(makePayload({ metadata: { forceN: 100 } }), 'u');
    await saveScratchCalculation(makePayload({ metadata: { forceN: 200 } }), 'u');
    const list = await listScratchCalculations('u');
    expect(list).toHaveLength(2);
  });

  it('namespacing por usuario: user A no ve scratch de user B', async () => {
    await saveScratchCalculation(makePayload(), 'user-A');
    await saveScratchCalculation(makePayload(), 'user-B');
    const listA = await listScratchCalculations('user-A');
    const listB = await listScratchCalculations('user-B');
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
  });

  it('anonymous bucket separado de users logged-in', async () => {
    await saveScratchCalculation(makePayload(), null);
    await saveScratchCalculation(makePayload(), 'u');
    const anon = await listScratchCalculations(null);
    const u = await listScratchCalculations('u');
    expect(anon).toHaveLength(1);
    expect(u).toHaveLength(1);
  });

  it('promoteScratchToProject marca como promovido + devuelve payload', async () => {
    const entry = await saveScratchCalculation(makePayload(), 'u');
    const payload = await promoteScratchToProject(entry.id, 'u', 'proj-1');
    expect(payload).not.toBeNull();
    expect(payload?.title).toBe('Scaffold uplift test');
    // Después de promover, no aparece en list (filtrado por !promotedToProjectId)
    const list = await listScratchCalculations('u');
    expect(list).toHaveLength(0);
  });

  it('promoteAll promueve todos los pendientes y devuelve payloads', async () => {
    await saveScratchCalculation(makePayload({ metadata: { forceN: 100 } }), 'u');
    await saveScratchCalculation(makePayload({ metadata: { forceN: 200 } }), 'u');
    await saveScratchCalculation(makePayload({ metadata: { forceN: 300 } }), 'u');
    const promoted = await promoteAllScratchToProject('u', 'proj-X');
    expect(promoted).toHaveLength(3);
    const remaining = await listScratchCalculations('u');
    expect(remaining).toHaveLength(0);
  });

  it('promote sobre id inexistente devuelve null', async () => {
    const result = await promoteScratchToProject('nonexistent', 'u', 'proj-1');
    expect(result).toBeNull();
  });

  it('delete remueve la entrada', async () => {
    const entry = await saveScratchCalculation(makePayload(), 'u');
    await deleteScratchCalculation(entry.id, 'u');
    const list = await listScratchCalculations('u');
    expect(list).toHaveLength(0);
  });

  it('list ordenado por createdAt descendente (más reciente primero)', async () => {
    // No usamos fake timers (interfieren con idb-keyval async); usamos
    // delays reales mínimos para garantizar createdAt distinto.
    await saveScratchCalculation(makePayload({ metadata: { forceN: 1 } }), 'u');
    await new Promise((r) => setTimeout(r, 5));
    await saveScratchCalculation(makePayload({ metadata: { forceN: 2 } }), 'u');
    await new Promise((r) => setTimeout(r, 5));
    await saveScratchCalculation(makePayload({ metadata: { forceN: 3 } }), 'u');
    const list = await listScratchCalculations('u');
    expect(list).toHaveLength(3);
    expect(list[0].node.metadata.forceN).toBe(3);
    expect(list[2].node.metadata.forceN).toBe(1);
  });
});
