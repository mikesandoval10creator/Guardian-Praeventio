// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { HealthVaultShare } from './HealthVaultShare';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock('react-qr-code', () => ({ default: () => <div data-testid="qr" /> }));
vi.mock('../components/health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => <div data-testid="disclaimer" />,
}));
const runtime = vi.hoisted(() => ({ user: { uid: 'patient-1' } as { uid: string } | null, dynamicGrantIds: false }));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: runtime.user, db: {} }),
}));

type SnapshotDoc = { data(): Record<string, unknown> };
let activeShareOverrides: Record<string, unknown> = {};
let emitActiveShares: ((docs: SnapshotDoc[]) => void) | undefined;
const activeShareEmissions: Array<(docs: SnapshotDoc[]) => void> = [];
const unsubscribeActiveShares = vi.fn();
const activeShareDoc = {
  data: () => ({
    id: runtime.dynamicGrantIds ? `grant-${runtime.user?.uid ?? 'signed-out'}` : 'grant-active',
    scope: 'full',
    topic: runtime.dynamicGrantIds ? runtime.user?.uid : undefined,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3_600_000,
    consumeCount: 0,
    maxConsumes: 3,
    revokedAt: null,
    ...activeShareOverrides,
  }),
};
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  onSnapshot: (
    _query: unknown,
    next: (snapshot: { docs: Array<{ data(): Record<string, unknown> }> }) => void,
  ) => {
    emitActiveShares = (docs) => next({ docs });
    activeShareEmissions.push((docs) => next({ docs }));
    next({ docs: [activeShareDoc] });
    return unsubscribeActiveShares;
  },
  query: (...args: unknown[]) => args,
  orderBy: () => ({}),
}));

const apiAuthHeaderMock = vi.fn(async () => 'Bearer test-token');
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: () => apiAuthHeaderMock() }));

const fetchMock = vi.fn();
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  runtime.user = { uid: 'patient-1' };
  runtime.dynamicGrantIds = false;
  window.sessionStorage.clear();
  activeShareOverrides = {};
  emitActiveShares = undefined;
  activeShareEmissions.length = 0;
  unsubscribeActiveShares.mockClear();
  fetchMock.mockReset();
  apiAuthHeaderMock.mockClear();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/health-vault/records') {
      return ok({
        records: [
          {
            id: 'record-1',
            workerUid: 'patient-1',
            type: 'lab_result',
            uploadedAt: Date.now(),
            uploadedBy: 'self',
            meta: { title: 'Hemograma' },
            tags: [],
            shareScope: 'private',
          },
        ],
      });
    }
    if (url.startsWith('/api/health-professionals/search')) {
      return ok({
        professionals: [
          {
            uid: 'doctor-1',
            displayName: 'Dra. Elena Morales',
            registryNumber: 'RNPI-12345',
            status: 'provisional',
          },
        ],
      });
    }
    if (url === '/api/health-vault/share' && init?.method === 'POST') {
      return ok({
        grantId: 'grant-1',
        secret: 'server-generated-secret',
        qrPayload: 'https://praeventio.app/vault/share/grant-1#server-generated-secret',
        expiresAt: Date.now() + 3_600_000,
        consentText: 'Consentimiento exacto emitido por el servidor.',
      });
    }
    if (url.includes('/revoke')) return ok({ ok: true });
    if (url.includes('/confirm-recipient')) return ok({ status: 'active' });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HealthVaultShare v2', () => {
  it('reuses one non-secret Idempotency-Key when the owner manually retries a lost response', async () => {
    const submittedKeys: string[] = [];
    let shareAttempts = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/health-vault/records') return ok({ records: [{
        id: 'record-1', workerUid: 'patient-1', type: 'lab_result', uploadedAt: Date.now(),
        uploadedBy: 'self', meta: { title: 'Hemograma' }, tags: [], shareScope: 'private',
      }] });
      if (url.startsWith('/api/health-professionals/search')) return ok({ professionals: [{
        uid: 'doctor-1', displayName: 'Dra. Elena Morales', registryNumber: 'RNPI-12345', status: 'provisional',
      }] });
      if (url === '/api/health-vault/share' && init?.method === 'POST') {
        const headers = init.headers as Record<string, string>;
        submittedKeys.push(headers['Idempotency-Key']);
        shareAttempts += 1;
        if (shareAttempts === 1) throw new TypeError('response lost after server commit');
        return ok({
          grantId: 'grant-replayed', secret: 'server-secret-not-key',
          qrPayload: 'https://praeventio.app/vault/share/grant-replayed#server-secret-not-key',
          expiresAt: Date.now() + 60_000, consentText: 'Consentimiento reintentado.',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const firstView = render(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Hemograma' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    await waitFor(() => expect(shareAttempts).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generar QR' })).toBeEnabled());
    firstView.unmount();

    render(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Hemograma' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    expect(await screen.findByText('Consentimiento reintentado.')).toBeTruthy();

    expect(submittedKeys).toHaveLength(2);
    expect(submittedKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(submittedKeys[1]).toBe(submittedKeys[0]);
    expect(submittedKeys[0]).not.toBe('server-secret-not-key');

    fireEvent.click(screen.getByRole('button', { name: 'Generar otro' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generar QR' }));
    await waitFor(() => expect(submittedKeys).toHaveLength(3));
    expect(submittedKeys[2]).not.toBe(submittedKeys[1]);
  });

  it('clears private selections, active grants and the generated QR when identity changes', async () => {
    runtime.dynamicGrantIds = true;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const uid = runtime.user?.uid ?? 'signed-out';
      if (url === '/api/health-vault/records') {
        return ok({ records: [{
          id: `record-${uid}`, workerUid: uid, type: 'lab_result', uploadedAt: Date.now(),
          uploadedBy: 'self', meta: { title: `Clinical record ${uid}` }, tags: [], shareScope: 'private',
        }] });
      }
      if (url.startsWith('/api/health-professionals/search')) {
        return ok({ professionals: [{ uid: 'doctor-1', displayName: 'Doctor', registryNumber: 'R-1', status: 'verified' }] });
      }
      if (url === '/api/health-vault/share' && init?.method === 'POST') {
        return ok({ grantId: `grant-${uid}`, secret: `secret-${uid}`, qrPayload: `https://example.test/${uid}#secret-${uid}`, expiresAt: Date.now() + 60_000, consentText: 'Consent' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const view = render(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Clinical record patient-1' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clinical record patient-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    expect(await screen.findByText(/secret-patient-1/)).toBeTruthy();
    expect(screen.getByText(/Toda la cartera/).textContent).toContain('patient-1');

    runtime.user = { uid: 'patient-2' };
    view.rerender(<HealthVaultShare />);

    expect(screen.queryByText(/secret-patient-1/)).toBeNull();
    expect(screen.queryByText('Clinical record patient-1')).toBeNull();
    expect(await screen.findByRole('checkbox', { name: 'Clinical record patient-2' })).not.toBeChecked();
    expect(screen.queryByText('patient-1')).toBeNull();
    const stalePatientOneListener = activeShareEmissions[0];
    expect(stalePatientOneListener).toBeDefined();
    act(() => stalePatientOneListener?.([{ data: () => ({ ...activeShareDoc.data(), id: 'grant-patient-1', topic: 'patient-1' }) }]));
    expect(screen.queryByText(/patient-1/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Generar QR' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clinical record patient-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    expect(await screen.findByText(/secret-patient-2/)).toBeTruthy();
    runtime.user = null;
    view.rerender(<HealthVaultShare />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Inicia sesión/);
    expect(screen.queryByText(/secret-patient-2/)).toBeNull();
    expect(screen.queryByText('Clinical record patient-2')).toBeNull();
  });

  it('does not start an A share request if identity changes while auth is pending', async () => {
    let releaseAuth!: (header: string) => void;
    const delayedAuth = new Promise<string>(resolve => { releaseAuth = resolve; });
    fetchMock.mockImplementation(async (url: string) => {
      const uid = runtime.user?.uid ?? 'signed-out';
      if (url === '/api/health-vault/records') return ok({ records: [{
        id: `record-${uid}`, workerUid: uid, type: 'lab_result', uploadedAt: Date.now(),
        uploadedBy: 'self', meta: { title: `Clinical record ${uid}` }, tags: [], shareScope: 'private',
      }] });
      if (url.startsWith('/api/health-professionals/search')) return ok({ professionals: [{ uid: 'doctor-1', displayName: 'Doctor', registryNumber: 'R-1', status: 'verified' }] });
      throw new Error(`unexpected fetch ${url}`);
    });
    const view = render(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Clinical record patient-1' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clinical record patient-1' }));
    const authCallCount = apiAuthHeaderMock.mock.calls.length;
    apiAuthHeaderMock.mockImplementationOnce(() => delayedAuth);
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    await waitFor(() => expect(apiAuthHeaderMock.mock.calls.length).toBe(authCallCount + 1));

    runtime.user = { uid: 'patient-2' };
    view.rerender(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Clinical record patient-2' });
    await act(async () => { releaseAuth('Bearer patient-1'); await delayedAuth; });

    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/health-vault/share' && (init as RequestInit)?.method === 'POST')).toBe(false);
  });

  it('does not publish an A share response in the UI after identity changes while POST is pending', async () => {
    let resolvePost!: (response: ReturnType<typeof ok>) => void;
    const delayedPost = new Promise<ReturnType<typeof ok>>(resolve => { resolvePost = resolve; });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/health-vault/records') return ok({ records: [{
        id: `record-${runtime.user?.uid}`, workerUid: runtime.user?.uid, type: 'lab_result',
        uploadedAt: Date.now(), uploadedBy: 'self', meta: { title: `Clinical record ${runtime.user?.uid}` }, tags: [], shareScope: 'private',
      }] });
      if (url.startsWith('/api/health-professionals/search')) return ok({ professionals: [{ uid: 'doctor-1', displayName: 'Doctor', registryNumber: 'R-1', status: 'verified' }] });
      if (url === '/api/health-vault/share' && init?.method === 'POST') return delayedPost;
      throw new Error(`unexpected fetch ${url}`);
    });
    const view = render(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Clinical record patient-1' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clinical record patient-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/health-vault/share' && (init as RequestInit)?.method === 'POST')).toBe(true));

    runtime.user = { uid: 'patient-2' };
    view.rerender(<HealthVaultShare />);
    await screen.findByRole('checkbox', { name: 'Clinical record patient-2' });
    resolvePost(ok({ grantId: 'grant-A', secret: 'secret-A', qrPayload: 'https://example.test/patient-1#secret-A', expiresAt: Date.now() + 60_000, consentText: 'Consent A' }));
    await act(async () => { await delayedPost; });

    expect(screen.queryByText(/secret-A/)).toBeNull();
    expect(screen.queryByText('Consent A')).toBeNull();
  });

  it('requires a verified professional and explicit records before enabling consent', async () => {
    render(<HealthVaultShare />);
    const submit = screen.getByRole('button', { name: 'Generar QR' });
    expect(submit).toBeDisabled();

    const professional = await screen.findByRole('option', { name: /Dra. Elena Morales/ });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), {
      target: { value: professional.getAttribute('value') },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));

    expect(submit).not.toBeDisabled();
    expect(screen.getByText(/Autorizarás exactamente 1 registro/)).toBeTruthy();
  });

  it('posts a v2 snapshot with Bearer auth and renders the fragment QR', async () => {
    render(<HealthVaultShare />);
    await screen.findByRole('option', { name: /Dra. Elena Morales/ });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), {
      target: { value: 'doctor-1' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));

    await screen.findByTestId('qr');
    const call = fetchMock.mock.calls.find(([url, init]) =>
      url === '/api/health-vault/share' && (init as RequestInit)?.method === 'POST',
    ) as [string, RequestInit];
    expect(call).toBeDefined();
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(String(call[1].body))).toMatchObject({
      version: 2,
      resourceIds: ['record-1'],
      recipientProfessionalUid: 'doctor-1',
      purpose: 'continuity_of_care',
    });
    expect(screen.getByText(/vault\/share\/grant-1#server-generated-secret/)).toBeTruthy();
    expect(screen.getByText('Consentimiento exacto emitido por el servidor.')).toBeTruthy();
  });

  it('creates an open QR without a recipient and requires later owner confirmation', async () => {
    render(<HealthVaultShare />);
    await screen.findByRole('option', { name: /Dra. Elena Morales/ });
    fireEvent.click(screen.getByRole('checkbox', { name: /Mi médico aún no aparece/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));

    await screen.findByTestId('qr');
    const call = fetchMock.mock.calls.find(([url, init]) =>
      url === '/api/health-vault/share' && (init as RequestInit)?.method === 'POST',
    ) as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body).not.toHaveProperty('recipientProfessionalUid');
    expect(body.resourceIds).toEqual(['record-1']);
  });

  it('keeps revocation authenticated for legacy and v2 summaries', async () => {
    render(<HealthVaultShare />);
    fireEvent.click(await screen.findByText('Revocar'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        url === '/api/health-vault/share/grant-active/revoke',
      ) as [string, RequestInit] | undefined;
      expect(call).toBeDefined();
      expect((call![1].headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    });
  });

  it('keeps a share active and explains what to do when revocation fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/health-vault/records') return ok({ records: [] });
      if (url.startsWith('/api/health-professionals/search')) {
        return ok({ professionals: [] });
      }
      if (url === '/api/health-vault/share/grant-active/revoke') {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: 'health_vault_temporarily_unavailable',
            message: 'No pudimos revocar el acceso. Intenta nuevamente.',
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<HealthVaultShare />);
    fireEvent.click(await screen.findByText('Revocar'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos revocar el acceso. Intenta nuevamente.',
    );
    expect(screen.getByText('Revocar')).toBeTruthy();
    expect(screen.queryByText(/Revocado:/)).toBeNull();
  });

  it('shows an open-QR claim and confirms exactly that professional', async () => {
    activeShareOverrides = {
      version: 2,
      status: 'pending',
      recipientClaim: {
        professionalUid: 'doctor-1',
        displayName: 'Dra. Elena Morales',
        registryNumber: 'RNPI-12345',
        requestedAt: Date.now(),
      },
      sessionCount: 0,
      maxSessions: 5,
    };
    render(<HealthVaultShare />);

    expect(await screen.findByText(/Solicitud de Dra. Elena Morales/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar este profesional' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        url === '/api/health-vault/share/grant-active/confirm-recipient',
      ) as [string, RequestInit] | undefined;
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1].body))).toEqual({ professionalUid: 'doctor-1' });
    });
  });

  it('shows a professional claim received while the owner keeps the page open', async () => {
    render(<HealthVaultShare />);
    expect(await screen.findByText('Revocar')).toBeTruthy();
    expect(screen.queryByText(/Solicitud de Dra. Elena Morales/)).toBeNull();

    activeShareOverrides = {
      version: 2,
      status: 'pending',
      recipientClaim: {
        professionalUid: 'doctor-1',
        displayName: 'Dra. Elena Morales',
        registryNumber: 'RNPI-12345',
        requestedAt: Date.now(),
      },
      sessionCount: 0,
      maxSessions: 5,
    };
    emitActiveShares?.([activeShareDoc]);

    expect(await screen.findByText(/Solicitud de Dra. Elena Morales/)).toBeTruthy();
  });

  it('releases the live grant listener when the owner leaves the page', async () => {
    const view = render(<HealthVaultShare />);
    expect(await screen.findByText('Revocar')).toBeTruthy();

    view.unmount();

    expect(unsubscribeActiveShares).toHaveBeenCalled();
  });
});
