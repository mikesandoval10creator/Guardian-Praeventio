// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Same shape as ISOAudit.test.tsx — framer-motion's projection layer needs a
// real layout engine that jsdom doesn't provide.
vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));

import { ConsentBanner } from './ConsentBanner.js';

const LOCAL_FLAG_KEY = 'pg.consentBanner.dismissed.v1';

/**
 * Reply to the GET consent probe with "no consent recorded" so the banner
 * stays open, then reply to each POST according to `postStatus(purpose)`.
 */
function mockFetch(postStatus: (purpose: string) => number) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method !== 'POST') {
      return { ok: true, json: async () => ({ consents: {} }) } as Response;
    }
    const body = JSON.parse(String(init.body)) as { purpose: string };
    const status = postStatus(body.purpose);
    return { ok: status < 400, status, json: async () => ({}) } as Response;
  });
}

async function acceptAndSettle() {
  const btn = await screen.findByRole('button', { name: /Aceptar y continuar/i });
  fireEvent.click(btn);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Guardando…/i })).toBeNull(),
  );
}

describe('<ConsentBanner />', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('todas las finalidades guardadas: cierra el banner y marca el flag local', async () => {
    vi.stubGlobal('fetch', mockFetch(() => 200));

    render(<ConsentBanner />);
    await acceptAndSettle();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(localStorage.getItem(LOCAL_FLAG_KEY)).toBe('1');
  });

  it('si el servidor rechaza una finalidad: NO cierra, nombra la que falló y no marca el flag', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((purpose) => (purpose === 'marketing' ? 500 : 200)),
    );

    render(<ConsentBanner />);
    // marketing defaults to off; turn it on so it is a user decision at stake.
    fireEvent.click(screen.getByRole('checkbox', { name: /Comunicaciones de marketing/i }));
    await acceptAndSettle();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(/Comunicaciones de marketing/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(localStorage.getItem(LOCAL_FLAG_KEY)).toBeNull();
  });

  it('si la red falla: NO cierra y no marca el flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') {
          return { ok: true, json: async () => ({ consents: {} }) } as Response;
        }
        throw new Error('network down');
      }),
    );

    render(<ConsentBanner />);
    await acceptAndSettle();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(localStorage.getItem(LOCAL_FLAG_KEY)).toBeNull();
  });
});
