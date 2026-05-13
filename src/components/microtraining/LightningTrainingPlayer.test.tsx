// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LightningTrainingPlayer } from './LightningTrainingPlayer.js';
import { MICROTRAINING_CATALOG } from '../../services/microtraining/lightningTrainingService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const altura = MICROTRAINING_CATALOG.find((m) => m.id === 'mt-altura-v1')!;
const ergo = MICROTRAINING_CATALOG.find((m) => m.id === 'mt-ergo-v1')!;

describe('<LightningTrainingPlayer />', () => {
  it('renderiza paso inicial con título y timer', () => {
    render(<LightningTrainingPlayer module={altura} workerUid="w-1" />);
    expect(screen.getByTestId('lightning-player')).toBeInTheDocument();
    expect(screen.getByTestId('lightning-timer')).toBeInTheDocument();
    expect(screen.getByTestId('lightning-block-0')).toBeInTheDocument();
  });

  it('avanza con botón Siguiente', () => {
    render(<LightningTrainingPlayer module={altura} workerUid="w-1" />);
    fireEvent.click(screen.getByTestId('lightning-next'));
    expect(screen.getByTestId('lightning-block-1')).toBeInTheDocument();
    expect(screen.getByTestId('lightning-quiz-1')).toBeInTheDocument();
  });

  it('botón Siguiente bloqueado hasta responder quiz', () => {
    render(<LightningTrainingPlayer module={altura} workerUid="w-1" />);
    fireEvent.click(screen.getByTestId('lightning-next')); // → quiz 1
    const next = screen.getByTestId('lightning-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('lightning-option-1-1'));
    expect(next.disabled).toBe(false);
  });

  it('completa con todas correctas → score 100 + certificación', () => {
    const onComplete = vi.fn();
    render(
      <LightningTrainingPlayer
        module={altura}
        workerUid="w-1"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByTestId('lightning-next')); // text → quiz1
    fireEvent.click(screen.getByTestId('lightning-option-1-1'));
    fireEvent.click(screen.getByTestId('lightning-next')); // quiz1 → quiz2
    fireEvent.click(screen.getByTestId('lightning-option-2-1'));
    fireEvent.click(screen.getByTestId('lightning-next')); // finish

    expect(screen.getByTestId('lightning-result')).toBeInTheDocument();
    expect(screen.getByTestId('lightning-score').textContent).toBe('100');
    expect(screen.getByTestId('lightning-certified')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('módulo sin certifyOnPass no emite cert aunque pase', () => {
    render(<LightningTrainingPlayer module={ergo} workerUid="w-1" />);
    fireEvent.click(screen.getByTestId('lightning-next')); // text → quiz
    fireEvent.click(screen.getByTestId('lightning-option-1-1'));
    fireEvent.click(screen.getByTestId('lightning-next')); // finish
    expect(screen.getByTestId('lightning-result')).toBeInTheDocument();
    expect(screen.queryByTestId('lightning-certified')).toBeNull();
  });
});
