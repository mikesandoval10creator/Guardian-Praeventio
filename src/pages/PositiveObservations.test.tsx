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
  data: { observations: PositiveObservation[]; period: '30d' | '90d' | 'all' } | null;
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

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  usePositiveObservations: () => mockList,
  usePositiveObservationBalance: () => mockBalance,
  createPositiveObservation: (
    pid: string,
    payload: Record<string, unknown>,
  ) => createSpy(pid, payload),
}));

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Sur' };
  mockIsOnline = true;
  listRefetchSpy.mockReset();
  balanceRefetchSpy.mockReset();
  createSpy.mockClear();
  createSpy.mockResolvedValue(undefined);
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

    // Rellenar.
    fireEvent.change(screen.getByTestId('positive-obs-worker-input'), {
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
});
