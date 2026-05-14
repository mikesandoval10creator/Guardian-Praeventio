// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SupervisorBriefingCard } from './SupervisorBriefingCard.js';
import type { SupervisorBriefingPack } from '../../services/meetingPack/meetingPackBuilder.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function makePack(over: Partial<SupervisorBriefingPack> = {}): SupervisorBriefingPack {
  return {
    supervisorUid: 'sup-1',
    shiftStart: '2026-05-13T06:00:00Z',
    headline: 'Turno 2026-05-13 · 12 trabajadores asignados',
    flaggedWorkers: [],
    criticalRisks: [],
    pendingActions: [],
    recommendations: [],
    inPersonHandoverRequired: false,
    ...over,
  };
}

describe('<SupervisorBriefingCard />', () => {
  it('renderiza headline', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({ headline: '⚠️ 1 riesgo SIF activo' })}
      />,
    );
    expect(screen.getByTestId('briefing-headline')).toHaveTextContent(
      'riesgo SIF activo',
    );
  });

  it('inPersonHandoverRequired: badge presencial visible', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({ inPersonHandoverRequired: true })}
      />,
    );
    expect(screen.getByTestId('briefing-in-person-badge')).toBeInTheDocument();
  });

  it('flagged workers: lista cada flag con kind/detail', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({
          flaggedWorkers: [
            {
              uid: 'w1',
              name: 'Juan Pérez',
              flagKind: 'fatigue',
              detail: 'Nivel fatiga high',
            },
            {
              uid: 'w2',
              name: 'María Soto',
              flagKind: 'expired_cert',
              detail: 'Certs vencidas: altura',
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('briefing-flag-w1-fatigue')).toHaveTextContent('Juan Pérez');
    expect(screen.getByTestId('briefing-flag-w1-fatigue')).toHaveTextContent(/Fatiga/);
    expect(screen.getByTestId('briefing-flag-w2-expired_cert')).toHaveTextContent(
      'María Soto',
    );
  });

  it('onWorkerSelected dispara con uid', () => {
    const onSelect = vi.fn();
    render(
      <SupervisorBriefingCard
        pack={makePack({
          flaggedWorkers: [
            {
              uid: 'w1',
              name: 'Juan',
              flagKind: 'restriction',
              detail: 'Limitación carga',
            },
          ],
        })}
        onWorkerSelected={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('briefing-flag-w1-restriction-open'));
    expect(onSelect).toHaveBeenCalledWith('w1');
  });

  it('sin flagged workers: la sección no se renderiza', () => {
    render(<SupervisorBriefingCard pack={makePack()} />);
    expect(screen.queryByTestId('briefing-flagged-workers')).toBeNull();
  });

  it('critical risks: render con badge por severity', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({
          criticalRisks: [
            { id: 'r1', description: 'Trabajo en altura sin línea de vida', severity: 'sif' },
            { id: 'r2', description: 'Tablero eléctrico expuesto', severity: 'critical' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('briefing-risk-r1')).toHaveTextContent(/sif/);
    expect(screen.getByTestId('briefing-risk-r2')).toHaveTextContent(/critical/);
  });

  it('weather advisory: aparece solo si está presente', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({ weatherAdvisory: 'UV extremo — reprogramar trabajo exterior' })}
      />,
    );
    expect(screen.getByTestId('briefing-weather')).toHaveTextContent(/UV extremo/);
  });

  it('sin weatherAdvisory: bloque oculto', () => {
    render(<SupervisorBriefingCard pack={makePack()} />);
    expect(screen.queryByTestId('briefing-weather')).toBeNull();
  });

  it('pending actions: lista con due date', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({
          pendingActions: [
            { id: 'a1', description: 'Revisar extintor', dueDate: '2026-05-14T10:00:00Z' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('briefing-action-a1')).toHaveTextContent('Revisar extintor');
    expect(screen.getByTestId('briefing-action-a1')).toHaveTextContent('2026-05-14');
  });

  it('recommendations: lista renderizada', () => {
    render(
      <SupervisorBriefingCard
        pack={makePack({
          recommendations: ['Confirmar EPP altura', 'Briefing presencial 10 min'],
        })}
      />,
    );
    const rec = screen.getByTestId('briefing-recommendations');
    expect(rec).toHaveTextContent('Confirmar EPP altura');
    expect(rec).toHaveTextContent('Briefing presencial 10 min');
  });

  it('onAcknowledge dispara con pack', () => {
    const onAck = vi.fn();
    const pack = makePack();
    render(<SupervisorBriefingCard pack={pack} onAcknowledge={onAck} />);
    fireEvent.click(screen.getByTestId('briefing-acknowledge'));
    expect(onAck).toHaveBeenCalledWith(pack);
  });

  it('sin onAcknowledge: botón oculto', () => {
    render(<SupervisorBriefingCard pack={makePack()} />);
    expect(screen.queryByTestId('briefing-acknowledge')).toBeNull();
  });
});
