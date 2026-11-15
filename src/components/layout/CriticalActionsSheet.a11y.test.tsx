// @vitest-environment jsdom
// src/components/layout/CriticalActionsSheet.a11y.test.tsx
//
// Ticket [P2][a11y] Auditoría de accesibilidad WCAG 2.2 AA.
//
// Flujo ANIDADO REAL: `CriticalActionsSheet` abre el `FastCheckModal` POR
// ENCIMA del `Sheet`, que sigue montado detrás.
//
// Este archivo ejercita los componentes REALES (Sheet + FastCheckModal): no
// se mockean los diálogos ni su manejo de foco. Sólo se aíslan los hooks de
// dominio/red (riesgo, proyecto, gamificación, online, Gemini), que no
// tienen relación con la accesibilidad.
//
// Comportamiento exigido (WCAG 2.1.2 / 2.4.3):
//   • el diálogo SUPERIOR es el dueño del foco,
//   • Escape cierra SÓLO el diálogo superior (el Sheet padre sigue abierto),
//   • al cerrarse el hijo, el foco vuelve a su activador (botón Fast Check),
//   • el Sheet padre retoma su propia trampa de foco.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';

// framer-motion: pass-through — los overlays se renderizan reales, sólo se
// elimina la animación (mismo patrón que src/components/shared/Sheet.test.tsx).
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
    AnimatePresence: ({
      children,
      onExitComplete,
    }: { children?: ReactNode; onExitComplete?: () => void }) => {
      if (!children && onExitComplete) queueMicrotask(onExitComplete);
      return <>{children}</>;
    },
    useReducedMotion: () => false,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

// ── Hooks de dominio / red (NUNCA los diálogos ni su foco) ──────────────────
const setModeMock = vi.fn();
vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({ setMode: setModeMock, mode: 'normal', appearance: 'light' }),
}));
vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addNode: vi.fn() }),
}));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena Norte' } }),
}));
vi.mock('../../hooks/useGamification', () => ({
  useGamification: () => ({ addPoints: vi.fn() }),
}));
vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));
vi.mock('../../services/geminiService', () => ({
  analyzeFastCheck: vi.fn(),
}));
vi.mock('../../utils/offlineKnowledge', () => ({
  savePendingOfflineQuery: vi.fn(),
}));

import { CriticalActionsSheet } from './CriticalActionsSheet';

/**
 * Elementos tabulables — mismo criterio que usan los overlays del repo
 * (p. ej. `src/components/changeMgmt/ReasonModal.tsx`).
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

async function criticalAxeViolations(root: Element): Promise<string[]> {
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations
    .filter((violation) => violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.help}`);
}

/** Harness: activador real + Sheet controlado (para poder cerrarlo). */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir acciones críticas
      </button>
      <CriticalActionsSheet isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Abre el Sheet y luego el FastCheck por dentro. Devuelve el Sheet (padre) y
 * el botón activador del FastCheck (hijo).
 */
async function openSheetThenFastCheck(): Promise<{
  sheet: HTMLElement;
  fastCheckButton: HTMLElement;
}> {
  render(<Harness />);
  const opener = screen.getByRole('button', { name: /Abrir acciones críticas/i });
  opener.focus();
  fireEvent.click(opener);

  const sheet = await screen.findByRole('dialog', { name: /Acciones rápidas/i });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar panel' })),
  );

  const fastCheckButton = within(sheet).getByRole('button', { name: /Fast Check/i });
  fastCheckButton.focus();
  expect(document.activeElement).toBe(fastCheckButton);
  fireEvent.click(fastCheckButton);

  return { sheet, fastCheckButton };
}

describe('CriticalActionsSheet — flujo anidado FastCheck (WCAG 2.2 AA)', () => {
  it('el FastCheck se expone como diálogo modal por encima del Sheet', async () => {
    const { sheet } = await openSheetThenFastCheck();

    const dialogs = screen.getAllByRole('dialog', { hidden: true });
    // Sheet (padre) + FastCheck (hijo): el hijo debe tener semántica de diálogo.
    expect(dialogs).toHaveLength(2);
    expect(dialogs).toContain(sheet);
  });

  it('axe: FastCheck no reporta violaciones críticas', async () => {
    await openSheetThenFastCheck();
    const child = screen.getByRole('dialog', { name: /Fast Check/i });
    await expect(criticalAxeViolations(child)).resolves.toEqual([]);
  });

  it('el diálogo superior (FastCheck) es el dueño del foco', async () => {
    const { sheet } = await openSheetThenFastCheck();

    const dialogs = screen.getAllByRole('dialog', { hidden: true });
    expect(dialogs).toHaveLength(2);
    const child = dialogs.find((dialog) => dialog !== sheet);
    expect(child).toBeDefined();

    // El foco debe estar DENTRO del hijo, no en el Sheet que quedó detrás.
    expect(child!.contains(document.activeElement)).toBe(true);
  });

  it('Escape cierra sólo el FastCheck: el Sheet padre sigue abierto', async () => {
    const { sheet } = await openSheetThenFastCheck();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    // El padre NO se cierra con el Escape del hijo.
    expect(screen.queryByRole('dialog', { name: /Acciones rápidas/i })).toBeInTheDocument();
    // El hijo sí se cierra → queda un único diálogo (el Sheet).
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    expect(sheet).toBeInTheDocument();
  });

  it('al cerrarse el FastCheck el foco vuelve a su activador', async () => {
    const { fastCheckButton } = await openSheetThenFastCheck();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(fastCheckButton));
  });

  it('el Sheet retoma su trampa de foco al cerrarse el FastCheck', async () => {
    const user = userEvent.setup();
    const { sheet } = await openSheetThenFastCheck();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // El Sheet sigue abierto: su trampa de foco debe volver a estar activa.
    expect(screen.queryByRole('dialog', { name: /Acciones rápidas/i })).toBeInTheDocument();
    exposeBackgroundForTabTest(sheet);

    const items = focusablesIn(sheet);
    const first = items[0];
    const last = items[items.length - 1];
    expect(first).toBe(screen.getByRole('button', { name: 'Cerrar panel' }));
    expect(last).toHaveTextContent('Fast Check');

    last.focus();
    await user.tab();

    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('cerrar el Sheet padre también descarta el FastCheck abierto', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: /Abrir acciones críticas/i });
    fireEvent.click(opener);

    const sheet = await screen.findByRole('dialog', { name: /Acciones rápidas/i });
    fireEvent.click(within(sheet).getByRole('button', { name: /Fast Check/i }));
    await screen.findByRole('dialog', { name: /Fast Check/i });

    // Simula que el estado de navegación cierra el panel mientras el hijo está abierto.
    fireEvent.click(within(sheet).getByRole('button', { name: /Activar Emergencia/i, hidden: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());

    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: /Acciones rápidas/i });
    expect(screen.queryByRole('dialog', { name: /Fast Check/i })).toBeNull();
  });
});
