// Praeventio Guard — usePushNotifications unit tests (Round 16 R3).
//
// We test the pure helper `registerTokenToServer` directly. The React
// hook itself is a thin wrapper around Capacitor + Firebase singletons
// that don't unit-test cleanly without jsdom; the helper carries all
// the interesting state-machine logic (no auth → skip, network error →
// classify, non-2xx → classify) so testing it gives us the meaningful
// coverage.

import { describe, it, expect, vi } from 'vitest';

// Mock firebase + Capacitor + push-notifications so importing the hook
// module under test doesn't bootstrap a real Firebase app or touch the
// native bridge.
vi.mock('../services/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  getMessagingInstance: vi.fn().mockResolvedValue(null),
  getToken: vi.fn(),
  onMessage: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn().mockResolvedValue({ receive: 'prompt' }),
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'denied' }),
    register: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn().mockResolvedValue(undefined),
  },
}));

import { registerTokenToServer } from './usePushNotifications';

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
