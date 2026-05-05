// SPDX-License-Identifier: MIT
//
// Sprint 29 Bucket DD F-E — calendarPreWarn tests.

import { describe, it, expect, vi } from 'vitest';
import {
  scanUpcomingTasks,
  type UpcomingTask,
  type ScanInputs,
  type CreateCalendarEventFn,
  type DispatchPushFn,
  type DispatchEmailFn,
} from './calendarPreWarn.js';

function makeBaseInputs(overrides: Partial<ScanInputs> = {}): ScanInputs {
  const warned = new Set<string>();
  return {
    projectId: 'p1',
    daysAhead: 3,
    tasks: [],
    getWeather: () => ({}),
    getSeismic: () => ({}),
    daysOfRisk: () => 1,
    dispatchPush: vi.fn(async () => ({ ok: true })),
    dispatchEmail: vi.fn(async () => ({ ok: true })),
    createCalendarEvent: vi.fn(async () => ({ id: 'evt-1' })),
    gerenteUid: 'gerente1',
    alreadyWarned: (k) => warned.has(k),
    markWarned: (k) => {
      warned.add(k);
    },
    now: () => new Date('2026-05-05T00:00:00Z'),
    ...overrides,
  };
}

const futureTask = (overrides: Partial<UpcomingTask> = {}): UpcomingTask => ({
  id: 't1',
  title: 'Trabajo en techo',
  supervisorUid: 'sup1',
  hazardTags: ['at-height'],
  scheduledAt: '2026-05-06T14:00:00Z',
  ...overrides,
});

describe('scanUpcomingTasks', () => {
  it('does NOT warn when weather is calm and no hazards trigger', async () => {
    const dispatchPush = vi.fn(async () => ({ ok: true }));
    const dispatchEmail = vi.fn(async () => ({ ok: true }));
    const createCalendarEvent = vi.fn(async () => ({ id: 'evt-x' }));
    const result = await scanUpcomingTasks(
      makeBaseInputs({
        tasks: [futureTask()],
        getWeather: () => ({ peakWindKmh: 10, rainMm: 0, peakTempC: 20 }),
        dispatchPush,
        dispatchEmail,
        createCalendarEvent,
      }),
    );
    expect(result.scanned).toBe(1);
    expect(result.warned).toBe(0);
    expect(dispatchPush).not.toHaveBeenCalled();
    expect(dispatchEmail).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('fires push + email + calendar event when wind > 40km/h with at-height task', async () => {
    const dispatchPush: DispatchPushFn = vi.fn(async () => ({ ok: true }));
    const dispatchEmail: DispatchEmailFn = vi.fn(async () => ({ ok: true }));
    const createCalendarEvent: CreateCalendarEventFn = vi.fn(async () => ({ id: 'cal-event-1' }));
    const result = await scanUpcomingTasks(
      makeBaseInputs({
        tasks: [futureTask()],
        getWeather: () => ({ peakWindKmh: 55, rainMm: 0, peakTempC: 18 }),
        dispatchPush,
        dispatchEmail,
        createCalendarEvent,
      }),
    );
    expect(result.warned).toBe(1);
    expect(result.warnings[0].hazard).toBe('wind-at-height');
    expect(result.warnings[0].pushSent).toBe(true);
    expect(result.warnings[0].emailSent).toBe(true);
    expect(result.warnings[0].calendarEventId).toBe('cal-event-1');
    expect(dispatchPush).toHaveBeenCalledOnce();
    expect(dispatchEmail).toHaveBeenCalledOnce();
    expect(createCalendarEvent).toHaveBeenCalledOnce();
    const mockedCreate = vi.mocked(createCalendarEvent);
    const calArgs = mockedCreate.mock.calls[0]?.[0];
    expect(calArgs).toBeDefined();
    expect(calArgs!.summary).toMatch(/^RIESGO:/);
    // Calendar event should be created 24h BEFORE the task start.
    expect(calArgs!.startsAt).toBe(new Date('2026-05-05T14:00:00Z').toISOString());
  });

  it('idempotency: re-running with already-warned key skips the dispatch', async () => {
    const dispatchPush = vi.fn(async () => ({ ok: true }));
    const inputs = makeBaseInputs({
      tasks: [futureTask()],
      getWeather: () => ({ peakWindKmh: 60 }),
      dispatchPush,
    });
    await scanUpcomingTasks(inputs);
    expect(dispatchPush).toHaveBeenCalledTimes(1);
    // second run must be a no-op (markWarned wrote the key)
    const second = await scanUpcomingTasks(inputs);
    expect(second.warned).toBe(0);
    expect(dispatchPush).toHaveBeenCalledTimes(1);
  });

  it('skips tasks scheduled outside the daysAhead horizon', async () => {
    const dispatchPush = vi.fn(async () => ({ ok: true }));
    const result = await scanUpcomingTasks(
      makeBaseInputs({
        tasks: [futureTask({ scheduledAt: '2026-05-30T14:00:00Z' })],
        getWeather: () => ({ peakWindKmh: 80 }),
        dispatchPush,
      }),
    );
    expect(result.scanned).toBe(0);
    expect(dispatchPush).not.toHaveBeenCalled();
  });

  it('amplifies wind risk by DAYS_OF_RISK multiplier (mid-wind triggers when DOR>1)', async () => {
    // 30 km/h peak alone wouldn't fire (threshold 40). With DOR 1.5 → 45.
    const dispatchPush = vi.fn(async () => ({ ok: true }));
    const result = await scanUpcomingTasks(
      makeBaseInputs({
        tasks: [futureTask()],
        getWeather: () => ({ peakWindKmh: 30 }),
        daysOfRisk: () => 1.5,
        dispatchPush,
      }),
    );
    expect(result.warned).toBe(1);
    expect(dispatchPush).toHaveBeenCalledOnce();
  });

  it('detects seismic-outdoor hazard for outdoor tasks when magnitude >= 5', async () => {
    const dispatchPush = vi.fn(async () => ({ ok: true }));
    const result = await scanUpcomingTasks(
      makeBaseInputs({
        tasks: [futureTask({ hazardTags: ['outdoor'], title: 'Topografía' })],
        getWeather: () => ({ peakWindKmh: 5 }),
        getSeismic: () => ({ recentMagnitude: 5.7 }),
        dispatchPush,
      }),
    );
    expect(result.warned).toBe(1);
    expect(result.warnings[0].hazard).toBe('seismic-outdoor');
  });
});
