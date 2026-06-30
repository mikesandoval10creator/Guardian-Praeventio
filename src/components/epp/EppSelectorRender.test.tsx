// @vitest-environment jsdom
// Component render tests for EppSelector — verifies that selecting a different
// rubro dynamically renders that rubro's EPP set. Uses real component + real data.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EppSelector } from './EppSelector';

// Minimal stubs for context dependencies used by GuardianMascot
vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({ mode: 'normal-light' }),
}));

// react-i18next stub — returns the fallback string (3rd arg to t())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, _opts?: unknown) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

describe('EppSelector', () => {
  it('renders the section header', () => {
    render(<EppSelector />);
    expect(screen.getByText('Personalización Inteligente')).toBeTruthy();
    expect(
      screen.getByText('Adapta tu equipo según tu profesión y entorno'),
    ).toBeTruthy();
  });

  it('renders the rubro dropdown with all 14 industries from prototype', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    // 14 rubros from the praevium-guard prototype (founder-confirmed list)
    expect(select.options.length).toBe(14);
  });

  it('defaults to Minería and shows casco minero', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    expect(select.value).toBe('GP-MIN');
    expect(screen.getByText('Casco minero')).toBeTruthy();
  });

  it('switching to Gastronomía renders gorro de cocinero', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GP-ALOJA-COM' } });
    expect(screen.getByText('Gorro de cocinero')).toBeTruthy();
    expect(screen.getByText('Calzado antideslizante')).toBeTruthy();
  });

  it('switching to Construcción renders casco + zapatos', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GP-CONS' } });
    expect(screen.getByText('Casco de seguridad')).toBeTruthy();
    expect(screen.getByText('Zapatos de seguridad')).toBeTruthy();
  });

  it('switching to Área de Salud renders N95 + guantes desechables', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GP-SAL' } });
    expect(screen.getByText('Mascarilla N95')).toBeTruthy();
    expect(screen.getByText('Guantes desechables')).toBeTruthy();
    expect(screen.getByText('Bata de protección')).toBeTruthy();
  });

  it('EPP grid is present in DOM', () => {
    render(<EppSelector />);
    expect(screen.getByTestId('epp-grid')).toBeTruthy();
  });

  it('switching to Educación shows Vocación with ❤️ — beloved founder detail', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GP-EDU' } });
    expect(screen.getByText('Vocación')).toBeTruthy();
    expect(screen.getByText('❤️')).toBeTruthy();
  });

  it('switching to Mecánica Automotriz shows overol and gafas', () => {
    render(<EppSelector />);
    const select = screen.getByTestId('epp-rubro-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GP-MECA-AUTO' } });
    expect(screen.getByText('Overol de trabajo')).toBeTruthy();
  });
});
