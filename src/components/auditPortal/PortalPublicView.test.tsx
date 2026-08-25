// @vitest-environment jsdom
//
// PortalPublicView tests — Hy3-audit 3c4aa66d-73fe-81c8-bd8d-e190b0f80c46.
// The component handles idle/loading/ok/forbidden/error states for the
// public audit portal entry. Had ZERO test coverage despite being in the
// operations/audit compliance path.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

// Mock the fetchPublicAuditPortal module BEFORE importing the component.
// [TS error 2026-08-25] import path corrected: function lives in
// src/hooks/useExternalAuditPortal.ts (not externalAuditPortal.ts).
vi.mock('../../hooks/useExternalAuditPortal', () => ({
  fetchPublicAuditPortal: vi.fn(),
}));

import { PortalPublicView } from './PortalPublicView';
import { fetchPublicAuditPortal } from '../../hooks/useExternalAuditPortal';

const mockedFetch = vi.mocked(fetchPublicAuditPortal);

beforeEach(() => {
  mockedFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PortalPublicView — minimal coverage', () => {
  // [Hy3-audit 3c4aa66d-73fe-81c8-bd8d-e190b0f80c46 reabierto 2026-08-24]:
  // The component handles idle/loading/ok/forbidden/error states for the
  // public audit portal entry. We exercise the two terminal-error branches
  // (forbidden + generic) which are the safest to assert in jsdom and
  // represent the user-visible failure modes.

  it('shows forbidden state when fetchPublicAuditPortal throws forbidden', async () => {
    mockedFetch.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { code: 'forbidden' }),
    );
    render(<PortalPublicView token="bad-token" projectId="proj-1" />);
    await waitFor(() => {
      // The forbidden branch renders an error-like alert.
      expect(document.body.textContent).toMatch(/forbidden|acceso|denegado|no autorizado/i);
    });
  });

  it('shows error state when fetchPublicAuditPortal throws generic error', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'));
    render(<PortalPublicView token="valid-token" projectId="proj-1" />);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/error|falla|problema|sin conexión/i);
    });
  });
});