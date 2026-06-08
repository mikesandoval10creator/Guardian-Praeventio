// @vitest-environment jsdom
//
// B-medicine / CLAUDE.md #13 — VigilanciaScheduler must surface REAL
// project-scoped medical-exam obligations (legal_obligations, kind==='medical_exam'),
// NOT the fabricated DEMO_EXAMS array (fake names + fake RUTs) it used to render.
// Drives the REAL component + REAL computeCalendar engine; mocks only the
// Firestore store boundary, i18n, and ProjectContext (DrugInteractions.test.tsx pattern).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import type { LegalObligation } from '../../services/legalCalendar/legalObligationsCalendar';
import { VigilanciaScheduler } from './VigilanciaScheduler';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      // count-style interpolation: t(key, { count, defaultValue })
      if (fb && typeof fb === 'object') {
        const tmpl = typeof fb.defaultValue === 'string' ? fb.defaultValue : _k;
        return tmpl.replace(/\{\{(\w+)\}\}/g, (_m, p) => String((fb as Record<string, unknown>)[p] ?? ''));
      }
      if (typeof fb === 'string') {
        if (opts) {
          let out = fb;
          for (const [k, v] of Object.entries(opts)) out = out.replace(`{{${k}}}`, String(v));
          return out;
        }
        return fb;
      }
      return _k;
    },
  }),
}));

vi.mock('../medical/MedicalIcon', () => ({ MedicalIcon: () => null }));

let mockProject: { id: string; name: string } | null = null;
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));

// Capture the subscribe callback so the test can drive a real snapshot through
// the component's own useEffect → computeCalendar path.
let emit: ((list: LegalObligation[]) => void) | null = null;
vi.mock('../../services/legalCalendar/legalCalendarStore', () => ({
  subscribeObligations: (
    _pid: string,
    onSnap: (list: LegalObligation[]) => void,
    _onErr?: (e: Error) => void,
  ) => {
    emit = onSnap;
    return () => {
      emit = null;
    };
  },
}));

const iso = (deltaDays: number) => new Date(Date.now() + deltaDays * 86_400_000).toISOString();
const medExam = (id: string, days: number): LegalObligation => ({
  id,
  kind: 'medical_exam',
  label: `Examen ${id}`,
  legalCitation: 'DS 109 + Ley 16.744',
  recurrence: 'annual',
  alertLeadDays: 30,
  nextDueAt: iso(days),
});

beforeEach(() => {
  mockProject = null;
  emit = null;
});
afterEach(cleanup);

describe('<VigilanciaScheduler /> real legal_obligations wiring', () => {
  it('no-project → honest empty state, no fabricated rows', () => {
    mockProject = null;
    render(<VigilanciaScheduler />);
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
    // The old fabricated DEMO RUT must be gone for good.
    expect(screen.queryByText(/12\.345\.678/)).not.toBeInTheDocument();
  });

  it('renders real label + citation and correct overdue/upcoming/on-track buckets', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    render(<VigilanciaScheduler />);
    act(() => emit!([medExam('overdue-1', -10), medExam('soon-1', 5), medExam('ok-1', 200)]));

    expect(screen.getByText('Examen overdue-1')).toBeInTheDocument();
    expect(screen.getByText('Examen soon-1')).toBeInTheDocument();
    expect(screen.getByText('Examen ok-1')).toBeInTheDocument();
    // Real citation surfaces on each row.
    expect(screen.getAllByText('DS 109 + Ley 16.744').length).toBe(3);
    // Overdue badge text is driven by the real daysUntilDue (~10d, ±1 from
    // floor-rounding the sub-second gap between fixture creation and now()).
    expect(screen.getByText(/\d+d vencido/)).toBeInTheDocument();

    // KPI tiles render (Próximos 30d is unique to the upcoming tile; "Vencidos"
    // appears on both the overdue KPI tile and the overdue filter button).
    expect(screen.getByText('Próximos 30d')).toBeInTheDocument();
    expect(screen.getAllByText('Vencidos').length).toBeGreaterThan(0);
  });

  it('filters OUT non-medical obligations (only kind===medical_exam surfaces)', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    render(<VigilanciaScheduler />);
    const nonMedical: LegalObligation = {
      id: 'cphs-1',
      kind: 'cphs_meeting',
      label: 'Reunión CPHS',
      legalCitation: 'DS 54 art. 24',
      recurrence: 'monthly',
      alertLeadDays: 7,
      nextDueAt: iso(3),
    };
    act(() => emit!([nonMedical, medExam('med-1', 5)]));
    expect(screen.getByText('Examen med-1')).toBeInTheDocument();
    expect(screen.queryByText('Reunión CPHS')).not.toBeInTheDocument();
  });

  it('project with zero medical exams → honest empty state', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    render(<VigilanciaScheduler />);
    act(() => emit!([]));
    expect(screen.getByText(/sin exámenes ocupacionales programados/i)).toBeInTheDocument();
  });
});
