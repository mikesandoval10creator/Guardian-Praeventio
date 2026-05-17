// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.14 page wrapper smoke test.
//
// Cubre:
//   1. Empty state cuando no hay proyecto seleccionado.
//   2. Header + controls renderizados con proyecto + sin findings.
//   3. Render del SVG y hotspots cuando hay findings.
//   4. Offline chip.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FindingsHeatMap } from './FindingsHeatMap';
import type { FindingPoint } from '../services/heatmap/findingsHeatmapBuilder';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

const now = new Date('2026-05-17T12:00:00Z');
const recent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

function f(over: Partial<FindingPoint> = {}): FindingPoint {
  return {
    id: 'fp-1',
    lat: -33.45,
    lng: -70.66,
    severity: 'high',
    occurredAt: recent,
    category: 'fall',
    ...over,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
});

describe('<FindingsHeatMap /> (Fase F.14)', () => {
  it('renderiza empty cuando no hay proyecto seleccionado', () => {
    render(<FindingsHeatMap findings={[f()]} />);
    expect(screen.getByTestId('findings-heatmap-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/Selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza header + controls sin findings', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    render(<FindingsHeatMap findings={[]} />);
    expect(screen.getByTestId('findings-heatmap-page')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-controls')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-empty-state')).toBeInTheDocument();
    // Controls deben tener el select de gridSize y severidad.
    expect(screen.getByTestId('findings-heatmap-grid-size')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-window')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-severity')).toBeInTheDocument();
  });

  it('renderiza el SVG + hotspots cuando hay findings', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const findings: FindingPoint[] = [
      f({ id: 'a', lat: -33.45, lng: -70.66, severity: 'critical' }),
      f({ id: 'b', lat: -33.45, lng: -70.66, severity: 'high' }),
      f({ id: 'c', lat: -33.46, lng: -70.67, severity: 'medium' }),
      f({ id: 'd', lat: -33.47, lng: -70.68, severity: 'low' }),
    ];
    render(<FindingsHeatMap findings={findings} />);
    expect(screen.getByTestId('findings-heatmap-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-svg')).toBeInTheDocument();
    expect(screen.getByTestId('findings-heatmap-hotspots')).toBeInTheDocument();
    // Debería listar al menos 1 hotspot.
    expect(screen.getByTestId('findings-heatmap-hotspot-0')).toBeInTheDocument();
  });

  it('muestra chip offline', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    render(<FindingsHeatMap findings={[]} />);
    expect(screen.getByTestId('findings-heatmap-offline-chip')).toBeInTheDocument();
  });
});
