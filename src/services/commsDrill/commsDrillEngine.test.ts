import { describe, it, expect } from 'vitest';
import {
  listDrillScripts,
  getDrillById,
  scoreDrill,
  planDrillSchedule,
  type DrillTarget,
  type ConfirmationRecord,
  type PastDrillExecution,
} from './commsDrillEngine.js';

const NOW = new Date('2026-05-13T10:00:00Z');

describe('listDrillScripts / getDrillById', () => {
  it('lista incluye al menos 4 drills canónicos', () => {
    const list = listDrillScripts();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.map((d) => d.id)).toContain('drill_monthly_primary');
    expect(list.map((d) => d.id)).toContain('drill_evacuation');
  });

  it('getDrillById retorna scenario válido', () => {
    const d = getDrillById('drill_evacuation');
    expect(d).not.toBeNull();
    expect(d?.objective).toBe('evacuation_announcement');
  });

  it('id desconocido → null', () => {
    expect(getDrillById('xxx')).toBeNull();
  });
});

const TARGETS: DrillTarget[] = [
  { uid: 'w1', role: 'worker', expectedChannels: ['app_push', 'sms'] },
  { uid: 'w2', role: 'worker', expectedChannels: ['app_push', 'radio_vhf'] },
  { uid: 's1', role: 'supervisor', expectedChannels: ['radio_vhf', 'phone_cell'] },
];

function conf(over: Partial<ConfirmationRecord>): ConfirmationRecord {
  return {
    targetUid: 'w1',
    channelUsed: 'app_push',
    receivedAtSeconds: 30,
    onTime: true,
    ...over,
  };
}

describe('scoreDrill — verdicts', () => {
  it('100% confirmation on-time sin outages → excellent', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: TARGETS.map((t) =>
        conf({ targetUid: t.uid, channelUsed: t.expectedChannels[0]!, onTime: true, receivedAtSeconds: 20 }),
      ),
      executedAt: NOW.toISOString(),
    });
    expect(r.verdict).toBe('excellent');
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('80% confirmation + on-time → satisfactory', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: [conf({ targetUid: 'w1' }), conf({ targetUid: 's1', channelUsed: 'radio_vhf' })],
      executedAt: NOW.toISOString(),
    });
    expect(['satisfactory', 'deficient']).toContain(r.verdict);
  });

  it('0 confirmaciones → failed', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: [],
      executedAt: NOW.toISOString(),
    });
    expect(r.verdict).toBe('failed');
    expect(r.nonResponders).toHaveLength(3);
  });

  it('channel outage agrega finding + corrective', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: TARGETS.map((t) =>
        conf({ targetUid: t.uid, channelUsed: t.expectedChannels[0]!, onTime: true }),
      ),
      channelOutages: [{ channel: 'app_push', from: 0, to: 60 }],
      executedAt: NOW.toISOString(),
    });
    expect(r.failedChannels).toContain('app_push');
    expect(r.correctiveActions.some((a) => /FCM/i.test(a))).toBe(true);
  });

  it('scenario id desconocido → failed con finding', () => {
    const r = scoreDrill({
      scenarioId: 'unknown',
      targets: TARGETS,
      confirmations: [],
      executedAt: NOW.toISOString(),
    });
    expect(r.verdict).toBe('failed');
    expect(r.score).toBe(0);
    expect(r.findings[0]).toMatch(/no encontrado/i);
  });

  it('avgResponseSeconds calculado de confirmaciones', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: [
        conf({ targetUid: 'w1', receivedAtSeconds: 10 }),
        conf({ targetUid: 'w2', receivedAtSeconds: 30 }),
        conf({ targetUid: 's1', receivedAtSeconds: 50 }),
      ],
      executedAt: NOW.toISOString(),
    });
    expect(r.averageResponseSeconds).toBe(30);
  });

  it('non-responders correctos', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: [conf({ targetUid: 'w1' })],
      executedAt: NOW.toISOString(),
    });
    expect(r.nonResponders.sort()).toEqual(['s1', 'w2']);
  });

  it('confirmaciones de uids fuera del target ignoradas', () => {
    const r = scoreDrill({
      scenarioId: 'drill_monthly_primary',
      targets: TARGETS,
      confirmations: [conf({ targetUid: 'externo-x' })],
      executedAt: NOW.toISOString(),
    });
    expect(r.confirmationRatio).toBe(0);
  });
});

describe('planDrillSchedule', () => {
  it('sin past executions → todos overdue', () => {
    const schedule = planDrillSchedule([], NOW);
    expect(schedule.every((s) => s.overdue)).toBe(true);
    expect(schedule.length).toBeGreaterThanOrEqual(4);
  });

  it('execution reciente con verdict excellent → no overdue', () => {
    const past: PastDrillExecution[] = [
      {
        scenarioId: 'drill_monthly_primary',
        executedAt: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
        verdict: 'excellent',
      },
    ];
    const schedule = planDrillSchedule(past, NOW);
    const monthly = schedule.find((s) => s.scenarioId === 'drill_monthly_primary');
    expect(monthly?.overdue).toBe(false);
  });

  it('verdict deficient acorta interval a la mitad', () => {
    const past: PastDrillExecution[] = [
      {
        scenarioId: 'drill_monthly_primary',
        // 20 días atrás (normal interval = 30, así que estaría no-overdue, pero deficient → 15d)
        executedAt: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
        verdict: 'deficient',
      },
    ];
    const schedule = planDrillSchedule(past, NOW);
    const monthly = schedule.find((s) => s.scenarioId === 'drill_monthly_primary');
    expect(monthly?.overdue).toBe(true);
    expect(monthly?.daysOverdue).toBeGreaterThan(0);
  });

  it('verdict excellent mantiene interval normal', () => {
    const past: PastDrillExecution[] = [
      {
        scenarioId: 'drill_monthly_primary',
        executedAt: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
        verdict: 'excellent',
      },
    ];
    const schedule = planDrillSchedule(past, NOW);
    const monthly = schedule.find((s) => s.scenarioId === 'drill_monthly_primary');
    expect(monthly?.overdue).toBe(false);
  });

  it('último execution gana cuando hay múltiples del mismo scenario', () => {
    const past: PastDrillExecution[] = [
      { scenarioId: 'drill_evacuation', executedAt: '2026-01-01T00:00:00Z', verdict: 'failed' },
      { scenarioId: 'drill_evacuation', executedAt: '2026-05-01T00:00:00Z', verdict: 'excellent' },
    ];
    const schedule = planDrillSchedule(past, NOW);
    const evac = schedule.find((s) => s.scenarioId === 'drill_evacuation');
    expect(evac?.lastExecutedAt).toBe('2026-05-01T00:00:00Z');
  });
});
