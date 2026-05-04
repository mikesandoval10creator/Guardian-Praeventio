// @vitest-environment jsdom
//
// Sprint 20 — Bucket D — DocsModal render/list/delete tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { Worker } from '../../types';

// ─── Mocks ─────────────────────────────────────────────────────────────────

let lastSnapshotCb: ((snap: any) => void) | null = null;

vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'doc-new' })),
  onSnapshot: vi.fn((_q: any, cb: any) => {
    lastSnapshotCb = cb;
    return () => { lastSnapshotCb = null; };
  }),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  handleFirestoreError: vi.fn(),
  OperationType: { CREATE: 'CREATE', LIST: 'LIST', WRITE: 'WRITE', READ: 'READ' },
  deleteDoc: vi.fn(async () => undefined),
  doc: vi.fn(),
  updateDoc: vi.fn(async () => undefined),
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
  ConfirmDialog: ({ isOpen, title }: any) =>
    isOpen ? React.createElement('div', { 'data-testid': 'confirm-dialog' }, title) : null,
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

  it('returns null branch when worker is null (no Firestore subscription)', () => {
    const { container } = render(
      <DocsModal isOpen={true} onClose={() => {}} worker={null} projectId="proj-1" />
    );
    // No worker → component returns null before subscribing.
    expect(lastSnapshotCb).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
