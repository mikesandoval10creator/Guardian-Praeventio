// @vitest-environment jsdom
//
// Sprint 20 — Bucket D — StartProcessModal integration tests.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

// â”€â”€â”€ Mocks (must precede the component import) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

vi.mock('../../services/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'fake-token' } },
  db: {},
}));

vi.mock('../../services/analytics', () => ({
  analytics: { track: vi.fn() },
}));

// framer-motion — render direct DOM without animations to keep tests sync.
vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { StartProcessModal } from './StartProcessModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StartProcessModal', () => {
  beforeEach(() => {
    // Default fetch — happy path. Override per test as needed.
    globalThis.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ id: 'proc-123' }) }) as any
    );
  });

  it('renders title and core fields when open', () => {
    render(
      <StartProcessModal
        isOpen={true}
        projectId="proj-1"
        crewId="crew-1"
        crewName="Cuadrilla A"
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/iniciar proceso/i)).toBeInTheDocument();
    expect(screen.getByText(/Cuadrilla A/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Hormigonado/i)).toBeInTheDocument();
  });

  it('shows validation error when name is empty and submit is clicked', async () => {
    render(
      <StartProcessModal
        isOpen={true}
        projectId="proj-1"
        crewId="crew-1"
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /iniciar/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/nombre/i);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('happy-path: POSTs /api/processes and calls onCreated + onClose', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <StartProcessModal
        isOpen={true}
        projectId="proj-1"
        crewId="crew-1"
        onClose={onClose}
        onCreated={onCreated}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/Hormigonado/i), {
      target: { value: 'Mi proceso' },
    });
    fireEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('proc-123'));
    expect(onClose).toHaveBeenCalled();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/processes',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toMatchObject({
      projectId: 'proj-1',
      crewId: 'crew-1',
      name: 'Mi proceso',
    });
  });

  it('shows server error message on non-ok response', async () => {
    globalThis.fetch = vi.fn(async () =>
      ({ ok: false, status: 500, json: async () => ({ error: 'kaboom' }) }) as any
    );
    render(
      <StartProcessModal
        isOpen={true}
        projectId="proj-1"
        crewId="crew-1"
        onClose={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/Hormigonado/i), {
      target: { value: 'Mi proceso' },
    });
    fireEvent.click(screen.getByRole('button', { name: /iniciar/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/No pudimos completar la acción/i);
    });
  });
});
