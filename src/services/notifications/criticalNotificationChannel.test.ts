import { describe, it, expect, vi } from 'vitest';

import {
  EMERGENCY_CHANNEL,
  EMERGENCY_CHANNEL_ID,
  ensureEmergencyChannel,
  getCriticalAlertStatus,
  criticalAlertsBlocked,
  type CriticalChannelDeps,
} from './criticalNotificationChannel';

function makeDeps(over: Partial<CriticalChannelDeps> = {}): CriticalChannelDeps {
  return {
    createChannel: vi.fn(async () => {}),
    listChannels: vi.fn(async () => ({ channels: [] as Array<{ id: string }> })),
    checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
    ...over,
  };
}

describe('EMERGENCY_CHANNEL config', () => {
  it('is IMPORTANCE_HIGH with public visibility, sound and vibration', () => {
    expect(EMERGENCY_CHANNEL.id).toBe(EMERGENCY_CHANNEL_ID);
    // 4 = NotificationManager.IMPORTANCE_HIGH → heads-up popup + sound.
    expect(EMERGENCY_CHANNEL.importance).toBe(4);
    // 1 = VISIBILITY_PUBLIC → full content on the lock screen (an evacuation
    // order must be readable without unlocking).
    expect(EMERGENCY_CHANNEL.visibility).toBe(1);
    expect(EMERGENCY_CHANNEL.vibration).toBe(true);
    // es-CL user-facing copy the worker sees in the OS channel list.
    expect(EMERGENCY_CHANNEL.name.length).toBeGreaterThan(0);
  });
});

describe('ensureEmergencyChannel', () => {
  it('creates the emergency channel when it is missing', async () => {
    const deps = makeDeps();
    const created = await ensureEmergencyChannel(deps);
    expect(created).toBe(true);
    expect(deps.createChannel).toHaveBeenCalledWith(EMERGENCY_CHANNEL);
  });

  it('is idempotent — does not recreate an existing channel', async () => {
    const deps = makeDeps({
      listChannels: vi.fn(async () => ({ channels: [{ id: EMERGENCY_CHANNEL_ID }] })),
    });
    const created = await ensureEmergencyChannel(deps);
    expect(created).toBe(false);
    expect(deps.createChannel).not.toHaveBeenCalled();
  });

  it('still creates the channel when listChannels fails (defensive)', async () => {
    const deps = makeDeps({
      listChannels: vi.fn(async () => {
        throw new Error('listChannels unsupported');
      }),
    });
    const created = await ensureEmergencyChannel(deps);
    expect(created).toBe(true);
    expect(deps.createChannel).toHaveBeenCalledWith(EMERGENCY_CHANNEL);
  });

  it('never throws even if createChannel fails — push must not crash', async () => {
    const deps = makeDeps({
      createChannel: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(ensureEmergencyChannel(deps)).resolves.toBe(false);
  });
});

describe('getCriticalAlertStatus / criticalAlertsBlocked', () => {
  it('reports enabled when the OS permission is granted', async () => {
    const status = await getCriticalAlertStatus(makeDeps());
    expect(status.enabled).toBe(true);
    expect(status.permission).toBe('granted');
    expect(criticalAlertsBlocked(status)).toBe(false);
  });

  it('reports BLOCKED when the worker denied notifications (silent-SOS-death)', async () => {
    const status = await getCriticalAlertStatus(
      makeDeps({ checkPermissions: vi.fn(async () => ({ receive: 'denied' })) }),
    );
    expect(status.enabled).toBe(false);
    expect(status.permission).toBe('denied');
    expect(criticalAlertsBlocked(status)).toBe(true);
  });

  it('fails CLOSED (blocked) when checkPermissions throws — better to warn than miss', async () => {
    const status = await getCriticalAlertStatus(
      makeDeps({
        checkPermissions: vi.fn(async () => {
          throw new Error('permission read failed');
        }),
      }),
    );
    expect(status.enabled).toBe(false);
    expect(criticalAlertsBlocked(status)).toBe(true);
  });
});
