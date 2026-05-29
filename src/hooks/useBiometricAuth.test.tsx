// @vitest-environment jsdom
//
// Tests for the biometric / WebAuthn proof-of-presence hook — SECURITY code.
//
// The Round-18-R6 threat model is the thing under test: sensitive flows
// ('login', 'claim-signing', and the default) MUST fail-closed when the
// server-issued challenge is unreachable — NO client-generated fallback, or an
// attacker who forces a server-unreachable state could replay a captured
// assertion. Low-stakes 'enroll-test' keeps the best-effort fallback so a flaky
// site network doesn't fake-fail a worker's fingerprint check.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  platform: 'web' as 'web' | 'ios' | 'android',
  currentUser: { uid: 'u1' } as { uid: string } | null,
  authHeader: 'Bearer test-token' as string | null,
  checkBiometry: vi.fn(),
  nativeAuthenticate: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => h.platform } }));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: (...a: unknown[]) => h.checkBiometry(...a),
    authenticate: (...a: unknown[]) => h.nativeAuthenticate(...a),
  },
}));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../services/firebase', () => ({ auth: { get currentUser() { return h.currentUser; } } }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => h.authHeader) }));

import { useBiometricAuth } from './useBiometricAuth';

const fetchMock = vi.fn();
const credGet = vi.fn();
const credCreate = vi.fn();

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function fakeAssertion() {
  const buf = new ArrayBuffer(8);
  return {
    id: 'cred-1',
    rawId: buf,
    type: 'public-key',
    response: { clientDataJSON: buf, authenticatorData: buf, signature: buf },
    getClientExtensionResults: () => ({}),
  };
}

beforeEach(() => {
  h.platform = 'web';
  h.currentUser = { uid: 'u1' };
  h.authHeader = 'Bearer test-token';
  fetchMock.mockReset();
  credGet.mockReset().mockResolvedValue(fakeAssertion());
  credCreate.mockReset().mockResolvedValue(fakeAssertion());
  vi.stubGlobal('fetch', fetchMock);
  // Make WebAuthn "supported" on web.
  (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = function () {};
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { get: credGet, create: credCreate },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CHALLENGE_B64 = btoa('x'.repeat(32));

describe('useBiometricAuth — web support + login happy path', () => {
  it('reports isSupported on a WebAuthn-capable browser', () => {
    const { result } = renderHook(() => useBiometricAuth());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.platform).toBe('web');
  });

  it("login succeeds: server challenge → credentials.get → /verify confirms", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/challenge')) return okJson({ challengeId: 'c1', challenge: CHALLENGE_B64 });
      if (url.includes('/verify')) return okJson({ verified: true });
      return okJson({});
    });
    const { result } = renderHook(() => useBiometricAuth());
    let ok = false;
    await act(async () => {
      ok = await result.current.authenticate('Confirma tu identidad', 'login');
    });
    expect(ok).toBe(true);
    expect(credGet).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/verify'))).toBe(true);
  });
});

describe('useBiometricAuth — fail-closed security (R6 downgrade vector)', () => {
  it('login FAILS CLOSED when the server challenge is unreachable (no credentials.get, no client fallback)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/challenge')) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return okJson({});
    });
    const { result } = renderHook(() => useBiometricAuth());
    let ok = true;
    await act(async () => {
      ok = await result.current.authenticate(undefined, 'login');
    });
    expect(ok).toBe(false);
    // The critical assertion: the ceremony never ran with a client challenge.
    expect(credGet).not.toHaveBeenCalled();
  });

  it('default purpose is treated as login (fail-closed) for un-audited legacy callers', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/challenge')) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return okJson({});
    });
    const { result } = renderHook(() => useBiometricAuth());
    let ok = true;
    await act(async () => {
      ok = await result.current.authenticate(); // no purpose
    });
    expect(ok).toBe(false);
    expect(credGet).not.toHaveBeenCalled();
  });

  it('login fails closed when /verify rejects the assertion (replay/expiry)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/challenge')) return okJson({ challengeId: 'c1', challenge: CHALLENGE_B64 });
      if (url.includes('/verify')) return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
      return okJson({});
    });
    const { result } = renderHook(() => useBiometricAuth());
    let ok = true;
    await act(async () => {
      ok = await result.current.authenticate(undefined, 'login');
    });
    expect(ok).toBe(false);
  });

  it("enroll-test (low-stakes) FALLS BACK to a client challenge when the server is unreachable", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/challenge')) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return okJson({});
    });
    const { result } = renderHook(() => useBiometricAuth());
    let ok = false;
    await act(async () => {
      ok = await result.current.authenticate(undefined, 'enroll-test');
    });
    // Best-effort: the ceremony DID run (client challenge) and no /verify needed.
    expect(credGet).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('returns false when WebAuthn is unsupported', async () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    const { result } = renderHook(() => useBiometricAuth());
    expect(result.current.isSupported).toBe(false);
    let ok = true;
    await act(async () => {
      ok = await result.current.authenticate(undefined, 'login');
    });
    expect(ok).toBe(false);
    expect(credGet).not.toHaveBeenCalled();
  });
});

describe('useBiometricAuth — registerCredential ceremony', () => {
  it('completes the options → create → verify ceremony and returns the credentialId', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/register/options')) {
        return okJson({
          challengeId: 'rc1',
          options: {
            challenge: btoa('y'.repeat(32)).replace(/=+$/g, ''),
            user: { id: btoa('u'.repeat(16)).replace(/=+$/g, ''), name: 'x', displayName: 'x' },
            rp: { name: 'Praeventio', id: 'localhost' },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          },
        });
      }
      if (url.includes('/register/verify')) return okJson({ verified: true, credentialId: 'newcred' });
      return okJson({});
    });
    credCreate.mockResolvedValue({
      id: 'newcred',
      rawId: new ArrayBuffer(8),
      type: 'public-key',
      response: { clientDataJSON: new ArrayBuffer(8), attestationObject: new ArrayBuffer(8) },
      getClientExtensionResults: () => ({}),
    });
    const { result } = renderHook(() => useBiometricAuth());
    let out: { success: boolean; credentialId?: string } = { success: false };
    await act(async () => {
      out = await result.current.registerCredential('Registra tu huella');
    });
    expect(out.success).toBe(true);
    expect(out.credentialId).toBe('newcred');
  });

  it('registerCredential fails when the server returns no options', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/register/options')) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      return okJson({});
    });
    const { result } = renderHook(() => useBiometricAuth());
    let out: { success: boolean } = { success: true };
    await act(async () => {
      out = await result.current.registerCredential();
    });
    expect(out.success).toBe(false);
  });
});
