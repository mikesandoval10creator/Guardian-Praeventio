// @vitest-environment jsdom
//
// Praeventio Guard — B-protocols page wrapper tests for <PrexorEvaluation />.
//
// Smoke tests:
//   1. Empty state when no project is selected.
//   2. Renders measurement form, legal frame and ADR 0012 disclaimer.
//   3. Add/remove measurement rows.
//   4. Calculate calls the stateless remote and renders dose + LAeq + the
//      legal-limit verdict and mandated action.
//   5. Save calls the persistence mutator and refreshes the history.
//   6. History renders persisted assessments.
//
// Remote calls (hooks/useProtocols) and the project context are mocked. The
// mocked result shapes mirror the REAL PrexorResult contract from
// src/services/protocols/prexor.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrexorEvaluation } from './PrexorEvaluation';

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

const calculateMock = vi.fn();
const recordMock = vi.fn();
const listMock = vi.fn();

vi.mock('../hooks/useProtocols', () => ({
  calculatePrexorRemote: (...args: unknown[]) => calculateMock(...args),
  recordPrexorAssessment: (...args: unknown[]) => recordMock(...args),
  listProtocolAssessments: (...args: unknown[]) => listMock(...args),
}));

const altoResult = {
  dosePercent: 317.5,
  leqEq8hDbA: 90,
  riskLevel: 'alto',
  recommendation:
    'Riesgo alto. Audiometría anual, controles de ingeniería/administrativos y uso obligatorio de protección auditiva certificada.',
  exceedsLegalLimit: true,
};

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  calculateMock.mockReset().mockResolvedValue({ result: altoResult });
  recordMock.mockReset().mockResolvedValue({ id: 'a-1', result: altoResult });
  listMock.mockReset().mockResolvedValue({ assessments: [] });
});

describe('<PrexorEvaluation /> page (B-protocols)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<PrexorEvaluation />);
    expect(screen.getByTestId('prexor-page-empty')).toBeInTheDocument();
  });

  it('renderiza formulario, marco legal D.S. 594 y disclaimer ADR 0012', async () => {
    render(<PrexorEvaluation />);
    expect(screen.getByTestId('prexor-page')).toBeInTheDocument();
    expect(screen.getByTestId('prexor-legal-frame')).toBeInTheDocument();
    expect(screen.getByTestId('protocols-disclaimer')).toBeInTheDocument();
    expect(screen.getByTestId('prexor-measurement-row-0')).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1', 'PREXOR'));
  });

  it('agrega y quita filas de medición', () => {
    render(<PrexorEvaluation />);
    fireEvent.click(screen.getByTestId('prexor-add-row-btn'));
    expect(screen.getByTestId('prexor-measurement-row-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('prexor-remove-row-1'));
    expect(screen.queryByTestId('prexor-measurement-row-1')).not.toBeInTheDocument();
    // The last remaining row cannot be removed.
    expect(
      (screen.getByTestId('prexor-remove-row-0') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('calcular llama al remoto con las mediciones y muestra dosis + límite legal', async () => {
    render(<PrexorEvaluation />);
    fireEvent.change(screen.getByTestId('prexor-duration-input-0'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByTestId('prexor-level-input-0'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByTestId('prexor-calculate-btn'));
    await waitFor(() => expect(calculateMock).toHaveBeenCalledTimes(1));
    expect(calculateMock).toHaveBeenCalledWith('p-1', {
      measurements: [{ durationHours: 8, levelDbA: 90 }],
    });
    expect(await screen.findByTestId('prexor-result')).toBeInTheDocument();
    expect(screen.getByTestId('prexor-risk-badge')).toHaveTextContent('prexor.risk_alto');
    expect(screen.getByTestId('prexor-legal-limit')).toHaveTextContent(
      /Supera el límite legal/,
    );
    // Mandated action = the engine's es-CL recommendation, verbatim.
    expect(screen.getByText(/Audiometría anual/)).toBeInTheDocument();
  });

  it('guardar llama al mutador y refresca el historial', async () => {
    render(<PrexorEvaluation />);
    fireEvent.change(screen.getByTestId('prexor-task-input'), {
      target: { value: 'Sala chancado' },
    });
    fireEvent.change(screen.getByTestId('prexor-duration-input-0'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByTestId('prexor-level-input-0'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByTestId('prexor-calculate-btn'));
    await screen.findByTestId('prexor-result');
    listMock.mockClear();
    fireEvent.click(screen.getByTestId('prexor-save-btn'));
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('p-1', {
      measurements: [{ durationHours: 8, levelDbA: 90 }],
      taskName: 'Sala chancado',
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1', 'PREXOR'));
    expect(screen.getByTestId('prexor-status')).toBeInTheDocument();
  });

  it('renderiza el historial persistido del proyecto', async () => {
    listMock.mockResolvedValue({
      assessments: [
        {
          id: 'a-3',
          projectId: 'p-1',
          protocol: 'PREXOR',
          taskName: 'Perforación nivel 2',
          workerId: 'worker-9',
          inputs: [],
          result: { ...altoResult, riskLevel: 'critico', dosePercent: 1200 },
          computedAt: '2026-06-09T15:30:00.000Z',
          metadata: { author: 'uid-1', signedAt: null },
        },
      ],
    });
    render(<PrexorEvaluation />);
    expect(await screen.findByTestId('prexor-history-item-a-3')).toBeInTheDocument();
    expect(screen.getByText('Perforación nivel 2')).toBeInTheDocument();
  });
});
