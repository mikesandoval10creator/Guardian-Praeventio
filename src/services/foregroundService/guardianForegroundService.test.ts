import { describe, it, expect, vi } from 'vitest';
import {
  GuardianForegroundController,
  HeartbeatTracker,
  buildNotificationForState,
  type ForegroundServicePluginContract,
  type GuardianForegroundContext,
} from './guardianForegroundService.js';

function makePlugin(): ForegroundServicePluginContract & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async startForegroundService(opts) {
      calls.push(`start:${opts.notification.title}`);
    },
    async stopForegroundService() {
      calls.push('stop');
    },
    async updateForegroundService(opts) {
      calls.push(`update:${opts.notification.title}`);
    },
  };
}

const CTX: GuardianForegroundContext = {
  workerUid: 'w1',
  projectId: 'p1',
  loneWorker: false,
};

describe('buildNotificationForState', () => {
  it('on_shift sin lone worker → notificación normal', () => {
    const n = buildNotificationForState('on_shift', CTX);
    expect(n.title).toContain('Guardian');
    expect(n.body).toContain('p1');
    expect(n.silent).toBe(false);
    expect(n.serviceType).toBe('location');
  });

  it('on_shift con lone worker → mensaje específico', () => {
    const n = buildNotificationForState('on_shift', { ...CTX, loneWorker: true });
    expect(n.body).toMatch(/[Tt]rabajo aislado/);
  });

  it('critical_zone → título de zona crítica', () => {
    const n = buildNotificationForState('critical_zone', { ...CTX, currentZoneKind: 'rescue' });
    expect(n.title).toMatch(/Zona Crítica|Cr.tica/);
    expect(n.body).toContain('rescue');
    expect(n.serviceType).toBe('location');
  });

  it('off_shift → silent + shortService', () => {
    const n = buildNotificationForState('off_shift', CTX);
    expect(n.silent).toBe(true);
    expect(n.serviceType).toBe('shortService');
  });
});

describe('GuardianForegroundController state machine', () => {
  it('off_shift inicial — sin start call', async () => {
    const plugin = makePlugin();
    const c = new GuardianForegroundController(plugin);
    expect(c.state).toBe('off_shift');
    expect(c.isRunning).toBe(false);
    expect(plugin.calls).toHaveLength(0);
  });

  it('transition off_shift → on_shift → llama startForegroundService', async () => {
    const plugin = makePlugin();
    const c = new GuardianForegroundController(plugin);
    const r = await c.transitionTo('on_shift', CTX);
    expect(r.applied).toBe(true);
    expect(r.state).toBe('on_shift');
    expect(c.isRunning).toBe(true);
    expect(plugin.calls[0]).toMatch(/^start:/);
  });

  it('transition on_shift → critical_zone → llama updateForegroundService (no stop+start)', async () => {
    const plugin = makePlugin();
    const c = new GuardianForegroundController(plugin);
    await c.transitionTo('on_shift', CTX);
    plugin.calls.length = 0;
    await c.transitionTo('critical_zone', CTX);
    expect(plugin.calls[0]).toMatch(/^update:/);
    expect(plugin.calls.some((x) => x.startsWith('start'))).toBe(false);
  });

  it('transition critical_zone → off_shift → llama stopForegroundService', async () => {
    const plugin = makePlugin();
    const c = new GuardianForegroundController(plugin);
    await c.transitionTo('critical_zone', CTX);
    plugin.calls.length = 0;
    await c.transitionTo('off_shift', CTX);
    expect(plugin.calls[0]).toBe('stop');
    expect(c.isRunning).toBe(false);
  });

  it('no_change cuando se transiciona al mismo state corriendo', async () => {
    const plugin = makePlugin();
    const c = new GuardianForegroundController(plugin);
    await c.transitionTo('on_shift', CTX);
    plugin.calls.length = 0;
    const r = await c.transitionTo('on_shift', CTX);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('no_change');
    expect(plugin.calls).toHaveLength(0);
  });

  it('error del plugin no rompe state — devuelve applied:false con razón', async () => {
    const plugin: ForegroundServicePluginContract = {
      async startForegroundService() {
        throw new Error('PERMISSION_DENIED');
      },
      async stopForegroundService() {},
      async updateForegroundService() {},
    };
    const c = new GuardianForegroundController(plugin);
    const r = await c.transitionTo('on_shift', CTX);
    expect(r.applied).toBe(false);
    expect(r.reason).toContain('PERMISSION_DENIED');
    expect(c.state).toBe('off_shift'); // preserva estado
  });
});

describe('HeartbeatTracker', () => {
  it('incrementa secuencia en cada build', () => {
    const t = new HeartbeatTracker();
    const now = new Date('2026-05-13T10:00:00Z');
    const h1 = t.build('w1', 'p1', 'on_shift', now);
    const h2 = t.build('w1', 'p1', 'on_shift', new Date(now.getTime() + 30_000));
    expect(h1.seq).toBe(1);
    expect(h2.seq).toBe(2);
  });

  it('isStale true al inicio', () => {
    const t = new HeartbeatTracker();
    expect(t.isStale(new Date())).toBe(true);
  });

  it('isStale false tras heartbeat reciente', () => {
    const t = new HeartbeatTracker();
    const now = new Date('2026-05-13T10:00:00Z');
    t.build('w1', 'p1', 'on_shift', now);
    expect(t.isStale(new Date(now.getTime() + 60_000))).toBe(false);
  });

  it('isStale true si >90s sin heartbeat (default)', () => {
    const t = new HeartbeatTracker();
    const now = new Date('2026-05-13T10:00:00Z');
    t.build('w1', 'p1', 'on_shift', now);
    expect(t.isStale(new Date(now.getTime() + 120_000))).toBe(true);
  });

  it('staleMs custom respetado', () => {
    const t = new HeartbeatTracker();
    const now = new Date('2026-05-13T10:00:00Z');
    t.build('w1', 'p1', 'on_shift', now);
    expect(t.isStale(new Date(now.getTime() + 31_000), 30_000)).toBe(true);
    expect(t.isStale(new Date(now.getTime() + 29_000), 30_000)).toBe(false);
  });
});
