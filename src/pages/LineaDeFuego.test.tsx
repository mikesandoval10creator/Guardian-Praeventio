// @vitest-environment jsdom
// Behavioral test for the Línea de Fuego self-assessment tool: the page wires
// the real validateLineOfFire engine to the form, so checking the required
// mitigations must move the verdict from BLOQUEO (people in path + missing
// controls) to CUMPLE (all controls declared). This is a real integration test
// over the actual engine, not a render smoke test.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LineaDeFuego } from './LineaDeFuego';

// Deterministic copy: t() returns the fallback so we assert engine output, not i18n.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

describe('LineaDeFuego (struck-by/caught-between tool over real engine)', () => {
  it('default exposure (people in path, no mitigations) → BLOQUEO recommendation', () => {
    render(<LineaDeFuego />);
    expect(screen.getByTestId('lof-card-suspended_load')).toBeTruthy();
    const msg = screen.getByTestId('lof-message-suspended_load').textContent ?? '';
    expect(msg).toContain('BLOQUEO');
  });

  it('checking all required mitigations clears the verdict to CUMPLE', () => {
    render(<LineaDeFuego />);
    // suspended_load required mitigations (canonical phrases the engine matches).
    for (const phrase of [
      'zona de exclusión bajo carga',
      'tag-line para guiar carga',
      'señalero entrenado',
    ]) {
      fireEvent.click(screen.getByLabelText(phrase));
    }
    const msg = screen.getByTestId('lof-message-suspended_load').textContent ?? '';
    expect(msg).toContain('todas las mitigaciones');
    expect(msg).not.toContain('BLOQUEO');
  });
});
