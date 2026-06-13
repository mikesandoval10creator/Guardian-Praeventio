// @vitest-environment jsdom
//
// SPDX-License-Identifier: MIT
//
// Praeventio Guard — HealthVaultShare auth-header regression test.
//
// Pins the §vault-bearer fix: the page used to send the RAW Firebase idToken
// as `Authorization: <token>` (via `user.getIdToken()`), but
// `verifyAuth.ts` only accepts `Authorization: Bearer <token>` — so every
// POST /api/health-vault/share returned 401 and the medical QR never
// generated. The fix routes both fetch calls through `apiAuthHeader()`,
// which returns the full header WITH the `Bearer ` prefix.
//
// Behavioral: renders the REAL page and drives the submit/revoke handlers;
// asserts the outgoing Authorization header starts with "Bearer ".

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { HealthVaultShare } from './HealthVaultShare';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));
// react-qr-code renders an <svg> via a worker-ish path; stub it out.
vi.mock('react-qr-code', () => ({ default: () => <div data-testid="qr" /> }));
vi.mock('../components/health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => <div data-testid="disclaimer" />,
}));
// A truthy `db` keeps the active-shares useEffect running; we control the
// Firestore reads via the firebase/firestore mock below.
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'worker-1' }, db: {} }),
}));

// The page dynamically `import('firebase/firestore')` to list active shares.
// Return one non-revoked, non-expired share so its "Revocar" button renders.
const activeShareDoc = {
  data: () => ({
    id: 'tok-active',
    scope: 'full',
    createdAt: Date.now(),
    expiresAt: Date.now() + 3_600_000,
    consumeCount: 0,
    maxConsumes: 3,
    revokedAt: null,
  }),
};
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  getDocs: async () => ({ docs: [activeShareDoc] }),
  query: (...args: unknown[]) => args,
  orderBy: () => ({}),
}));

const apiAuthHeaderMock = vi.fn(async () => 'Bearer test-token');
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: () => apiAuthHeaderMock(),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  apiAuthHeaderMock.mockClear();
  apiAuthHeaderMock.mockResolvedValue('Bearer test-token');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HealthVaultShare — Authorization header carries the Bearer prefix', () => {
  it('POSTs /api/health-vault/share with `Authorization: Bearer <token>` (not the raw idToken)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tokenId: 'tok-1',
        secret: 's3cr3t',
        qrPayload: 'https://example.test/vault/share/tok-1/s3cr3t',
        expiresAt: Date.now() + 3_600_000,
      }),
    });

    render(<HealthVaultShare />);
    fireEvent.click(screen.getByText('Generar QR'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/health-vault/share');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    // The load-bearing assertion: prefix must be present, else verifyAuth 401s.
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Authorization'].startsWith('Bearer ')).toBe(true);
  });

  it('revoke POST also sends the Bearer-prefixed Authorization header', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    render(<HealthVaultShare />);

    // The active-shares list loads the seeded share → its "Revocar" appears.
    const revokeBtn = await screen.findByText('Revocar');
    fireEvent.click(revokeBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/health-vault/share/tok-active/revoke');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Authorization'].startsWith('Bearer ')).toBe(true);
  });
});
