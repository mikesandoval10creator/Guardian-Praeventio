// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  subscribe,
  emit,
  getState,
  __resetForTests,
  type GuardianEvent,
} from './eventBus.js';

beforeEach(() => {
  __resetForTests();
});

describe('eventBus', () => {
  it('subscriber tipo-específico recibe solo eventos de ese tipo', () => {
    const fall = vi.fn();
    const hr = vi.fn();
    subscribe('sensor.fall', fall);
    subscribe('sensor.heartrate.high', hr);

    emit({ type: 'sensor.fall', severity: 'high', gForce: 5.2, at: '2026-05-11T10:00:00Z' });
    expect(fall).toHaveBeenCalledTimes(1);
    expect(hr).not.toHaveBeenCalled();
  });

  it('wildcard recibe todos los eventos', () => {
    const all = vi.fn();
    subscribe('*', all);
    emit({ type: 'sensor.fall', severity: 'low', gForce: 1.5, at: 't1' });
    emit({ type: 'sync.online', at: 't2' });
    expect(all).toHaveBeenCalledTimes(2);
  });

  it('subscriber tardío recibe el último evento del tipo (async)', async () => {
    emit({ type: 'mesh.ble.connected', peerCount: 3, at: 't1' });
    const late = vi.fn();
    subscribe('mesh.ble.connected', late);
    // queueMicrotask → siguiente tick
    await Promise.resolve();
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0][0].peerCount).toBe(3);
  });

  it('error en un subscriber no impide notificación a los demás', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    subscribe('emergency.sos.triggered', broken);
    subscribe('emergency.sos.triggered', ok);
    emit({ type: 'emergency.sos.triggered', workerUid: 'w1', reason: 'manual', at: 't1' });
    expect(broken).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('unsubscribe detiene la recepción', () => {
    const fn = vi.fn();
    const off = subscribe('sync.online', fn);
    emit({ type: 'sync.online', at: 't1' });
    off();
    emit({ type: 'sync.online', at: 't2' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('getState refleja último por tipo + conteos', () => {
    emit({ type: 'sync.online', at: 't1' });
    emit({ type: 'sync.online', at: 't2' });
    emit({ type: 'sync.offline', at: 't3' });
    const s = getState();
    expect(s.countByType['sync.online']).toBe(2);
    expect(s.countByType['sync.offline']).toBe(1);
    expect((s.lastByType['sync.online'] as Extract<GuardianEvent, { type: 'sync.online' }>).at).toBe(
      't2',
    );
  });

  it('múltiples emit sincrónicos preservan orden', () => {
    const calls: string[] = [];
    subscribe('incident.created', (e) => calls.push(e.incidentId));
    emit({ type: 'incident.created', incidentId: 'i1', severity: 'low', at: 't1' });
    emit({ type: 'incident.created', incidentId: 'i2', severity: 'high', at: 't2' });
    emit({ type: 'incident.created', incidentId: 'i3', severity: 'critical', at: 't3' });
    expect(calls).toEqual(['i1', 'i2', 'i3']);
  });
});
