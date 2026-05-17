// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §171-179 PricingCalculator smoke tests.
//
// Verifica:
//   1. La página renderiza con los outputs de plan recomendado, costo,
//      ROI, EPP budget.
//   2. ROI consume `roiCalculator.computeRoi` correctamente (al menos un
//      caso de prueba determinístico).
//   3. El botón "Generar OC" dispara descarga (URL.createObjectURL).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return _k;
    },
  }),
}));

import { PricingCalculator } from './PricingCalculator';

function renderPage() {
  return render(
    <MemoryRouter>
      <PricingCalculator />
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

  it('downloads JSON OC draft when clicking Generar OC', () => {
    renderPage();
    const btn = screen.getByTestId('pc-generate-oc');
    fireEvent.click(btn);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('updates recommended tier when worker count crosses a threshold', () => {
    renderPage();
    const workers = screen.getByTestId('pc-workers') as HTMLInputElement;
    fireEvent.change(workers, { target: { value: '50000' } });
    // 50k trabajadores debería empujar a `ilimitado` o `global-titanio`.
    const recoSection = screen.getByTestId('pricing-calculator-recommendation');
    const text = recoSection.textContent ?? '';
    expect(text.toLowerCase()).toMatch(/ilimitado|global/i);
  });
});
