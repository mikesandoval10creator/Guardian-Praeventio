// @vitest-environment jsdom
// src/components/shared/Sheet.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// framer-motion starts real animation promises in jsdom and leaves them
// pending after unmount (the async-leak gate flags them). The sheet's
// behavior under test (dialog semantics, Escape, close) does not need motion.
vi.mock('framer-motion', () => {
  type PassProps = React.HTMLAttributes<HTMLDivElement> & {
    children?: React.ReactNode;
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
  };
  const Pass = ({
    children,
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: PassProps) => <div {...rest}>{children}</div>;
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

import Sheet from './Sheet';

afterEach(cleanup);

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
