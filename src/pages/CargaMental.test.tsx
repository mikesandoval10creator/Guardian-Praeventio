// @vitest-environment jsdom
// Behavioral test for the Carga Mental self-assessment tool: the page wires the
// real scoreMentalLoad engine to the NASA-TLX form, so the rendered verdict must
// follow the engine, not a hardcoded label. Pushing every dimension high must
// yield a "Crítica" level; pushing them low must yield "Baja". This exercises
// the actual scoring (an integration test over the real engine), not a smoke
// render — and proves the result is honest (no fabricated alarm at low load).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CargaMental } from './CargaMental';

// Deterministic copy: t() returns the fallback so we assert engine output.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

const DIMS = [
  'mentalDemand',
  'physicalDemand',
  'temporalDemand',
  'effort',
  'frustration',
  'performance',
] as const;

function setAllDimensions(value: number) {
  for (const key of DIMS) {
    fireEvent.change(screen.getByTestId(`mental-load-slider-${key}`), {
      target: { value: String(value) },
    });
  }
}

describe('CargaMental (NASA-TLX self-assessment over real scoreMentalLoad)', () => {
  it('all dimensions high → Crítica level (real engine, not a fixed label)', async () => {
    render(<CargaMental />);
    setAllDimensions(90);
    fireEvent.click(screen.getByTestId('mental-load-submit'));
    const level = await screen.findByTestId('carga-mental-level');
    expect(level.textContent ?? '').toContain('Crítica');
    expect(level.textContent ?? '').toContain('90/100');
  });

  it('all dimensions low → Baja level, no fabricated alarm', async () => {
    render(<CargaMental />);
    setAllDimensions(10);
    fireEvent.click(screen.getByTestId('mental-load-submit'));
    const level = await screen.findByTestId('carga-mental-level');
    expect(level.textContent ?? '').toContain('Baja');
  });
});
