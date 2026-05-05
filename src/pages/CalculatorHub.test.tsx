// @vitest-environment jsdom
//
// Sprint 29 Bucket AA F-A — CalculatorHub integration tests.
//
// Verifica para 3 calculadoras (gasDispersion, dikeHydrostatic, scaffoldWindSuction)
// que un input válido por defecto genera output renderizado y que
// writeNodesDebounced es llamado al menos 1 vez con el nodo persistible.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Mocks ────────────────────────────────────────────────────────────────────

const writeNodesDebouncedMock = vi.fn();
vi.mock('../services/zettelkasten/persistence/writeNode', () => ({
  writeNodesDebounced: (...args: unknown[]) => writeNodesDebouncedMock(...args),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'proj-test-1', name: 'Test', createdBy: 'u1' },
  }),
}));

// Stub framer-motion / lucide is fine to render; cite uses pure data.
import { CalculatorHub } from './CalculatorHub';

beforeEach(() => {
  writeNodesDebouncedMock.mockClear();
});

afterEach(() => {
  cleanup();
});

function clickTab(container: HTMLElement, key: string) {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="tab-${key}"]`);
  if (!btn) throw new Error(`tab ${key} not found`);
  btn.click();
}

describe('CalculatorHub — gas dispersion calc', () => {
  it('renders gas-dispersion node and persists via writeNodesDebounced', async () => {
    const { container } = render(<CalculatorHub />);
    // Default tab = atmospheres → GasDispersionCalc rendered with defaults
    // that emit a critical node (releaseRate 0.5, IDLH 30, stab F, wind 10).
    // The card has testid calc-card-EMERGENCY_PREPAREDNESS — but several calcs
    // share that controlId; we instead look for the dispersion-specific input.
    const rateInput = container.querySelector('[data-testid="gd-rate"]');
    expect(rateInput).toBeTruthy();

    // Allow effects to flush
    await Promise.resolve();
    expect(writeNodesDebouncedMock).toHaveBeenCalled();
    // First call's payload should be a single-node array with a real type.
    const firstCall = writeNodesDebouncedMock.mock.calls[0];
    expect(Array.isArray(firstCall[0])).toBe(true);
    const types = writeNodesDebouncedMock.mock.calls.map((c) => c[0][0]?.type);
    expect(types).toContain('gas-dispersion');
  });
});

describe('CalculatorHub — dike hydrostatic calc', () => {
  it('renders dike anomaly node when piezometers under-read and persists', async () => {
    writeNodesDebouncedMock.mockClear();
    const { container } = render(<CalculatorHub />);
    clickTab(container, 'hydraulics');
    await Promise.resolve();

    expect(container.querySelector('[data-testid="dk-rho"]')).toBeTruthy();
    // Defaults emit a dike-hydrostatic node (depth1=10, p1=80kPa < ρgh).
    const types = writeNodesDebouncedMock.mock.calls.map((c) => c[0][0]?.type);
    expect(types).toContain('dike-hydrostatic');
  });
});

describe('CalculatorHub — scaffold wind suction calc', () => {
  it('renders scaffold-uplift node and persists once per render', async () => {
    writeNodesDebouncedMock.mockClear();
    const { container } = render(<CalculatorHub />);
    clickTab(container, 'structural');
    await Promise.resolve();

    expect(container.querySelector('[data-testid="sc-area"]')).toBeTruthy();
    // Defaults: areaM2=50, cp=-1.5, wind=90 km/h → scaffold-uplift node emitted.
    const calls = writeNodesDebouncedMock.mock.calls
      .filter((c) => c[0]?.[0]?.type === 'scaffold-uplift');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0][1]).toEqual({ projectId: 'proj-test-1' });
  });
});
