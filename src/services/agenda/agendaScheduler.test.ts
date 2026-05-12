import { describe, it, expect } from 'vitest';
import {
  scheduleReminders,
  selectChannelForUrgency,
  shouldDeliverNow,
  isInFocusBlock,
  buildDailyDigest,
  type AgendaItem,
  type UserPreferences,
} from './agendaScheduler.js';

const prefs: UserPreferences = {
  workerUid: 'w1',
  workDayStartHour: 8,
  workDayEndHour: 18,
  channelByUrgency: {
    low: 'email',
    medium: 'in_app',
    high: 'push',
    urgent: 'whatsapp',
  },
  focusBlocksPerDay: 2,
  doNotDisturbAfterHour: 19,
};

function item(over: Partial<AgendaItem> & { id: string }): AgendaItem {
  return {
    id: over.id,
    workerUid: 'w1',
    title: over.title ?? 'reunion',
    startAt: over.startAt ?? '2026-05-12T10:00:00Z',
    endAt: over.endAt ?? '2026-05-12T11:00:00Z',
    focusBlock: over.focusBlock ?? false,
    urgency: over.urgency ?? 'medium',
    reminders: over.reminders ?? [],
  };
}

describe('scheduleReminders', () => {
  it('calcula triggersAt restando offset', () => {
    const r = scheduleReminders(
      item({
        id: 'i1',
        startAt: '2026-05-12T10:00:00Z',
        reminders: [
          { atOffsetMinutes: 30, channel: 'push' },
          { atOffsetMinutes: 60, channel: 'email' },
        ],
      }),
    );
    expect(r[0].triggersAt).toBe('2026-05-12T09:30:00.000Z');
    expect(r[1].triggersAt).toBe('2026-05-12T09:00:00.000Z');
  });
});

describe('selectChannelForUrgency', () => {
  it('mapea según preferencias', () => {
    expect(selectChannelForUrgency(prefs, 'urgent')).toBe('whatsapp');
    expect(selectChannelForUrgency(prefs, 'low')).toBe('email');
  });
});

describe('shouldDeliverNow', () => {
  it('urgent overrides DnD', () => {
    const r = shouldDeliverNow(
      { itemId: 'i1', triggersAt: '2026-05-12T22:00:00Z', channel: 'whatsapp', urgency: 'urgent' },
      prefs,
      '2026-05-12T22:00:00Z',
    );
    expect(r.deliver).toBe(true);
  });

  it('DnD activo después de 19 → defer', () => {
    const r = shouldDeliverNow(
      { itemId: 'i1', triggersAt: '2026-05-12T22:00:00Z', channel: 'push', urgency: 'medium' },
      prefs,
      '2026-05-12T22:00:00Z',
    );
    expect(r.deliver).toBe(false);
  });

  it('entrega dentro de horario laboral', () => {
    const r = shouldDeliverNow(
      { itemId: 'i1', triggersAt: 't', channel: 'push', urgency: 'medium' },
      prefs,
      '2026-05-12T10:00:00Z',
    );
    expect(r.deliver).toBe(true);
  });
});

describe('isInFocusBlock', () => {
  it('detecta dentro de bloque foco', () => {
    const items = [
      item({
        id: 'f1',
        focusBlock: true,
        startAt: '2026-05-12T10:00:00Z',
        endAt: '2026-05-12T11:00:00Z',
      }),
    ];
    expect(isInFocusBlock(items, '2026-05-12T10:30:00Z')?.id).toBe('f1');
  });

  it('fuera de bloque → null', () => {
    const items = [
      item({
        id: 'f1',
        focusBlock: true,
        startAt: '2026-05-12T10:00:00Z',
        endAt: '2026-05-12T11:00:00Z',
      }),
    ];
    expect(isInFocusBlock(items, '2026-05-12T12:00:00Z')).toBeNull();
  });
});

describe('buildDailyDigest', () => {
  it('arma secciones según inputs', () => {
    const d = buildDailyDigest('w1', '2026-05-12', {
      upcomingItems: [item({ id: 'm1', title: 'CPHS', startAt: '2026-05-12T10:00:00Z', endAt: '...' })],
      overdueActions: 3,
      pendingApprovals: 2,
      freshIncidents: 1,
    });
    expect(d.sections.length).toBe(4);
  });

  it('omite secciones vacías', () => {
    const d = buildDailyDigest('w1', '2026-05-12', {
      upcomingItems: [],
      overdueActions: 0,
      pendingApprovals: 0,
      freshIncidents: 0,
    });
    expect(d.sections).toEqual([]);
  });
});
