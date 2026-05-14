// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResilientAiAssistantPanel } from './ResilientAiAssistantPanel';
import type { TierAdapter } from '../../services/ai/resilientAiOrchestrator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function ok(text: string, confidence = 0.9): TierAdapter {
  return async () => ({ text, confidence, citations: [] });
}

describe('<ResilientAiAssistantPanel />', () => {
  it('estado inicial: panel visible, sin history', () => {
    render(<ResilientAiAssistantPanel adapters={{ slm: ok('hola') }} />);
    expect(screen.getByTestId('resilient-ai-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-panel-history')).toBeNull();
    expect(screen.getByTestId('ai-panel-emergency-toggle')).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('submit con Enter agrega respuesta al history', async () => {
    render(<ResilientAiAssistantPanel adapters={{ slm: ok('respuesta SLM') }} />);
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: '¿Cómo activo SOS?' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('ai-panel-history')).toHaveTextContent(
        'respuesta SLM',
      );
    });
    expect(screen.getByTestId('ai-panel-history')).toHaveTextContent(
      '¿Cómo activo SOS?',
    );
  });

  it('Enter con Shift NO submitea (newline normal)', async () => {
    const adapter = vi.fn(async () => ({ text: 'no debería', confidence: 0.9 }));
    render(<ResilientAiAssistantPanel adapters={{ slm: adapter }} />);
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: 'línea uno' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('submit con botón send funciona', async () => {
    render(<ResilientAiAssistantPanel adapters={{ slm: ok('via botón') }} />);
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-panel-submit'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ai-panel-history')).toHaveTextContent(
        'via botón',
      );
    });
  });

  it('submit vacío (whitespace only) NO dispara', async () => {
    const adapter = vi.fn(async () => ({ text: 'x', confidence: 0.9 }));
    render(<ResilientAiAssistantPanel adapters={{ slm: adapter }} />);
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('botón emergencia toggle: data-emergency-mode + hint visible', () => {
    render(<ResilientAiAssistantPanel adapters={{ slm: ok('x') }} />);
    expect(screen.getByTestId('resilient-ai-panel')).toHaveAttribute(
      'data-emergency-mode',
      'false',
    );
    expect(screen.queryByTestId('ai-panel-emergency-hint')).toBeNull();

    fireEvent.click(screen.getByTestId('ai-panel-emergency-toggle'));
    expect(screen.getByTestId('resilient-ai-panel')).toHaveAttribute(
      'data-emergency-mode',
      'true',
    );
    expect(screen.getByTestId('ai-panel-emergency-hint')).toBeInTheDocument();
  });

  it('suggestions: chip rellena el input al click', () => {
    render(
      <ResilientAiAssistantPanel
        adapters={{ slm: ok('x') }}
        suggestions={['¿Qué EPP necesito para altura?', '¿Cómo declaro DIAT?']}
      />,
    );
    expect(screen.getByTestId('ai-panel-suggestions')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-panel-suggestion-1'));
    expect((screen.getByTestId('ai-panel-input') as HTMLTextAreaElement).value).toBe(
      '¿Cómo declaro DIAT?',
    );
  });

  it('suggestions desaparecen una vez hay history', async () => {
    render(
      <ResilientAiAssistantPanel
        adapters={{ slm: ok('respuesta') }}
        suggestions={['sug 1']}
      />,
    );
    expect(screen.getByTestId('ai-panel-suggestions')).toBeInTheDocument();
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('ai-panel-suggestions')).toBeNull();
    });
  });

  it('clear history limpia los items', async () => {
    render(<ResilientAiAssistantPanel adapters={{ slm: ok('respuesta') }} />);
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('ai-panel-history')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('ai-panel-clear'));
    expect(screen.queryByTestId('ai-panel-history')).toBeNull();
  });

  it('maxHistory cap respetado', async () => {
    let n = 0;
    const adapter: TierAdapter = async () => ({
      text: `respuesta ${++n}`,
      confidence: 0.9,
    });
    render(
      <ResilientAiAssistantPanel adapters={{ slm: adapter }} maxHistory={2} />,
    );
    const input = screen.getByTestId('ai-panel-input');

    for (let i = 1; i <= 3; i++) {
      fireEvent.change(input, { target: { value: `q${i}` } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      // Esperar el render del history antes de la siguiente iteración.
      await waitFor(() => {
        expect(screen.getByTestId('ai-panel-history')).toHaveTextContent(
          `respuesta ${i}`,
        );
      });
    }
    // Última entry primero. La 1ª debería haber caído fuera del cap.
    const history = screen.getByTestId('ai-panel-history');
    expect(history).toHaveTextContent('respuesta 3');
    expect(history).toHaveTextContent('respuesta 2');
    expect(history).not.toHaveTextContent('respuesta 1');
  });

  it('queryExtras (tenantId, userUid, defaultDomain) llegan al adapter', async () => {
    const adapter = vi.fn(async () => ({ text: 'x', confidence: 0.9 }));
    render(
      <ResilientAiAssistantPanel
        adapters={{ slm: adapter }}
        tenantId="t-1"
        userUid="u-1"
        defaultDomain="emergency"
      />,
    );
    const input = screen.getByTestId('ai-panel-input');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => {
      expect(adapter).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'hola',
          domain: 'emergency',
          tenantId: 't-1',
          userUid: 'u-1',
        }),
      );
    });
  });

  it('placeholder custom', () => {
    render(
      <ResilientAiAssistantPanel
        adapters={{ slm: ok('x') }}
        placeholder="custom placeholder"
      />,
    );
    expect(
      (screen.getByTestId('ai-panel-input') as HTMLTextAreaElement).placeholder,
    ).toBe('custom placeholder');
  });
});
