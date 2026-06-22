// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from './Button';

describe('Button', () => {
  it('renderiza el texto y dispara onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('aplica la variante danger (token hazard) y respeta disabled', () => {
    render(<Button variant="danger" disabled>Borrar</Button>);
    const btn = screen.getByRole('button', { name: 'Borrar' });
    expect(btn.className).toMatch(/hazard|danger/);
    expect(btn).toBeDisabled();
  });
});
