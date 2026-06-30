// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Iso45001Catalog } from './Iso45001Catalog.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<Iso45001Catalog />', () => {
  it('renderiza lista 10 controles', () => {
    render(<Iso45001Catalog />);
    expect(screen.getByTestId('iso45001-catalog')).toBeInTheDocument();
    expect(screen.getByTestId('iso45001-control-LEADERSHIP_COMMITMENT')).toBeInTheDocument();
    expect(screen.getByTestId('iso45001-control-EMERGENCY_PREPAREDNESS')).toBeInTheDocument();
  });

  it('marca cobertura con set de IDs cubiertos', () => {
    render(
      <Iso45001Catalog
        coveredControlIds={new Set(['LEADERSHIP_COMMITMENT', 'WORKER_PARTICIPATION'])}
      />,
    );
    expect(screen.getByTestId('iso45001-covered-LEADERSHIP_COMMITMENT')).toBeInTheDocument();
    expect(screen.getByTestId('iso45001-coverage').textContent).toMatch(/20%/);
  });

  it('dispara onControlClick', () => {
    const onClick = vi.fn();
    render(<Iso45001Catalog onControlClick={onClick} />);
    fireEvent.click(screen.getByTestId('iso45001-btn-LEADERSHIP_COMMITMENT'));
    expect(onClick).toHaveBeenCalledWith('LEADERSHIP_COMMITMENT');
  });

  it('al clickear un control abre el drawer de detalle (no navega a iso.org)', () => {
    render(<Iso45001Catalog />);
    const firstBtn = screen.getByTestId('iso45001-btn-LEADERSHIP_COMMITMENT');
    fireEvent.click(firstBtn);
    expect(screen.getByRole('dialog', { name: /Detalle de control ISO 45001/i })).toBeInTheDocument();
  });
});
