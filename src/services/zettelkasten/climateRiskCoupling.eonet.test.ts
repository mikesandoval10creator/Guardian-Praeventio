// Sprint 39 J3a — climateRiskCoupling EONET integration tests.
//
// Reglas del usuario verificadas:
//  - Recomendación construida pasa por buildCalmRecommendation → assertCalm.
//  - Cuerpo NUNCA menciona NASA/USGS/EONET.
//  - Falla del adapter → graceful degradation (riskScore == baseline, sin
//    recomendación) sin propagar excepción.

import { describe, it, expect, vi } from 'vitest';
import {
  assessClimateRiskWithExternalEvents,
  filterEventsByProximity,
} from './climateRiskCoupling';
import type { BBox, EonetEvent } from '../external/eonet/types';

const FORBIDDEN_BODY_PATTERNS = [
  /NASA/i,
  /USGS/i,
  /EONET/i,
  /Earth Observatory/i,
];

function bboxAroundSantiago(): BBox {
  // ~Santiago de Chile center
  return {
    lonMin: -71,
    lonMax: -70,
    latMin: -34,
    latMax: -33,
  };
}

function wildfireNearSantiago(): EonetEvent {
  return {
    id: 'EONET_WF_1',
    title: 'Wildfire',
    description: null,
    link: undefined,
    closed: null,
    categories: [{ id: 'wildfires', title: 'Wildfires' }],
    sources: [],
    geometry: [
      { date: '2026-05-01T00:00:00Z', type: 'Point', coordinates: [-70.5, -33.5] },
    ],
  };
}

describe('filterEventsByProximity', () => {
  it('keeps event with point inside bbox center radius', () => {
    const out = filterEventsByProximity(
      [wildfireNearSantiago()],
      bboxAroundSantiago(),
      50,
    );
    expect(out).toHaveLength(1);
  });

  it('drops event whose only geometry is far away', () => {
    const far: EonetEvent = {
      ...wildfireNearSantiago(),
      id: 'EONET_FAR',
      geometry: [
        { date: '2026-05-01T00:00:00Z', type: 'Point', coordinates: [10, 50] },
      ],
    };
    const out = filterEventsByProximity([far], bboxAroundSantiago(), 50);
    expect(out).toHaveLength(0);
  });
});

describe('assessClimateRiskWithExternalEvents', () => {
  it('1) wildfire in bbox => riskScore multiplied (>baseline) + calm recommendation', async () => {
    const fetchEvents = vi.fn().mockResolvedValue([wildfireNearSantiago()]);
    const result = await assessClimateRiskWithExternalEvents({
      baselineScore: 1.0,
      projectBbox: bboxAroundSantiago(),
      deps: { eonetAdapter: { fetchEvents } },
    });
    expect(fetchEvents).toHaveBeenCalledOnce();
    expect(result.externalEvents).toHaveLength(1);
    expect(result.riskScore).toBeGreaterThan(result.baselineScore);
    expect(result.riskScore).toBeCloseTo(1.3, 5);
    // Recomendación tranquila — pasó por assertCalm internamente.
    expect(result.recommendation).not.toBeNull();
    expect(result.recommendation!.blockOperation).toBe(false);
    for (const re of FORBIDDEN_BODY_PATTERNS) {
      expect(result.recommendation!.body).not.toMatch(re);
      expect(result.recommendation!.title).not.toMatch(re);
    }
  });

  it('2) no events in bbox => riskScore equals baseline + null recommendation', async () => {
    const fetchEvents = vi.fn().mockResolvedValue([]);
    const result = await assessClimateRiskWithExternalEvents({
      baselineScore: 1.0,
      projectBbox: bboxAroundSantiago(),
      deps: { eonetAdapter: { fetchEvents } },
    });
    expect(result.externalEvents).toHaveLength(0);
    expect(result.riskScore).toBe(1.0);
    expect(result.recommendation).toBeNull();
  });

  it('3) EONET fetch failure => graceful degradation (no throw, baseline preserved)', async () => {
    const fetchEvents = vi
      .fn()
      .mockRejectedValue(new Error('upstream 500'));
    const result = await assessClimateRiskWithExternalEvents({
      baselineScore: 1.0,
      projectBbox: bboxAroundSantiago(),
      deps: { eonetAdapter: { fetchEvents } },
    });
    expect(result.externalEvents).toHaveLength(0);
    expect(result.riskScore).toBe(1.0);
    expect(result.recommendation).toBeNull();
  });
});
