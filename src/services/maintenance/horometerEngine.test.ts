import { describe, it, expect } from 'vitest';
import {
  buildDefaultPolicy,
  assessHorometerStatus,
  proposeCalendarTask,
  buildFleetReport,
  type MachineHorometer,
} from './horometerEngine.js';

const NOW_ISO = '2026-05-12T10:00:00Z';

describe('buildDefaultPolicy', () => {
  it('genera 3 thresholds escalonados 85/95/100%', () => {
    const p = buildDefaultPolicy(1000);
    expect(p.thresholds).toHaveLength(3);
    expect(p.thresholds[0].triggerAtHours).toBe(850);
    expect(p.thresholds[1].triggerAtHours).toBe(950);
    expect(p.thresholds[2].triggerAtHours).toBe(1000);
    expect(p.blockOnMandatory).toBe(true);
  });
});

describe('assessHorometerStatus', () => {
  const policy = buildDefaultPolicy(1000);

  function h(currentHours: number, lastMaintAt = 0): MachineHorometer {
    return {
      machineId: 'CAEX-08',
      currentHours,
      lastMaintenanceAtHours: lastMaintAt,
    };
  }

  it('máquina con 500h en ciclo de 1000h → OK', () => {
    const s = assessHorometerStatus(h(500), policy);
    expect(s.triggeredThreshold).toBeNull();
    expect(s.shouldBlock).toBe(false);
    expect(s.cycleProgressPercent).toBe(50);
    expect(s.message).toMatch(/^OK/);
  });

  it('máquina con 870h → warning', () => {
    const s = assessHorometerStatus(h(870), policy);
    expect(s.triggeredThreshold?.kind).toBe('warning');
    expect(s.shouldBlock).toBe(false);
  });

  it('máquina con 960h → critical', () => {
    const s = assessHorometerStatus(h(960), policy);
    expect(s.triggeredThreshold?.kind).toBe('critical');
    expect(s.shouldBlock).toBe(false);
  });

  it('máquina con 1050h → mandatory + shouldBlock', () => {
    const s = assessHorometerStatus(h(1050), policy);
    expect(s.triggeredThreshold?.kind).toBe('mandatory');
    expect(s.shouldBlock).toBe(true);
  });

  it('después de mantención, status reinicia', () => {
    const s = assessHorometerStatus(h(1200, 1100), policy);
    // hoursSinceLastMaintenance = 100 → OK
    expect(s.triggeredThreshold).toBeNull();
    expect(s.cycleProgressPercent).toBe(10);
  });
});

describe('proposeCalendarTask', () => {
  const policy = buildDefaultPolicy(1000);

  it('OK status → null (sin task)', () => {
    const s = assessHorometerStatus(
      { machineId: 'M1', currentHours: 500, lastMaintenanceAtHours: 0 },
      policy,
    );
    const task = proposeCalendarTask(s, { avgUsageHoursPerDay: 8, nowIso: NOW_ISO });
    expect(task).toBeNull();
  });

  it('warning → tarea con priority medium', () => {
    const s = assessHorometerStatus(
      { machineId: 'M1', currentHours: 870, lastMaintenanceAtHours: 0 },
      policy,
    );
    const task = proposeCalendarTask(s, { avgUsageHoursPerDay: 8, nowIso: NOW_ISO });
    expect(task?.priority).toBe('medium');
    expect(task?.kind).toBe('preventive');
  });

  it('mandatory crossed → priority critical + kind mandatory_block_resolution', () => {
    const s = assessHorometerStatus(
      { machineId: 'M1', currentHours: 1050, lastMaintenanceAtHours: 0 },
      policy,
    );
    const task = proposeCalendarTask(s, { avgUsageHoursPerDay: 8, nowIso: NOW_ISO });
    expect(task?.priority).toBe('critical');
    expect(task?.kind).toBe('mandatory_block_resolution');
    expect(task?.title).toMatch(/URGENTE/);
  });
});

describe('buildFleetReport', () => {
  const policy = buildDefaultPolicy(1000);

  it('cuenta cada estado correctamente', () => {
    const fleet = [
      // OK
      { horometer: { machineId: 'A', currentHours: 100, lastMaintenanceAtHours: 0 }, policy },
      // warning
      { horometer: { machineId: 'B', currentHours: 870, lastMaintenanceAtHours: 0 }, policy },
      // critical
      { horometer: { machineId: 'C', currentHours: 970, lastMaintenanceAtHours: 0 }, policy },
      // blocked
      { horometer: { machineId: 'D', currentHours: 1100, lastMaintenanceAtHours: 0 }, policy },
    ];
    const r = buildFleetReport(fleet);
    expect(r.totalMachines).toBe(4);
    expect(r.ok).toBe(1);
    expect(r.warning).toBe(1);
    // 'critical' bucket incluye 'critical' thresholds + 'mandatory' no bloqueante. Aquí D bloquea.
    expect(r.critical).toBe(1);
    expect(r.blocked).toBe(1);
  });

  it('topUrgent ordenado por gravedad', () => {
    const fleet = [
      { horometer: { machineId: 'B', currentHours: 870, lastMaintenanceAtHours: 0 }, policy },
      { horometer: { machineId: 'D', currentHours: 1100, lastMaintenanceAtHours: 0 }, policy },
      { horometer: { machineId: 'C', currentHours: 970, lastMaintenanceAtHours: 0 }, policy },
    ];
    const r = buildFleetReport(fleet);
    expect(r.topUrgent[0].machineId).toBe('D'); // mandatory > critical > warning
  });
});
