// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HorometerStatusCard } from './HorometerStatusCard.js';
import { buildDefaultPolicy } from '../../services/maintenance/horometerEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const policy = buildDefaultPolicy(1000);

describe('<HorometerStatusCard />', () => {
  it('OK status renderiza barra verde sin task', () => {
    render(
      <HorometerStatusCard
        horometer={{ machineId: 'M1', currentHours: 500, lastMaintenanceAtHours: 0 }}
        policy={policy}
      />,
    );
    expect(screen.getByTestId('horometer-card-M1')).toBeInTheDocument();
    expect(screen.getByTestId('horometer-state-M1').textContent).toBe('ok');
    expect(screen.queryByTestId('horometer-task-M1')).toBeNull();
  });

  it('warning status muestra task agendable', () => {
    render(
      <HorometerStatusCard
        horometer={{ machineId: 'M2', currentHours: 870, lastMaintenanceAtHours: 0 }}
        policy={policy}
      />,
    );
    expect(screen.getByTestId('horometer-state-M2').textContent).toBe('warning');
    expect(screen.getByTestId('horometer-task-M2')).toBeInTheDocument();
  });

  it('mandatory triggers bloqueo visible', () => {
    render(
      <HorometerStatusCard
        horometer={{ machineId: 'M3', currentHours: 1100, lastMaintenanceAtHours: 0 }}
        policy={policy}
      />,
    );
    expect(screen.getByTestId('horometer-block-M3')).toBeInTheDocument();
    expect(screen.getByTestId('horometer-state-M3').textContent).toBe('mandatory');
  });

  it('onSchedule dispara con la tarea propuesta', () => {
    const onSchedule = vi.fn();
    render(
      <HorometerStatusCard
        horometer={{ machineId: 'M4', currentHours: 870, lastMaintenanceAtHours: 0 }}
        policy={policy}
        onSchedule={onSchedule}
      />,
    );
    fireEvent.click(screen.getByTestId('horometer-schedule-M4'));
    expect(onSchedule).toHaveBeenCalled();
  });
});
