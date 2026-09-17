import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmergencyDeliveryController,
  sendEmergencyDelivery,
  type EmergencyDeliveryPayload,
  type EmergencyDeliveryEvent,
} from './emergencyDeliveryOutbox';
import { createInMemoryOutboxAdapter } from '../sync/genericOutboxEngine';

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const payload: EmergencyDeliveryPayload = {
  operation: 'triage',
  projectId: 'project-1',
  workerId: 'worker-1',
  status: 'danger',
  triageLevel: 'rojo',
  occurredAt: '2026-09-17T10:00:00.000Z',
  location: { lat: -33.45, lng: -70.66 },
};

const event: EmergencyDeliveryEvent = {
  clientEventId: 'emergency-event-1',
  kind: 'emergency_delivery',
  priority: 'critical',
  payload,
  occurredAt: payload.occurredAt,
};

const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendEmergencyDelivery', () => {
  it('POSTs the packet with the stable idempotency key and returns the server ACK', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, delivered: true, serverEventId: 'srv-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await sendEmergencyDelivery(event);

    expect(result.kind).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/emergency/delivery');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Idempotency-Key']).toBe('emergency-event-1');
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientEventId: 'emergency-event-1',
      operation: 'triage',
      projectId: 'project-1',
    });
  });

  it('classifies network failure as retry, never dropping the packet', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    await expect(sendEmergencyDelivery(event)).resolves.toEqual({
      kind: 'retry',
      error: 'Failed to fetch',
    });
  });

  it('aborts a hung request instead of blocking the emergency path forever', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('network_timeout')));
    }));

    const pending = sendEmergencyDelivery(event);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual({
      kind: 'retry',
      error: 'network_timeout',
    });
    vi.useRealTimers();
  });

  it('classifies rules/membership denial as retryable retention with an honest HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"forbidden"}', { status: 403 }));
    await expect(sendEmergencyDelivery(event)).resolves.toEqual({
      kind: 'retry',
      error: 'HTTP 403',
    });
  });
});

describe('createEmergencyDeliveryController', () => {
  it('keeps a network-failed packet pending and delivers it later with the same key', async () => {
    let now = 1_000_000;
    const adapter = createInMemoryOutboxAdapter<EmergencyDeliveryPayload>();
    const sender = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'retry' as const, error: 'network_error' })
      .mockResolvedValueOnce({ kind: 'success' as const });
    const controller = createEmergencyDeliveryController({
      adapter,
      sender,
      nowMs: () => now,
    });

    const first = await controller.submit(payload, { clientEventId: event.clientEventId });
    expect(first.status).toBe('pending');
    expect(first.failureKind).toBe('network');
    expect(await adapter.listEntries()).toHaveLength(1);

    now += 2_000;
    await controller.flush();
    expect(await adapter.listEntries()).toHaveLength(0);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0]?.[0].clientEventId).toBe(event.clientEventId);
    expect(sender.mock.calls[1]?.[0].clientEventId).toBe(event.clientEventId);
  });

  it('surfaces a 403 as failed while retaining the packet for recovery/escalation', async () => {
    const adapter = createInMemoryOutboxAdapter<EmergencyDeliveryPayload>();
    const controller = createEmergencyDeliveryController({
      adapter,
      sender: vi.fn(async () => ({ kind: 'retry' as const, error: 'HTTP 403' })),
    });

    const result = await controller.submit(payload, { clientEventId: 'emergency-denied' });
    expect(result.status).toBe('failed');
    expect(result.failureKind).toBe('authorization');
    expect(result.error).toBe('HTTP 403');
    expect(await adapter.listEntries()).toHaveLength(1);
  });

  it('deduplicates a re-tap with the same clientEventId', async () => {
    const adapter = createInMemoryOutboxAdapter<EmergencyDeliveryPayload>();
    const controller = createEmergencyDeliveryController({
      adapter,
      sender: vi.fn(async () => ({ kind: 'retry' as const, error: 'network_error' })),
    });

    await controller.submit(payload, { clientEventId: 'emergency-dedupe' });
    await controller.submit(payload, { clientEventId: 'emergency-dedupe' });
    expect(await adapter.listEntries()).toHaveLength(1);
  });
});
