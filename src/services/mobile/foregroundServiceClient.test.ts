/**
 * Smoke tests for `foregroundServiceClient`.
 *
 * The native module is never imported here — the test injects a fake
 * plugin via `__setForegroundServicePlugin` and forces the native
 * checker on/off via `__setNativeCheckerForTests`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startLoneWorkerFgs,
  stopLoneWorkerFgs,
  isRunning,
  isAndroidNative,
  __setForegroundServicePlugin,
  __setNativeCheckerForTests,
  __resetForegroundServiceClient,
  type ForegroundServicePluginLike,
  type StartForegroundServiceArgs,
} from './foregroundServiceClient';

interface FakePlugin extends ForegroundServicePluginLike {
  calls: Array<{ op: string; args?: unknown }>;
}

function makeFakePlugin(opts: { fail?: 'start' | 'stop' } = {}): FakePlugin {
  const calls: FakePlugin['calls'] = [];
  return {
    calls,
    async createNotificationChannel(args) {
      calls.push({ op: 'createChannel', args });
    },
    async startForegroundService(args: StartForegroundServiceArgs) {
      calls.push({ op: 'start', args });
      if (opts.fail === 'start') throw new Error('PERMISSION_DENIED');
    },
    async updateForegroundService(args: StartForegroundServiceArgs) {
      calls.push({ op: 'update', args });
    },
    async stopForegroundService() {
      calls.push({ op: 'stop' });
      if (opts.fail === 'stop') throw new Error('SERVICE_NOT_RUNNING');
    },
  };
}

beforeEach(() => {
  __resetForegroundServiceClient();
});

describe('foregroundServiceClient — platform guard', () => {
  it('is no-op on web (Capacitor.isNativePlatform false)', async () => {
    __setNativeCheckerForTests(() => false);
    const plugin = makeFakePlugin();
    __setForegroundServicePlugin(plugin);

    const r = await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 900 });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('not_native');
    expect(plugin.calls).toHaveLength(0);
    expect(isRunning()).toBe(false);
  });

  it('isAndroidNative returns false in the test environment', () => {
    // jsdom has no Capacitor — the function should return false, NOT throw.
    expect(() => isAndroidNative()).not.toThrow();
    expect(isAndroidNative()).toBe(false);
  });
});

describe('foregroundServiceClient — lifecycle on Android', () => {
  beforeEach(() => {
    __setNativeCheckerForTests(() => true);
  });

  it('startLoneWorkerFgs creates channel and starts the service', async () => {
    const plugin = makeFakePlugin();
    __setForegroundServicePlugin(plugin);

    const r = await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 900 });
    expect(r.applied).toBe(true);
    expect(r.reason).toBe('started');
    expect(isRunning()).toBe(true);

    const opsOrder = plugin.calls.map((c) => c.op);
    expect(opsOrder).toEqual(['createChannel', 'start']);

    const startArgs = plugin.calls[1].args as StartForegroundServiceArgs;
    expect(startArgs.notificationChannelId).toBe('lone_worker');
    expect(startArgs.smallIcon).toBe('ic_guardian_shield');
    expect(startArgs.serviceType).toBe('location_health');
    expect(startArgs.body).toMatch(/15 min/); // 900s → 15 min
  });

  it('second start while running emits updateForegroundService (idempotent)', async () => {
    const plugin = makeFakePlugin();
    __setForegroundServicePlugin(plugin);

    await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 900 });
    plugin.calls.length = 0;

    const r = await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 300 });
    expect(r.applied).toBe(true);
    expect(r.reason).toBe('updated');
    expect(plugin.calls.map((c) => c.op)).toEqual(['update']);

    const updateArgs = plugin.calls[0].args as StartForegroundServiceArgs;
    expect(updateArgs.body).toMatch(/5 min/);
  });

  it('stopLoneWorkerFgs flips running flag', async () => {
    const plugin = makeFakePlugin();
    __setForegroundServicePlugin(plugin);

    await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 900 });
    expect(isRunning()).toBe(true);

    const r = await stopLoneWorkerFgs();
    expect(r.applied).toBe(true);
    expect(r.reason).toBe('stopped');
    expect(isRunning()).toBe(false);
  });

  it('stop when nothing is running is a no-op (applied=false, reason=stopped)', async () => {
    const plugin = makeFakePlugin();
    __setForegroundServicePlugin(plugin);

    const r = await stopLoneWorkerFgs();
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('stopped');
  });

  it('plugin throw on start surfaces as reason=error and keeps running=false', async () => {
    const plugin = makeFakePlugin({ fail: 'start' });
    __setForegroundServicePlugin(plugin);

    const r = await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 900 });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('error');
    expect(r.error).toContain('PERMISSION_DENIED');
    expect(isRunning()).toBe(false);
  });

  it('handles short intervals (<60s) in seconds units', async () => {
    const plugin = makeFakePlugin();
    __setForegroundServicePlugin(plugin);

    await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 30 });
    const startArgs = plugin.calls[1].args as StartForegroundServiceArgs;
    expect(startArgs.body).toMatch(/30 s/);
  });
});

describe('foregroundServiceClient — unimplemented plugin (web fallback)', () => {
  beforeEach(() => {
    __setNativeCheckerForTests(() => true);
  });

  it('reports reason=error when the real plugin throws UNIMPLEMENTED', async () => {
    // Simulates the real-world failure mode where the native checker
    // lies (e.g. detection bug) but the plugin bridge isn't actually
    // available — every method call throws `UNIMPLEMENTED`.
    const unimplemented: ForegroundServicePluginLike = {
      async createNotificationChannel() {
        throw Object.assign(new Error('plugin not implemented on web'), {
          code: 'UNIMPLEMENTED',
        });
      },
      async startForegroundService() {
        throw Object.assign(new Error('plugin not implemented on web'), {
          code: 'UNIMPLEMENTED',
        });
      },
      async updateForegroundService() {
        throw new Error('unreachable');
      },
      async stopForegroundService() {
        throw new Error('unreachable');
      },
    };
    __setForegroundServicePlugin(unimplemented);
    const r = await startLoneWorkerFgs({ workerUid: 'w1', checkInIntervalSec: 900 });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('error');
    expect(r.error).toMatch(/not implemented|UNIMPLEMENTED/);
    expect(isRunning()).toBe(false);
  });
});

// Silence the vi-unused import warning in strict TS configs.
void vi;
