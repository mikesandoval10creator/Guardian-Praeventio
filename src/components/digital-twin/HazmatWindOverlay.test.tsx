// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — HazmatWindOverlay tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@react-google-maps/api', () => ({
  Circle: (props: any) =>
    React.createElement('div', { 'data-testid': 'circle', 'data-radius': props?.options?.radius ?? '' }),
  Polyline: () => React.createElement('div', { 'data-testid': 'polyline' }),
}));

vi.mock('../../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({
    weather: { windSpeed: 25, windDirection: 90 },
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1' } }),
}));

vi.mock('../../services/digitalTwin/siteGeometry', () => ({
  projectWindSuction: () => ({
    haloRadiusM: 25,
    hotZoneRadiusM: 12,
    downwindLine: [[-70.6, -33.45], [-70.601, -33.451]],
    downwindAnchor: [-70.6005, -33.4505],
    suctionPa: 4.2,
  }),
  ringCentroid: () => [-70.6, -33.45],
}));

vi.mock('../../services/zettelkasten/bernoulli/gasLeakDetection', () => ({
  generateGasLeakNode: vi.fn(() => null),
}));

vi.mock('../../services/zettelkasten/persistence/writeNode', () => ({
  writeNodesDebounced: vi.fn(),
}));

import { HazmatWindOverlay } from './HazmatWindOverlay';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HazmatWindOverlay', () => {
  it('renders nothing when feature list is empty', () => {
    const { container } = render(<HazmatWindOverlay features={[]} />);
    expect(container.querySelector('[data-testid="circle"]')).toBeNull();
  });

  it('renders a Circle for each hazard feature', () => {
    const features: any[] = [
      {
        type: 'Feature',
        properties: { id: 'h-1', type: 'hazard', name: 'Tanque químico' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-70.6, -33.45],
            [-70.601, -33.45],
            [-70.601, -33.451],
            [-70.6, -33.451],
            [-70.6, -33.45],
          ]],
        },
      },
    ];
    const { container } = render(<HazmatWindOverlay features={features} />);
    expect(container.querySelectorAll('[data-testid="circle"]').length).toBeGreaterThan(0);
  });
});
