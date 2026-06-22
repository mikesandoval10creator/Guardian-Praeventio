// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from './KpiRow';
import { ShieldCheck } from 'lucide-react';

describe('KpiRow', () => {
  it('renderiza valor, label, subtexto y tendencia de cada KPI', () => {
    render(
      <KpiRow
        items={[
          { id: 'comp', label: 'Cumplimiento', value: '82%', sub: '6 de 8 fuentes', trend: { dir: 'up', text: '+4 pts' }, tone: 'success', icon: ShieldCheck },
          { id: 'permits', label: 'Permisos activos', value: 3, sub: 'PT vigentes' },
        ]}
      />,
    );
    expect(screen.getByText('Cumplimiento')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('6 de 8 fuentes')).toBeInTheDocument();
    expect(screen.getByText('+4 pts')).toBeInTheDocument();
    expect(screen.getByText('Permisos activos')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
  it('no usa tipografía sub-12px (calma sin perder dato)', () => {
    const { container } = render(<KpiRow items={[{ id: 'a', label: 'A', value: 1 }]} />);
    expect(container.innerHTML).not.toMatch(/text-\[(7|8|9|10|11)px\]/);
  });
});
