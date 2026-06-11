// @vitest-environment jsdom
//
// Praeventio Guard — B-protocols page wrapper tests for <PlanesiEvaluation />.
//
// Smoke tests:
//   1. Empty state when no project is selected.
//   2. Renders form, legal frame (DS 594 Art. 66 + protocolo MINSAL) and the
//      ADR 0012 disclaimer.
//   3. Calculate calls the stateless remote and renders % LPP + grade +
//      surveillance periodicity + legal-limit verdict.
//   4. The PLANESI-activation banner appears when the engine flags it.
//   5. Save calls the persistence mutator and refreshes the history.
//   6. History renders persisted assessments.
//
// Remote calls (hooks/useProtocols) and the project context are mocked. The
// mocked result shapes mirror the REAL PlanesiResult contract from
// src/services/protocols/planesi.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanesiEvaluation } from './PlanesiEvaluation';

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
  evaluatePlanesiRemote: (...args: unknown[]) => evaluateMock(...args),
  recordPlanesiAssessment: (...args: unknown[]) => recordMock(...args),
  listProtocolAssessments: (...args: unknown[]) => listMock(...args),
}));

// 0,06 mg/m³ cuarzo @ 12 h → Fj 0,50 → 150% LPP → NR4 / GE1 (engine truth).
const grade1Result = {
  silicaType: 'cuarzo',
  lppMgM3: 0.08,
  jornadaFactor: 0.5,
  altitudeFactor: 1,
  correctedLppMgM3: 0.04,
  percentOfLpp: 150,
  ambientRiskLevel: 4,
  ambientReevaluation:
    'Nivel de Riesgo 4 (Cpp sobre el LPP): el organismo administrador debe prescribir medidas de control inmediatas y notificar a la Autoridad Sanitaria Regional (protocolo sílice MINSAL, 6.6.1.1); reevaluar tras corregir.',
  exposureGrade: 1,
  surveillanceRequired: true,
  surveillancePeriodicity:
    'Grado de Exposición 1 (≥ 50% y hasta 2× LPP): radiografía de tórax cada 2 años (Tabla 7-1).',
  planesiActivated: false,
  exceedsLegalLimit: true,
  exceedsMaxPermitted: false,
  recommendation:
    'Supera el LPP. Implementar controles según jerarquía: sustitución del material con sílice, humectación de polvos, ventilación local exhaustora y cabinas cerradas con filtro; respirador con filtro P100 y prueba de ajuste anual solo como último recurso mientras se corrige el origen.',
};

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  evaluateMock.mockReset().mockResolvedValue({ result: grade1Result });
  recordMock.mockReset().mockResolvedValue({ id: 'a-1', result: grade1Result });
  listMock.mockReset().mockResolvedValue({ assessments: [] });
});

describe('<PlanesiEvaluation /> page (B-protocols, módulo sílice)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<PlanesiEvaluation />);
    expect(screen.getByTestId('planesi-page-empty')).toBeInTheDocument();
  });

  it('renderiza formulario, marco legal D.S. 594 Art. 66 y disclaimer ADR 0012', async () => {
    render(<PlanesiEvaluation />);
    expect(screen.getByTestId('planesi-page')).toBeInTheDocument();
    expect(screen.getByTestId('planesi-legal-frame')).toBeInTheDocument();
    expect(screen.getByTestId('protocols-disclaimer')).toBeInTheDocument();
    expect(screen.getByTestId('planesi-concentration-input')).toBeInTheDocument();
    expect(screen.getByTestId('planesi-hours-input')).toBeInTheDocument();
    expect(screen.getByTestId('planesi-silica-type-select')).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1', 'PLANESI'));
  });

  it('calcular llama al remoto (coma decimal chilena aceptada) y muestra % LPP + grado + vigilancia', async () => {
    render(<PlanesiEvaluation />);
    fireEvent.change(screen.getByTestId('planesi-concentration-input'), {
      target: { value: '0,06' },
    });
    fireEvent.change(screen.getByTestId('planesi-hours-input'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByTestId('planesi-calculate-btn'));
    await waitFor(() => expect(evaluateMock).toHaveBeenCalledTimes(1));
    expect(evaluateMock).toHaveBeenCalledWith('p-1', {
      input: {
        concentrationMgM3: 0.06,
        exposureHoursPerDay: 12,
        silicaType: 'cuarzo',
      },
    });
    expect(await screen.findByTestId('planesi-result')).toBeInTheDocument();
    expect(screen.getByTestId('planesi-grade-badge')).toHaveTextContent('planesi.grade_1');
    expect(screen.getByTestId('planesi-legal-limit')).toHaveTextContent(
      /Supera el límite permisible/,
    );
    // Surveillance periodicity = the engine's es-CL string, verbatim.
    expect(screen.getByTestId('planesi-surveillance')).toHaveTextContent(
      /radiografía de tórax cada 2 años/i,
    );
    expect(screen.getByText(/humectación de polvos/)).toBeInTheDocument();
  });

  it('muestra el aviso de activación PLANESI cuando el motor lo marca', async () => {
    evaluateMock.mockResolvedValue({
      result: { ...grade1Result, planesiActivated: true },
    });
    render(<PlanesiEvaluation />);
    fireEvent.click(screen.getByTestId('planesi-calculate-btn'));
    expect(await screen.findByTestId('planesi-activated')).toBeInTheDocument();
    expect(screen.getByTestId('planesi-activated')).toHaveTextContent(/0,1 mg\/m³/);
  });

  it('guardar llama al mutador y refresca el historial', async () => {
    render(<PlanesiEvaluation />);
    fireEvent.change(screen.getByTestId('planesi-task-input'), {
      target: { value: 'Perforación frente 3' },
    });
    fireEvent.change(screen.getByTestId('planesi-concentration-input'), {
      target: { value: '0,06' },
    });
    fireEvent.change(screen.getByTestId('planesi-hours-input'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByTestId('planesi-calculate-btn'));
    await screen.findByTestId('planesi-result');
    listMock.mockClear();
    fireEvent.click(screen.getByTestId('planesi-save-btn'));
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('p-1', {
      input: {
        concentrationMgM3: 0.06,
        exposureHoursPerDay: 12,
        silicaType: 'cuarzo',
      },
      taskName: 'Perforación frente 3',
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1', 'PLANESI'));
    expect(screen.getByTestId('planesi-status')).toBeInTheDocument();
  });

  it('renderiza el historial persistido del proyecto', async () => {
    listMock.mockResolvedValue({
      assessments: [
        {
          id: 'a-3',
          projectId: 'p-1',
          protocol: 'PLANESI',
          taskName: 'Chancado primario',
          workerId: 'ges-chancado',
          inputs: { concentrationMgM3: 0.5, exposureHoursPerDay: 8 },
          result: { ...grade1Result, exposureGrade: 3, percentOfLpp: 625 },
          computedAt: '2026-06-09T15:30:00.000Z',
          metadata: { author: 'uid-1', signedAt: null },
        },
      ],
    });
    render(<PlanesiEvaluation />);
    expect(await screen.findByTestId('planesi-history-item-a-3')).toBeInTheDocument();
    expect(screen.getByText('Chancado primario')).toBeInTheDocument();
  });
});
