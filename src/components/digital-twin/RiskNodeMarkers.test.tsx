// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — RiskNodeMarkers tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const onSnapshotMock = vi.fn();

vi.mock('@react-google-maps/api', () => ({
  Marker: (props: any) =>
    React.createElement('div', { 'data-testid': 'marker', 'data-position': JSON.stringify(props.position) }),
  InfoWindow: ({ children }: any) =>
    React.createElement('div', { 'data-testid': 'infowindow' }, children),
}));

vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('../../services/digitalTwin/siteGeometry', () => ({
  severityColor: () => '#ff0000',
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { RiskNodeMarkers } from './RiskNodeMarkers';

afterEach(() => {
  cleanup();
  onSnapshotMock.mockReset();
});

describe('RiskNodeMarkers', () => {
  function makeSnap(docs: Array<{ id: string; data: any }>) {
    return {
      forEach(cb: (d: any) => void) {
        for (const d of docs) cb({ id: d.id, data: () => d.data });
      },
    };
  }

  it('renders no markers when subscription has no nodes yet', () => {
    onSnapshotMock.mockImplementation((_q, cb) => {
      cb(makeSnap([]));
      return () => undefined;
    });
    const { container } = render(
      <RiskNodeMarkers tenantId="tenant-1" projectId="proj-1" />,
    );
    expect(container.querySelector('[data-testid="marker"]')).toBeNull();
  });

  it('renders a Marker per node carrying coordinates', () => {
    onSnapshotMock.mockImplementation((_q, cb) => {
      cb(
        makeSnap([
          {
            id: 'n-1',
            data: {
              title: 'Riesgo eléctrico',
              severity: 'high',
              coordinates: { lat: -33.45, lng: -70.6 },
            },
          },
        ]),
      );
      return () => undefined;
    });
    const { container } = render(
      <RiskNodeMarkers tenantId="tenant-1" projectId="proj-1" />,
    );
    expect(container.querySelectorAll('[data-testid="marker"]').length).toBe(1);
  });
});
