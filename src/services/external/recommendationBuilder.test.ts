import { describe, it, expect } from 'vitest';
import { buildCalmRecommendation } from './recommendationBuilder.js';
import type { EonetEvent } from './eonet/types.js';
import type { UsgsEarthquake } from './usgs/types.js';

const FORBIDDEN_BODY_PATTERNS = [
  /NASA/i,
  /USGS/i,
  /EONET/i,
  /Earth Observatory/i,
  /EVACUAR/,
  /INMEDIATAMENTE/,
];

function eonetWildfire(): EonetEvent {
  return {
    id: 'EONET_42',
    title: 'Wildfire X',
    description: null,
    link: 'https://example.test/42',
    closed: null,
    categories: [{ id: 'wildfires', title: 'Wildfires' }],
    sources: [],
    geometry: [{ date: '2026-01-01T00:00:00Z', type: 'Point', coordinates: [-70, -33] }],
  };
}

function usgsM5(): UsgsEarthquake {
  return {
    type: 'Feature',
    id: 'usgs_eq_42',
    properties: {
      mag: 5.0,
      place: 'Test',
      time: 1_700_000_000_000,
    },
    geometry: { type: 'Point', coordinates: [-70, -33, 10] },
  };
}

describe('buildCalmRecommendation', () => {
  it('builds calm recommendation from EONET wildfire — body NEVER mentions NASA', () => {
    const rec = buildCalmRecommendation(eonetWildfire());
    expect(rec.title).toBeTruthy();
    expect(rec.body).toBeTruthy();
    for (const re of FORBIDDEN_BODY_PATTERNS) {
      expect(rec.body).not.toMatch(re);
      expect(rec.title).not.toMatch(re);
    }
  });

  it('builds calm recommendation from USGS earthquake — body NEVER mentions USGS', () => {
    const rec = buildCalmRecommendation(usgsM5());
    for (const re of FORBIDDEN_BODY_PATTERNS) {
      expect(rec.body).not.toMatch(re);
      expect(rec.title).not.toMatch(re);
    }
  });

  it('M5 earthquake maps to caution severity (NOT critical)', () => {
    const rec = buildCalmRecommendation(usgsM5());
    expect(rec.severity).toBe('caution');
    // The type system also forbids 'critical' — but assert at runtime too.
    expect(['info', 'caution', 'high']).toContain(rec.severity);
  });

  it('blockOperation is always false for external-feed recommendations', () => {
    const recA = buildCalmRecommendation(eonetWildfire());
    const recB = buildCalmRecommendation(usgsM5());
    expect(recA.blockOperation).toBe(false);
    expect(recB.blockOperation).toBe(false);
  });

  it('citation source label is generic "natural-event-feed", not organism-specific', () => {
    const recA = buildCalmRecommendation(eonetWildfire());
    const recB = buildCalmRecommendation(usgsM5());
    expect(recA.citation.source).toBe('natural-event-feed');
    expect(recB.citation.source).toBe('natural-event-feed');
    expect(recA.citation.source).not.toMatch(/nasa/i);
    expect(recB.citation.source).not.toMatch(/usgs/i);
    // refId preserves the upstream id for audit trail.
    expect(recA.citation.refId).toBe('EONET_42');
    expect(recB.citation.refId).toBe('usgs_eq_42');
  });
});
