// @vitest-environment jsdom
//
// F7 evidence lock — ProjectDocuments archive-not-delete tests.
//
// Founder decision 2026-07-02: project documents are legal evidence (DS 44 /
// Ley 16.744 trail). The old UI deleted the Storage object AND the Firestore
// row; F7 reconverts removal to `archived: true` (hide-only). These tests pin:
//   1. archived docs are hidden from the list,
//   2. the archive flow writes ONLY the flag via updateDoc,
//   3. no delete primitive is ever invoked.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const updateDocMock = vi.fn(async (..._args: any[]) => undefined);
const deleteDocMock = vi.fn(async (..._args: any[]) => undefined);
const deleteObjectMock = vi.fn(async (..._args: any[]) => undefined);
const addDocMock = vi.fn(async (..._args: any[]) => ({ id: 'doc-new' }));

vi.mock('../../services/firebase', () => ({
  db: {},
  storage: {},
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn(async () => undefined),
  getDownloadURL: vi.fn(async () => 'https://example.test/doc.pdf'),
  deleteObject: (...args: any[]) => deleteObjectMock(...args),
  collection: vi.fn((_db: any, path: string) => ({ path })),
  addDoc: (...args: unknown[]) => addDocMock(...(args as [unknown, unknown])),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  deleteDoc: (...args: any[]) => deleteDocMock(...args),
  doc: vi.fn((_db: any, path: string, id: string) => ({ path, id })),
  updateDoc: (...args: any[]) => updateDocMock(...args),
}));

vi.mock('../../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({
    data: [
      {
        id: 'doc-active', name: 'PTS Excavación.pdf', url: 'https://x/a', type: 'PDF',
        size: 2048, projectId: 'proj-1', uploadedBy: 'u1', createdAt: '2026-06-03T00:00:00Z',
      },
      {
        id: 'doc-archived', name: 'Plan antiguo.pdf', url: 'https://x/b', type: 'PDF',
        size: 1024, projectId: 'proj-1', uploadedBy: 'u1', createdAt: '2026-05-01T00:00:00Z',
        archived: true,
      },
      {
        id: 'doc-newstyle', name: 'Contrato.pdf', storagePath: 'projects/proj-1/documents/1_Contrato.pdf',
        type: 'PDF', size: 2048, projectId: 'proj-1', uploadedBy: 'u1', createdAt: '2026-06-04T00:00:00Z',
      },
    ],
    loading: false,
  }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1', email: 'u1@x.cl' } }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../utils/imageCompression', () => ({
  compressImage: vi.fn(async (f: File) => f),
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
  const Pass = ({ children, ...rest }: any) => React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { ProjectDocuments } from './ProjectDocuments';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectDocuments — F7 evidence lock', () => {
  it('hides archived documents from the list (hide-only removal)', () => {
    render(<ProjectDocuments projectId="proj-1" />);
    expect(screen.getByText('PTS Excavación.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Plan antiguo.pdf')).not.toBeInTheDocument();
  });

  it('F7: archiving writes archived:true to project_documents and deletes NOTHING', async () => {
    render(<ProjectDocuments projectId="proj-1" />);
    fireEvent.click(screen.getAllByTitle('Archivar documento (la evidencia se conserva)')[0]);
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Archivar documento')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-accept'));
    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
    expect(updateDocMock.mock.calls[0][0]).toEqual({ path: 'project_documents', id: 'doc-active' });
    expect(updateDocMock.mock.calls[0][1]).toEqual({ archived: true });
    // The evidence-destruction primitives are NEVER invoked.
    expect(deleteDocMock).not.toHaveBeenCalled();
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  // [P0] security — persist `storagePath`, NEVER a long-lived bearer
  // getDownloadURL. A bearer URL keeps working after the doc is archived
  // or the worker leaves, for anyone who saw it. The rules gate the path;
  // the URL must be derived on demand at download time.
  it('[P0] upload persists storagePath + fileName, NOT a bearer url', async () => {
    render(<ProjectDocuments projectId="proj-1" />);
    const file = new File(['pdf-bytes'], 'contrato.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText(/subir documento/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(addDocMock).toHaveBeenCalledTimes(1));
    const added = (addDocMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(added.storagePath).toMatch(/^projects\/proj-1\/documents\/\d+_contrato\.pdf$/);
    expect(added.fileName).toBe('contrato.pdf');
    expect(added.url).toBeUndefined(); // NEVER persist the bearer URL
  });

  // [P0] security — downloads are derived ON DEMAND from storagePath via
  // getDownloadURL at click time (re-checks storage.rules against CURRENT
  // membership). Legacy rows with a persisted bearer url keep working.
  it('[P0] download from storagePath derives a fresh URL via getDownloadURL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const getDownloadURLMock = vi.fn(async () => 'https://fresh.example/derived-url');
    const firebase = await import('../../services/firebase');
    vi.mocked(firebase.getDownloadURL).mockImplementation(getDownloadURLMock);

    render(<ProjectDocuments projectId="proj-1" />);
    // Two rows render download links: doc-active (legacy url) and
    // doc-newstyle (storagePath only). Click the NEW-style one — the
    // derived-URL path is what this test pins.
    const links = screen.getAllByTitle('Descargar archivo original');
    expect(links.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(links[links.length - 1]);
    await waitFor(() => expect(getDownloadURLMock).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith('https://fresh.example/derived-url', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });
});
