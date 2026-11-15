// @vitest-environment jsdom
// src/components/regulatory/Iso45001DetailDrawer.test.tsx
//
// Ticket [P2][a11y] Auditoría de accesibilidad WCAG 2.2 AA.
//
// El drawer de detalle ISO 45001 es un overlay modal (role="dialog" +
// aria-modal). Antes de este ticket NO tenía trampa de tabulación: el teclado
// podía salir del drawer hacia el resto de la página (WCAG 2.4.3 / 2.1.2).
// Estos tests fijan el comportamiento esperado: foco atrapado, Escape,
// restauración del foco al activador y ausencia de violaciones axe críticas.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

import { Iso45001DetailDrawer } from './Iso45001DetailDrawer';

/**
 * Elementos tabulables — mismo criterio que usan los overlays del repo
 * (p. ej. `src/components/changeMgmt/ReasonModal.tsx`). El `<aside
 * tabindex="-1">` recibe el foco inicial por código pero NO es un destino de
 * tabulación, por eso queda fuera.
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

/** Harness mínimo: un activador real + el drawer controlado. */
function DrawerHarness() {
  const [controlId, setControlId] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setControlId('HAZARD_IDENTIFICATION')}>
        Ver control 6.1.2
      </button>
      <Iso45001DetailDrawer controlId={controlId} onClose={() => setControlId(null)} />
    </>
  );
}

describe('Iso45001DetailDrawer', () => {
  it('no renderiza nada cuando controlId es null', () => {
    const { container } = render(<Iso45001DetailDrawer controlId={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('muestra cláusula, título y scope reales del control (no buy-link como primario)', () => {
    render(<Iso45001DetailDrawer controlId="HAZARD_IDENTIFICATION" onClose={() => {}} />);
    expect(screen.getAllByText(/6\.1\.2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Identificaci/).length).toBeGreaterThan(0);
    // The link text comes from t('iso45001.openStandard', 'Ver estándar oficial').
    // The mock returns the fallback which matches the updated es key exactly.
    const link = screen.getByRole('link', { name: /Ver estándar oficial/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('iso.org'));
  });
  it('cierra con el botón cerrar', () => {
    const onClose = vi.fn();
    render(<Iso45001DetailDrawer controlId="LEADERSHIP_COMMITMENT" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('C1: mueve el foco al panel aside al abrirse', async () => {
    // Place a trigger button in the DOM so focus has a natural source.
    const trigger = document.createElement('button');
    trigger.textContent = 'Abrir';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      render(<Iso45001DetailDrawer controlId="HAZARD_IDENTIFICATION" onClose={() => {}} />);
    });

    // The aside has tabIndex={-1} and receives programmatic focus on open.
    const panel = document.querySelector('aside[tabindex="-1"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);

    document.body.removeChild(trigger);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WCAG 2.2 AA — trampa de foco del drawer de detalle
// ─────────────────────────────────────────────────────────────────────────────
describe('Iso45001DetailDrawer — foco y semántica (WCAG 2.2 AA)', () => {
  it('Tab desde el último control NO saca el foco del drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: /Ver control 6\.1\.2/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const last = items[items.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);

    await user.tab();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Shift+Tab desde el primer control NO saca el foco del drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: /Ver control 6\.1\.2/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const first = items[0];
    first.focus();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab desde el último control vuelve al primer control del drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: /Ver control 6\.1\.2/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    expect(first).toBe(screen.getByRole('button', { name: /cerrar/i }));
    expect(last).toHaveAttribute('href', expect.stringContaining('iso.org'));

    last.focus();
    await user.tab();

    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab desde el primer control vuelve al último control del drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: /Ver control 6\.1\.2/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    exposeBackgroundForTabTest(dialog);
    const items = focusablesIn(dialog);
    const first = items[0];
    const last = items[items.length - 1];

    first.focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(last);
  });

  it('Escape cierra el drawer y el foco vuelve al activador', async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: /Ver control 6\.1\.2/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    const close = within(dialog).getByRole('button', { name: /cerrar/i });
    fireEvent.keyDown(close, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('axe: el drawer no reporta violaciones críticas (WCAG 2.2 AA)', async () => {
    render(<Iso45001DetailDrawer controlId="HAZARD_IDENTIFICATION" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    await expect(criticalAxeViolations(dialog)).resolves.toEqual([]);
  });
});
