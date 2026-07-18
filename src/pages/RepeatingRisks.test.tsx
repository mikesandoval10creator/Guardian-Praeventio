// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.13 page wrapper tests.
//
// Smoke tests for `<RepeatingRisks />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Empty-success state when project loaded pero zero patrones.
//   4. Renderiza la card cuando el hook entrega patrones.
//   5. Error state surfaces hook.error.message.
//   6. Offline chip cuando isOnline=false.
//
// El componente mockea `useProject`, `useOnlineStatus`,
// `useRepeatingRisks` y `RepeatingRiskRadarCard` para que el test sea
// hermético — no Firestore, no fetch, no SVG icons reales.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RepeatingRisks } from './RepeatingRisks';
import type {
  RadarReport,
  RepeatingPattern,
} from '../services/riskRadar/repeatingRiskRadar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
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

type RadarMock = {
  data: { report: RadarReport } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockRadar: RadarMock;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useRepeatingRisks', () => ({
  useRepeatingRisks: (_pid: string | null) => mockRadar,
}));
// Stub the visual card — keeps the test focused on page orchestration
// (loading/error/empty/offline) instead of the card's internals (which
// have their own test file `RepeatingRiskRadarCard.test.tsx`).
vi.mock('../components/riskRadar/RepeatingRiskRadarCard', () => ({
  RepeatingRiskRadarCard: ({ report }: { report: RadarReport }) => (
    <div data-testid="repeating-risks-card-stub">
      patterns={report.totalPatterns}
    </div>
  ),
}));

function pattern(over: Partial<RepeatingPattern> = {}): RepeatingPattern {
  return {
    id: 'same_kind:caída',
    kind: 'same_kind_across_zones',
    label: 'Caídas en 3 zonas',
    involvedIncidentIds: ['i1', 'i2', 'i3'],
    occurrences: 3,
    lastSeenAt: '2026-05-10T12:00:00Z',
    recommendedAction: 'Revisar procedimiento de caídas.',
    severity: 'high',
    ...over,
  };
}

function radar(patterns: RepeatingPattern[] = []): RadarReport {
  return {
    patterns,
    totalPatterns: patterns.length,
    byKind: {},
    maxSeverity: patterns.length ? 'high' : 'low',
    windowDays: 90,
    consideredIncidents: 42,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockRadar = {
    data: null,
    loading: false,
    error: null,
    refetch: () => undefined,
  };
});

describe('<RepeatingRisks /> page wrapper (Fase F.13)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<RepeatingRisks />);
    expect(
      screen.getByTestId('repeating-risks-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRadar = {
      data: null,
      loading: true,
      error: null,
      refetch: () => undefined,
    };
    render(<RepeatingRisks />);
    expect(screen.getByTestId('repeating-risks-loading')).toBeInTheDocument();
  });

  it('muestra empty-success cuando el radar no detectó patrones', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRadar = {
      data: { report: radar([]) },
      loading: false,
      error: null,
      refetch: () => undefined,
    };
    render(<RepeatingRisks />);
    expect(
      screen.getByTestId('repeating-risks-empty-state'),
    ).toBeInTheDocument();
    expect(screen.getByText(/buen trabajo/i)).toBeInTheDocument();
    // Interpolación: "Ventana analizada: 90 días · 42 incidente(s)".
    // Buscamos el string entero para no chocar con el "Últimos 90 días"
    // que también aparece en el título.
    expect(
      screen.getByText(/Ventana analizada: 90 días · 42 incidente\(s\)/i),
    ).toBeInTheDocument();
  });

  it('renderiza la card cuando hay patrones detectados', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRadar = {
      data: {
        report: radar([
          pattern(),
          pattern({ id: 'same_zone:patio', label: 'Patio con 2 tipos' }),
        ]),
      },
      loading: false,
      error: null,
      refetch: () => undefined,
    };
    render(<RepeatingRisks />);
    expect(screen.getByTestId('repeating-risks-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('repeating-risks-card-stub'),
    ).toBeInTheDocument();
    // Subtitle interpola el count: "{{count}} patrón(es) detectado(s)".
    expect(screen.getByText(/2 patrón\(es\) detectado\(s\)/i)).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRadar = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: () => undefined,
    };
    render(<RepeatingRisks />);
    expect(screen.getByTestId('repeating-risks-error')).toBeInTheDocument();
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  it('muestra el chip offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    mockRadar = {
      data: { report: radar([]) },
      loading: false,
      error: null,
      refetch: () => undefined,
    };
    render(<RepeatingRisks />);
    expect(
      screen.getByTestId('repeating-risks-offline-chip'),
    ).toBeInTheDocument();
  });
});
