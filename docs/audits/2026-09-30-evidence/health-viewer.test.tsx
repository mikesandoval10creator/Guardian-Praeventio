// ARCHIVED AUDIT — PASS may reproduce an unfixed defect. NOT a release gate.
// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { HealthVaultViewer } from '@guardian-audit/src/pages/HealthVaultViewer';
import { createVaultSecretHandoff } from '@guardian-audit/src/services/health/vaultSecretHandoff';

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
const registerCredentialMock = vi.hoisted(() => vi.fn());

vi.mock('@guardian-audit/src/contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: runtime.user }),
}));
vi.mock('@guardian-audit/src/hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    createHealthProfessionalAssertion: vi.fn(async () => runtime.assertion),
    registerCredential: registerCredentialMock,
  }),
}));
vi.mock('@guardian-audit/src/components/health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => <div>Praeventio nunca diagnostica.</div>,
}));
vi.mock('@guardian-audit/src/lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => 'Bearer doctor-token') }));

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
  registerCredentialMock.mockReset();
  registerCredentialMock.mockResolvedValue({ success: true, credentialId: 'credential-new' });
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
    : {
        pathname: path,
        state: {
          vaultHandoff: createVaultSecretHandoff(options?.secret ?? 'fragment-secret'),
        },
      };
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

  it('registers a server-verifiable passkey before submitting professional identity', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { error: 'professional_identity_not_found' }))
      .mockResolvedValueOnce(jsonResponse(201, { identity: { status: 'pending' } }));
    renderAt();

    fireEvent.change(await screen.findByLabelText('Nombre profesional'), {
      target: { value: 'Dra. Elena Morales' },
    });
    fireEvent.change(screen.getByLabelText('RUT profesional'), {
      target: { value: '12.345.678-5' },
    });
    fireEvent.change(screen.getByLabelText(/registro profesional/i), {
      target: { value: 'RNPI-12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registrar huella y enviar/i }));

    expect(await screen.findByText(/profesional est.* pendiente/i)).toBeTruthy();
    expect(registerCredentialMock).toHaveBeenCalledWith(
      'Verifica tu identidad para registrar tu perfil profesional',
    );
    const enrollmentCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/health-professionals/enroll',
    );
    expect(enrollmentCall).toBeTruthy();
  });

  it('fails closed and keeps identity data local when passkey registration fails', async () => {
    registerCredentialMock.mockResolvedValue({ success: false });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: 'professional_identity_not_found' }),
    );
    renderAt();

    fireEvent.change(await screen.findByLabelText('Nombre profesional'), {
      target: { value: 'Dra. Elena Morales' },
    });
    fireEvent.change(screen.getByLabelText('RUT profesional'), {
      target: { value: '12.345.678-5' },
    });
    fireEvent.change(screen.getByLabelText(/registro profesional/i), {
      target: { value: 'RNPI-12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registrar huella y enviar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/dispositivo compatibles con passkeys/i);
    expect(
      fetchMock.mock.calls.some(([url]) => url === '/api/health-professionals/enroll'),
    ).toBe(false);
  });

  it('does not release data while professional verification is pending', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { status: 'pending' } }));
    renderAt();

    expect(await screen.findByText(/verificación profesional está pendiente/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests owner confirmation for an open QR without releasing records', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { identity: { status: 'provisional' } }))
      .mockResolvedValueOnce(jsonResponse(202, {
        status: 'pending',
        confirmationRequired: true,
      }));
    renderAt();

    expect(await screen.findByText('El paciente debe confirmar tu acceso')).toBeTruthy();
    expect(screen.getByText(/TodavÃ­a no se mostrÃ³ ningÃºn dato clÃ­nico/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const claimCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(claimCall[0]).toBe('/api/health-vault/view/grant-1/claim');
    expect(JSON.parse(String(claimCall[1].body))).toEqual({ secret: 'fragment-secret' });
  });

  it('opens a server-verified session and fetches exactly the authorized records', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/health-professionals/me') {
        return jsonResponse(200, { identity: { status: 'provisional' } });
      }
      if (url === '/api/health-vault/view/grant-1/claim') {
        return jsonResponse(200, { status: 'active', confirmationRequired: false });
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
      if (url === '/api/health-vault/view/grant-1/claim') {
        return jsonResponse(200, { status: 'active', confirmationRequired: false });
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

// Audit reproductions: these tests assert the current DEFECT, not the desired contract.
describe('NOT FIXED — stale health records after identity transition', () => {
  function installDeferredRecords() {
    let resolveRecords!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveRecords = resolve; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/health-professionals/me') return jsonResponse(200, {identity:{status:'verified'}});
      if (url.endsWith('/claim')) return jsonResponse(200, {confirmationRequired:false});
      if (url.endsWith('/session')) return jsonResponse(201, {sessionToken:'audit-session-A'});
      if (url.endsWith('/records')) return pending;
      throw Error('Unexpected audit URL '+url);
    });
    return () => resolveRecords(jsonResponse(200, {ownerName:'Paciente Sintetico A',expiresAt:Date.now()+60000,records:[{id:'audit-record',meta:{title:'Registro Sintetico Confidencial A'}}]}));
  }
  function tree() {
    return <MemoryRouter initialEntries={[{pathname:'/vault/share/grant-1',state:{vaultHandoff:createVaultSecretHandoff('fragment-secret')}}]}><Routes><Route path='/vault/share/:tokenId' element={<HealthVaultViewer/>}/></Routes></MemoryRouter>;
  }
  it('late records response replaces login-required view AFTER logout', async () => {
    const finish = installDeferredRecords();
    const view = render(tree());
    fireEvent.click(await screen.findByRole('button',{name:/Verificar huella y abrir/}));
    await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/records'))).toBe(true));
    runtime.user=null;
    view.rerender(tree());
    expect(await screen.findByText('Identifícate como profesional de salud')).toBeTruthy();
    await act(async()=>finish());
    expect(await screen.findByText('Registro Sintetico Confidencial A')).toBeTruthy();
    expect(screen.queryByText('Identifícate como profesional de salud')).toBeNull();
  });
  it('previous records can reappear while the replacement identity is still being checked', async () => {
    const finish=installDeferredRecords();
    const view=render(tree());
    fireEvent.click(await screen.findByRole('button',{name:/Verificar huella y abrir/}));
    await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/records'))).toBe(true));
    fetchMock.mockImplementation(()=>new Promise(()=>{}));
    runtime.user={uid:'doctor-2'};
    view.rerender(tree());
    await act(async()=>finish());
    expect(await screen.findByText('Registro Sintetico Confidencial A')).toBeTruthy();
  });
});
