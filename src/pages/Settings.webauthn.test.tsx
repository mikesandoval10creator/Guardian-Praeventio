// @vitest-environment jsdom
//
// Settings WebAuthn UI tests — Sprint 30 Bucket KK.
//
// We test the standalone `WebAuthnKeysSection` component (which is what
// Settings.tsx renders inside the Seguridad y Privacidad accordion).
// Mounting the full Settings page would drag in i18n + Firebase + the
// fall-detection hook; the component-level tests give equivalent
// coverage.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

// Mock useFirebase before importing the component.
const mockUser = {
  uid: 'test-uid',
  email: 't@example.com',
  getIdToken: vi.fn(async () => 'mock-token'),
};
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser }),
}));

// Mock firebase/firestore + services/firebase so the default loaders, if
// ever called, don't blow up.
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  doc: vi.fn(),
  deleteDoc: vi.fn(async () => undefined),
}));
vi.mock('../services/firebase', () => ({ db: {} }));

// Plan v2 B3 — el component ahora usa apiAuthHeaderOrThrow vía dynamic
// import. Mockeamos el módulo para evitar tocar `auth.currentUser` y
// poder asertar el header que termina en registerNewAuthenticator.
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaderOrThrow: vi.fn(async () => 'Bearer mock-token'),
}));

import { WebAuthnKeysSection } from '../components/settings/WebAuthnKeysSection';
import * as webauthnClient from '../services/auth/webauthnClient';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings WebAuthn UI', () => {
  beforeEach(() => {
    // navigator.credentials + PublicKeyCredential present for "supported"
    vi.spyOn(webauthnClient, 'isWebAuthnSupported').mockReturnValue(true);
  });

  it('renders empty-state when the user has no credentials', async () => {
    const loadCredentials = vi.fn(async () => []);
    const { findByTestId } = render(
      <WebAuthnKeysSection loadCredentials={loadCredentials} />,
    );
    await findByTestId('webauthn-empty');
    expect(loadCredentials).toHaveBeenCalledWith('test-uid');
  });

  it('lists registered credentials with nickname + transports', async () => {
    const loadCredentials = vi.fn(async () => [
      {
        credentialId: 'cred-1',
        nickname: 'YubiKey',
        deviceType: 'cross-platform',
        transports: ['usb', 'nfc'],
        registeredAt: 1700000000000,
        lastUsedAt: 1700100000000,
      },
    ]);
    const { findByTestId, container } = render(
      <WebAuthnKeysSection loadCredentials={loadCredentials} />,
    );
    await findByTestId('webauthn-credential-cred-1');
    expect(container.textContent).toContain('YubiKey');
    expect(container.textContent).toContain('cross-platform');
    expect(container.textContent?.toLowerCase()).toContain('usb');
  });

  it('register happy path: calls registerNewAuthenticator and refreshes', async () => {
    const loadCredentials = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          credentialId: 'new-cred',
          nickname: 'iPhone',
          deviceType: 'platform',
          transports: ['internal'],
          registeredAt: Date.now(),
          lastUsedAt: null,
        },
      ]);
    const registerSpy = vi
      .spyOn(webauthnClient, 'registerNewAuthenticator')
      .mockResolvedValue({ credentialId: 'new-cred', nickname: 'iPhone' });

    const { findByTestId, getByLabelText } = render(
      <WebAuthnKeysSection loadCredentials={loadCredentials} />,
    );
    await findByTestId('webauthn-empty');

    const nameInput = getByLabelText(/nombre de la llave/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'iPhone' } });

    const btn = await findByTestId('webauthn-register-btn');
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0].nickname).toBe('iPhone');
    expect(registerSpy.mock.calls[0][0].authHeader).toBe('Bearer mock-token');

    // After refresh, the new credential should appear.
    await findByTestId('webauthn-credential-new-cred');
  });

  it('shows an error message when register fails (server 500)', async () => {
    const loadCredentials = vi.fn(async () => []);
    vi.spyOn(webauthnClient, 'registerNewAuthenticator').mockRejectedValue(
      new Error('register_options_failed:500'),
    );

    const { findByTestId } = render(
      <WebAuthnKeysSection loadCredentials={loadCredentials} />,
    );
    await findByTestId('webauthn-empty');

    const btn = await findByTestId('webauthn-register-btn');
    await act(async () => {
      fireEvent.click(btn);
    });
    const err = await findByTestId('webauthn-error');
    expect(err.textContent).toMatch(/no se pudo registrar/i);
  });

  it('does NOT expose a self-serve delete control (stolen-device protection, B17)', async () => {
    // Self-serve removal of an MFA credential is disabled by design: a thief
    // with an unlocked phone must not be able to wipe the victim's keys and
    // lock them out of their safety data with no recovery. The screen is
    // read-only + register-new (rotate); removal is an account-recovery flow.
    const loadCredentials = vi.fn(async () => [
      {
        credentialId: 'cred-x',
        nickname: 'Old key',
        registeredAt: 1700000000000,
        lastUsedAt: null,
      },
    ]);

    const { findByTestId, queryByLabelText, queryByTestId, getByTestId } = render(
      <WebAuthnKeysSection loadCredentials={loadCredentials} />,
    );
    await findByTestId('webauthn-credential-cred-x');

    // No trash/delete affordance, no inline confirm panel.
    expect(queryByLabelText(/eliminar llave/i)).toBeNull();
    expect(queryByTestId('webauthn-confirm-cred-x')).toBeNull();
    // The protective explanation is shown instead.
    expect(getByTestId('webauthn-no-delete-note')).not.toBeNull();
  });

  it('shows the unsupported banner when navigator.credentials missing', () => {
    vi.spyOn(webauthnClient, 'isWebAuthnSupported').mockReturnValue(false);
    const { getByTestId } = render(<WebAuthnKeysSection />);
    expect(getByTestId('webauthn-unsupported')).not.toBeNull();
  });
});
