// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.21 page wrapper tests.
//
// Smoke tests for `<PreShiftRisk />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Renders score + level + recommendations when data arrives.
//   4. Error surfaces in the UI.
//   5. Offline chip when isOnline=false.
//
// The page mocks `usePreShiftRisk`, `useProject`, and `useOnlineStatus`
// so the test is hermetic — no Firestore, no fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreShiftRisk } from './PreShiftRisk';
import type { ShiftRiskReport } from '../services/shiftRiskPanel/preShiftRiskComposer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
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
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockResp: {
  data: { panel: ShiftRiskReport } | null;
  loading: boolean;
  error: Error | null;
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/usePreShiftRisk', () => ({
  usePreShiftRisk: () => mockResp,
}));
// F.21 added a `useUniversalKnowledge()` read in the page (weather → WBGT heat
// stress protocol). These hermetic smoke tests don't exercise the thermal card,
// so mock the context with no environment: `weather` resolves to null and the
// HeatStressCard branch (gated on `weather` in PreShiftRisk.tsx) stays
// unrendered — exactly the behaviour before F.21. Avoids pulling the real
// provider (Firestore/graph) into a hermetic test.
vi.mock('../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({ environment: null }),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockResp = { data: null, loading: false, error: null };
});

function makePanel(overrides: Partial<ShiftRiskReport> = {}): ShiftRiskReport {
  return {
    projectId: 'p-1',
    shift: 'day',
    date: '2026-05-17',
    riskScore: 45,
    level: 'amber',
    factors: [
      {
        id: 'wind',
        label: 'Viento 13 m/s sobre umbral izaje',
        weight: 15,
        recommendation: 'Suspender izaje y trabajo en altura sobre 1.8m.',
      },
      {
        id: 'fatigue',
        label: '2 trabajador(es) con fatiga alta/crítica',
        weight: 25,
        recommendation: 'No asignar a tareas críticas: Juan Pérez, Ana Silva.',
      },
    ],
    topRecommendations: [
      'No asignar a tareas críticas: Juan Pérez, Ana Silva.',
      'Suspender izaje y trabajo en altura sobre 1.8m.',
    ],
    recommendDelayShiftStart: false,
    ...overrides,
  };
}

describe('<PreShiftRisk /> page wrapper (Fase F.21)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<PreShiftRisk />);
    expect(
      screen.getByTestId('pre-shift-risk-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = { data: null, loading: true, error: null };
    render(<PreShiftRisk />);
    expect(screen.getByTestId('pre-shift-risk-loading')).toBeInTheDocument();
  });

  it('renderiza score, nivel y recomendaciones cuando llega el panel', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { panel: makePanel() },
      loading: false,
      error: null,
    };
    render(<PreShiftRisk />);
    expect(screen.getByTestId('pre-shift-risk-page')).toBeInTheDocument();
    // Score card
    expect(screen.getByTestId('pre-shift-risk-score')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText(/MEDIO/i)).toBeInTheDocument();
    // Recommendations section
    const recommendations = screen.getByTestId(
      'pre-shift-risk-recommendations',
    );
    expect(recommendations).toBeInTheDocument();
    // The recommendation copy appears both in the top-3 list AND inside
    // each factor row, so scope the assertion to the recommendations
    // block to keep the matcher unique.
    expect(
      recommendations.textContent ?? '',
    ).toMatch(/No asignar a tareas críticas/i);
    // Weather + personnel sections
    expect(
      screen.getByTestId('pre-shift-risk-factor-wind'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('pre-shift-risk-factor-fatigue'),
    ).toBeInTheDocument();
  });

  it('muestra el banner de postergar turno cuando recommendDelayShiftStart=true', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        panel: makePanel({
          riskScore: 82,
          level: 'red',
          recommendDelayShiftStart: true,
        }),
      },
      loading: false,
      error: null,
    };
    render(<PreShiftRisk />);
    expect(
      screen.getByTestId('pre-shift-risk-delay-recommendation'),
    ).toBeInTheDocument();
    expect(screen.getByText(/postergar el inicio del turno/i)).toBeInTheDocument();
    expect(screen.getByText(/ALTO/i)).toBeInTheDocument();
  });

  it('muestra el chip de offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockResp = {
      data: { panel: makePanel() },
      loading: false,
      error: null,
    };
    render(<PreShiftRisk />);
    expect(
      screen.getByTestId('pre-shift-risk-offline-chip'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<PreShiftRisk />);
    expect(screen.getByTestId('pre-shift-risk-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
