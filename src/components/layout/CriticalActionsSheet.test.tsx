// @vitest-environment jsdom
// src/components/layout/CriticalActionsSheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

const setModeMock = vi.fn();
vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({ setMode: setModeMock, mode: 'normal', appearance: 'light' }),
}));
// Sheet uses framer-motion AnimatePresence which triggers infinite recursion
// in React's passive mount effects during tests — stub it to a plain div.
vi.mock('../shared/Sheet', () => ({
  default: ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: ReactNode }) =>
    isOpen ? (
      <div data-testid="sheet">
        <h2>{title}</h2>
        <button aria-label="Cerrar panel" onClick={onClose}>×</button>
        {children}
      </div>
    ) : null,
}));
// FastCheckModal pulls heavy hooks — stub it for this unit test.
vi.mock('../FastCheckModal', () => ({
  FastCheckModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>fast-check-modal</div> : null,
}));

import { CriticalActionsSheet } from './CriticalActionsSheet';

describe('CriticalActionsSheet', () => {
  it('Activar Emergencia llama setMode(emergency) sin navegar y cierra', () => {
    const onClose = vi.fn();
    render(<CriticalActionsSheet isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Activar Emergencia/i }));
    expect(setModeMock).toHaveBeenCalledWith('emergency');
    expect(onClose).toHaveBeenCalled();
  });
  it('Fast Check abre el modal inline (sin route change)', () => {
    render(<CriticalActionsSheet isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Fast Check/i }));
    expect(screen.getByText('fast-check-modal')).toBeInTheDocument();
  });
});
