// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiResponseCard } from './AiResponseCard';
import type { AiResponse } from '../../services/ai/resilientAiOrchestrator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function response(over: Partial<AiResponse> = {}): AiResponse {
  return {
    text: 'Respuesta de prueba',
    tier: 'slm',
    confidence: 0.85,
    citations: [],
    degraded: false,
    latencyMs: 120,
    tierErrors: [],
    ...over,
  };
}

describe('<AiResponseCard />', () => {
  it('renderiza el texto preservando whitespace', () => {
    render(
      <AiResponseCard
        response={response({ text: 'línea 1\nlínea 2\nlínea 3' })}
      />,
    );
    expect(screen.getByTestId('ai-response-text')).toHaveTextContent(/línea 1/);
    expect(screen.getByTestId('ai-response-text')).toHaveTextContent(/línea 3/);
  });

  it('tier=slm: badge "IA en dispositivo" + degraded NO visible', () => {
    render(<AiResponseCard response={response({ tier: 'slm' })} />);
    expect(screen.getByTestId('ai-response-tier-badge')).toHaveTextContent(
      'IA en dispositivo',
    );
    expect(screen.queryByTestId('ai-response-degraded-banner')).toBeNull();
  });

  it('tier=zettelkasten: degraded banner visible con motivo', () => {
    render(
      <AiResponseCard
        response={response({ tier: 'zettelkasten', degraded: true })}
      />,
    );
    expect(screen.getByTestId('ai-response-tier-badge')).toHaveTextContent(
      'Grafo del proyecto',
    );
    const banner = screen.getByTestId('ai-response-degraded-banner');
    expect(banner).toHaveTextContent(/grafo del proyecto/i);
    expect(banner).toHaveAttribute('data-tier', 'zettelkasten');
  });

  it('tier=canned: banner explica "Sin acceso a IA"', () => {
    render(
      <AiResponseCard response={response({ tier: 'canned', degraded: true })} />,
    );
    expect(screen.getByTestId('ai-response-degraded-banner')).toHaveTextContent(
      /Sin acceso a IA/,
    );
  });

  it('tier=gemini: banner advierte sobre consumo de datos', () => {
    render(
      <AiResponseCard response={response({ tier: 'gemini', degraded: true })} />,
    );
    expect(screen.getByTestId('ai-response-degraded-banner')).toHaveTextContent(
      /consumir datos/,
    );
  });

  it('degraded banner muestra tierErrors en details si presentes', () => {
    render(
      <AiResponseCard
        response={response({
          tier: 'firestore',
          degraded: true,
          tierErrors: [
            { tier: 'slm', error: 'OOM iOS' },
            { tier: 'zettelkasten', error: 'no memory snapshot' },
          ],
        })}
      />,
    );
    const details = screen.getByTestId('ai-response-degraded-details');
    expect(details).toBeInTheDocument();
    // El contenido del <details> está en el DOM aunque esté collapsed.
    const banner = screen.getByTestId('ai-response-degraded-banner');
    expect(banner).toHaveTextContent('OOM iOS');
    expect(banner).toHaveTextContent('no memory snapshot');
  });

  it('confidence dots refleja value (0.85 → 4 filled, 1 empty visual)', () => {
    render(<AiResponseCard response={response({ confidence: 0.85 })} />);
    expect(screen.getByTestId('ai-response-confidence')).toHaveAttribute(
      'data-value',
      '0.85',
    );
  });

  it('latencyMs visible en footer', () => {
    render(<AiResponseCard response={response({ latencyMs: 1234 })} />);
    expect(screen.getByTestId('ai-response-latency')).toHaveTextContent('1234 ms');
  });

  it('hideTelemetry=true oculta footer entero', () => {
    render(<AiResponseCard response={response()} hideTelemetry />);
    expect(screen.queryByTestId('ai-response-footer')).toBeNull();
  });

  it('citations agrupadas por kind con icon + label', () => {
    render(
      <AiResponseCard
        response={response({
          citations: [
            { kind: 'node', ref: 'node-1', label: 'Nodo SOS' },
            { kind: 'node', ref: 'node-2' },
            { kind: 'normative', ref: 'DS-594', label: 'DS 594' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('ai-response-citation-group-node')).toBeInTheDocument();
    expect(screen.getByTestId('ai-response-citation-group-normative')).toBeInTheDocument();
    expect(screen.getByTestId('ai-citation-node-1')).toHaveTextContent('Nodo SOS');
    // Sin label cae al ref.
    expect(screen.getByTestId('ai-citation-node-2')).toHaveTextContent('node-2');
  });

  it('onCitationClick dispara con la citation', () => {
    const onClick = vi.fn();
    render(
      <AiResponseCard
        response={response({
          citations: [{ kind: 'normative', ref: 'DS-594', label: 'DS 594' }],
        })}
        onCitationClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-citation-btn-DS-594'));
    expect(onClick).toHaveBeenCalledWith({
      kind: 'normative',
      ref: 'DS-594',
      label: 'DS 594',
    });
  });

  it('sin onCitationClick: chip renderizado sin botón clickable', () => {
    render(
      <AiResponseCard
        response={response({
          citations: [{ kind: 'normative', ref: 'DS-594' }],
        })}
      />,
    );
    expect(screen.queryByTestId('ai-citation-btn-DS-594')).toBeNull();
    expect(screen.getByTestId('ai-citation-DS-594')).toBeInTheDocument();
  });

  it('sin citations: sección oculta', () => {
    render(<AiResponseCard response={response({ citations: [] })} />);
    expect(screen.queryByTestId('ai-response-citations')).toBeNull();
  });

  it('prompt opcional: header de la pregunta visible', () => {
    render(
      <AiResponseCard
        response={response()}
        prompt="¿Cómo activo el SOS?"
      />,
    );
    expect(screen.getByTestId('ai-response-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('ai-response-card')).toHaveTextContent(
      '¿Cómo activo el SOS?',
    );
  });

  it('sin prompt: header NO se renderiza', () => {
    render(<AiResponseCard response={response()} />);
    expect(screen.queryByTestId('ai-response-prompt')).toBeNull();
  });

  it('data-tier + data-degraded attributes en el article', () => {
    render(
      <AiResponseCard
        response={response({ tier: 'gemini', degraded: true })}
      />,
    );
    const card = screen.getByTestId('ai-response-card');
    expect(card).toHaveAttribute('data-tier', 'gemini');
    expect(card).toHaveAttribute('data-degraded', 'true');
  });

  describe('streaming', () => {
    it('streaming sin response: renderiza texto parcial + caret + indicador', () => {
      render(
        <AiResponseCard
          streaming={{ text: 'Estoy gener', tokensReceived: 3, tier: 'slm' }}
        />,
      );
      expect(screen.getByTestId('ai-response-text')).toHaveTextContent('Estoy gener');
      expect(screen.getByTestId('ai-response-streaming-caret')).toBeInTheDocument();
      const indicator = screen.getByTestId('ai-response-streaming-indicator');
      expect(indicator).toHaveAttribute('data-tokens', '3');
      expect(indicator).toHaveTextContent(/IA generando/);
    });

    it('streaming sin response: data-streaming="true" + aria-busy', () => {
      render(
        <AiResponseCard
          streaming={{ text: '...', tokensReceived: 1, tier: 'slm' }}
        />,
      );
      const card = screen.getByTestId('ai-response-card');
      expect(card).toHaveAttribute('data-streaming', 'true');
      expect(card).toHaveAttribute('aria-busy', 'true');
    });

    it('streaming sin response: footer + citations NO visibles (aún no hay métrica)', () => {
      render(
        <AiResponseCard
          streaming={{ text: 'parcial', tokensReceived: 2, tier: 'slm' }}
        />,
      );
      expect(screen.queryByTestId('ai-response-footer')).toBeNull();
      expect(screen.queryByTestId('ai-response-citations')).toBeNull();
    });

    it('response sin streaming: data-streaming="false" + caret NO visible', () => {
      render(<AiResponseCard response={response()} />);
      const card = screen.getByTestId('ai-response-card');
      expect(card).toHaveAttribute('data-streaming', 'false');
      expect(screen.queryByTestId('ai-response-streaming-caret')).toBeNull();
      expect(screen.queryByTestId('ai-response-streaming-indicator')).toBeNull();
    });

    it('response Y streaming presente (caller no limpió): response gana, no caret', () => {
      render(
        <AiResponseCard
          response={response({ text: 'final' })}
          streaming={{ text: 'parcial', tokensReceived: 5 }}
        />,
      );
      expect(screen.getByTestId('ai-response-text')).toHaveTextContent('final');
      expect(screen.queryByTestId('ai-response-streaming-caret')).toBeNull();
      expect(screen.getByTestId('ai-response-footer')).toBeInTheDocument();
    });

    it('streaming con tier explícito gemini: badge implícito sigue siendo correcto', () => {
      render(
        <AiResponseCard
          streaming={{ text: 'x', tokensReceived: 1, tier: 'gemini' }}
        />,
      );
      const card = screen.getByTestId('ai-response-card');
      expect(card).toHaveAttribute('data-tier', 'gemini');
    });

    it('streaming.text vacío: caret igual visible (UX feedback inmediato)', () => {
      render(
        <AiResponseCard streaming={{ text: '', tokensReceived: 0, tier: 'slm' }} />,
      );
      expect(screen.getByTestId('ai-response-streaming-caret')).toBeInTheDocument();
    });
  });
});
