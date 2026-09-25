// @vitest-environment jsdom

// Praeventio Guard — usePushNotifications unit tests (Round 16 R3).
//
// We test the pure helper `registerTokenToServer` directly. The React
// hook itself is a thin wrapper around Capacitor + Firebase singletons
// that don't unit-test cleanly without jsdom; the helper carries all
// the interesting state-machine logic (no auth → skip, network error →
// classify, non-2xx → classify) so testing it gives us the meaningful
// coverage.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockNative = vi.hoisted(() => ({ value: false }));
const mockAuth = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }));
const mockGetMessagingInstance = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockOnMessage = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, status: 200 }));
const mockSetDoc = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAddListener = vi.hoisted(() => vi.fn());
const mockRegister = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRemoveAllListeners = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const nativeCallbacks = vi.hoisted(() => new Map<string, ((value: any) => void)[]>());

// Mock firebase + Capacitor + push-notifications so importing the hook
// module under test doesn't bootstrap a real Firebase app or touch the
// native bridge.
vi.mock('../services/firebase', () => ({
  auth: mockAuth,
  db: {},
  getMessagingInstance: mockGetMessagingInstance,
  getToken: vi.fn(),
  onMessage: mockOnMessage,
}));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn().mockResolvedValue('Bearer test-token') }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: mockSetDoc,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockNative.value,
    getPlatform: () => mockNative.value ? 'android' : 'web',
  },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: mockRegister,
    createChannel: vi.fn().mockResolvedValue(undefined),
    listChannels: vi.fn().mockResolvedValue({ channels: [] }),
    addListener: mockAddListener,
    removeAllListeners: mockRemoveAllListeners,
  },
}));

import {
  __resetPushNotificationRuntimeForTests,
  registerTokenToServer,
  usePushNotifications,
} from './usePushNotifications';

beforeEach(() => {
  mockNative.value = false;
  mockAuth.currentUser = { uid: 'u1' };
  nativeCallbacks.clear();
  mockAddListener.mockReset();
  mockAddListener.mockImplementation(async (event: string, callback: (value: unknown) => void) => {
    const callbacks = nativeCallbacks.get(event) ?? [];
    callbacks.push(callback);
    nativeCallbacks.set(event, callbacks);
    return {
      remove: vi.fn(async () => {
        nativeCallbacks.set(event, (nativeCallbacks.get(event) ?? []).filter((candidate) => candidate !== callback));
      }),
    };
  });
  mockRegister.mockClear();
  mockRemoveAllListeners.mockClear();
  mockOnMessage.mockReset();
  mockOnMessage.mockReturnValue(vi.fn());
  mockGetMessagingInstance.mockReset();
  mockGetMessagingInstance.mockResolvedValue(null);
  mockSetDoc.mockClear();
  mockFetch.mockClear();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(async () => {
  await __resetPushNotificationRuntimeForTests();
  vi.unstubAllGlobals();
});

describe('registerTokenToServer', () => {
  it('returns no_auth when there is no signed-in user', async () => {
    const fetchImpl = vi.fn();
    const result = await registerTokenToServer('token-abc', 'web', {
      getIdToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_auth');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns empty_token when token is missing', async () => {
    const fetchImpl = vi.fn();
    const result = await registerTokenToServer('', 'web', {
      getIdToken: async () => 'id-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty_token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs token + platform with Bearer auth header on happy path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await registerTokenToServer('fcm-token-xyz', 'android', {
      getIdToken: async () => 'firebase-id-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/push/register-token');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer firebase-id-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ token: 'fcm-token-xyz', platform: 'android' });
  });

  it('classifies non-2xx responses with http_<status>', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await registerTokenToServer('token', 'ios', {
      getIdToken: async () => 'id',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe('http_401');
  });

  it('returns network_error message on fetch rejection', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'));
    const result = await registerTokenToServer('token', 'web', {
      getIdToken: async () => 'id',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('connection refused');
  });

  it('returns id_token_failed when getIdToken throws', async () => {
    const fetchImpl = vi.fn();
    const result = await registerTokenToServer('token', 'web', {
      getIdToken: async () => {
        throw new Error('boom');
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('id_token_failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('usePushNotifications runtime lifecycle', () => {
  it('shares native listeners and removes only owned handles after the last unmount', async () => {
    mockNative.value = true;
    const first = renderHook(() => usePushNotifications());
    const second = renderHook(() => usePushNotifications());

    await waitFor(() => expect(mockAddListener).toHaveBeenCalledTimes(2));
    expect(mockAddListener.mock.calls.map((call) => call[0])).toEqual([
      'pushNotificationReceived',
      'pushNotificationActionPerformed',
    ]);

    first.unmount();
    expect(mockRemoveAllListeners).not.toHaveBeenCalled();
    expect(nativeCallbacks.get('pushNotificationReceived')).toHaveLength(1);

    second.unmount();
    await waitFor(() => expect(nativeCallbacks.get('pushNotificationReceived')).toHaveLength(0));
    expect(mockRemoveAllListeners).not.toHaveBeenCalled();
  });

  it('installs registration handlers before register and dedupes repeated token events', async () => {
    mockNative.value = true;
    const first = renderHook(() => usePushNotifications());
    const second = renderHook(() => usePushNotifications());
    await waitFor(() => expect(mockAddListener).toHaveBeenCalledTimes(2));

    await act(async () => {
      await Promise.all([
        first.result.current.requestPermission(),
        second.result.current.requestPermission(),
      ]);
    });

    expect(mockRegister).toHaveBeenCalledOnce();
    expect(mockAddListener.mock.calls.map((call) => call[0])).toEqual([
      'pushNotificationReceived',
      'pushNotificationActionPerformed',
      'registration',
      'registrationError',
    ]);
    expect(mockAddListener.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      mockRegister.mock.invocationCallOrder[0],
    );

    const registrationCallbacks = nativeCallbacks.get('registration') ?? [];
    await act(async () => {
      await Promise.all(registrationCallbacks.map((callback) => callback({ value: 'token-1' })));
      await Promise.all(registrationCallbacks.map((callback) => callback({ value: 'token-1' })));
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    first.unmount();
    second.unmount();
  });

  it('shares one web foreground listener and unsubscribes after the last consumer leaves', async () => {
    mockNative.value = false;
    mockGetMessagingInstance.mockResolvedValue({});
    const webUnsubscribe = vi.fn();
    mockOnMessage.mockReturnValue(webUnsubscribe);
    const first = renderHook(() => usePushNotifications());
    const second = renderHook(() => usePushNotifications());

    await waitFor(() => expect(mockOnMessage).toHaveBeenCalledOnce());
    first.unmount();
    expect(webUnsubscribe).not.toHaveBeenCalled();
    second.unmount();
    await waitFor(() => expect(webUnsubscribe).toHaveBeenCalledOnce());
  });
});
