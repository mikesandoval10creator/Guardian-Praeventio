// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FindingsHeatmapPreview } from './FindingsHeatmapPreview.js';
import type { FindingPoint } from '../../services/heatmap/findingsHeatmapBuilder.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function fp(over: Partial<FindingPoint> & { id: string; lat: number; lng: number }): FindingPoint {
  return {
    severity: 'medium',
    occurredAt: '2026-05-12T10:00:00Z',
    category: 'general',
    ...over,
  };
}

describe('<FindingsHeatmapPreview />', () => {
  it('vacío muestra mensaje empty y no renderiza SVG de cells', () => {
    render(<FindingsHeatmapPreview findings={[]} />);
    expect(screen.getByTestId('findings-heatmap-preview')).toBeTruthy();
    expect(screen.getByTestId('heatmap-empty')).toHaveTextContent(/No hay hallazgos/i);
    expect(screen.queryByTestId('heatmap-svg')).toBeNull();
  });

  it('renderiza SVG con al menos una celda cuando hay findings', () => {
    render(
      <FindingsHeatmapPreview
        findings={[
          fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'high' }),
          fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'high' }),
        ]}
      />,
    );
    expect(screen.getByTestId('heatmap-svg')).toBeTruthy();
    expect(screen.getAllByTestId('heatmap-cell').length).toBeGreaterThan(0);
  });

  it('muestra count de celdas en el header', () => {
    render(
      <FindingsHeatmapPreview
        findings={[
          fp({ id: 'a', lat: -33.45, lng: -70.65 }),
          fp({ id: 'b', lat: -33.46, lng: -70.66 }),
        ]}
      />,
    );
    expect(screen.getByTestId('heatmap-cell-count')).toHaveTextContent(/2 celdas/i);
  });

  it('lista hotspots con coords y count', () => {
    render(
      <FindingsHeatmapPreview
        findings={[
          fp({ id: 'a', lat: -33.45, lng: -70.65, severity: 'critical' }),
          fp({ id: 'b', lat: -33.4500001, lng: -70.6500001, severity: 'critical' }),
          fp({ id: 'c', lat: -33.46, lng: -70.66, severity: 'low' }),
        ]}
        topN={2}
      />,
    );
    const items = screen.getAllByTestId('heatmap-hotspot');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(2);
    // El primer hotspot debe ser el critical
    expect(items[0]).toHaveTextContent(/critical/);
  });
});
