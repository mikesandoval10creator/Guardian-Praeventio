import { describe, it, expect } from 'vitest';
import {
  buildHeatmapCells,
  pickHotspots,
  bboxOf,
  SEVERITY_WEIGHT,
  type FindingPoint,
  type Severity,
} from './findingsHeatmapBuilder.js';

function fp(over: Partial<FindingPoint> & { id: string; lat: number; lng: number }): FindingPoint {
  return {
    severity: 'low',
    occurredAt: '2026-05-12T10:00:00Z',
    category: 'general',
    ...over,
  };
}

describe('findingsHeatmapBuilder.buildHeatmapCells', () => {
  it('empty points → empty cells', () => {
    expect(buildHeatmapCells([], { gridSizeM: 50 })).toEqual([]);
  });

  it('throws when gridSizeM <= 0', () => {
    expect(() => buildHeatmapCells([fp({ id: 'a', lat: 0, lng: 0 })], { gridSizeM: 0 })).toThrow();
  });

  it('agrupa puntos cercanos en una misma celda', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'medium' }),
        fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'medium' }),
        fp({ id: 'c', lat: -33.4500002, lng: -70.6500003, severity: 'medium' }),
      ],
      { gridSizeM: 50 },
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(3);
    expect(cells[0].weight).toBe(3 * SEVERITY_WEIGHT.medium);
  });

  it('separa puntos lejanos en celdas distintas', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'low' }),
        fp({ id: 'b', lat: -33.46, lng: -70.66, severity: 'low' }), // ~1.2 km
      ],
      { gridSizeM: 50 },
    );
    expect(cells).toHaveLength(2);
  });

  it('severity dominante por mayoría', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'low' }),
        fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'high' }),
        fp({ id: 'c', lat: -33.4500002, lng: -70.6500002, severity: 'high' }),
      ],
      { gridSizeM: 50 },
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].dominantSeverity).toBe('high');
  });

  it('en empate de conteo, elige la severidad más alta', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'low' }),
        fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'critical' }),
      ],
      { gridSizeM: 50 },
    );
    expect(cells[0].dominantSeverity).toBe('critical');
  });

  it('weight escala con severidad', () => {
    const lowCells = buildHeatmapCells(
      [fp({ id: 'a', lat: 0, lng: 0, severity: 'low' })],
      { gridSizeM: 50 },
    );
    const criticalCells = buildHeatmapCells(
      [fp({ id: 'a', lat: 0, lng: 0, severity: 'critical' })],
      { gridSizeM: 50 },
    );
    expect(criticalCells[0].weight).toBeGreaterThan(lowCells[0].weight);
    expect(lowCells[0].weight).toBe(SEVERITY_WEIGHT.low);
    expect(criticalCells[0].weight).toBe(SEVERITY_WEIGHT.critical);
  });

  it('minCount filtra celdas con menos de N findings', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65 }),
        fp({ id: 'b', lat: -33.46, lng: -70.66 }), // lejos, queda solo
        fp({ id: 'c', lat: -33.4500001, lng: -70.6500001 }),
      ],
      { gridSizeM: 50, minCount: 2 },
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(2);
  });

  it('ordena cells por weight desc', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'low' }),
        fp({ id: 'b', lat: -33.46, lng: -70.66, severity: 'critical' }),
        fp({ id: 'c', lat: -33.4600001, lng: -70.6600001, severity: 'critical' }),
      ],
      { gridSizeM: 50 },
    );
    expect(cells[0].weight).toBeGreaterThanOrEqual(cells[cells.length - 1].weight);
    expect(cells[0].dominantSeverity).toBe('critical');
  });

  it('determinístico: misma entrada → misma salida', () => {
    const input: FindingPoint[] = [
      fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'medium' }),
      fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'high' }),
      fp({ id: 'c', lat: -33.46, lng: -70.66, severity: 'low' }),
    ];
    const a = buildHeatmapCells(input, { gridSizeM: 50 });
    const b = buildHeatmapCells(input, { gridSizeM: 50 });
    expect(a).toEqual(b);
  });

  it('cell center cae dentro o cerca del bbox de los puntos', () => {
    const cells = buildHeatmapCells(
      [
        fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'low' }),
        fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'low' }),
      ],
      { gridSizeM: 50 },
    );
    expect(cells[0].lat).toBeCloseTo(-33.45, 2);
    expect(cells[0].lng).toBeCloseTo(-70.65, 2);
  });
});

describe('findingsHeatmapBuilder.pickHotspots', () => {
  it('topN=0 → vacío', () => {
    const cells = buildHeatmapCells(
      [fp({ id: 'a', lat: 0, lng: 0, severity: 'high' })],
      { gridSizeM: 50 },
    );
    expect(pickHotspots(cells, 0)).toEqual([]);
  });

  it('topN limita resultados ordenados por weight', () => {
    const sevList: Severity[] = ['low', 'medium', 'high', 'critical'];
    const findings = sevList.map((s, i) =>
      fp({ id: `p${i}`, lat: -33.45 + i * 0.01, lng: -70.65 + i * 0.01, severity: s }),
    );
    const cells = buildHeatmapCells(findings, { gridSizeM: 50 });
    const top2 = pickHotspots(cells, 2);
    expect(top2).toHaveLength(2);
    expect(top2[0].weight).toBeGreaterThanOrEqual(top2[1].weight);
    expect(top2[0].dominantSeverity).toBe('critical');
  });
});

describe('findingsHeatmapBuilder.bboxOf', () => {
  it('empty → null', () => {
    expect(bboxOf([])).toBeNull();
  });

  it('calcula min/max de lat/lng', () => {
    const bb = bboxOf([
      { lat: -33.45, lng: -70.65 },
      { lat: -33.46, lng: -70.64 },
      { lat: -33.44, lng: -70.66 },
    ]);
    expect(bb).toEqual({ minLat: -33.46, maxLat: -33.44, minLng: -70.66, maxLng: -70.64 });
  });

  it('un solo punto → bbox degenerado', () => {
    const bb = bboxOf([{ lat: 1, lng: 2 }]);
    expect(bb).toEqual({ minLat: 1, maxLat: 1, minLng: 2, maxLng: 2 });
  });
});
