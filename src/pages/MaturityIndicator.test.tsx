// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.26 page wrapper tests.
//
// Smoke tests for `<MaturityIndicator />`:
//   1. Empty state when project too new / not enough signals.
//   2. Loading state from the hook.
//   3. Error state surfaces hook error.
//   4. Renders level 1 (Reactivo) with rose color tokens.
//   5. Renders level 3 (Proactivo) with teal color tokens.
//   6. Renders level 5 (Autónomo) with gold #FFD700 tokens + max-level
//      hero copy (no "próximo nivel" CTA).
//
// El componente mockea el hook Sprint K y los contexts de proyecto/online
// para que el test sea hermético — sin Firestore, sin fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaturityIndicator } from './MaturityIndicator';
import type { MaturityIndexResponse } from '../hooks/useMaturityIndex';
import type {
  MaturityCategory,
  MaturityReport,
} from '../services/maturity/preventionMaturityIndex';

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
let mockUseMaturity: {
  data: MaturityIndexResponse | null;
  loading: boolean;
  error: Error | null;
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useMaturityIndex', () => ({
  usePreventionMaturity: () => mockUseMaturity,
}));

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  mockIsOnline = true;
  mockUseMaturity = { data: null, loading: false, error: null };
});

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

function categoryScores(value: number): Record<MaturityCategory, number> {
  return {
    foundation: value,
    measurement: value,
    behavior: value,
    leadership: value,
    integration: value,
  };
}

function fixtureReport(
  level: 1 | 2 | 3 | 4 | 5,
  overall: number,
): MaturityReport {
  // levelName en el servicio: 1=reactivo, 2=cumplimiento, 3=proactivo,
  // 4=sistémico, 5=autónomo (la página renombra 4 a 'Predictivo' en UI).
  const names = {
    1: 'reactivo',
    2: 'cumplimiento',
    3: 'proactivo',
    4: 'sistémico',
    5: 'autónomo',
  } as const;
  return {
    level,
    levelName: names[level],
    overallScore: overall,
    categoryScores: categoryScores(overall),
    weakestArea: 'foundation',
    nextLevelGap: {
      targetLevel: level === 5 ? null : ((level + 1) as 2 | 3 | 4 | 5),
      pointsNeeded: 0.1,
      weakestCategory: 'foundation',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('<MaturityIndicator /> page wrapper (Fase F.26)', () => {
  it('muestra empty-state cuando insufficientData=true (proyecto muy nuevo)', () => {
    mockUseMaturity = {
      data: {
        insufficientData: true,
        reason: 'project_too_new',
        signalsCount: 1,
        projectAgeDays: 30,
      },
      loading: false,
      error: null,
    };
    render(<MaturityIndicator />);
    expect(screen.getByTestId('maturity-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/al menos 3 meses de datos/i),
    ).toBeInTheDocument();
    // The hero/gauge MUST NOT render when insufficient.
    expect(screen.queryByTestId('maturity-gauge')).not.toBeInTheDocument();
  });

  it('muestra loading mientras el hook trae datos', () => {
    mockUseMaturity = { data: null, loading: true, error: null };
    render(<MaturityIndicator />);
    expect(screen.getByTestId('maturity-loading')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockUseMaturity = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<MaturityIndicator />);
    expect(screen.getByTestId('maturity-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza nivel 1 (Reactivo) con tokens rose', () => {
    mockUseMaturity = {
      data: {
        report: fixtureReport(1, 0.1),
        recommendations: [
          {
            category: 'foundation',
            action: 'Cerrar brechas de capacitación vigente.',
            targetMetric: 'trainingCoverage',
            expectedImpact: 0.08,
          },
        ],
      },
      loading: false,
      error: null,
    };
    render(<MaturityIndicator />);
    expect(screen.getByTestId('maturity-hero')).toBeInTheDocument();
    const levelName = screen.getByTestId('maturity-level-name');
    expect(levelName).toHaveTextContent(/reactivo/i);
    expect(levelName.className).toMatch(/text-rose-500/);
    const gauge = screen.getByTestId('maturity-gauge');
    expect(gauge).toHaveAttribute('data-level', '1');
    expect(gauge.className).toMatch(/rose/);
    // Next-level CTA present (level 1 → 2).
    expect(
      screen.getByText(/próximo paso: nivel 2/i),
    ).toBeInTheDocument();
    // Recommendation rendered.
    expect(screen.getByTestId('maturity-recommendation-0')).toBeInTheDocument();
  });

  it('renderiza nivel 3 (Proactivo) con tokens teal', () => {
    mockUseMaturity = {
      data: {
        report: fixtureReport(3, 0.5),
        recommendations: [],
      },
      loading: false,
      error: null,
    };
    render(<MaturityIndicator />);
    const levelName = screen.getByTestId('maturity-level-name');
    expect(levelName).toHaveTextContent(/proactivo/i);
    expect(levelName.className).toMatch(/text-teal-500/);
    const gauge = screen.getByTestId('maturity-gauge');
    expect(gauge).toHaveAttribute('data-level', '3');
    // 5 dimensions rendered.
    expect(screen.getByTestId('maturity-dimension-foundation')).toBeInTheDocument();
    expect(screen.getByTestId('maturity-dimension-measurement')).toBeInTheDocument();
    expect(screen.getByTestId('maturity-dimension-behavior')).toBeInTheDocument();
    expect(screen.getByTestId('maturity-dimension-leadership')).toBeInTheDocument();
    expect(screen.getByTestId('maturity-dimension-integration')).toBeInTheDocument();
  });

  it('renderiza nivel 5 (Autónomo) con gold #FFD700 y sin CTA de próximo nivel', () => {
    mockUseMaturity = {
      data: {
        report: fixtureReport(5, 0.95),
        recommendations: [],
      },
      loading: false,
      error: null,
    };
    render(<MaturityIndicator />);
    const levelName = screen.getByTestId('maturity-level-name');
    expect(levelName).toHaveTextContent(/autónomo/i);
    // Gold color uses arbitrary Tailwind class `text-[#FFD700]`.
    expect(levelName.className).toContain('#FFD700');
    const gauge = screen.getByTestId('maturity-gauge');
    expect(gauge).toHaveAttribute('data-level', '5');
    expect(gauge.className).toContain('#FFD700');
    // Max-level copy present, no "próximo paso" CTA.
    expect(screen.getByText(/nivel máximo/i)).toBeInTheDocument();
    expect(screen.queryByText(/próximo paso/i)).not.toBeInTheDocument();
  });
});
