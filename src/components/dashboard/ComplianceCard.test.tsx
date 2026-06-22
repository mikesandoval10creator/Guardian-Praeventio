// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComplianceCard } from './ComplianceCard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string, opts?: Record<string, unknown>) => {
  if (opts && 'remaining' in opts) return `Falta ${opts.remaining}%`;
  return d ?? _k;
}}) }));

vi.mock('../../store/densityStore', () => ({
  useDensityStore: (sel: (s: { density: string }) => unknown) => sel({ density: 'comfortable' }),
}));

describe('ComplianceCard (rediseño F2)', () => {
  it('conserva TODOS los datos: %, label, nivel y falta %', () => {
    render(<ComplianceCard percentage={82} label="Faena Norte" onClick={() => {}} />);
    expect(screen.getAllByText(/82%/).length).toBeGreaterThan(0);
    expect(screen.getByText('Faena Norte')).toBeInTheDocument();
    expect(screen.getByText(/Nivel Aceptable/)).toBeInTheDocument();
    expect(screen.getByText(/Falta 18%/)).toBeInTheDocument();
  });
  it('dispara onClick', () => {
    const onClick = vi.fn();
    render(<ComplianceCard percentage={50} label="X" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Cumplimiento/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('no usa tipografía sub-12px ni emerald hardcodeado', () => {
    const { container } = render(<ComplianceCard percentage={95} label="Y" onClick={() => {}} />);
    expect(container.innerHTML).not.toMatch(/text-\[(7|9|10)px\]/);
    expect(container.innerHTML).not.toMatch(/text-emerald-\d/);
  });
});
