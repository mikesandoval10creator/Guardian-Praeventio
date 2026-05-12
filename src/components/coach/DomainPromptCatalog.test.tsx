// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DomainPromptCatalog } from './DomainPromptCatalog.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<DomainPromptCatalog />', () => {
  it('renderiza 3 tabs', () => {
    render(<DomainPromptCatalog />);
    expect(screen.getByTestId('domain-prompt-catalog')).toBeInTheDocument();
    expect(screen.getByTestId('domain-prompt-tab-chemical')).toBeInTheDocument();
    expect(screen.getByTestId('domain-prompt-tab-medicine')).toBeInTheDocument();
    expect(screen.getByTestId('domain-prompt-tab-legal')).toBeInTheDocument();
  });

  it('renderiza system prompt + citations del dominio actual', () => {
    render(<DomainPromptCatalog />);
    expect(screen.getByTestId('domain-prompt-content-chemical')).toBeInTheDocument();
    expect(screen.getByTestId('domain-prompt-system-chemical').textContent).toMatch(
      /DS 594/,
    );
    expect(screen.getByTestId('domain-prompt-citations-chemical')).toBeInTheDocument();
  });

  it('cambio de tab cambia content', () => {
    render(<DomainPromptCatalog />);
    fireEvent.click(screen.getByTestId('domain-prompt-tab-legal'));
    expect(screen.getByTestId('domain-prompt-content-legal')).toBeInTheDocument();
  });

  it('dispara onDomainSelect', () => {
    const onSel = vi.fn();
    render(<DomainPromptCatalog onDomainSelect={onSel} />);
    fireEvent.click(screen.getByTestId('domain-prompt-tab-medicine'));
    expect(onSel).toHaveBeenCalledWith('medicine');
  });
});
