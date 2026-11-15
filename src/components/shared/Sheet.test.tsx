// @vitest-environment jsdom
// src/components/shared/Sheet.test.tsx
//
// Ticket [P2][a11y] Auditoría de accesibilidad WCAG 2.2 AA.
//
// El `Sheet` (panel lateral) es el overlay de "Acciones rápidas" y de varios
// módulos. Antes de este ticket sólo movía/restauraba el foco: NO existía
// trampa de tabulación, por lo que el teclado podía escapar del panel hacia
// el contenido de fondo (WCAG 2.4.3 Focus Order / 2.1.2).
//
// Estos tests fijan el COMPORTAMIENTO esperado (no la implementación):
//   • foco inicial dentro del panel,
//   • Tab / Shift+Tab atrapados dentro del panel (ida y vuelta),
//   • Escape cierra sólo el panel abierto,
//   • el foco vuelve al elemento que lo abrió,
//   • axe (WCAG 2.0–2.2 A/AA) sin violaciones críticas.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';

vi.mock('framer-motion', () => {
  type PassProps = HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
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
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

import Sheet from './Sheet';

afterEach(cleanup);

/**
 * Elementos tabulables — mismo criterio que usan los overlays del repo
 * (p. ej. `src/components/changeMgmt/ReasonModal.tsx`). El contenedor del
 * panel (`tabindex="-1"`) recibe foco programmaticamente pero NO es un
 * destino de tabulación, por eso queda fuera.
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Bypass user-event's aria-modal shortcut; exercise the component's own trap. */
function exposeBackgroundForTabTest(dialog: HTMLElement): void {
  dialog.removeAttribute('aria-modal');
  for (const sibling of Array.from(document.body.children)) {
    if (!sibling.contains(dialog)) {
      sibling.removeAttribute('inert');
      sibling.removeAttribute('aria-hidden');
    }
  }
}

/** Violaciones CRÍTICAS de axe (WCAG 2.0–2.2 A/AA) dentro de `root`. */
async function criticalAxeViolations(root: Element): Promise<string[]> {
  const results = await axe.run(root, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
    // JSDOM has no canvas implementation; color contrast is a serious-impact
    // rule and is tracked separately in the accessibility audit, not this
    // critical-impact acceptance check.
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations
    .filter((violation) => violation.impact === 'critical')
    .map((violation) => `${violation.id} (${violation.nodes.length} nodos): ${violation.help}`);
}

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
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('el botón cerrar dispara onClose', () => {
    const onClose = vi.fn();
    render(<Sheet isOpen onClose={onClose} title="Acciones">x</Sheet>);
    fireEvent.click(screen.getByLabelText('Cerrar panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WCAG 2.2 AA — trampa de foco del panel lateral
// ─────────────────────────────────────────────────────────────────────────────
describe('Sheet — foco y semántica (WCAG 2.2 AA)', () => {
  it('mueve el foco al botón de cierre al abrir el panel', async () => {
    render(
      <Sheet isOpen onClose={() => {}} title="Acciones">
        <button type="button">Primero</button>
      </Sheet>,
    );
    const close = screen.getByRole('button', { name: 'Cerrar panel' });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  it('Shift+Tab desde el primer control NO saca el foco del panel', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Antes</button>
        <Sheet isOpen onClose={() => {}} title="Acciones">
          <button type="button">Primero</button>
          <button type="button">Ultimo</button>
        </Sheet>
        <button type="button">Despues</button>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const first = items[0];
    first.focus();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab desde el último control mantiene el foco dentro del panel', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Antes</button>
        <Sheet isOpen onClose={() => {}} title="Acciones">
          <button type="button">Primero</button>
          <button type="button">Ultimo</button>
        </Sheet>
        <button type="button">Despues</button>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const last = items[items.length - 1];
    expect(last).toHaveTextContent('Ultimo');

    last.focus();
    await user.tab();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Shift+Tab desde el primer control vuelve al último control del panel', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Antes</button>
        <Sheet isOpen onClose={() => {}} title="Acciones">
          <button type="button">Primero</button>
          <button type="button">Ultimo</button>
        </Sheet>
        <button type="button">Despues</button>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const first = items[0];
    const last = items[items.length - 1];

    first.focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(last);
  });

  it('Escape cierra el panel y el foco vuelve al activador', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir panel
          </button>
          <Sheet isOpen={open} onClose={() => setOpen(false)} title="Acciones">
            <button type="button">Primero</button>
          </Sheet>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir panel' });
    opener.focus();
    fireEvent.click(opener);

    const close = await screen.findByRole('button', { name: 'Cerrar panel' });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.keyDown(close, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('axe: el panel no reporta violaciones críticas (WCAG 2.2 AA)', async () => {
    render(
      <Sheet isOpen onClose={() => {}} title="Acciones">
        <button type="button">Primero</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    await expect(criticalAxeViolations(dialog)).resolves.toEqual([]);
  });
});
