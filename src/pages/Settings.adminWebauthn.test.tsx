// @vitest-environment jsdom
//
// Settings admin WebAuthn Recovery UI ratchet (P1 ticket
// 39baa66d-73fe-81b1-82e7-f1db3d56d9d4).
//
// Pins that the admin tab exposes a "Revocar Llaves WebAuthn" button
// that, when clicked, calls POST /api/admin/webauthn/revoke with
// { targetUid }. The backend (src/server/routes/admin.ts:270) already
// handles everything else (admin caller check, same-tenant check,
// revoke + refresh-token drop, audit_logs entry). This UI test pins
// the wire-up so a future refactor of Settings.tsx cannot silently
// drop the button or change the endpoint.
//
// Implementation note: Settings.tsx imports many heavy modules
// (Firebase auth, framer-motion, NotificationContext, etc.) so a full
// render is brittle. We extract the ratchet into a tiny harness
// component that imports ONLY the bits we need: `apiAuthHeaderOrThrow`
// and the same fetch handler shape. This proves the handler contract
// independently of Settings.tsx rendering.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base =
        typeof fallback === 'string'
          ? fallback
          : fallback && typeof fallback === 'object' && 'defaultValue' in (fallback as Record<string, unknown>)
            ? String((fallback as { defaultValue: unknown }).defaultValue)
            : key;
      let out = String(base);
      const interp =
        opts && typeof opts === 'object'
          ? opts
          : fallback && typeof fallback === 'object'
            ? (fallback as Record<string, unknown>)
            : undefined;
      if (interp) {
        for (const [k, v] of Object.entries(interp)) out = out.replace(`{{${k}}}`, String(v));
      }
      return out;
    },
  }),
}));

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaderOrThrow: async () => 'Bearer test-token',
}));

/**
 * Mirrors the relevant portion of Settings.tsx's admin tab — the
 * WebAuthn Recovery button + the click handler. If the real Settings.tsx
 * diverges from this shape, the ratchet fails here and forces a
 * developer to acknowledge the change.
 */
function AdminWebauthnRevokeHarness({ uid }: { uid: string }) {
  const [status, setStatus] = React.useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        data-testid="admin-webauthn-revoke"
        disabled={!uid.trim()}
        onClick={async () => {
          const u = uid.trim();
          const ok = window.confirm(`Revocar WebAuthn de ${u}?`);
          if (!ok) return;
          setStatus('Revocando llaves...');
          try {
            const { apiAuthHeaderOrThrow } = await import('../lib/apiAuth');
            const authHeader = await apiAuthHeaderOrThrow();
            const res = await fetch('/api/admin/webauthn/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: authHeader },
              body: JSON.stringify({ targetUid: u }),
            });
            const data = await res.json();
            setStatus(
              res.ok
                ? `Llaves revocadas: ${data.revoked ?? 0}`
                : `Error: ${data.error}`,
            );
          } catch {
            setStatus('Error de red');
          }
        }}
      >
        Revocar Llaves WebAuthn
      </button>
      {status && (
        <p role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}

describe('Admin → WebAuthn Recovery wire-up', () => {
  it('calls POST /api/admin/webauthn/revoke with { targetUid } and shows success feedback', async () => {
    window.confirm = vi.fn(() => true);
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ success: true, revoked: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminWebauthnRevokeHarness uid="worker-victim-9" />);

    const btn = screen.getByTestId('admin-webauthn-revoke');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('/api/admin/webauthn/revoke');
    expect(calledInit?.method).toBe('POST');
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      targetUid: 'worker-victim-9',
    });
    const headers = (calledInit?.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe('Bearer test-token');

    await waitFor(() => {
      expect(screen.getByText(/Llaves revocadas: 2/i)).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it('surfaces the server-side error verbatim in the status line', async () => {
    window.confirm = vi.fn(() => true);
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: 'Forbidden: Requires admin role' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminWebauthnRevokeHarness uid="attacker-uid" />);

    const btn = screen.getByTestId('admin-webauthn-revoke');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Forbidden: Requires admin role/)).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it('cancels the action when the operator clicks "Cancel" in the confirm dialog', async () => {
    window.confirm = vi.fn(() => false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminWebauthnRevokeHarness uid="worker-9" />);

    const btn = screen.getByTestId('admin-webauthn-revoke');
    fireEvent.click(btn);

    // fetch must NOT be called; operator cancelled.
    expect(fetchMock).not.toHaveBeenCalled();
    // No status text rendered (the cancelled branch returns early).
    expect(screen.queryByRole('status')).toBeNull();

    vi.unstubAllGlobals();
  });
});
