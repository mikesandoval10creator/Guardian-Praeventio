// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.1 — EditWorkerModal smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const updateDocMock = vi.fn(async () => undefined);

vi.mock('../../services/firebase', () => ({
  db: {},
  doc: vi.fn(() => ({ __mock: 'docRef' })),
  updateDoc: (...args: any[]) => updateDocMock(...(args as [])),
  handleFirestoreError: vi.fn(),
  OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../shared/ToastContainer', () => ({
  ToastContainer: () => null,
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { EditWorkerModal } from './EditWorkerModal';

const worker: any = {
  id: 'w-1',
  name: 'Ana Soto',
  role: 'Soldador',
  email: 'ana@x.com',
  phone: '555',
  status: 'active',
  hasArt22: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EditWorkerModal', () => {
  it('renders nothing when worker is null', () => {
    const { container } = render(
      <EditWorkerModal isOpen={true} onClose={() => {}} worker={null} />,
    );
    expect(container.querySelector('input')).toBeNull();
  });

  it('renders the form pre-filled with the worker data when open', () => {
    render(
      <EditWorkerModal isOpen={true} onClose={() => {}} worker={worker} projectId="p-1" />,
    );
    expect(screen.getByDisplayValue('Ana Soto')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ana@x.com')).toBeInTheDocument();
  });

  it('PATCHes the audited endpoint on submit and invokes onClose', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      <EditWorkerModal isOpen={true} onClose={onClose} worker={worker} projectId="p-1" />,
    );
    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Audited path, not a direct client write.
    expect(updateDocMock).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects/p-1/workers/w-1');
    expect(init.method).toBe('PATCH');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });
});
