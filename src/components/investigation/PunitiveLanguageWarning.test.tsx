// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PunitiveLanguageWarning } from './PunitiveLanguageWarning.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<PunitiveLanguageWarning />', () => {
  it('texto neutro → muestra ok', () => {
    render(
      <PunitiveLanguageWarning text="El procedimiento no contemplaba esta condición climática específica." />,
    );
    expect(screen.getByTestId('punitive-language-ok')).toBeInTheDocument();
  });

  it('texto con "culpa" → muestra warning + sugerencias', () => {
    render(<PunitiveLanguageWarning text="Fue culpa del trabajador por no revisar." />);
    expect(screen.getByTestId('punitive-language-warning')).toBeInTheDocument();
    expect(screen.getByTestId('punitive-language-warning')).toHaveTextContent(/culpa/i);
    expect(screen.getByTestId('punitive-language-warning')).toHaveTextContent(/sistémica|factores/i);
  });

  it('onAcknowledge dispara', () => {
    const onAck = vi.fn();
    render(
      <PunitiveLanguageWarning
        text="Negligencia evidente del operador."
        onAcknowledge={onAck}
      />,
    );
    fireEvent.click(screen.getByTestId('punitive-acknowledge'));
    expect(onAck).toHaveBeenCalledTimes(1);
  });
});
