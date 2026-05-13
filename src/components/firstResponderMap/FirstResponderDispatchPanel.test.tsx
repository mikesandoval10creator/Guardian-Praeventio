// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirstResponderDispatchPanel } from './FirstResponderDispatchPanel.js';
import type {
  DispatchPlan,
  DispatchCandidate,
  CoverageGap,
} from '../../services/firstResponderMap/firstResponderMap.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function candidate(over: Partial<DispatchCandidate> & { responderUid: string }): DispatchCandidate {
  return {
    responderUid: over.responderUid,
    matchedRole: over.matchedRole ?? 'paramedic',
    distanceMeters: over.distanceMeters ?? 120,
    estimatedArrivalSeconds: over.estimatedArrivalSeconds ?? 80,
    available: over.available ?? true,
    sifCertOk: over.sifCertOk ?? true,
    matchScore: over.matchScore ?? 75,
    reasonIfRejected: over.reasonIfRejected,
  };
}

describe('<FirstResponderDispatchPanel />', () => {
  it('idle: sin plan + sin gaps → mensaje cobertura completa', () => {
    render(<FirstResponderDispatchPanel plan={null} />);
    expect(screen.getByTestId('first-responder-panel-idle')).toBeInTheDocument();
    expect(screen.queryByTestId('first-responder-coverage-gaps')).toBeNull();
  });

  it('idle: con gaps los lista por severity', () => {
    const gaps: CoverageGap[] = [
      { kind: 'no_paramedic', detail: 'Sin paramédico on-duty', severity: 'critical' },
      { kind: 'undermanned', detail: 'Solo 1 responder', severity: 'warning' },
    ];
    render(<FirstResponderDispatchPanel plan={null} coverageGaps={gaps} />);
    expect(screen.getByTestId('coverage-gap-no_paramedic')).toBeInTheDocument();
    expect(screen.getByTestId('coverage-gap-undermanned')).toBeInTheDocument();
  });

  it('plan activo: muestra primary + ETA + distancia', () => {
    const plan: DispatchPlan = {
      incidentKind: 'medical_emergency',
      primary: candidate({ responderUid: 'p1', distanceMeters: 250, estimatedArrivalSeconds: 167 }),
      backups: [],
      noEligibleResponder: false,
      recommendations: [],
    };
    render(
      <FirstResponderDispatchPanel
        plan={plan}
        responderNameByUid={{ p1: 'Juan Pérez' }}
      />,
    );
    const primary = screen.getByTestId('first-responder-primary');
    expect(primary).toHaveTextContent('Juan Pérez');
    expect(primary).toHaveTextContent('250 m');
    expect(primary).toHaveTextContent(/2m 47s/);
    expect(primary).toHaveTextContent(/score 75/);
  });

  it('onDispatchPrimary se dispara solo si available', () => {
    const onDispatch = vi.fn();
    const plan: DispatchPlan = {
      incidentKind: 'fire',
      primary: candidate({ responderUid: 'p1', matchedRole: 'fire_brigade' }),
      backups: [],
      noEligibleResponder: false,
      recommendations: [],
    };
    render(<FirstResponderDispatchPanel plan={plan} onDispatchPrimary={onDispatch} />);
    fireEvent.click(screen.getByTestId('first-responder-notify-primary'));
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch.mock.calls[0][0].responderUid).toBe('p1');
  });

  it('backups: lista cada uno con score; promote callback se dispara', () => {
    const onPromote = vi.fn();
    const plan: DispatchPlan = {
      incidentKind: 'medical_emergency',
      primary: candidate({ responderUid: 'p1' }),
      backups: [
        candidate({ responderUid: 'p2', matchScore: 60 }),
        candidate({ responderUid: 'p3', matchScore: 40 }),
      ],
      noEligibleResponder: false,
      recommendations: [],
    };
    render(<FirstResponderDispatchPanel plan={plan} onPromoteBackup={onPromote} />);
    expect(screen.getByTestId('first-responder-backup-p2')).toBeInTheDocument();
    expect(screen.getByTestId('first-responder-backup-p3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('first-responder-promote-p3'));
    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote.mock.calls[0][0].responderUid).toBe('p3');
  });

  it('candidato no disponible: muestra reasonIfRejected + sin botón', () => {
    const plan: DispatchPlan = {
      incidentKind: 'fall_from_height',
      primary: candidate({ responderUid: 'p1' }),
      backups: [
        candidate({
          responderUid: 'p2',
          available: false,
          reasonIfRejected: 'on_break',
        }),
      ],
      noEligibleResponder: false,
      recommendations: [],
    };
    const onPromote = vi.fn();
    render(<FirstResponderDispatchPanel plan={plan} onPromoteBackup={onPromote} />);
    expect(screen.getByTestId('candidate-rejected-p2')).toHaveTextContent('on_break');
    expect(screen.queryByTestId('first-responder-promote-p2')).toBeNull();
  });

  it('noEligibleResponder: muestra recommendations + botón llamar mutual', () => {
    const onCallMutual = vi.fn();
    const plan: DispatchPlan = {
      incidentKind: 'cardiac_arrest',
      backups: [],
      noEligibleResponder: true,
      recommendations: ['Llamar 131 SAMU inmediatamente', 'Activar protocolo external'],
    };
    render(<FirstResponderDispatchPanel plan={plan} onCallMutual={onCallMutual} />);
    expect(screen.getByTestId('first-responder-no-eligible')).toHaveTextContent(
      'Llamar 131 SAMU',
    );
    fireEvent.click(screen.getByTestId('first-responder-call-mutual'));
    expect(onCallMutual).toHaveBeenCalledTimes(1);
  });

  it('ETA formato: <60s en segundos, >=60s en m+s', () => {
    const plan: DispatchPlan = {
      incidentKind: 'medical_emergency',
      primary: candidate({ responderUid: 'p1', estimatedArrivalSeconds: 45 }),
      backups: [],
      noEligibleResponder: false,
      recommendations: [],
    };
    const { rerender } = render(<FirstResponderDispatchPanel plan={plan} />);
    expect(screen.getByTestId('first-responder-primary')).toHaveTextContent('ETA 45s');

    plan.primary!.estimatedArrivalSeconds = 125;
    rerender(<FirstResponderDispatchPanel plan={plan} />);
    expect(screen.getByTestId('first-responder-primary')).toHaveTextContent(/ETA 2m 5s/);
  });

  it('responderNameByUid ausente → cae a uid', () => {
    const plan: DispatchPlan = {
      incidentKind: 'fire',
      primary: candidate({ responderUid: 'unknown-uid' }),
      backups: [],
      noEligibleResponder: false,
      recommendations: [],
    };
    render(<FirstResponderDispatchPanel plan={plan} />);
    expect(screen.getByTestId('first-responder-primary')).toHaveTextContent('unknown-uid');
  });
});
