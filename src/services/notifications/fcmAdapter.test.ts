// Praeventio Guard — FCM (Firebase Cloud Messaging) adapter unit tests.
//
// These tests exercise the multicast / topic-send pipeline that backs
// /api/push/incident-alert and the background "critical incident" trigger.
// We mock `firebase-admin/messaging` end-to-end so the suite:
//   • runs offline (no real FCM round-trip),
//   • is deterministic regardless of credential availability,
//   • verifies that failed-token detection (for stale-token cleanup)
//     correctly extracts which token entries failed.
//
// The mock exposes a stub `getMessaging()` whose `sendEachForMulticast`
// and `send` methods are vitest spies overridden per test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEachForMulticastMock = vi.fn();
const sendMock = vi.fn();

vi.mock('firebase-admin/messaging', () => {
  return {
    getMessaging: () => ({
      sendEachForMulticast: sendEachForMulticastMock,
      send: sendMock,
    }),
  };
});

// Import AFTER vi.mock so the adapter sees the stubs.
import { fcmAdapter, FcmAdapterError } from './fcmAdapter.js';

beforeEach(() => {
  sendEachForMulticastMock.mockReset();
  sendMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fcmAdapter.sendToTokens', () => {
  it('returns a zeroed result when given an empty token list (no SDK call)', async () => {
    const result = await fcmAdapter.sendToTokens([], { title: 'x', body: 'y' });
    expect(result).toEqual({ successCount: 0, failureCount: 0, failedTokens: [], invalidTokens: [] });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('forwards title/body/data to messaging.sendEachForMulticast and aggregates a fully-successful result', async () => {
    sendEachForMulticastMock.mockResolvedValueOnce({
      successCount: 2,
      failureCount: 0,
      responses: [
        { success: true, messageId: 'm1' },
        { success: true, messageId: 'm2' },
      ],
    });

    const result = await fcmAdapter.sendToTokens(['tokA', 'tokB'], {
      title: 'Alerta crítica',
      body: 'Incidente nuevo en faena',
      data: { projectId: 'proj-1', nodeId: 'n-9' },
    });

    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const call = sendEachForMulticastMock.mock.calls[0][0];
    expect(call.tokens).toEqual(['tokA', 'tokB']);
    expect(call.notification).toEqual({
      title: 'Alerta crítica',
      body: 'Incidente nuevo en faena',
    });
    expect(call.data).toEqual({ projectId: 'proj-1', nodeId: 'n-9' });
    // `android.priority: 'high'` is required for Doze-mode delivery on real devices.
    expect(call.android).toEqual({ priority: 'high' });

    expect(result).toEqual({
      successCount: 2,
      failureCount: 0,
      failedTokens: [],
      invalidTokens: [],
    });
  });

  it('extracts the exact tokens that failed delivery for stale-token cleanup', async () => {
    sendEachForMulticastMock.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 2,
      responses: [
        { success: true, messageId: 'm1' },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/invalid-argument' } },
      ],
    });

    const result = await fcmAdapter.sendToTokens(
      ['good', 'stale', 'invalid'],
      { title: 't', body: 'b' },
    );

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(2);
    expect(result.failedTokens).toEqual(['stale', 'invalid']);
    // Both codes are definitive → both are prunable.
    expect(result.invalidTokens).toEqual(['stale', 'invalid']);
  });

  it('classifies only DEFINITIVE FCM errors as invalid — a temporary failure is not pruned', async () => {
    sendEachForMulticastMock.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 2,
      responses: [
        { success: true, messageId: 'm1' },
        { success: false, error: { code: 'messaging/server-unavailable' } }, // temporary
        { success: false, error: { code: 'messaging/registration-token-not-registered' } }, // definitive
      ],
    });

    const result = await fcmAdapter.sendToTokens(['live', 'transient', 'dead'], {
      title: 't',
      body: 'b',
    });

    expect(result.failedTokens).toEqual(['transient', 'dead']);
    // The transient token must survive; only the unregistered one is prunable.
    expect(result.invalidTokens).toEqual(['dead']);
  });

  it('batches fan-outs above the 500-token FCM cap into multiple multicast calls', async () => {
    const tokens = Array.from({ length: 1200 }, (_, i) => `t${i}`);
    const okChunk = (n: number) => ({
      successCount: n,
      failureCount: 0,
      responses: Array.from({ length: n }, (_, i) => ({ success: true, messageId: `m${i}` })),
    });
    sendEachForMulticastMock
      .mockResolvedValueOnce(okChunk(500))
      .mockResolvedValueOnce(okChunk(500))
      .mockResolvedValueOnce(okChunk(200));

    const result = await fcmAdapter.sendToTokens(tokens, { title: 't', body: 'b' });

    // 1200 → 500 + 500 + 200 = 3 SDK calls, aggregated.
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(3);
    expect(sendEachForMulticastMock.mock.calls[0][0].tokens).toHaveLength(500);
    expect(sendEachForMulticastMock.mock.calls[2][0].tokens).toHaveLength(200);
    expect(result.successCount).toBe(1200);
  });

  it('omits the data field when not provided (FCM rejects undefined data)', async () => {
    sendEachForMulticastMock.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'm1' }],
    });

    await fcmAdapter.sendToTokens(['tokA'], { title: 't', body: 'b' });

    const call = sendEachForMulticastMock.mock.calls[0][0];
    expect('data' in call).toBe(false);
  });

  it('wraps SDK throws in FcmAdapterError so callers can branch on type', async () => {
    sendEachForMulticastMock.mockRejectedValueOnce(new Error('FCM down'));

    await expect(
      fcmAdapter.sendToTokens(['tok'], { title: 't', body: 'b' }),
    ).rejects.toBeInstanceOf(FcmAdapterError);
  });
});

describe('fcmAdapter.sendToTopic', () => {
  it('publishes to the given topic with notification + data and returns the message id', async () => {
    sendMock.mockResolvedValueOnce('projects/p/messages/abc');

    const messageId = await fcmAdapter.sendToTopic('project_proj-1', {
      title: 'Capacitación obligatoria',
      body: 'Curso de altura el lunes',
      data: { projectId: 'proj-1' },
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.topic).toBe('project_proj-1');
    expect(call.notification).toEqual({
      title: 'Capacitación obligatoria',
      body: 'Curso de altura el lunes',
    });
    expect(call.data).toEqual({ projectId: 'proj-1' });
    expect(messageId).toBe('projects/p/messages/abc');
  });

  it('rejects empty topic strings before hitting the SDK', async () => {
    await expect(
      fcmAdapter.sendToTopic('', { title: 't', body: 'b' }),
    ).rejects.toBeInstanceOf(FcmAdapterError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('wraps SDK throws in FcmAdapterError', async () => {
    sendMock.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(
      fcmAdapter.sendToTopic('topic', { title: 't', body: 'b' }),
    ).rejects.toBeInstanceOf(FcmAdapterError);
  });
});
