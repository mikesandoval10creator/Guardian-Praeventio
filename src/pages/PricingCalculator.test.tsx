// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §171-179 PricingCalculator smoke tests.
//
// Verifica:
//   1. La página renderiza con los outputs de plan recomendado, costo,
//      ROI, EPP budget.
//   2. ROI consume `roiCalculator.computeRoi` correctamente (al menos un
//      caso de prueba determinístico).
//   3. El botón "Generar OC (.pdf)" llama a generatePricingOcPdf y al
//      .save() del documento jsPDF (H21 cerrado Fase A.3).
//   4. El botón "Descargar JSON" dispara URL.createObjectURL (legacy
//      integration shape).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScenarioComparison } from '../services/roiScenario/roiScenarioSimulator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      // Interpolate {{var}} tokens so subtitle/sensitivity copy is testable.
      if (typeof fallback === 'string') {
        const vars = (opts ?? (typeof fallback === 'object' ? fallback : {})) as Record<string, unknown>;
        return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key) =>
          vars[key] != null ? String(vars[key]) : '',
        );
      }
      return _k;
    },
  }),
}));

// Mock del renderer PDF — verificamos el wire sin ejecutar el render
// completo (jsdom no implementa Canvas que jsPDF puede usar para fonts
// custom; helvetica embebida del builtin sí funciona pero preferimos
// aislar la unidad de test).
const mockSave = vi.fn();
vi.mock('../utils/pricingOcPdf', () => ({
  generatePricingOcPdf: vi.fn(() => ({ save: mockSave })),
}));

// Project context: la página llama useProject() para el ROI scenario
// comparator. Por defecto NO hay proyecto activo (empty-state). Tests que
// ejercitan el comparador setean selectedProject vía setSelectedProject.
let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    projects: [],
    selectedProject: mockSelectedProject,
    setSelectedProject: vi.fn(),
    createProject: vi.fn(),
    loading: false,
    error: null,
  }),
}));

// ROI scenario hook: mockea el fetch real al endpoint
// POST /api/sprint-k/:projectId/roi-scenario/compare. El test pasa los
// inputs reales derivados de la calculadora y verifica que la respuesta
// del servidor se RENDERIZE (tabla + rationale), no que se descarte.
const mockCompareRoiScenarios = vi.fn();
vi.mock('../hooks/useRoiScenario', () => ({
  compareRoiScenarios: (...args: unknown[]) => mockCompareRoiScenarios(...args),
}));

import { PricingCalculator } from './PricingCalculator';
import { generatePricingOcPdf } from '../utils/pricingOcPdf';

function renderPage() {
  return render(
    <MemoryRouter>
      <PricingCalculator />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Reset scenario mocks per test — default: no active project, no fetch.
  mockSelectedProject = null;
  mockCompareRoiScenarios.mockReset();
  mockCompareRoiScenarios.mockResolvedValue({
    comparison: {} as ScenarioComparison,
  });
  // Polyfill URL.createObjectURL / revokeObjectURL in jsdom.
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock'),
    });
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  }
  if (!('revokeObjectURL' in URL)) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  }
  // Avoid jsdom "Not implemented: navigation" warning when the page
  // dispatches a synthetic click on a generated anchor with `download`.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('<PricingCalculator /> Sprint K §171-179', () => {
  it('smoke: renders main sections', () => {
    renderPage();
    expect(screen.getByTestId('pricing-calculator-page')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calculator-inputs')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calculator-recommendation')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calculator-current-cost')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calculator-tier-table')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calculator-roi')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-calculator-epp')).toBeInTheDocument();
  });

  it('computes a positive ROI when baseline > current incidents (deterministic)', () => {
    renderPage();
    // Defaults: baseline=12, current=4 → 8 incidentes evitados / año.
    const avoided = screen.getByTestId('pc-roi-avoided');
    expect(avoided.textContent).toBe('8');
    // ROI debería ser un porcentaje finito > 0 con defaults.
    const roiPercent = screen.getByTestId('pc-roi-percent').textContent ?? '';
    expect(roiPercent).toMatch(/\d/);
    expect(roiPercent).not.toBe('∞');
  });

  it('recalculates ROI when baseline drops to match current (no incidents avoided)', () => {
    renderPage();
    const baseline = screen.getByTestId('pc-roi-baseline') as HTMLInputElement;
    fireEvent.change(baseline, { target: { value: '4' } }); // == currentIncidents default
    expect(screen.getByTestId('pc-roi-avoided').textContent).toBe('0');
    // Payback con savings=0 debe mostrar "No recuperable".
    expect(screen.getByTestId('pc-roi-payback').textContent).toContain('No recuperable');
  });

  it('generates PDF OC when clicking Generar OC (.pdf) — H21 cierre Fase A.3', () => {
    renderPage();
    const btn = screen.getByTestId('pc-generate-oc');
    fireEvent.click(btn);
    expect(generatePricingOcPdf).toHaveBeenCalledTimes(1);
    // Payload mínimo verificable: industry + workers + projects + tier + plan
    // + EPP budget + ROI campos.
    const arg = (generatePricingOcPdf as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      industryPrefix: string;
      workers: number;
      projects: number;
    };
    expect(arg.industryPrefix).toBeTruthy();
    expect(typeof arg.workers).toBe('number');
    expect(typeof arg.projects).toBe('number');
    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedName = mockSave.mock.calls[0]?.[0] as string;
    expect(savedName).toMatch(/^praeventio-oc-\d+\.pdf$/);
  });

  it('downloads JSON via secondary button (programmatic integration shape)', () => {
    renderPage();
    const btn = screen.getByTestId('pc-download-oc-json');
    fireEvent.click(btn);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('updates recommended tier when worker count crosses a threshold', () => {
    renderPage();
    const workers = screen.getByTestId('pc-workers') as HTMLInputElement;
    fireEvent.change(workers, { target: { value: '50000' } });
    // 50k trabajadores debería empujar a `diamante` (la cima ilimitada).
    const recoSection = screen.getByTestId('pricing-calculator-recommendation');
    const text = recoSection.textContent ?? '';
    expect(text.toLowerCase()).toMatch(/diamante/i);
  });
});

describe('<PricingCalculator /> ROI scenario comparator (server-computed)', () => {
  it('shows the honest empty-state when no project is active (no fetch)', () => {
    mockSelectedProject = null;
    renderPage();
    expect(screen.getByTestId('pc-scenario-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pc-scenario-rationale')).not.toBeInTheDocument();
    // Sin proyecto activo NO se llama al endpoint.
    expect(mockCompareRoiScenarios).not.toHaveBeenCalled();
  });

  it('renders the server comparison (table + rationale) when a project is active', async () => {
    mockSelectedProject = { id: 'proj-abc-123', name: 'Faena Norte' };
    const comparison: ScenarioComparison = {
      baseline: {
        averageDirectCostPerIncidentClp: 2_500_000,
        baselineRatePerYear: 12,
        workersCount: 120,
        indirectMultiplier: 4,
      },
      outcomes: [
        {
          scenarioId: 'current-program',
          scenarioName: 'Programa actual',
          totalInvestmentClp: 5_000_000,
          projectedSavingsClp: 87_500_000,
          projectedRoiPercent: 1650,
          paybackMonths: 0.7,
          recommendationScore: 78.5,
          sensitivityBand: { roiLowerBound: 1300, roiUpperBound: 2000 },
        },
      ],
      recommendedScenario: {
        scenarioId: 'current-program',
        scenarioName: 'Programa actual',
        totalInvestmentClp: 5_000_000,
        projectedSavingsClp: 87_500_000,
        projectedRoiPercent: 1650,
        paybackMonths: 0.7,
        recommendationScore: 78.5,
        sensitivityBand: { roiLowerBound: 1300, roiUpperBound: 2000 },
      },
      rationale: [
        'Escenario recomendado: "Programa actual" con score 78.5/100.',
        'ROI proyectado: 1650%, payback 0.7 meses.',
      ],
    };
    mockCompareRoiScenarios.mockResolvedValue({ comparison });

    renderPage();

    // El dato comparado del SERVIDOR se renderiza (no se descarta).
    const savings = await screen.findByTestId('pc-scenario-savings-current-program');
    // Valor real del servidor formateado a CLP.
    expect(savings.textContent).toContain('87.500.000');
    expect(screen.getByTestId('pc-scenario-score-current-program').textContent).toContain('78.5/100');
    expect(screen.getByTestId('pc-scenario-roi-current-program').textContent).toContain('1650%');

    // El rationale del servidor también se muestra.
    const rationale = screen.getByTestId('pc-scenario-rationale');
    expect(rationale.textContent).toContain('Programa actual');
    expect(rationale.textContent).toContain('78.5/100');

    // Ya no se muestra el empty-state.
    expect(screen.queryByTestId('pc-scenario-empty')).not.toBeInTheDocument();
  });

  it('calls the endpoint with inputs derived from real calculator state (not invented)', async () => {
    mockSelectedProject = { id: 'proj-xyz-789', name: 'Mina Sur' };
    renderPage();

    await waitFor(() => expect(mockCompareRoiScenarios).toHaveBeenCalled());

    const [projectId, input] = mockCompareRoiScenarios.mock.calls.at(-1) as [
      string,
      {
        baseline: { workersCount: number; baselineRatePerYear: number; averageDirectCostPerIncidentClp: number };
        scenarios: Array<{ assumptions: { expectedIncidentReductionPct: number } }>;
      },
    ];

    // projectId = el proyecto activo real.
    expect(projectId).toBe('proj-xyz-789');
    // baseline derivado de los inputs por defecto de la calculadora.
    expect(input.baseline.workersCount).toBe(120);
    expect(input.baseline.baselineRatePerYear).toBe(12);
    expect(input.baseline.averageDirectCostPerIncidentClp).toBe(2_500_000);
    // reductionPct = round((12-4)/12*100) = 67 — derivado, no hardcodeado.
    expect(input.scenarios[0].assumptions.expectedIncidentReductionPct).toBe(67);
  });

  it('falls back to the empty-state (no fabricated rows) when the server fetch fails', async () => {
    mockSelectedProject = { id: 'proj-fail-000', name: 'Faena Falla' };
    mockCompareRoiScenarios.mockRejectedValue(new Error('http_503'));
    renderPage();

    // Tras el rechazo no se inventan filas: se muestra el empty-state.
    await screen.findByTestId('pc-scenario-empty');
    expect(screen.queryByTestId('pc-scenario-rationale')).not.toBeInTheDocument();
  });
});
