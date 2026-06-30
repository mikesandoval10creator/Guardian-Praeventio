// @vitest-environment jsdom
// src/components/shared/Sheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sheet from './Sheet';

describe('Sheet', () => {
  it('no renderiza contenido cuando isOpen=false', () => {
    render(<Sheet isOpen={false} onClose={() => {}} title="Acciones">contenido</Sheet>);
    expect(screen.queryByText('contenido')).toBeNull();
  });
  it('renderiza título + contenido y es un dialog modal cuando abre', () => {
    render(<Sheet isOpen onClose={() => {}} title="Acciones">contenido</Sheet>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Acciones')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
  it('Escape dispara onClose', () => {
    const onClose = vi.fn();
    render(<Sheet isOpen onClose={onClose} title="Acciones">x</Sheet>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('el botón cerrar dispara onClose', () => {
    const onClose = vi.fn();
    render(<Sheet isOpen onClose={onClose} title="Acciones">x</Sheet>);
    fireEvent.click(screen.getByLabelText('Cerrar panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
