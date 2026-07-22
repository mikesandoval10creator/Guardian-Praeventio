// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { HealthVaultViewer } from './HealthVaultViewer';

const runtime = vi.hoisted(() => ({
  user: { uid: 'doctor-1' } as { uid: string } | null,
  assertion: {
    challengeId: 'challenge-1',
    id: 'credential-1',
    rawId: 'raw',
    type: 'public-key',
    clientExtensionResults: {},
    clientDataJSON: 'client',
    authenticatorData: 'authenticator',
    signature: 'signature',
  } as any,
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: runtime.user }),
}));
vi.mock('../hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    createHealthProfessionalAssertion: vi.fn(async () => runtime.assertion),
  }),
}));
vi.mock('../components/health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => <div>Praeventio nunca diagnostica.</div>,
}));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => 'Bearer doctor-token') }));

const fetchMock = vi.fn();
const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  runtime.user = { uid: 'doctor-1' };
  runtime.assertion = {
    challengeId: 'challenge-1', id: 'credential-1', rawId: 'raw', type: 'public-key',
    clientExtensionResults: {}, clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature',
  };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(options?: { legacy?: boolean; secret?: string }) {
  const legacy = options?.legacy ?? false;
  const path = legacy ? '/vault/share/grant-1/legacy-secret' : '/vault/share/grant-1';
  const entry = legacy
    ? path
    : { pathname: path, state: { vaultSecret: options?.secret ?? 'fragment-secret' } };
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/vault/share/:tokenId" element={<HealthVaultViewer />} />
        <Route path="/vault/share/:tokenId/:secret" element={<HealthVaultViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HealthVaultViewer v2', () => {
  it('requires login without sending the QR secret to the server', async () => {
    runtime.user = null;
    renderAt();

    expect(await screen.findByText('Identifícate como profesional de salud')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Iniciar sesión/ }).getAttribute('href')).toBe('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains that a legacy path-secret link must be reissued', async () => {
    renderAt({ legacy: true });

    expect(await screen.findByText(/enlace antiguo ya no muestra datos/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers independent professional enrollment when the account has no identity', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'professional_identity_not_found' }));
    renderAt();

    expect(await screen.findByText('Registrar identidad profesional')).toBeTruthy();
    expect(screen.getByText(/independiente de cualquier empresa o proyecto/i)).toBeTruthy();
  });

  it('does not release data while professional verification is pending', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { status: 'pending' } }));
    renderAt();

    expect(await screen.findByText(/verificación profesional está pendiente/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens a server-verified session and fetches exactly the authorized records', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/health-professionals/me') {
        return jsonResponse(200, { identity: { status: 'provisional' } });
      }
      if (url === '/api/health-vault/view/grant-1/session') {
        return jsonResponse(201, { sessionToken: 'hvs_session.session-secret', expiresAt: Date.now() + 60_000 });
      }
      if (url === '/api/health-vault/view/grant-1/records') {
        return jsonResponse(200, {
          ownerName: 'Paciente Uno',
          expiresAt: Date.now() + 60_000,
          records: [
            {
              id: 'record-1', workerUid: 'patient-1', type: 'lab_result', uploadedAt: Date.now(),
              uploadedBy: 'self', meta: { title: 'Hemograma' }, tags: [], shareScope: 'private',
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? 'GET'}`);
    });
    renderAt({ secret: 'fragment-secret' });
    fireEvent.click(await screen.findByRole('button', { name: /Verificar huella y abrir/ }));

    expect(await screen.findByText('Hemograma')).toBeTruthy();
    expect(screen.getByText(/Health Vault de Paciente Uno/)).toBeTruthy();
    const sessionCall = fetchMock.mock.calls.find(([url]) =>
      url === '/api/health-vault/view/grant-1/session',
    ) as [string, RequestInit];
    expect(sessionCall[0]).not.toContain('fragment-secret');
    expect(JSON.parse(String(sessionCall[1].body))).toMatchObject({
      secret: 'fragment-secret',
      assertion: { challengeId: 'challenge-1' },
    });
    const recordsCall = fetchMock.mock.calls.find(([url]) =>
      url === '/api/health-vault/view/grant-1/records',
    ) as [string, RequestInit];
    expect((recordsCall[1].headers as Record<string, string>)['X-Health-Vault-Session']).toBe(
      'hvs_session.session-secret',
    );
  });

  it('shows the server human message instead of a raw 403', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/health-professionals/me') {
        return jsonResponse(200, { identity: { status: 'verified' } });
      }
      return jsonResponse(403, {
        error: 'recipient_mismatch',
        message: 'Este acceso fue autorizado para otro profesional.',
      });
    });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /Verificar huella y abrir/ }));

    expect(await screen.findByText('Este acceso fue autorizado para otro profesional.')).toBeTruthy();
    expect(screen.queryByText(/^403$/)).toBeNull();
  });
});
