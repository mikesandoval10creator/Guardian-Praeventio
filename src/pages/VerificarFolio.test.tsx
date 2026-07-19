// @vitest-environment jsdom
//
// The point of this page is that a fiscalizador scanning a QR never sees a
// machine string, and never sees a verdict stronger than what the verifier
// actually proved. These tests pin both.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { VerificarFolio } from './VerificarFolio';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FOLIO = 'DIAT-2026-praevent-000001';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/verificar/${FOLIO}`]}>
      <Routes>
        <Route path="/verificar/:folio" element={<VerificarFolio />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderWithResponse(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => body }));
  return renderPage();
}

describe('VerificarFolio', () => {
  it('shows a verified document with its signer data', async () => {
    const { getByTestId, container } = renderWithResponse({
      valid: true,
      verificationStatus: 'verified',
      kind: 'DIAT',
      signedAt: '2026-05-05T10:00:00.000Z',
      signerRut: '12.345.678-K',
    });
    await waitFor(() => {
      expect(getByTestId('verification-verdict').dataset.tone).toBe('verified');
    });
    expect(container.textContent).toContain('DIAT');
    expect(container.textContent).toContain('12.345.678-K');
    expect(container.textContent).toContain(FOLIO);
  });

  it('never claims a document is valid when the signature could not be checked', async () => {
    const { getByTestId, container } = renderWithResponse({
      valid: false,
      verificationStatus: 'unverifiable',
      reason: 'legacy_unverifiable',
      kind: 'DIEP',
    });
    await waitFor(() => {
      expect(getByTestId('verification-verdict').dataset.tone).toBe('unverifiable');
    });
    // Not verified, but not accused either.
    expect(container.textContent).not.toMatch(/documento verificado/i);
    expect(container.textContent).toMatch(/no significa que el documento sea falso/i);
  });

  it('never renders a raw machine reason or an HTTP code', async () => {
    const { container } = renderWithResponse({
      valid: false,
      verificationStatus: 'invalid',
      reason: 'payload_hash_mismatch',
    });
    await waitFor(() => {
      expect(container.textContent).toMatch(/no corresponde a este documento/i);
    });
    expect(container.textContent).not.toMatch(/payload_hash_mismatch/);
    expect(container.textContent).not.toMatch(/\b(4\d{2}|5\d{2})\b/);
  });

  it('degrades honestly when the verifier cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { getByTestId } = renderPage();
    await waitFor(() => {
      expect(getByTestId('verification-verdict').dataset.tone).toBe('unknown');
    });
  });
});
