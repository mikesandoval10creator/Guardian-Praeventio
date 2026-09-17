// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deliveryState = vi.hoisted(() => ({
  submit: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock('../services/emergency/emergencyDeliveryOutbox', () => ({
  submitEmergencyDelivery: (...args: unknown[]) =>
    (deliveryState.submit as (...items: unknown[]) => unknown)(...args),
  subscribeEmergencyDelivery: (...args: unknown[]) =>
    (deliveryState.subscribe as (...items: unknown[]) => unknown)(...args),
}));
vi.mock('../services/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'worker-1', displayName: 'Ana', email: 'ana@test.com' } },
  serverTimestamp: () => 'server-timestamp',
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  doc: vi.fn(),
  updateDoc: vi.fn(),
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../lib/sentry', () => ({ captureEmergencyError: vi.fn() }));
vi.mock('../services/emergency/meshFallback', () => ({
  enqueueOutbound: vi.fn(async () => ({ enqueued: true, packetId: 'mesh-1' })),
}));
vi.mock('../utils/networkStatus', () => ({ isOnline: () => true }));

const { EmergencyProvider, useEmergency } = await import('./EmergencyContext');

const handle = {
  ctx: null as ReturnType<typeof useEmergency> | null,
};
function Harness() {
  handle.ctx = useEmergency();
  return <div data-testid="active">{String(handle.ctx.isEmergencyActive)}</div>;
}

beforeEach(() => {
  deliveryState.submit.mockReset();
  deliveryState.subscribe.mockClear();
  handle.ctx = null;
});

describe('EmergencyContext durable delivery contract', () => {
  it('activates locally but exposes pending until server ACK', async () => {
    deliveryState.submit.mockResolvedValue({
      clientEventId: 'activation-1',
      operation: 'activation',
      projectId: 'project-1',
      status: 'pending',
      failureKind: 'network',
      queued: true,
    });

    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );
    await act(async () => {
      await handle.ctx!.triggerEmergency('fall', 'project-1');
    });

    expect(handle.ctx?.isEmergencyActive).toBe(true);
    expect(handle.ctx?.emergencyDeliveryStatus?.status).toBe('pending');
    expect(handle.ctx?.emergencyDeliveryStatus?.status).not.toBe('accepted');
    expect(deliveryState.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'activation',
        projectId: 'project-1',
      }),
      expect.objectContaining({
        clientEventId: expect.stringMatching(/^activation-/),
      }),
    );
  });

  it('shows accepted only after the delivery service returns a server ACK', async () => {
    deliveryState.submit.mockResolvedValue({
      clientEventId: 'activation-2',
      operation: 'activation',
      projectId: 'project-1',
      status: 'accepted',
      queued: true,
      ack: { accepted: true, delivered: true, serverEventId: 'server-2' },
    });

    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );
    await act(async () => {
      await handle.ctx!.triggerEmergency('fall', 'project-1');
    });

    expect(handle.ctx?.emergencyDeliveryStatus?.status).toBe('accepted');
    expect(handle.ctx?.emergencyDeliveryStatus?.ack?.serverEventId).toBe('server-2');
  });

  it('enqueues resolution durably instead of issuing a direct updateDoc', async () => {
    deliveryState.submit
      .mockResolvedValueOnce({
        clientEventId: 'activation-3',
        operation: 'activation',
        projectId: 'project-1',
        status: 'accepted',
        queued: true,
      })
      .mockResolvedValueOnce({
        clientEventId: 'resolution-3',
        operation: 'resolution',
        projectId: 'project-1',
        status: 'pending',
        queued: true,
      });

    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );
    await act(async () => {
      await handle.ctx!.triggerEmergency('fall', 'project-1');
    });
    act(() => handle.ctx!.resolveEmergency());

    expect(deliveryState.submit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: 'resolution',
        projectId: 'project-1',
        eventId: 'activation-3',
      }),
      expect.anything(),
    );
    expect(handle.ctx?.isEmergencyActive).toBe(false);
  });
});
