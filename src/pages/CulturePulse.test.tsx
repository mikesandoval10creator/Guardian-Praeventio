// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §61-63 page wrapper tests.
//
// Smoke tests for `<CulturePulse />` page:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error surface from the hook.
//   4. Low-score render (rose band) — typical "starting" project.
//   5. High-score render (gold band, ≥90) — mature project.
//   6. Active survey banner with participation rate and CTA.
//   7. Respond flow — clicking the CTA opens the modal.
//
// Hermetic — mocks Sprint K hooks, project / firebase / online status
// contexts, and the submission helpers so no Firestore / fetch is hit.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CulturePulse } from './CulturePulse';
import type {
  CulturePulseResponse,
  CulturePulseHistoryResponse,
} from '../hooks/useCulturePulse';

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

type HookState<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsAdmin = false;
let mockIsOnline = true;
let mockPulse: HookState<CulturePulseResponse>;
let mockHistory: HookState<CulturePulseHistoryResponse>;
const refetchPulse = vi.fn();
const refetchHistory = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ isAdmin: mockIsAdmin }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useCulturePulse', () => ({
  useCulturePulse: () => mockPulse,
  useCulturePulseHistory: () => mockHistory,
  scheduleCulturePulse: vi.fn(),
  submitCulturePulseResponse: vi.fn(),
}));

function emptySnapshot(): CulturePulseResponse {
  return {
    snapshot: {
      surveyId: null,
      status: null,
      openAt: null,
      closeAt: null,
      cultureIndex: 0,
      level: 'low',
      totalResponses: 0,
      expectedRespondents: null,
      participationRate: null,
      punitiveCulturedFlagged: false,
      byQuestion: {
        felt_safe_today: 0,
        manager_listens: 0,
        free_to_stop: 0,
        reported_incident_safely: 0,
        has_resources_to_be_safe: 0,
      },
      topConcerns: [],
      topStrengths: [],
      hasResponded: false,
    },
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsAdmin = false;
  mockIsOnline = true;
  mockPulse = {
    data: null,
    loading: false,
    error: null,
    refetch: refetchPulse,
  };
  mockHistory = {
    data: null,
    loading: false,
    error: null,
    refetch: refetchHistory,
  };
  refetchPulse.mockReset();
  refetchHistory.mockReset();
});

describe('<CulturePulse /> page wrapper (Sprint K §61-63)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<CulturePulse />);
    expect(screen.getByTestId('culture-pulse-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras los hooks traen datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockPulse = {
      data: null,
      loading: true,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    expect(screen.getByTestId('culture-pulse-loading')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockPulse = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    expect(screen.getByTestId('culture-pulse-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza el gauge con índice bajo (banda rose)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const empty = emptySnapshot();
    empty.snapshot.cultureIndex = 25;
    empty.snapshot.level = 'low';
    mockPulse = {
      data: empty,
      loading: false,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    const gauge = screen.getByTestId('culture-pulse-gauge');
    expect(gauge).toBeInTheDocument();
    expect(gauge.getAttribute('data-index')).toBe('25');
    // The "25" digit should render inside the gauge.
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('renderiza el gauge con índice alto (banda gold)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snap = emptySnapshot();
    snap.snapshot.cultureIndex = 92;
    snap.snapshot.level = 'strong';
    snap.snapshot.topStrengths = [
      { key: 'felt_safe_today', label: 'Me sentí seguro hoy', score: 4.8 },
    ];
    mockPulse = {
      data: snap,
      loading: false,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    const gauge = screen.getByTestId('culture-pulse-gauge');
    expect(gauge.getAttribute('data-index')).toBe('92');
    expect(screen.getByText('92')).toBeInTheDocument();
    // Top strength surface for visibility.
    expect(
      screen.getByTestId('culture-pulse-strength-felt_safe_today'),
    ).toBeInTheDocument();
  });

  it('muestra el banner de encuesta activa con participación', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snap = emptySnapshot();
    snap.snapshot.surveyId = 'pulse-may';
    snap.snapshot.status = 'open';
    snap.snapshot.openAt = '2026-05-01T00:00:00Z';
    snap.snapshot.closeAt = '2026-05-31T00:00:00Z';
    snap.snapshot.totalResponses = 8;
    snap.snapshot.expectedRespondents = 20;
    snap.snapshot.participationRate = 0.4;
    snap.snapshot.cultureIndex = 60;
    snap.snapshot.hasResponded = false;
    mockPulse = {
      data: snap,
      loading: false,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    const banner = screen.getByTestId('culture-pulse-active-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/8 respuestas/);
    expect(banner.textContent).toMatch(/40% participación/);
    expect(screen.getByTestId('culture-pulse-respond-btn')).toBeInTheDocument();
  });

  it('abre el modal de respuesta al hacer click en "Responder encuesta"', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snap = emptySnapshot();
    snap.snapshot.surveyId = 'pulse-may';
    snap.snapshot.status = 'open';
    snap.snapshot.openAt = '2026-05-01T00:00:00Z';
    snap.snapshot.closeAt = '2026-05-31T00:00:00Z';
    snap.snapshot.hasResponded = false;
    mockPulse = {
      data: snap,
      loading: false,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    fireEvent.click(screen.getByTestId('culture-pulse-respond-btn'));
    const modal = screen.getByTestId('culture-pulse-respond-modal');
    expect(modal).toBeInTheDocument();
    // All 5 question groups render.
    expect(
      screen.getByTestId('culture-pulse-respond-q-felt_safe_today'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('culture-pulse-respond-q-free_to_stop'),
    ).toBeInTheDocument();
  });

  // Codex P1 #3 (PR #323) — anonymity threshold UX.
  it('suprime gauge/concerns/strengths cuando insufficientResponses=true', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snap = emptySnapshot();
    snap.snapshot.surveyId = 'pulse-may';
    snap.snapshot.status = 'open';
    snap.snapshot.openAt = '2026-05-01T00:00:00Z';
    snap.snapshot.closeAt = '2026-05-31T00:00:00Z';
    snap.snapshot.totalResponses = 3;
    snap.snapshot.insufficientResponses = true;
    snap.snapshot.currentCount = 3;
    snap.snapshot.threshold = 5;
    mockPulse = {
      data: snap,
      loading: false,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    // Gate banner is visible.
    const gate = screen.getByTestId('culture-pulse-anonymity-gate');
    expect(gate).toBeInTheDocument();
    expect(gate.textContent).toMatch(/anonimato/i);
    expect(gate.textContent).toMatch(/3 de 5/);
    // Aggregates are NOT rendered.
    expect(screen.queryByTestId('culture-pulse-gauge')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('culture-pulse-concerns'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('culture-pulse-strengths'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('culture-pulse-punitive-flag'),
    ).not.toBeInTheDocument();
  });

  // Codex P2 #2 round 2 (PR #323) — future-scheduled survey must NOT render
  // active banner / response CTA. The server enforces this via
  // `effectiveStatus` requiring `openAt <= now < closeAt`; when the server
  // returns `status='closed'` (because openAt is in the future), the page
  // must not surface a "Responder encuesta" CTA the respond endpoint would
  // then reject with `survey_not_open`.
  it('no muestra CTA de respuesta cuando status=closed (encuesta futura)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snap = emptySnapshot();
    snap.snapshot.surveyId = 'pulse-jul';
    // Server already mapped status -> closed because openAt is future.
    snap.snapshot.status = 'closed';
    snap.snapshot.openAt = '2027-07-01T00:00:00Z';
    snap.snapshot.closeAt = '2027-07-31T00:00:00Z';
    snap.snapshot.totalResponses = 0;
    snap.snapshot.hasResponded = false;
    mockPulse = {
      data: snap,
      loading: false,
      error: null,
      refetch: refetchPulse,
    };
    render(<CulturePulse />);
    expect(
      screen.queryByTestId('culture-pulse-active-banner'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('culture-pulse-respond-btn'),
    ).not.toBeInTheDocument();
  });
});
