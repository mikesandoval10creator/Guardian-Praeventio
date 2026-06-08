// @vitest-environment jsdom
//
// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthVaultViewer page tests.

import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HealthVaultViewer } from './HealthVaultViewer';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vault/share/:tokenId/:secret" element={<HealthVaultViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HealthVaultViewer', () => {
  it('renders MedicalDisclaimer banner permanently (loading state)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Promise(() => {
        /* never resolves */
      }) as any,
    );
    renderAt('/vault/share/abc/xyz');
    expect(screen.getByText('Praeventio nunca diagnostica.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/cargando/i);
  });

  it('renders worker name + records on success', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        workerName: 'Juan Pérez',
        records: [
          {
            id: 'r1',
            workerUid: 'w1',
            type: 'lab_result',
            uploadedAt: Date.now(),
            uploadedBy: 'self',
            meta: { title: 'Hemograma' },
            tags: [],
            shareScope: 'shared-via-qr',
          },
        ],
        expiresAt: Date.now() + 86_400_000,
      }),
    });
    renderAt('/vault/share/tok/sec');
    await waitFor(() =>
      expect(screen.getByText(/Juan Pérez/)).toBeTruthy(),
    );
    expect(screen.getByText('Hemograma')).toBeTruthy();
    // Banner + footer ambos llevan la frase. Verificamos que aparece >=1 vez.
    expect(
      screen.getAllByText(/Praeventio nunca diagnostica/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows expired message on 410 expired', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 410,
      json: async () => ({ error: 'expired' }),
    });
    renderAt('/vault/share/tok/sec');
    await waitFor(() =>
      expect(screen.getByText(/expiró/i)).toBeTruthy(),
    );
  });

  it('shows revoked message on 410 revoked', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 410,
      json: async () => ({ error: 'revoked' }),
    });
    renderAt('/vault/share/tok/sec');
    await waitFor(() =>
      expect(screen.getByText(/revocó/i)).toBeTruthy(),
    );
  });

  it('shows invalid message on 401', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      json: async () => ({ error: 'invalid_token' }),
    });
    renderAt('/vault/share/tok/sec');
    await waitFor(() =>
      expect(screen.getByText(/inválido/i)).toBeTruthy(),
    );
  });

  it('keeps the medical disclaimer banner present even on error states', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 410,
      json: async () => ({ error: 'expired' }),
    });
    renderAt('/vault/share/tok/sec');
    await waitFor(() => screen.getByText(/expiró/i));
    expect(screen.getByText('Praeventio nunca diagnostica.')).toBeTruthy();
  });

  it('renders the file link from server fileProxyPath, never a raw fileUri', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        workerName: 'Juan Pérez',
        records: [
          {
            id: 'r1',
            workerUid: 'w1',
            type: 'imaging',
            uploadedAt: Date.now(),
            uploadedBy: 'doctor',
            meta: { title: 'RX columna' },
            tags: [],
            shareScope: 'shared-via-qr',
            fileProxyPath: '/api/health-vault/view/tok/sec/file/r1',
          },
        ],
        expiresAt: Date.now() + 86_400_000,
      }),
    });
    renderAt('/vault/share/tok/sec');
    const link = await screen.findByText('Ver archivo');
    expect(link.getAttribute('href')).toBe('/api/health-vault/view/tok/sec/file/r1');
    // never points at a raw Storage / signed URL
    expect(link.getAttribute('href')).not.toMatch(/^https?:\/\//);
  });
});
