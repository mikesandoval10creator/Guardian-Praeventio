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
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

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
    expect(registerSpy.mock.calls[0][0].authToken).toBe('mock-token');

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

  it('confirm-delete flow removes the credential after explicit confirm', async () => {
    const loadCredentials = vi
      .fn()
      .mockResolvedValueOnce([
        {
          credentialId: 'cred-x',
          nickname: 'Old key',
          registeredAt: 1700000000000,
          lastUsedAt: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const deleteCredential = vi.fn(async () => undefined);

    const { findByTestId, getByLabelText, queryByTestId } = render(
      <WebAuthnKeysSection
        loadCredentials={loadCredentials}
        deleteCredential={deleteCredential}
      />,
    );
    await findByTestId('webauthn-credential-cred-x');

    // Click trash icon → renders inline confirm panel.
    fireEvent.click(getByLabelText(/eliminar llave/i));
    const confirm = await findByTestId('webauthn-confirm-cred-x');
    expect(confirm).not.toBeNull();

    await act(async () => {
      fireEvent.click(confirm.querySelector('button')!); // first button = "Confirmar"
    });
    await waitFor(() => expect(deleteCredential).toHaveBeenCalledWith('test-uid', 'cred-x'));

    // After refresh the row is gone.
    await waitFor(() =>
      expect(queryByTestId('webauthn-credential-cred-x')).toBeNull(),
    );
  });

  it('shows the unsupported banner when navigator.credentials missing', () => {
    vi.spyOn(webauthnClient, 'isWebAuthnSupported').mockReturnValue(false);
    const { getByTestId } = render(<WebAuthnKeysSection />);
    expect(getByTestId('webauthn-unsupported')).not.toBeNull();
  });
});
