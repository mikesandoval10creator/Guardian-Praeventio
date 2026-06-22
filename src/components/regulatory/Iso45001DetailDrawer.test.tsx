// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Iso45001DetailDrawer } from './Iso45001DetailDrawer';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

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
