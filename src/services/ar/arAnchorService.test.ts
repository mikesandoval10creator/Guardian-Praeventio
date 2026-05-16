import { describe, it, expect } from 'vitest';
import {
  distanceM,
  filterAnchors,
  findProximityPairs,
  isValidMatrix,
  matrixFromPosition,
  newAnchorId,
  positionFromMatrix,
  type MachineryAnchor,
  type WarehouseObjectAnchor,
  type ArAnchor,
} from './arAnchorService.js';

function makeMachinery(over: Partial<MachineryAnchor> & { id: string }): MachineryAnchor {
  return {
    id: over.id,
    kind: 'machinery',
    projectId: over.projectId ?? 'p1',
    tenantId: over.tenantId ?? 't1',
    createdByUid: over.createdByUid ?? 'u1',
    createdAt: over.createdAt ?? '2026-05-16T00:00:00Z',
    updatedAt: over.updatedAt ?? '2026-05-16T00:00:00Z',
    gps: over.gps ?? { latitude: -33.45, longitude: -70.66 },
    matrix: over.matrix ?? matrixFromPosition(0, 0, 0),
    label: over.label ?? 'Grúa Horquilla A',
    equipmentId: over.equipmentId ?? 'eq-1',
    info: over.info ?? { code: 'GRH-001' },
    tags: over.tags,
  };
}

function makeWarehouseObj(
  over: Partial<WarehouseObjectAnchor> & { id: string; objectType?: WarehouseObjectAnchor['objectType'] },
): WarehouseObjectAnchor {
  return {
    id: over.id,
    kind: 'warehouse_object',
    projectId: over.projectId ?? 'p1',
    tenantId: over.tenantId ?? 't1',
    createdByUid: over.createdByUid ?? 'u1',
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    gps: over.gps ?? { latitude: -33.45, longitude: -70.66 },
    matrix: over.matrix ?? matrixFromPosition(0, 0, 0),
    label: over.label ?? 'Extintor PQS',
    objectType: over.objectType ?? 'extinguisher_pqs',
    status: over.status ?? 'planned',
    tags: over.tags,
  };
}

describe('matrixFromPosition / positionFromMatrix', () => {
  it('roundtrip preserva la posición', () => {
    const m = matrixFromPosition(1.5, -2.0, 3.25);
    const p = positionFromMatrix(m);
    expect(p.x).toBe(1.5);
    expect(p.y).toBe(-2.0);
    expect(p.z).toBe(3.25);
  });

  it('identidad + posición tiene 16 elementos', () => {
    const m = matrixFromPosition(0, 0, 0);
    expect(m.length).toBe(16);
    // Diagonal principal = 1
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
  });
});

describe('isValidMatrix', () => {
  it('matriz válida con 16 numbers finitos → true', () => {
    expect(isValidMatrix(matrixFromPosition(1, 2, 3))).toBe(true);
  });

  it('no-array → false', () => {
    expect(isValidMatrix('not an array')).toBe(false);
    expect(isValidMatrix(null)).toBe(false);
  });

  it('array con length distinto a 16 → false', () => {
    expect(isValidMatrix([1, 2, 3])).toBe(false);
  });

  it('contiene NaN → false', () => {
    const bad = matrixFromPosition(1, 2, 3).slice() as number[];
    bad[5] = Number.NaN;
    expect(isValidMatrix(bad)).toBe(false);
  });

  it('contiene Infinity → false', () => {
    const bad = matrixFromPosition(1, 2, 3).slice() as number[];
    bad[10] = Number.POSITIVE_INFINITY;
    expect(isValidMatrix(bad)).toBe(false);
  });
});

describe('distanceM', () => {
  it('mismo punto → 0', () => {
    const a = makeMachinery({ id: 'a', matrix: matrixFromPosition(0, 0, 0) });
    const b = makeMachinery({ id: 'b', matrix: matrixFromPosition(0, 0, 0) });
    expect(distanceM(a, b)).toBe(0);
  });

  it('axis-aligned 3-4-5 triangle', () => {
    const a = makeMachinery({ id: 'a', matrix: matrixFromPosition(0, 0, 0) });
    const b = makeMachinery({ id: 'b', matrix: matrixFromPosition(3, 4, 0) });
    expect(distanceM(a, b)).toBe(5);
  });

  it('3D distance funciona en los 3 ejes', () => {
    const a = makeMachinery({ id: 'a', matrix: matrixFromPosition(1, 2, 3) });
    const b = makeMachinery({ id: 'b', matrix: matrixFromPosition(4, 6, 3) });
    expect(distanceM(a, b)).toBe(5); // 3-4-5
  });
});

describe('newAnchorId', () => {
  it('contiene kind como prefijo', () => {
    expect(newAnchorId('machinery')).toMatch(/^ar-machinery-/);
    expect(newAnchorId('warehouse_object')).toMatch(/^ar-warehouse_object-/);
    expect(newAnchorId('poster')).toMatch(/^ar-poster-/);
  });

  it('genera IDs distintos en llamadas consecutivas', () => {
    const a = newAnchorId('machinery');
    const b = newAnchorId('machinery');
    expect(a).not.toBe(b);
  });
});

describe('filterAnchors', () => {
  const a1 = makeMachinery({ id: 'a1', projectId: 'p1' });
  const a2 = makeMachinery({ id: 'a2', projectId: 'p2' });
  const a3 = makeWarehouseObj({ id: 'a3', projectId: 'p1', tags: ['emergencia', 'visible'] });
  const a4 = makeWarehouseObj({ id: 'a4', projectId: 'p1', tags: ['emergencia'] });
  const all: ArAnchor[] = [a1, a2, a3, a4];

  it('filtra por projectId', () => {
    const r = filterAnchors(all, { projectId: 'p1' });
    expect(r.map((a) => a.id).sort()).toEqual(['a1', 'a3', 'a4']);
  });

  it('filtra por kind', () => {
    const r = filterAnchors(all, { projectId: 'p1', kind: 'warehouse_object' });
    expect(r.map((a) => a.id).sort()).toEqual(['a3', 'a4']);
  });

  it('filtra por tags (AND, todos deben matchear)', () => {
    const r = filterAnchors(all, { projectId: 'p1', tags: ['emergencia', 'visible'] });
    expect(r.map((a) => a.id)).toEqual(['a3']);
  });

  it('tags vacío equivale a no-filtro', () => {
    const r = filterAnchors(all, { projectId: 'p1', tags: [] });
    expect(r.length).toBe(3);
  });

  it('projectId que no existe → []', () => {
    const r = filterAnchors(all, { projectId: 'p999' });
    expect(r).toEqual([]);
  });
});

describe('findProximityPairs', () => {
  it('warehouse objects dentro del threshold → pair', () => {
    const a = makeWarehouseObj({
      id: 'a',
      objectType: 'extinguisher_co2',
      matrix: matrixFromPosition(0, 0, 0),
    });
    const b = makeWarehouseObj({
      id: 'b',
      objectType: 'evacuation_route',
      matrix: matrixFromPosition(0, 0, 1.5), // 1.5m de distancia
    });
    const pairs = findProximityPairs([a, b], 2);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.distanceM).toBe(1.5);
  });

  it('objects fuera del threshold → vacío', () => {
    const a = makeWarehouseObj({ id: 'a', matrix: matrixFromPosition(0, 0, 0) });
    const b = makeWarehouseObj({ id: 'b', matrix: matrixFromPosition(0, 0, 10) });
    const pairs = findProximityPairs([a, b], 2);
    expect(pairs).toEqual([]);
  });

  it('multiple pairs en cluster — todos detectados', () => {
    const a = makeWarehouseObj({ id: 'a', matrix: matrixFromPosition(0, 0, 0) });
    const b = makeWarehouseObj({ id: 'b', matrix: matrixFromPosition(1, 0, 0) });
    const c = makeWarehouseObj({ id: 'c', matrix: matrixFromPosition(0, 1, 0) });
    const pairs = findProximityPairs([a, b, c], 2);
    // 3 combinaciones: ab, ac, bc
    expect(pairs.length).toBe(3);
  });
});
