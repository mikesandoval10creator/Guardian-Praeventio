import { describe, it, expect } from 'vitest';
import {
  deriveLoneWorkerStatus,
  decideEscalation,
  recordCheckIn,
  endSession,
  type LoneWorkerSession,
} from './loneWorkerService.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function session(over: Partial<LoneWorkerSession> = {}): LoneWorkerSession {
  return {
    id: 's1',
    workerUid: 'w1',
    startedAt: '2026-05-11T11:00:00Z',
    checkInIntervalMin: 30,
    checkIns: [],
    status: 'active',
    ...over,
  };
}

describe('deriveLoneWorkerStatus', () => {
  it('active si dentro de intervalo desde startedAt', () => {
    // intervalo 30min, NOW = startedAt + 60min → overdue_warning porque pasó 1×
    const s = session();
    // Adjust: started recientemente
    s.startedAt = new Date(NOW.getTime() - 15 * 60_000).toISOString();
    expect(deriveLoneWorkerStatus(s, NOW)).toBe('active');
  });

  it('overdue_warning después de 1× intervalo sin check-in', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 40 * 60_000).toISOString(),
    });
    expect(deriveLoneWorkerStatus(s, NOW)).toBe('overdue_warning');
  });

  it('overdue_critical después de 2× intervalo sin check-in', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 90 * 60_000).toISOString(),
    });
    expect(deriveLoneWorkerStatus(s, NOW)).toBe('overdue_critical');
  });

  it('help_requested si último check-in fue "help"', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      checkIns: [{ at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), status: 'help' }],
    });
    expect(deriveLoneWorkerStatus(s, NOW)).toBe('help_requested');
  });

  it('ended si tiene endedAt', () => {
    const s = session({ endedAt: NOW.toISOString() });
    expect(deriveLoneWorkerStatus(s, NOW)).toBe('ended');
  });

  it('check-in reciente reinicia el timer', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      checkIns: [{ at: new Date(NOW.getTime() - 10 * 60_000).toISOString(), status: 'ok' }],
    });
    expect(deriveLoneWorkerStatus(s, NOW)).toBe('active');
  });
});

describe('decideEscalation', () => {
  it('overdue_warning → supervisor', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 40 * 60_000).toISOString(),
    });
    const e = decideEscalation(s, NOW);
    expect(e?.level).toBe('supervisor');
  });

  it('overdue_critical → brigade', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 90 * 60_000).toISOString(),
    });
    const e = decideEscalation(s, NOW);
    expect(e?.level).toBe('brigade');
  });

  it('help_requested → emergency_services', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      checkIns: [{ at: NOW.toISOString(), status: 'help' }],
    });
    const e = decideEscalation(s, NOW);
    expect(e?.level).toBe('emergency_services');
  });

  it('active → null (no escalamiento)', () => {
    const s = session({
      startedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    });
    expect(decideEscalation(s, NOW)).toBeNull();
  });
});

describe('recordCheckIn', () => {
  it('agrega check-in y actualiza lastKnownLocation', () => {
    const s = session();
    const after = recordCheckIn(s, {
      at: NOW.toISOString(),
      lat: -33.4,
      lng: -70.7,
      status: 'ok',
    });
    expect(after.checkIns).toHaveLength(1);
    expect(after.lastKnownLocation?.lat).toBe(-33.4);
  });

  it('check-in con status=help marca help_requested', () => {
    const s = session();
    const after = recordCheckIn(s, { status: 'help' });
    expect(after.status).toBe('help_requested');
  });
});

describe('endSession', () => {
  it('marca endedAt y status=ended', () => {
    const s = endSession(session(), NOW.toISOString());
    expect(s.endedAt).toBe(NOW.toISOString());
    expect(s.status).toBe('ended');
  });
});
