import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildEvent,
  emit,
  subscribe,
  clear,
  getEvents,
  getListenerCount,
  eventBus,
  __resetForTests,
  __setPolicyForTests,
  type BusEvent,
  type EventType,
} from './eventBus.js';
import {
  computeFaenaStateAndEmit,
  recordCheckInAndEmit,
  assessFatigueAndEmit,
  type FaenaStateChangedPayload,
  type LoneWorkerCheckInPayload,
  type FatigueThresholdCrossedPayload,
} from './integrations.js';
import type { FaenaStateInput } from '../operationalState/faenaStateEngine.js';
import type { LoneWorkerSession } from '../loneWorker/loneWorkerService.js';
import type { WorkSession } from '../fatigue/fatigueMonitor.js';

beforeEach(() => {
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  vi.useRealTimers();
});

describe('eventBus core — subscribe / emit / clear', () => {
  it('entrega un evento síncronamente a un suscriptor (policy=none)', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    const received: BusEvent[] = [];
    subscribe('evacuation_started', (e) => received.push(e));
    emit(buildEvent({ type: 'evacuation_started', payload: { zone: 'A' } }));
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ zone: 'A' });
  });

  it('unsubscribe deja de recibir eventos', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    const received: BusEvent[] = [];
    const unsub = subscribe('evacuation_started', (e) => received.push(e));
    emit(buildEvent({ type: 'evacuation_started', payload: { n: 1 } }));
    unsub();
    emit(buildEvent({ type: 'evacuation_started', payload: { n: 2 } }));
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ n: 1 });
  });

  it('no entrega un evento al listener de otro tipo', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    __setPolicyForTests('evacuation_ended', { kind: 'none' });
    const startedReceived: BusEvent[] = [];
    const endedReceived: BusEvent[] = [];
    subscribe('evacuation_started', (e) => startedReceived.push(e));
    subscribe('evacuation_ended', (e) => endedReceived.push(e));
    emit(buildEvent({ type: 'evacuation_started', payload: {} }));
    emit(buildEvent({ type: 'evacuation_ended', payload: {} }));
    expect(startedReceived).toHaveLength(1);
    expect(endedReceived).toHaveLength(1);
  });

  it('múltiples suscriptores del mismo tipo reciben el mismo evento', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    const a: BusEvent[] = [];
    const b: BusEvent[] = [];
    subscribe('evacuation_started', (e) => a.push(e));
    subscribe('evacuation_started', (e) => b.push(e));
    emit(buildEvent({ type: 'evacuation_started', payload: { hit: true } }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toBe(b[0]); // mismo objeto, no copia.
  });

  it('un listener que lanza no rompe a los demás', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    const a: BusEvent[] = [];
    subscribe('evacuation_started', () => {
      throw new Error('boom');
    });
    subscribe('evacuation_started', (e) => a.push(e));
    emit(buildEvent({ type: 'evacuation_started', payload: {} }));
    expect(a).toHaveLength(1);
  });

  it('events ring buffer captura los emitidos', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    emit(buildEvent({ type: 'evacuation_started', payload: { i: 1 } }));
    emit(buildEvent({ type: 'evacuation_started', payload: { i: 2 } }));
    expect(getEvents()).toHaveLength(2);
    expect(getEvents('evacuation_started')).toHaveLength(2);
  });

  it('clear() vacía el history pero mantiene listeners', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    const received: BusEvent[] = [];
    subscribe('evacuation_started', (e) => received.push(e));
    emit(buildEvent({ type: 'evacuation_started', payload: {} }));
    clear();
    expect(getEvents()).toHaveLength(0);
    // listener sigue activo
    emit(buildEvent({ type: 'evacuation_started', payload: { after: true } }));
    expect(received).toHaveLength(2);
    expect(getListenerCount('evacuation_started')).toBe(1);
  });

  it('clear(type) sólo afecta a ese tipo', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    __setPolicyForTests('evacuation_ended', { kind: 'none' });
    emit(buildEvent({ type: 'evacuation_started', payload: {} }));
    emit(buildEvent({ type: 'evacuation_ended', payload: {} }));
    clear('evacuation_started');
    expect(getEvents('evacuation_started')).toHaveLength(0);
    expect(getEvents('evacuation_ended')).toHaveLength(1);
  });

  it('eventBus façade expone el mismo singleton', () => {
    __setPolicyForTests('evacuation_started', { kind: 'none' });
    const received: BusEvent[] = [];
    eventBus.subscribe('evacuation_started', (e) => received.push(e));
    eventBus.emit(eventBus.buildEvent({ type: 'evacuation_started', payload: {} }));
    expect(received).toHaveLength(1);
    expect(eventBus.events).toHaveLength(1);
  });
});

describe('eventBus throttle / debounce', () => {
  it('throttle: deja pasar el primero y descarta dentro de la ventana', () => {
    __setPolicyForTests('lone_worker_check_in', { kind: 'throttle', ms: 100 });
    const received: BusEvent[] = [];
    subscribe('lone_worker_check_in', (e) => received.push(e));
    const t0 = 1_700_000_000_000;
    emit(buildEvent({ type: 'lone_worker_check_in', payload: { n: 1 }, ts: t0 }));
    emit(buildEvent({ type: 'lone_worker_check_in', payload: { n: 2 }, ts: t0 + 50 }));
    emit(buildEvent({ type: 'lone_worker_check_in', payload: { n: 3 }, ts: t0 + 99 }));
    emit(buildEvent({ type: 'lone_worker_check_in', payload: { n: 4 }, ts: t0 + 200 }));
    expect(received.map((e) => (e.payload as { n: number }).n)).toEqual([1, 4]);
  });

  it('debounce: emite sólo el último después de la ventana de silencio', async () => {
    vi.useFakeTimers();
    __setPolicyForTests('faena_state_changed', { kind: 'debounce', ms: 50 });
    const received: BusEvent[] = [];
    subscribe('faena_state_changed', (e) => received.push(e));
    emit(buildEvent({ type: 'faena_state_changed', payload: { v: 'a' } }));
    emit(buildEvent({ type: 'faena_state_changed', payload: { v: 'b' } }));
    emit(buildEvent({ type: 'faena_state_changed', payload: { v: 'c' } }));
    // Antes del flush no se ha entregado nada.
    expect(received).toHaveLength(0);
    vi.advanceTimersByTime(60);
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ v: 'c' });
  });
});

describe('integrations — faenaStateEngine', () => {
  function baseInput(over: Partial<FaenaStateInput> = {}): FaenaStateInput {
    return {
      activeEmergencyIncidents: 0,
      activeStoppages: [],
      restrictedZones: [],
      criticalEquipmentDown: [],
      openCriticalFindings: 0,
      activeWorkPermits: 0,
      ...over,
    };
  }

  it('emite faena_state_changed cuando el estado cambia', () => {
    __setPolicyForTests('faena_state_changed', { kind: 'none' });
    const received: BusEvent<FaenaStateChangedPayload>[] = [];
    subscribe<FaenaStateChangedPayload>('faena_state_changed', (e) =>
      received.push(e),
    );
    const result = computeFaenaStateAndEmit(
      baseInput({ activeEmergencyIncidents: 1 }),
      'operativa',
    );
    expect(result.state).toBe('emergencia');
    expect(received).toHaveLength(1);
    expect(received[0].payload.previousState).toBe('operativa');
    expect(received[0].payload.newState).toBe('emergencia');
  });

  it('NO emite cuando el estado no cambió', () => {
    __setPolicyForTests('faena_state_changed', { kind: 'none' });
    const received: BusEvent[] = [];
    subscribe('faena_state_changed', (e) => received.push(e));
    computeFaenaStateAndEmit(baseInput(), 'operativa');
    expect(received).toHaveLength(0);
  });

  it('emite en boot si previousState es null', () => {
    __setPolicyForTests('faena_state_changed', { kind: 'none' });
    const received: BusEvent<FaenaStateChangedPayload>[] = [];
    subscribe<FaenaStateChangedPayload>('faena_state_changed', (e) =>
      received.push(e),
    );
    computeFaenaStateAndEmit(baseInput(), null);
    expect(received).toHaveLength(1);
    expect(received[0].payload.previousState).toBeNull();
    expect(received[0].payload.newState).toBe('operativa');
  });
});

describe('integrations — loneWorkerService', () => {
  function session(over: Partial<LoneWorkerSession> = {}): LoneWorkerSession {
    return {
      id: 's1',
      workerUid: 'w1',
      startedAt: '2026-05-11T10:00:00Z',
      checkInIntervalMin: 30,
      checkIns: [],
      status: 'active',
      ...over,
    };
  }

  it('emite lone_worker_check_in al registrar check-in OK', () => {
    __setPolicyForTests('lone_worker_check_in', { kind: 'none' });
    const received: BusEvent<LoneWorkerCheckInPayload>[] = [];
    subscribe<LoneWorkerCheckInPayload>('lone_worker_check_in', (e) =>
      received.push(e),
    );
    const updated = recordCheckInAndEmit(session(), {
      at: '2026-05-11T10:15:00Z',
      lat: -33.4,
      lng: -70.6,
      status: 'ok',
    });
    expect(updated.checkIns).toHaveLength(1);
    expect(received).toHaveLength(1);
    expect(received[0].payload.workerUid).toBe('w1');
    expect(received[0].payload.status).toBe('ok');
    expect(received[0].payload.hasLocation).toBe(true);
  });

  it('emite con status=help cuando worker solicita ayuda', () => {
    __setPolicyForTests('lone_worker_check_in', { kind: 'none' });
    const received: BusEvent<LoneWorkerCheckInPayload>[] = [];
    subscribe<LoneWorkerCheckInPayload>('lone_worker_check_in', (e) =>
      received.push(e),
    );
    recordCheckInAndEmit(session(), {
      at: '2026-05-11T10:15:00Z',
      status: 'help',
    });
    expect(received[0].payload.status).toBe('help');
    expect(received[0].payload.hasLocation).toBe(false);
  });
});

describe('integrations — fatigueMonitor', () => {
  it('emite fatigue_threshold_crossed cuando el riesgo escala', () => {
    __setPolicyForTests('fatigue_threshold_crossed', { kind: 'none' });
    const received: BusEvent<FatigueThresholdCrossedPayload>[] = [];
    subscribe<FatigueThresholdCrossedPayload>(
      'fatigue_threshold_crossed',
      (e) => received.push(e),
    );
    const sessions: WorkSession[] = [
      {
        workerUid: 'w1',
        startedAt: '2026-05-11T00:00:00Z',
        endedAt: '2026-05-11T14:00:00Z', // 14h → critical
        isNight: false,
        hadCriticalTasks: false,
      },
    ];
    const result = assessFatigueAndEmit(
      'w1',
      sessions,
      'low',
      { now: new Date('2026-05-11T14:00:00Z') },
    );
    expect(result.risk).toBe('critical');
    expect(received).toHaveLength(1);
    expect(received[0].payload.previousRisk).toBe('low');
    expect(received[0].payload.newRisk).toBe('critical');
    expect(received[0].payload.shouldRestrictCritical).toBe(true);
  });

  it('NO emite cuando el riesgo no escaló', () => {
    __setPolicyForTests('fatigue_threshold_crossed', { kind: 'none' });
    const received: BusEvent[] = [];
    subscribe('fatigue_threshold_crossed', (e) => received.push(e));
    // sin sesiones → risk low; previousRisk también low → no emit
    assessFatigueAndEmit('w1', [], 'low', { now: new Date('2026-05-11T12:00:00Z') });
    expect(received).toHaveLength(0);
  });

  it('en boot (previousRisk null) emite si el primer assessment ya es ≥ moderate', () => {
    __setPolicyForTests('fatigue_threshold_crossed', { kind: 'none' });
    const received: BusEvent[] = [];
    subscribe('fatigue_threshold_crossed', (e) => received.push(e));
    const sessions: WorkSession[] = [
      {
        workerUid: 'w1',
        startedAt: '2026-05-11T00:00:00Z',
        endedAt: '2026-05-11T13:00:00Z', // 13h → critical
        isNight: false,
        hadCriticalTasks: false,
      },
    ];
    assessFatigueAndEmit('w1', sessions, null, {
      now: new Date('2026-05-11T13:00:00Z'),
    });
    expect(received).toHaveLength(1);
  });
});

describe('integration smoke — multi-subscriber pipeline', () => {
  it('un faena_state_changed crítico puede desencadenar listeners derivados', () => {
    __setPolicyForTests('faena_state_changed', { kind: 'none' });
    const stateChanges: string[] = [];
    const audit: Array<{ type: EventType; ts: number }> = [];

    subscribe<FaenaStateChangedPayload>('faena_state_changed', (e) => {
      stateChanges.push(e.payload.newState);
    });
    // Listener "auditoría" suscrito a varios tipos.
    subscribe('faena_state_changed', (e) => audit.push({ type: e.type, ts: e.ts }));
    subscribe('evacuation_started', (e) => audit.push({ type: e.type, ts: e.ts }));

    computeFaenaStateAndEmit(
      {
        activeEmergencyIncidents: 1,
        activeStoppages: [],
        restrictedZones: [],
        criticalEquipmentDown: [],
        openCriticalFindings: 0,
        activeWorkPermits: 0,
      },
      'operativa',
    );
    emit(buildEvent({ type: 'evacuation_started', payload: { zone: 'A' } }));

    expect(stateChanges).toEqual(['emergencia']);
    expect(audit.map((a) => a.type)).toEqual([
      'faena_state_changed',
      'evacuation_started',
    ]);
  });
});
