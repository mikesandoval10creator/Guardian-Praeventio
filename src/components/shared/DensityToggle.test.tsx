// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DensityToggle } from './DensityToggle';
import { useDensityStore } from '../../store/densityStore';

describe('DensityToggle', () => {
  beforeEach(() => useDensityStore.setState({ density: 'comfortable' }));
  it('marca el segmento activo con aria-pressed', () => {
    render(<DensityToggle />);
    expect(screen.getByRole('button', { name: 'Cómodo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Compacto' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('cambia la densidad al clickear Compacto', () => {
    render(<DensityToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Compacto' }));
    expect(useDensityStore.getState().density).toBe('compact');
  });
});
