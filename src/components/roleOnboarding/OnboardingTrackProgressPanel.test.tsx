// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingTrackProgressPanel } from './OnboardingTrackProgressPanel.js';
import {
  getTrackForRole,
  evaluateProgress,
  type UserOnboardingProgress,
} from '../../services/roleOnboarding/roleOnboardingTracks.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function makeProgress(role: 'worker' | 'supervisor', completedStepIds: string[]): UserOnboardingProgress {
  return {
    userUid: 'user-1',
    role,
    completedStepIds,
    startedAt: '2026-05-10T10:00:00Z',
  };
}

describe('<OnboardingTrackProgressPanel />', () => {
  it('renderiza todos los steps del track del rol', () => {
    const track = getTrackForRole('worker');
    const progress = makeProgress('worker', []);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    for (const step of track.steps) {
      expect(
        screen.getByTestId(`onboarding-step-${step.id}`),
      ).toBeInTheDocument();
    }
  });

  it('sin pasos completados: bloqueado para operar', () => {
    const track = getTrackForRole('worker');
    const progress = makeProgress('worker', []);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    expect(screen.getByTestId('onboarding-operation-badge')).toHaveAttribute(
      'data-state',
      'blocked',
    );
  });

  it('todos los blocking completados: habilitado para operar', () => {
    const track = getTrackForRole('worker');
    const blockingIds = track.steps.filter((s) => s.blockingForOperation).map((s) => s.id);
    const progress = makeProgress('worker', blockingIds);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    expect(screen.getByTestId('onboarding-operation-badge')).toHaveAttribute(
      'data-state',
      'ready',
    );
  });

  it('barra de progreso refleja completedPct', () => {
    const track = getTrackForRole('worker');
    // Worker tiene 6 steps. Marcamos 3 → 50%.
    const progress = makeProgress('worker', track.steps.slice(0, 3).map((s) => s.id));
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    const fill = screen.getByTestId('onboarding-progress-fill');
    expect(fill.style.width).toBe('50%');
  });

  it('step completado → data-state="completed" + icon de check', () => {
    const track = getTrackForRole('worker');
    const firstId = track.steps[0]!.id;
    const progress = makeProgress('worker', [firstId]);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    expect(screen.getByTestId(`onboarding-step-${firstId}`)).toHaveAttribute(
      'data-state',
      'completed',
    );
    expect(
      screen.getByTestId(`onboarding-step-${firstId}-icon-completed`),
    ).toBeInTheDocument();
  });

  it('siguiente recomendado → data-state="next"', () => {
    const track = getTrackForRole('worker');
    const progress = makeProgress('worker', []);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    // El primer step pendiente blocking debería ser el "next".
    const firstStep = track.steps[0]!;
    expect(screen.getByTestId(`onboarding-step-${firstStep.id}`)).toHaveAttribute(
      'data-state',
      'next',
    );
  });

  it('onStartStep dispara con el step', () => {
    const track = getTrackForRole('worker');
    const progress = makeProgress('worker', []);
    const status = evaluateProgress(progress, track);
    const onStart = vi.fn();
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
        onStartStep={onStart}
      />,
    );
    const firstId = track.steps[0]!.id;
    fireEvent.click(screen.getByTestId(`onboarding-step-${firstId}-start`));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].id).toBe(firstId);
  });

  it('onCompleteStep dispara con el step', () => {
    const track = getTrackForRole('worker');
    const progress = makeProgress('worker', []);
    const status = evaluateProgress(progress, track);
    const onComplete = vi.fn();
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
        onCompleteStep={onComplete}
      />,
    );
    const firstId = track.steps[0]!.id;
    fireEvent.click(screen.getByTestId(`onboarding-step-${firstId}-complete`));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].id).toBe(firstId);
  });

  it('step completado oculta botones de Start/Complete', () => {
    const track = getTrackForRole('worker');
    const firstId = track.steps[0]!.id;
    const progress = makeProgress('worker', [firstId]);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
        onStartStep={vi.fn()}
        onCompleteStep={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(`onboarding-step-${firstId}-start`)).toBeNull();
    expect(screen.queryByTestId(`onboarding-step-${firstId}-complete`)).toBeNull();
  });

  it('marcador Bloqueante visible solo en steps pendientes blocking', () => {
    const track = getTrackForRole('supervisor');
    const progress = makeProgress('supervisor', []);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    // Algún step blocking debe mostrar tag.
    const blockingStep = track.steps.find((s) => s.blockingForOperation)!;
    expect(
      screen.getByTestId(`onboarding-step-${blockingStep.id}-blocking`),
    ).toBeInTheDocument();
    // Step no-blocking NO debe tener tag bloqueante.
    const nonBlocking = track.steps.find((s) => !s.blockingForOperation);
    if (nonBlocking) {
      expect(
        screen.queryByTestId(`onboarding-step-${nonBlocking.id}-blocking`),
      ).toBeNull();
    }
  });

  it('trackCompleted → badge "Track completado" visible', () => {
    const track = getTrackForRole('worker');
    // Completa todos para superar el umbral 80%.
    const allIds = track.steps.map((s) => s.id);
    const progress = makeProgress('worker', allIds);
    const status = evaluateProgress(progress, track);
    render(
      <OnboardingTrackProgressPanel
        track={track}
        progress={progress}
        status={status}
      />,
    );
    expect(screen.getByTestId('onboarding-track-completed-badge')).toBeInTheDocument();
  });
});
