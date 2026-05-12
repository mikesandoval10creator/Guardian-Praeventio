import { describe, it, expect } from 'vitest';
import {
  bestChannelForZone,
  detectDeadZones,
  computeEscalation,
  buildContactabilityReport,
  planChannelFailover,
  type ContactInfo,
  type ZoneCoverage,
  type EscalationLevel,
} from './communicationMap.js';

describe('bestChannelForZone', () => {
  it('preferred channel disponible', () => {
    const c: ContactInfo = { workerUid: 'w1', role: 'sup', channels: ['radio_uhf', 'phone_cell'] };
    const z: ZoneCoverage = { zoneId: 'A', availableChannels: ['radio_uhf', 'phone_cell'] };
    expect(bestChannelForZone(c, z)).toBe('radio_uhf');
  });

  it('cae al siguiente si preferred no disponible', () => {
    const c: ContactInfo = { workerUid: 'w1', role: 'sup', channels: ['radio_uhf', 'phone_cell'] };
    const z: ZoneCoverage = { zoneId: 'A', availableChannels: ['phone_cell'] };
    expect(bestChannelForZone(c, z)).toBe('phone_cell');
  });

  it('null si ningún canal disponible', () => {
    const c: ContactInfo = { workerUid: 'w1', role: 'sup', channels: ['radio_uhf'] };
    const z: ZoneCoverage = { zoneId: 'A', availableChannels: ['phone_satellite'] };
    expect(bestChannelForZone(c, z)).toBeNull();
  });
});

describe('detectDeadZones', () => {
  it('zona sin ninguno de los canales requeridos', () => {
    const r = detectDeadZones(
      [
        { zoneId: 'A', availableChannels: ['radio_uhf'] },
        { zoneId: 'B', availableChannels: ['whatsapp'] },
      ],
      ['radio_uhf', 'phone_cell'],
    );
    expect(r.map((z) => z.zoneId)).toEqual(['B']);
  });
});

describe('computeEscalation', () => {
  const chain: EscalationLevel[] = [
    { level: 1, uids: ['sup1'], waitMinutes: 5 },
    { level: 2, uids: ['lead1'], waitMinutes: 10 },
    { level: 3, uids: ['manager1'], waitMinutes: 15 },
  ];

  it('nivel 1 si dentro de 5min', () => {
    const r = computeEscalation(chain, 3);
    expect(r.currentLevel).toBe(1);
    expect(r.recipientsToNotify).toEqual(['sup1']);
    expect(r.nextLevelInMinutes).toBe(2);
  });

  it('nivel 2 después de 5min', () => {
    const r = computeEscalation(chain, 10);
    expect(r.currentLevel).toBe(2);
    expect(r.recipientsToNotify).toEqual(['lead1']);
  });

  it('nivel 3 después de 15min', () => {
    const r = computeEscalation(chain, 20);
    expect(r.currentLevel).toBe(3);
  });
});

describe('buildContactabilityReport', () => {
  it('% reachability + unreachableUids', () => {
    const r = buildContactabilityReport([
      { workerUid: 'a', testedAt: 't', reachable: true },
      { workerUid: 'b', testedAt: 't', reachable: false },
      { workerUid: 'c', testedAt: 't', reachable: false },
      { workerUid: 'd', testedAt: 't', reachable: true },
    ]);
    expect(r.reachabilityPercent).toBe(50);
    expect(r.unreachableUids.sort()).toEqual(['b', 'c']);
  });
});

describe('planChannelFailover', () => {
  it('primary down → recomienda fallback disponible', () => {
    const c: ContactInfo = { workerUid: 'w1', role: 'sup', channels: ['radio_uhf', 'phone_cell'] };
    const z: ZoneCoverage = { zoneId: 'A', availableChannels: ['radio_uhf', 'phone_cell'] };
    const r = planChannelFailover(c, z, true);
    expect(r.recommendedChannel).toBe('phone_cell');
  });

  it('primary up → recomienda primary', () => {
    const c: ContactInfo = { workerUid: 'w1', role: 'sup', channels: ['radio_uhf', 'phone_cell'] };
    const z: ZoneCoverage = { zoneId: 'A', availableChannels: ['radio_uhf', 'phone_cell'] };
    const r = planChannelFailover(c, z, false);
    expect(r.recommendedChannel).toBe('radio_uhf');
  });

  it('null si ningún canal disponible', () => {
    const c: ContactInfo = { workerUid: 'w1', role: 'sup', channels: ['radio_uhf'] };
    const z: ZoneCoverage = { zoneId: 'A', availableChannels: [] };
    const r = planChannelFailover(c, z, true);
    expect(r.recommendedChannel).toBeNull();
  });
});
