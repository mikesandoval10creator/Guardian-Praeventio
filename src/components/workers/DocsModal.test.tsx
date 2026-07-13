// @vitest-environment jsdom
//
// Sprint 20 — Bucket D — DocsModal render/list/delete tests.

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Worker } from '../../types';

// ─── Mocks ─────────────────────────────────────────────────────────────────

let lastSnapshotCb: ((snap: any) => void) | null = null;

const addDocMock = vi.fn(async (..._args: any[]) => ({ id: 'doc-new' }));
const updateDocMock = vi.fn(async (..._args: any[]) => undefined);
const deleteDocMock = vi.fn(async (..._args: any[]) => undefined);

vi.mock('../../services/firebase', () => ({
  db: {},
  storage: {},
  collection: vi.fn((_db: any, path: string) => ({ path })),
  addDoc: (...args: any[]) => addDocMock(...args),
  onSnapshot: vi.fn((_q: any, cb: any) => {
    lastSnapshotCb = cb;
    return () => { lastSnapshotCb = null; };
  }),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  handleFirestoreError: vi.fn(),
  OperationType: { CREATE: 'CREATE', LIST: 'LIST', WRITE: 'WRITE', READ: 'READ' },
  deleteDoc: (...args: any[]) => deleteDocMock(...args),
  doc: vi.fn((_db: any, path: string, id: string) => ({ path, id })),
  updateDoc: (...args: any[]) => updateDocMock(...args),
}));

// handleUpload dynamically imports firebase/storage — stub it so no network I/O.
vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn(async () => undefined),
  getDownloadURL: vi.fn(async () => 'https://example.test/doc.pdf'),
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({
    nodes: [],
    addNode: vi.fn(async () => ({ id: 'node-1' })),
    addConnection: vi.fn(),
  }),
}));

vi.mock('../../services/geminiService', () => ({
  analyzeDocumentCompliance: vi.fn(async () => ({
    isCompliant: true,
    reason: 'OK',
    urgency: 'low',
  })),
}));

vi.mock('../../services/analytics', () => ({
  analytics: { track: vi.fn() },
}));

vi.mock('../shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ isOpen, title, onConfirm }: any) =>
    isOpen
      ? React.createElement(
          'div',
          { 'data-testid': 'confirm-dialog' },
          title,
          React.createElement(
            'button',
            { 'data-testid': 'confirm-dialog-accept', onClick: onConfirm },
            'aceptar',
          ),
        )
      : null,
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { DocsModal } from './DocsModal';

const worker: Worker = {
  id: 'w-1',
  name: 'Juan Pérez',
  role: 'Soldador',
  email: 'juan@x.com',
  status: 'active',
  joinedAt: new Date().toISOString(),
} as any;

beforeEach(() => {
  addDocMock.mockClear();
  addDocMock.mockResolvedValue({ id: 'doc-new' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  lastSnapshotCb = null;
});

describe('DocsModal', () => {
  it('renders worker name in the modal header', () => {
    render(<DocsModal isOpen={true} onClose={() => {}} worker={worker} projectId="proj-1" />);
    // Open + worker present means the modal subscribes via onSnapshot.
    expect(lastSnapshotCb).not.toBeNull();
    // Name should be visible somewhere in the header.
    expect(screen.getByText(/Juan Pérez/)).toBeInTheDocument();
  });

  it('renders empty-state when the snapshot returns no docs', () => {
    render(<DocsModal isOpen={true} onClose={() => {}} worker={worker} projectId="proj-1" />);
    // Simulate Firestore replying with zero docs.
    lastSnapshotCb?.({ docs: [] });
    // Component should not crash and modal stays mounted.
    expect(screen.getByText(/Juan Pérez/)).toBeInTheDocument();
  });

  it('writes archived:false on uploaded docs so they match the live listener', async () => {
    const { container } = render(
      <DocsModal isOpen={true} onClose={() => {}} worker={worker} projectId="proj-1" />
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const file = new File(['%PDF-1.4'], 'certificado.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(addDocMock).toHaveBeenCalledTimes(1));
    // The written object MUST carry archived:false — the onSnapshot query filters
    // where('archived', '==', false); without it, uploads never surface in the list.
    const written = (addDocMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(written.archived).toBe(false);
    expect(written.name).toBe('certificado.pdf');
  });

  it('F7: archive writes archived:true and NEVER calls deleteDoc (evidence lock)', async () => {
    render(<DocsModal isOpen={true} onClose={() => {}} worker={worker} projectId="proj-1" />);
    lastSnapshotCb?.({
      docs: [
        { id: 'doc-1', data: () => ({ name: 'contrato.pdf', type: 'PDF', url: 'https://x/y', archived: false }) },
      ],
    });
    const archiveBtn = await screen.findByTitle(/archivar documento/i);
    fireEvent.click(archiveBtn);
    fireEvent.click(screen.getByTestId('confirm-dialog-accept'));
    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
    // Target: the project-scoped path + the doc id, flipping ONLY the flag.
    expect(updateDocMock.mock.calls[0][0]).toEqual({ path: 'projects/proj-1/workers/w-1/documents', id: 'doc-1' });
    expect(updateDocMock.mock.calls[0][1]).toEqual({ archived: true });
    expect(deleteDocMock).not.toHaveBeenCalled();
  });

  it('returns null branch when worker is null (no Firestore subscription)', () => {
    const { container } = render(
      <DocsModal isOpen={true} onClose={() => {}} worker={null} projectId="proj-1" />
    );
    // No worker → component returns null before subscribing.
    expect(lastSnapshotCb).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
