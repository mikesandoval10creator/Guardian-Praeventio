// @vitest-environment jsdom
//
// Praeventio Guard — B-protocols page wrapper tests for <TmertEvaluation />.
//
// Smoke tests:
//   1. Empty state when no project is selected.
//   2. Renders form, legal frame and the ADR 0012 exposure disclaimer.
//   3. Calculate calls the stateless remote and renders the verdict +
//      mandated action (engine recommendation) + medical referral note.
//   4. Save is gated on a computed result and a taskName.
//   5. Save calls the persistence mutator and refreshes the history.
//   6. History renders persisted assessments.
//
// All remote calls (hooks/useProtocols) and the project context are mocked —
// hermetic, no fetch/Firestore. The mocked result shapes mirror the REAL
// TmertResult contract from src/services/protocols/tmert.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TmertEvaluation } from './TmertEvaluation';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string) =>
      typeof fallback === 'string' ? fallback : k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

const evaluateMock = vi.fn();
const recordMock = vi.fn();
const listMock = vi.fn();

vi.mock('../hooks/useProtocols', () => ({
  evaluateTmertRemote: (...args: unknown[]) => evaluateMock(...args),
  recordTmertAssessment: (...args: unknown[]) => recordMock(...args),
  listProtocolAssessments: (...args: unknown[]) => listMock(...args),
}));

const altoResult = {
  factorsAtRisk: ['repetitividad', 'fuerza', 'posturaForzada'],
  overallRisk: 'alto',
  recommendation:
    'Riesgo alto. Aplicar controles inmediatos y derivar al trabajador a evaluación médica (medicina del trabajo).',
  requiresMedicalEvaluation: true,
};

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  evaluateMock.mockReset().mockResolvedValue({ result: altoResult });
  recordMock.mockReset().mockResolvedValue({ id: 'a-1', result: altoResult });
  listMock.mockReset().mockResolvedValue({ assessments: [] });
});

describe('<TmertEvaluation /> page (B-protocols)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<TmertEvaluation />);
    expect(screen.getByTestId('tmert-page-empty')).toBeInTheDocument();
  });

  it('renderiza el formulario, el marco legal y el disclaimer ADR 0012', async () => {
    render(<TmertEvaluation />);
    expect(screen.getByTestId('tmert-page')).toBeInTheDocument();
    expect(screen.getByTestId('tmert-legal-frame')).toBeInTheDocument();
    expect(screen.getByTestId('protocols-disclaimer')).toBeInTheDocument();
    // 4 factors × 3 conditions = 12 checkboxes.
    for (const f of ['repetitividad', 'fuerza', 'posturaForzada', 'otros']) {
      for (const c of ['A', 'B', 'C']) {
        expect(screen.getByTestId(`tmert-cond-${f}-${c}`)).toBeInTheDocument();
      }
    }
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1', 'TMERT'));
  });

  it('calcular llama al remoto con el input armado y muestra el veredicto', async () => {
    render(<TmertEvaluation />);
    fireEvent.click(screen.getByTestId('tmert-cond-repetitividad-A'));
    fireEvent.click(screen.getByTestId('tmert-cond-fuerza-B'));
    fireEvent.click(screen.getByTestId('tmert-calculate-btn'));
    await waitFor(() => expect(evaluateMock).toHaveBeenCalledTimes(1));
    expect(evaluateMock).toHaveBeenCalledWith('p-1', {
      input: expect.objectContaining({
        repetitividad: { A: true, B: false, C: false },
        fuerza: { A: false, B: true, C: false },
        exposureHoursPerDay: 8,
      }),
    });
    expect(await screen.findByTestId('tmert-result')).toBeInTheDocument();
    expect(screen.getByTestId('tmert-risk-badge')).toHaveTextContent('tmert.risk_alto');
    // Mandated action = the engine's es-CL recommendation, verbatim.
    expect(screen.getByText(/Aplicar controles inmediatos/)).toBeInTheDocument();
    expect(screen.getByTestId('tmert-medical-referral')).toBeInTheDocument();
  });

  it('guardar exige resultado calculado y tarea no vacía', async () => {
    render(<TmertEvaluation />);
    // Without a computed result the save button is disabled.
    expect((screen.getByTestId('tmert-save-btn') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('tmert-calculate-btn'));
    await screen.findByTestId('tmert-result');
    // With a result but no taskName → validation error, no remote call.
    fireEvent.click(screen.getByTestId('tmert-save-btn'));
    expect(await screen.findByTestId('tmert-error')).toBeInTheDocument();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('guardar llama al mutador con taskName/workerId y refresca el historial', async () => {
    render(<TmertEvaluation />);
    fireEvent.change(screen.getByTestId('tmert-task-input'), {
      target: { value: 'Ensacado manual' },
    });
    fireEvent.change(screen.getByTestId('tmert-worker-input'), {
      target: { value: 'worker-7' },
    });
    fireEvent.click(screen.getByTestId('tmert-calculate-btn'));
    await screen.findByTestId('tmert-result');
    listMock.mockClear();
    fireEvent.click(screen.getByTestId('tmert-save-btn'));
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('p-1', {
      input: expect.objectContaining({ exposureHoursPerDay: 8 }),
      taskName: 'Ensacado manual',
      workerId: 'worker-7',
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1', 'TMERT'));
    expect(screen.getByTestId('tmert-status')).toBeInTheDocument();
  });

  it('renderiza el historial persistido del proyecto', async () => {
    listMock.mockResolvedValue({
      assessments: [
        {
          id: 'a-9',
          projectId: 'p-1',
          protocol: 'TMERT',
          taskName: 'Despacho bodega',
          workerId: null,
          inputs: {},
          result: { ...altoResult, overallRisk: 'medio' },
          computedAt: '2026-06-10T12:00:00.000Z',
          metadata: { author: 'uid-1', signedAt: null },
        },
      ],
    });
    render(<TmertEvaluation />);
    expect(await screen.findByTestId('tmert-history-item-a-9')).toBeInTheDocument();
    expect(screen.getByText('Despacho bodega')).toBeInTheDocument();
  });
});
