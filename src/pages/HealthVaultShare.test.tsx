// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { HealthVaultShare } from './HealthVaultShare';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock('react-qr-code', () => ({ default: () => <div data-testid="qr" /> }));
vi.mock('../components/health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => <div data-testid="disclaimer" />,
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'patient-1' }, db: {} }),
}));

let activeShareOverrides: Record<string, unknown> = {};
let emitActiveShares: ((docs: Array<{ data(): Record<string, unknown> }>) => void) | undefined;
const unsubscribeActiveShares = vi.fn();
const activeShareDoc = {
  data: () => ({
    id: 'grant-active',
    scope: 'full',
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
  activeShareOverrides = {};
  emitActiveShares = undefined;
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
