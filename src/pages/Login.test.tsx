// @vitest-environment jsdom
//
// SECURITY test for the login biometric STEP-UP path (F4).
// Contract under test: a login biometric is only honored when the server
// CRYPTOGRAPHICALLY verifies the WebAuthn assertion (useBiometricAuth
// authenticate(_, 'login') → true). When the hook returns false (invalid /
// replayed / unenrolled assertion, or unreachable /challenge), Login MUST
// fail-closed: sign the session out and show an error, never proceed.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  authenticate: vi.fn(),
  registerCredential: vi.fn(async () => ({ success: false })),
  isSupported: true,
  currentUser: { uid: 'u1', email: 'a@b.cl' } as { uid: string; email: string } | null,
  signInWithGoogle: vi.fn(async () => {}),
  logOut: vi.fn(async () => {}),
}));

vi.mock('../hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    isSupported: h.isSupported,
    authenticate: h.authenticate,
    registerCredential: h.registerCredential,
    register: vi.fn(),
    platform: 'web',
  }),
}));
vi.mock('../services/firebase', () => ({
  signInWithGoogle: () => h.signInWithGoogle(),
  logOut: () => h.logOut(),
  auth: { get currentUser() { return h.currentUser; } },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => true })),
}));
vi.mock('../services/analytics', () => ({
  analytics: { track: vi.fn() },
  userIdHash: vi.fn(async () => 'hash'),
}));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import Login from './Login';

beforeEach(() => {
  h.authenticate.mockReset();
  h.registerCredential.mockReset().mockResolvedValue({ success: false });
  h.signInWithGoogle.mockReset().mockResolvedValue(undefined);
  h.logOut.mockReset().mockResolvedValue(undefined);
  h.isSupported = true;
  h.currentUser = { uid: 'u1', email: 'a@b.cl' };
  try { window.localStorage.setItem('praeventio_webauthn_enrolled', '1'); } catch { /* */ }
});

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* */ }
});

describe('Login biometric step-up — fail-closed (F4)', () => {
  it('signs out and shows an error when the server REJECTS the assertion', async () => {
    h.authenticate.mockResolvedValue(false); // server /verify said no
    render(<Login />);
    const btn = screen.getByLabelText('Usar Biometría (Face ID / Huella)');
    fireEvent.click(btn);
    await waitFor(() => {
      // The biometric was actually demanded with the sensitive 'login' purpose.
      expect(h.authenticate).toHaveBeenCalledWith(expect.any(String), 'login');
      // Fail-closed: the session was torn down.
      expect(h.logOut).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps the session when the server VERIFIES the assertion', async () => {
    h.authenticate.mockResolvedValue(true);
    render(<Login />);
    fireEvent.click(screen.getByLabelText('Usar Biometría (Face ID / Huella)'));
    await waitFor(() => {
      expect(h.authenticate).toHaveBeenCalledWith(expect.any(String), 'login');
    });
    expect(h.logOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the biometric button when no server credential is enrolled', () => {
    try { window.localStorage.removeItem('praeventio_webauthn_enrolled'); } catch { /* */ }
    render(<Login />);
    expect(screen.queryByLabelText('Usar Biometría (Face ID / Huella)')).toBeNull();
  });
});
