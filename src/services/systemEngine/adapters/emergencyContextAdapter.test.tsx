// @vitest-environment jsdom
//
// Tests — emergencyContextAdapter: SOS observability emit on emergency
// activation. Pins the idempotency contract (stable key tied to the emergency
// activation, NOT the emit-time clock) and the not-ok surfacing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── controllable context state + spies (hoisted above the vi.mock factories) ──
const H = vi.hoisted(() => ({
  ctx: {
    user: { uid: 'u1' } as { uid: string } | null,
    selectedProject: { id: 'p1' } as { id: string } | null,
    isEmergencyActive: false,
    emergencyType: null as string | null,
    emergencyStartTime: null as number | null,
  },
  emitMock: vi.fn(
    async (_event?: unknown) =>
      ({ ok: true, eventId: 'evt-1' }) as { ok: boolean; error?: string; eventId?: string },
  ),
  loggerMock: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const ctx = H.ctx;
const emitMock = H.emitMock;
const loggerMock = H.loggerMock;

vi.mock('../../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: H.ctx.user }),
}));
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: H.ctx.selectedProject }),
}));
vi.mock('../../../contexts/EmergencyContext', () => ({
  useEmergency: () => ({
    isEmergencyActive: H.ctx.isEmergencyActive,
    emergencyType: H.ctx.emergencyType,
    emergencyStartTime: H.ctx.emergencyStartTime,
  }),
}));
vi.mock('../eventLog', () => ({
  // Passthrough envelope so the test can read back the idempotencyKey.
  buildEnvelope: (input: { idempotencyKey?: string; tenantId: string }) => ({
    id: 'evt-1',
    tenantId: input.tenantId,
    ts: 0,
    idempotencyKey: input.idempotencyKey ?? 'evt-1',
  }),
  emit: (...args: unknown[]) => H.emitMock(...args),
}));
vi.mock('../../../utils/logger', () => ({ logger: H.loggerMock }));

import { useEmergencyContextAdapter } from './emergencyContextAdapter';

beforeEach(() => {
  emitMock.mockReset().mockResolvedValue({ ok: true, eventId: 'evt-1' });
  loggerMock.error.mockReset();
  loggerMock.warn.mockReset();
  ctx.user = { uid: 'u1' };
  ctx.selectedProject = { id: 'p1' };
  ctx.isEmergencyActive = false;
  ctx.emergencyType = null;
  ctx.emergencyStartTime = null;
});

describe('useEmergencyContextAdapter', () => {
  it('emits sos_triggered once on the inactive→active transition', async () => {
    const { rerender } = renderHook(() => useEmergencyContextAdapter({ tenantId: 't1' }));
    expect(emitMock).not.toHaveBeenCalled();

    ctx.isEmergencyActive = true;
    ctx.emergencyType = 'fall_detected';
    ctx.emergencyStartTime = 1_700_000_000_000;
    rerender();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const event = emitMock.mock.calls[0][0] as { type: string; payload: { origin: string } };
    expect(event.type).toBe('sos_triggered');
    expect(event.payload.origin).toBe('fall_detection');
  });

  it('keys idempotency on emergencyStartTime, not the emit-time clock', async () => {
    const { rerender } = renderHook(() => useEmergencyContextAdapter({ tenantId: 't1' }));
    ctx.isEmergencyActive = true;
    ctx.emergencyType = 'sos';
    ctx.emergencyStartTime = 1_700_000_000_000;
    rerender();

    const event = emitMock.mock.calls[0][0] as { idempotencyKey: string };
    // Stable + deterministic: the start time, not Date.now(), is in the key.
    expect(event.idempotencyKey).toBe('sos:u1:sos:1700000000000');
  });

  it('does not re-emit while staying active (guarded by the transition ref)', async () => {
    const { rerender } = renderHook(() => useEmergencyContextAdapter({ tenantId: 't1' }));
    ctx.isEmergencyActive = true;
    ctx.emergencyType = 'sos';
    ctx.emergencyStartTime = 1_700_000_000_000;
    rerender();
    rerender(); // still active — no second emit
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a not-ok emit result (dropped SOS audit event) as an error log', async () => {
    emitMock.mockResolvedValue({ ok: false, error: 'invalid event' });
    const { rerender } = renderHook(() => useEmergencyContextAdapter({ tenantId: 't1' }));
    ctx.isEmergencyActive = true;
    ctx.emergencyType = 'sos';
    ctx.emergencyStartTime = 1_700_000_000_000;
    rerender();
    // Let the awaited IIFE settle.
    await vi.waitFor(() => expect(loggerMock.error).toHaveBeenCalled());
    expect(loggerMock.error.mock.calls[0][0]).toContain('not ok');
  });

  it('no-ops without a tenant or a signed-in user', async () => {
    ctx.user = null;
    const { rerender } = renderHook(() => useEmergencyContextAdapter({ tenantId: 't1' }));
    ctx.isEmergencyActive = true;
    ctx.emergencyType = 'sos';
    ctx.emergencyStartTime = 1_700_000_000_000;
    rerender();
    expect(emitMock).not.toHaveBeenCalled();
  });
});
