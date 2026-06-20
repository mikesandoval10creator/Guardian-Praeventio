// @vitest-environment jsdom
//
// Praeventio Guard — <ChangeManagement /> page wrapper tests (F5 MOC).
//
// Verifica que la página monta el TRÍO real sobre dato real del backend
// adapter-backed (/api/sprint-k/:projectId/moc/*):
//   1. Empty-state honesto cuando no hay proyecto seleccionado.
//   2. <MOCStatusPanel /> renderiza la cobertura + cada MOC desde
//      useMocList() (items + summaries) — el dato del proyecto.
//   3. <AcknowledgmentBanner /> aparece por cada MOC pendiente de la
//      confirmación del trabajador (usePendingMocAcks), mostrando el cambio.
//   4. La pestaña "Declarar" monta <ChangeDeclarationForm /> y un submit
//      llama declareMoc() (la superficie persistida real).
//
// Hermetic: los hooks de red (useOperationalChange) y la firma biométrica
// se mockean en su frontera; el resto (página + trío) es código real.
// Patrón espejo de Apprenticeship.test.tsx + CorrectiveActions.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ChangeManagement } from './ChangeManagement';
import * as mocHooks from '../hooks/useOperationalChange';
import type {
  OperationalChange,
  ChangeAcknowledgementSummary,
} from '../services/changeMgmt/operationalChangeService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      const base = typeof fallback === 'string' ? fallback : _k;
      const merged =
        opts && typeof opts === 'object'
          ? opts
          : fallback && typeof fallback === 'object'
            ? fallback
            : undefined;
      let out = base;
      if (typeof fallback === 'object' && fallback && 'defaultValue' in fallback) {
        out = String((fallback as { defaultValue: string }).defaultValue);
      }
      if (merged) {
        for (const [key, val] of Object.entries(merged)) {
          if (key === 'defaultValue') continue;
          out = out.replace(`{{${key}}}`, String(val));
        }
      }
      return out;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

// Biometric signing: report supported + auto-approve so the banner ack flow
// can drive acknowledgeMoc without a real WebAuthn challenge.
vi.mock('../hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    isSupported: true,
    authenticate: vi.fn().mockResolvedValue(true),
  }),
}));

type ListState = {
  data: mocHooks.MocListResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
type PendingState = {
  data: mocHooks.PendingAcksResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockList: ListState;
let mockPending: PendingState;
const declareMocMock = vi.fn();
const acknowledgeMocMock = vi.fn();
const closeMocMock = vi.fn();

vi.mock('../hooks/useOperationalChange', () => ({
  useMocList: () => mockList,
  usePendingMocAcks: () => mockPending,
  declareMoc: (...args: unknown[]) => declareMocMock(...args),
  acknowledgeMoc: (...args: unknown[]) => acknowledgeMocMock(...args),
  closeMoc: (...args: unknown[]) => closeMocMock(...args),
}));

function makeChange(over: Partial<OperationalChange> & { id: string }): OperationalChange {
  return {
    id: over.id,
    projectId: over.projectId ?? 'p-1',
    kind: over.kind ?? 'procedure',
    whatChanged: over.whatChanged ?? 'Cambio de procedimiento de izaje',
    previousValue: over.previousValue ?? 'manual viejo',
    newValue: over.newValue ?? 'manual v2',
    rationale: over.rationale ?? 'Actualización tras hallazgo de inspección de seguridad.',
    impact: over.impact ?? 'medium',
    affectedWorkerUids: over.affectedWorkerUids ?? ['worker-001', 'worker-002'],
    declaredByUid: over.declaredByUid ?? 'admin-uid',
    declaredByRole: over.declaredByRole ?? 'supervisor',
    effectiveFrom: over.effectiveFrom ?? '2026-06-20T00:00:00.000Z',
    declaredAt: over.declaredAt ?? '2026-06-19T00:00:00.000Z',
    acknowledgments: over.acknowledgments ?? [{ workerUid: 'worker-001', ackedAt: '2026-06-19T01:00:00.000Z' }],
    status: over.status ?? 'in_effect',
    approvals: over.approvals ?? [],
  };
}

function summaryFor(c: OperationalChange): ChangeAcknowledgementSummary {
  const acked = new Set(c.acknowledgments.map((a) => a.workerUid));
  const pending = c.affectedWorkerUids.filter((u) => !acked.has(u));
  return {
    changeId: c.id,
    totalAffected: c.affectedWorkerUids.length,
    acknowledged: c.acknowledgments.length,
    pending: pending.length,
    coveragePercent:
      c.affectedWorkerUids.length === 0
        ? 100
        : Math.round((c.acknowledgments.length / c.affectedWorkerUids.length) * 100),
    pendingWorkerUids: pending,
  };
}

function emptyList(): ListState {
  return { data: { items: [], summaries: [] }, loading: false, error: null, refetch: vi.fn() };
}
function emptyPending(): PendingState {
  return { data: { pending: [] }, loading: false, error: null, refetch: vi.fn() };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockList = emptyList();
  mockPending = emptyPending();
  declareMocMock.mockReset();
  acknowledgeMocMock.mockReset();
  closeMocMock.mockReset();
});

describe('<ChangeManagement /> page (F5 MOC)', () => {
  it('renderiza empty-state honesto cuando no hay proyecto', () => {
    mockSelectedProject = null;
    render(<ChangeManagement />);
    expect(screen.getByTestId('change-management.empty.noProject')).toBeInTheDocument();
    // El panel y el form NO se montan sin proyecto.
    expect(screen.queryByTestId('moc.panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('moc.declarationForm')).not.toBeInTheDocument();
  });

  it('renderiza la cobertura + el MOC real desde useMocList en la pestaña Cobertura', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const c = makeChange({ id: 'moc-abc', whatChanged: 'Nuevo supervisor turno noche' });
    mockList = {
      data: { items: [c], summaries: [summaryFor(c)] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(<ChangeManagement />);

    // El panel real montado con el dato del proyecto.
    expect(screen.getByTestId('moc.panel')).toBeInTheDocument();
    // Cobertura: 1 de 2 confirmaron → 50%.
    expect(screen.getByTestId('moc.panel.overallPct')).toHaveTextContent('50%');
    // La tarjeta del MOC muestra el whatChanged real.
    expect(screen.getByTestId('changeMgmt.card.title')).toHaveTextContent(
      'Nuevo supervisor turno noche',
    );
  });

  it('monta un AcknowledgmentBanner por cada MOC pendiente de mi confirmación', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const pendingChange = makeChange({
      id: 'moc-pending',
      whatChanged: 'EPP obligatorio actualizado en zona ácida',
      acknowledgments: [],
    });
    mockPending = {
      data: { pending: [pendingChange] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(<ChangeManagement />);

    const banner = screen.getByTestId('moc.banner');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByTestId('moc.banner.whatChanged')).toHaveTextContent(
      'EPP obligatorio actualizado en zona ácida',
    );
  });

  it('en la pestaña Declarar monta el form real y un submit válido llama declareMoc con el projectId', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    declareMocMock.mockResolvedValueOnce({ change: makeChange({ id: 'moc-new' }) });

    render(<ChangeManagement />);

    // Cambiar a la pestaña de declaración.
    fireEvent.click(screen.getByTestId('change-management.tab.declare'));
    expect(screen.getByTestId('moc.declarationForm')).toBeInTheDocument();

    // Completar el form: whatChanged + valores distintos + rationale >=20 +
    // un worker afectado (impacto medium por defecto lo exige).
    fireEvent.change(screen.getByTestId('moc.form.whatChanged'), {
      target: { value: 'Cambio de turno zona B' },
    });
    fireEvent.change(screen.getByTestId('moc.form.previousValue'), {
      target: { value: 'turno A' },
    });
    fireEvent.change(screen.getByTestId('moc.form.newValue'), {
      target: { value: 'turno B' },
    });
    fireEvent.change(screen.getByTestId('moc.form.rationale'), {
      target: {
        value: 'Reasignación por dotación insuficiente en el turno saliente.',
      },
    });
    fireEvent.change(screen.getByTestId('moc.form.newWorkerUid'), {
      target: { value: 'worker-777' },
    });
    fireEvent.click(screen.getByTestId('moc.form.addWorker'));

    fireEvent.click(screen.getByTestId('moc.form.submit'));

    await waitFor(() => {
      expect(declareMocMock).toHaveBeenCalledTimes(1);
    });
    expect(declareMocMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        whatChanged: 'Cambio de turno zona B',
        previousValue: 'turno A',
        newValue: 'turno B',
        affectedWorkerUids: ['worker-777'],
        impact: 'medium',
      }),
    );
  });
});
