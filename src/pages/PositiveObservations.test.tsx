// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §214-215 page wrapper tests.
//
// Smoke tests for `<PositiveObservations />` (6 cases):
//   1. Empty state — proyecto seleccionado pero 0 observaciones en el
//      período devuelve el call-to-action "captura cuando veas algo bien
//      hecho".
//   2. Loading — el spinner de carga aparece mientras los hooks traen
//      datos.
//   3. Error — el mensaje del hook se surface en pantalla.
//   4. Render con balance POSITIVO (ratio > 1 = level positive_skew/
//      balanced; el ring del widget pinta verde/teal).
//   5. Render con balance NEGATIVO (correctivas > positivas → level
//      imbalanced/punitive; el ring pinta amber/rose y el mensaje
//      menciona cultura punitiva o desbalance).
//   6. Create — abrir el form, rellenar campos, submit; el mutator se
//      invoca con el payload correcto y el refetch dispara después.
//
// Hermético — sin Firestore, sin fetch real, sin i18n internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PositiveObservations } from './PositiveObservations';
import type {
  PositiveObservation,
  BalanceReport,
} from '../services/positiveObservations/positiveObservationsService';

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

type ListState = {
  data: {
    observations: PositiveObservation[];
    period: '30d' | '90d' | 'all';
    pagination?: {
      limit: number;
      hasMore: boolean;
      nextStartAfter: string | null;
    };
  } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
type BalanceState = {
  data:
    | {
        positive: number;
        corrective: number;
        ratio: number;
        period: '30d' | '90d' | 'all';
        balance: BalanceReport;
        positivePeriod?: '30d' | '90d' | 'all';
        correctivePeriod?: '30d' | '90d' | 'all';
        correctivePeriodBasis?: 'dueDate' | 'all';
      }
    | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockList: ListState;
let mockBalance: BalanceState;
const listRefetchSpy = vi.fn();
const balanceRefetchSpy = vi.fn();
const createSpy = vi.fn().mockResolvedValue(undefined);
// Codex P2 round 2 PR #320 (line 250): the form now picks a real
// `Worker.id` from `projects/{pid}/workers`. Tests provide a default
// roster so the form has something to autocomplete + select.
let mockWorkers: Array<{ id: string; name: string; email: string; role: string }> = [];
// Capture how `usePositiveObservations` is invoked so we can assert
// the page passes the cursor on Load More.
const positiveObsCallSpy = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: mockWorkers, loading: false, error: null }),
}));
vi.mock('../hooks/usePositiveObservations', () => ({
  usePositiveObservations: (
    pid: string | null,
    opts: { period?: string; startAfter?: string } = {},
  ) => {
    positiveObsCallSpy(pid, opts);
    return mockList;
  },
  usePositiveObservationBalance: () => mockBalance,
  createPositiveObservation: (
    pid: string,
    payload: Record<string, unknown>,
  ) => createSpy(pid, payload),
}));

type BbsState = {
  data: { profile: import('../services/behaviorObservation/bbsObservationEngine').BbsProfile } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockBbs: BbsState;
const bbsCallSpy = vi.fn();
vi.mock('../hooks/useBbs', () => ({
  useBbsProfile: (pid: string | null, days: number) => {
    bbsCallSpy(pid, days);
    return mockBbs;
  },
}));

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Sur' };
  mockIsOnline = true;
  listRefetchSpy.mockReset();
  balanceRefetchSpy.mockReset();
  createSpy.mockClear();
  createSpy.mockResolvedValue(undefined);
  positiveObsCallSpy.mockReset();
  mockWorkers = [
    { id: 'uid_juan', name: 'Juan Pérez', email: 'juan@p.cl', role: 'soldador' },
    { id: 'uid_maria', name: 'María Soto', email: 'maria@p.cl', role: 'supervisora' },
  ];
  mockList = {
    data: { observations: [], period: '30d' },
    loading: false,
    error: null,
    refetch: listRefetchSpy,
  };
  mockBalance = {
    data: null,
    loading: false,
    error: null,
    refetch: balanceRefetchSpy,
  };
  mockBbs = { data: null, loading: false, error: null, refetch: vi.fn() };
  bbsCallSpy.mockReset();
});

function obs(over: Partial<PositiveObservation> & { id: string }): PositiveObservation {
  return {
    id: over.id,
    observedWorkerUid: over.observedWorkerUid ?? 'w-1',
    observerUid: over.observerUid ?? 'obs-1',
    observerRole: over.observerRole ?? 'supervisor',
    kind: over.kind ?? 'safe_behavior',
    description: over.description ?? 'Verificó EPP antes de subir al andamio.',
    observedAt: over.observedAt ?? new Date('2026-05-10T10:00:00.000Z').toISOString(),
    location: over.location ?? 'Frente A',
    shared: over.shared ?? false,
  };
}

describe('<PositiveObservations /> page wrapper (Sprint K §214-215)', () => {
  it('renderiza empty-state con call-to-action cuando no hay observaciones', () => {
    mockList = {
      data: { observations: [], period: '30d' },
      loading: false,
      error: null,
      refetch: listRefetchSpy,
    };
    render(<PositiveObservations />);
    expect(screen.getByTestId('positive-obs-page')).toBeInTheDocument();
    expect(screen.getByTestId('positive-obs-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/captura cuando veas algo bien hecho/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras los hooks traen datos', () => {
    mockList = { data: null, loading: true, error: null, refetch: listRefetchSpy };
    mockBalance = { data: null, loading: true, error: null, refetch: balanceRefetchSpy };
    render(<PositiveObservations />);
    expect(screen.getByTestId('positive-obs-loading')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockList = {
      data: null,
      loading: false,
      error: new Error('Backend caído'),
      refetch: listRefetchSpy,
    };
    render(<PositiveObservations />);
    expect(screen.getByTestId('positive-obs-error')).toBeInTheDocument();
    expect(screen.getByText(/Backend caído/i)).toBeInTheDocument();
  });

  it('renderiza balance POSITIVO (ratio alto, mensaje saludable)', () => {
    mockList = {
      data: {
        observations: [
          obs({ id: 'o1', description: 'Detuvo tarea al notar riesgo de caída.' }),
          obs({ id: 'o2', description: 'Sugerencia de mejora en izaje.' }),
        ],
        period: '30d',
      },
      loading: false,
      error: null,
      refetch: listRefetchSpy,
    };
    mockBalance = {
      data: {
        positive: 8,
        corrective: 2,
        ratio: 4,
        period: '30d',
        balance: {
          positiveCount: 8,
          correctiveCount: 2,
          total: 10,
          positiveRatio: 0.8,
          level: 'positive_skew',
          message: '80% positivas. Asegurar que las correctivas siguen registrándose.',
        },
      },
      loading: false,
      error: null,
      refetch: balanceRefetchSpy,
    };
    render(<PositiveObservations />);
    expect(screen.getByTestId('positive-balance-widget')).toBeInTheDocument();
    expect(screen.getByTestId('balance-positive-count')).toHaveTextContent('8');
    expect(screen.getByTestId('balance-corrective-count')).toHaveTextContent('2');
    expect(screen.getByTestId('balance-ratio')).toHaveTextContent('4.0');
    expect(screen.getAllByTestId('positive-obs-card')).toHaveLength(2);
  });

  it('renderiza balance NEGATIVO (level punitive, mensaje crítico)', () => {
    mockBalance = {
      data: {
        positive: 0,
        corrective: 5,
        ratio: 0,
        period: '30d',
        balance: {
          positiveCount: 0,
          correctiveCount: 5,
          total: 5,
          positiveRatio: 0,
          level: 'punitive',
          message: 'Solo se registran observaciones correctivas. Cultura punitiva.',
        },
      },
      loading: false,
      error: null,
      refetch: balanceRefetchSpy,
    };
    render(<PositiveObservations />);
    const widget = screen.getByTestId('positive-balance-widget');
    expect(widget).toBeInTheDocument();
    // Mensaje crítico debe surface.
    expect(screen.getByTestId('balance-message')).toHaveTextContent(/cultura punitiva/i);
    expect(screen.getByTestId('balance-positive-count')).toHaveTextContent('0');
    expect(screen.getByTestId('balance-corrective-count')).toHaveTextContent('5');
  });

  it('permite crear una nueva observación (form submit invoca mutator + refetch)', async () => {
    render(<PositiveObservations />);

    // Abrir el form.
    const newBtn = screen.getByTestId('positive-obs-new-button');
    fireEvent.click(newBtn);
    expect(screen.getByTestId('positive-obs-form')).toBeInTheDocument();

    // Codex P2 round 2 PR #320 (line 250): the form now requires
    // selecting a worker from the picker rather than free-text. Pick
    // Juan from the dropdown so `observedWorkerUid` is guaranteed to
    // be a real `Worker.id`.
    fireEvent.change(screen.getByTestId('positive-obs-worker-select'), {
      target: { value: 'uid_juan' },
    });
    fireEvent.change(screen.getByTestId('positive-obs-location-input'), {
      target: { value: 'Frente sur' },
    });
    fireEvent.change(screen.getByTestId('positive-obs-description-input'), {
      target: { value: 'Verificó arnés antes de subir al andamio nivel 3.' },
    });

    // Submit.
    const submit = screen.getByTestId('positive-obs-form-submit');
    fireEvent.click(submit);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
    const [pidArg, payload] = createSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(pidArg).toBe('p-1');
    expect(payload.observedWorkerUid).toBe('uid_juan');
    expect(payload.location).toBe('Frente sur');
    expect(payload.description).toMatch(/arnés/);
    expect(payload.kind).toBe('safe_behavior');
    // Refetch dispara después del save exitoso.
    await waitFor(() => {
      expect(listRefetchSpy).toHaveBeenCalled();
      expect(balanceRefetchSpy).toHaveBeenCalled();
    });
  });

  // Codex P2 round 2 PR #320 (line 250): typing a free-text name that
  // doesn't match the roster must not satisfy the form — submit stays
  // disabled until a real `Worker.id` is picked.
  it('bloquea submit si el usuario sólo escribe texto sin seleccionar trabajador', () => {
    render(<PositiveObservations />);
    fireEvent.click(screen.getByTestId('positive-obs-new-button'));
    // Query that doesn't match any roster member so the picker stays
    // empty (no auto-pick on single hit) and the user can't accidentally
    // submit a name string as a UID.
    fireEvent.change(screen.getByTestId('positive-obs-worker-input'), {
      target: { value: 'zzznoroster' },
    });
    fireEvent.change(screen.getByTestId('positive-obs-location-input'), {
      target: { value: 'Frente sur' },
    });
    fireEvent.change(screen.getByTestId('positive-obs-description-input'), {
      target: { value: 'Verificó arnés correctamente.' },
    });
    const submit = screen.getByTestId(
      'positive-obs-form-submit',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  // Codex P2 round 2 PR #320 (line 487): the widget must reflect the
  // server's explicit per-side windows. When the corrective count
  // falls back to all-time (legacy docs without `dueDate`), an
  // asymmetry chip surfaces so users don't read the ratio as
  // period-specific.
  it('renderiza chip de asimetría cuando correctivePeriod difiere del positivePeriod', () => {
    mockBalance = {
      data: {
        positive: 3,
        corrective: 7,
        ratio: 0.43,
        period: '30d',
        positivePeriod: '30d',
        correctivePeriod: 'all',
        correctivePeriodBasis: 'all',
        balance: {
          positiveCount: 3,
          correctiveCount: 7,
          total: 10,
          positiveRatio: 0.3,
          level: 'imbalanced',
          message: 'Solo 30% positivas. Promover registro de comportamientos seguros.',
        },
      },
      loading: false,
      error: null,
      refetch: balanceRefetchSpy,
    };
    render(<PositiveObservations />);
    expect(screen.getByTestId('balance-asymmetry-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('balance-period-chip')).not.toBeInTheDocument();
  });

  // Codex P2 round 2 PR #320 (line 487): symmetric window renders the
  // standard chip with the dueDate basis appended when applicable.
  it('renderiza chip simétrico con basis dueDate cuando el server filtró ambos lados', () => {
    mockBalance = {
      data: {
        positive: 5,
        corrective: 2,
        ratio: 2.5,
        period: '30d',
        positivePeriod: '30d',
        correctivePeriod: '30d',
        correctivePeriodBasis: 'dueDate',
        balance: {
          positiveCount: 5,
          correctiveCount: 2,
          total: 7,
          positiveRatio: 5 / 7,
          level: 'balanced',
          message: 'Balance saludable de feedback positivo y correctivo.',
        },
      },
      loading: false,
      error: null,
      refetch: balanceRefetchSpy,
    };
    render(<PositiveObservations />);
    const chip = screen.getByTestId('balance-period-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent(/30 días/);
    expect(chip).toHaveTextContent(/dueDate/);
  });

  // Codex P2 round 2 PR #320 (line 550): the page must expose the
  // `nextStartAfter` cursor when the server reports more pages. Click
  // Load More → hook is re-invoked with the cursor.
  it('expone botón "Cargar más" y pasa nextStartAfter cuando hasMore=true', async () => {
    mockList = {
      data: {
        observations: [obs({ id: 'o1' }), obs({ id: 'o2' })],
        period: '30d',
        pagination: { limit: 500, hasMore: true, nextStartAfter: 'o2' },
      },
      loading: false,
      error: null,
      refetch: listRefetchSpy,
    };
    render(<PositiveObservations />);
    const loadMore = screen.getByTestId('positive-obs-load-more');
    expect(loadMore).toBeInTheDocument();
    fireEvent.click(loadMore);
    await waitFor(() => {
      const lastCall = positiveObsCallSpy.mock.calls.at(-1) as [
        string,
        { period?: string; startAfter?: string },
      ];
      expect(lastCall?.[1]?.startAfter).toBe('o2');
    });
  });

  // Without `pagination.hasMore`, no Load More button is rendered.
  it('oculta "Cargar más" cuando no hay más páginas', () => {
    mockList = {
      data: {
        observations: [obs({ id: 'o1' })],
        period: '30d',
        pagination: { limit: 500, hasMore: false, nextStartAfter: null },
      },
      loading: false,
      error: null,
      refetch: listRefetchSpy,
    };
    render(<PositiveObservations />);
    expect(screen.queryByTestId('positive-obs-load-more')).not.toBeInTheDocument();
  });

  // ── BbsProfileCard wiring (feat/wire-bbs-profile) ─────────────────────
  // The page renders <BbsProfileCard> fed by useBbsProfile (GET
  // /api/sprint-k/:projectId/bbs/profile → server reads REAL persisted
  // observations and computes the profile via the engine).

  it('renderiza BbsProfileCard con el perfil REAL del hook useBbsProfile', () => {
    mockBbs = {
      data: {
        profile: {
          tenantId: 't-1',
          windowStart: '2026-05-21T00:00:00.000Z',
          windowEnd: '2026-06-20T00:00:00.000Z',
          totalObservations: 10,
          safePercentage: 80,
          byCategory: {
            epp: { total: 5, safe: 3, atRisk: 2, safePercentage: 60 },
            positioning: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            tools_equipment: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            procedures: { total: 5, safe: 5, atRisk: 0, safePercentage: 100 },
            housekeeping: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            ergonomics: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            communication: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
          },
          focusCategories: ['epp'],
          topRiskAreas: [{ areaId: 'frente-norte', atRiskPct: 40, total: 5 }],
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<PositiveObservations />);
    const card = screen.getByTestId('bbs-profile-card');
    expect(card).toBeInTheDocument();
    // Overall safe % from REAL profile.
    expect(screen.getByTestId('bbs-overall')).toHaveTextContent('80%');
    // Only categories with observations render (epp + procedures).
    expect(screen.getByTestId('bbs-category-epp')).toBeInTheDocument();
    expect(screen.getByTestId('bbs-category-procedures')).toBeInTheDocument();
    expect(screen.queryByTestId('bbs-category-housekeeping')).not.toBeInTheDocument();
    // epp is the focus category (<70% safe).
    expect(screen.getByTestId('bbs-category-epp')).toHaveAttribute('data-focus', 'true');
    expect(screen.getByTestId('bbs-category-epp-focus-tag')).toBeInTheDocument();
    // Top risk area surfaces.
    expect(screen.getByTestId('bbs-area-frente-norte')).toHaveTextContent('frente-norte');
  });

  it('BbsProfileCard muestra empty-state honesto cuando no hay observaciones', () => {
    mockBbs = {
      data: {
        profile: {
          tenantId: 't-1',
          windowStart: '2026-05-21T00:00:00.000Z',
          windowEnd: '2026-06-20T00:00:00.000Z',
          totalObservations: 0,
          safePercentage: 0,
          byCategory: {
            epp: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            positioning: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            tools_equipment: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            procedures: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            housekeeping: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            ergonomics: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
            communication: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
          },
          focusCategories: [],
          topRiskAreas: [],
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<PositiveObservations />);
    expect(screen.getByTestId('bbs-profile-card')).toBeInTheDocument();
    expect(screen.getByTestId('bbs-no-categories')).toBeInTheDocument();
    expect(screen.queryByTestId('bbs-top-risk-areas')).not.toBeInTheDocument();
  });

  it('useBbsProfile recibe el projectId y los días mapeados desde el período (90d → 90)', () => {
    render(<PositiveObservations />);
    // Initial render uses the default '30d' period → 30 days.
    expect(bbsCallSpy).toHaveBeenCalledWith('p-1', 30);
    // Switch to 90 días → the hook is re-invoked with 90.
    fireEvent.click(screen.getByTestId('period-chip-90d'));
    expect(bbsCallSpy).toHaveBeenCalledWith('p-1', 90);
  });

  it('no renderiza BbsProfileCard mientras el perfil aún no carga (data=null)', () => {
    mockBbs = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<PositiveObservations />);
    expect(screen.queryByTestId('bbs-profile-card')).not.toBeInTheDocument();
  });
});
