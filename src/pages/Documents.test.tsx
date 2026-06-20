// @vitest-environment jsdom
//
// Praeventio Guard — Documents page: documentHygiene mount (Wire UI #37/#46).
//
// Verifies that <Documents /> wires the REAL document-hygiene surface
// (<DocumentHygienePanel /> + <DocConfidenceCard />) against the REAL backend
// `GET /api/sprint-k/:projectId/document-hygiene` via `useDocumentHygiene`:
//   1. The hygiene panel renders REAL counts derived from the hook (a ghost
//      document with no signature / no access / no operational link is counted
//      as a ghost — proving the data is read, not the old fabricated zeros).
//   2. The confidence card renders the REAL computed score for the lowest-
//      confidence document.
//   3. Honest empty-state: no documents → 0 problems, no confidence card.
//
// Mocks live only at the network/context frontier (the hook, project context,
// Firestore collection, online status, versioning, firebase, router,
// framer-motion). The hygiene engine + components run for real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Documents } from './Documents';
import type { DocumentRecord } from '../services/documentHygiene/documentHygieneEngine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fb?: string | Record<string, unknown>) =>
      typeof fb === 'string' ? fb : k,
  }),
}));

const MOTION_ONLY_PROPS = [
  'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout',
];
vi.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: Record<string, unknown>, ref: unknown) => {
      const domProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (!MOTION_ONLY_PROPS.includes(k)) domProps[k] = v;
      }
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

let mockProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));

vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false }),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../hooks/useDocumentVersioning', () => ({
  useDocumentChain: () => ({ data: null, loading: false, error: null }),
  useDocumentChangelog: () => ({ data: null, loading: false, error: null }),
}));

// Network frontier: the real backend GET, returning REAL DocumentRecord[].
let mockHygiene: {
  data: { documents: DocumentRecord[] } | null;
  loading: boolean;
  error: Error | null;
} = { data: null, loading: false, error: null };
vi.mock('../hooks/useDataQuality', () => ({
  useDocumentHygiene: () => mockHygiene,
}));

vi.mock('../services/firebase', () => ({
  db: {},
  serverTimestamp: () => 'ts',
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../components/documents/AddDocumentModal', () => ({
  AddDocumentModal: () => null,
}));
vi.mock('../components/documents/EditDocumentModal', () => ({
  EditDocumentModal: () => null,
}));

// Frontier mock only: the real PDF rendering pipeline (jspdf). The
// LegalDocGeneratorForm + legalDocTemplates service run for real so this test
// proves the page mounts a WORKING generator (real markdown, real download
// call), not just an imported-but-dead component.
const downloadLegalDocPdf = vi.fn();
vi.mock('../utils/legalDocPdf.js', () => ({
  downloadLegalDocPdf: (...args: unknown[]) => downloadLegalDocPdf(...args),
}));

function ghostDoc(over: Partial<DocumentRecord> & { id: string }): DocumentRecord {
  return {
    id: over.id,
    title: over.title ?? 'Doc',
    kind: 'procedure',
    version: 'v1',
    updatedAt: over.updatedAt ?? '2026-05-01T00:00:00Z',
    hasValidSignature: over.hasValidSignature ?? false,
    accessCount90d: over.accessCount90d ?? 0,
    readReceiptCount: over.readReceiptCount ?? 0,
    referencesNorm: over.referencesNorm ?? false,
    isLinkedToOperations: over.isLinkedToOperations ?? false,
  };
}

beforeEach(() => {
  mockProject = null;
  mockHygiene = { data: null, loading: false, error: null };
  downloadLegalDocPdf.mockClear();
});

describe('<Documents /> documentHygiene mount', () => {
  it('renderiza el panel de higiene con datos REALES del backend (ghost detectado)', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    mockHygiene = {
      data: {
        documents: [
          ghostDoc({
            id: 'ghost-1',
            title: 'Procedimiento huérfano',
            isLinkedToOperations: false,
            readReceiptCount: 0,
            accessCount90d: 0,
          }),
        ],
      },
      loading: false,
      error: null,
    };
    render(<Documents />);
    expect(screen.getByTestId('doc-hygiene-panel')).toBeInTheDocument();
    // REAL data: a doc with no link / no signature / no access is a ghost.
    // The old fabricated path would also yield this, so we additionally assert
    // the ghost list renders the specific doc id sourced from the hook.
    expect(screen.getByTestId('doc-ghost-ghost-1')).toBeInTheDocument();
    expect(screen.getByTestId('doc-ghost-count').textContent).toMatch(/1/);
  });

  it('renderiza DocConfidenceCard con el score REAL del documento de menor confianza', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    // A high-confidence doc + a low one — the card must focus the LOW one.
    const strong: DocumentRecord = {
      id: 'strong',
      title: 'Reglamento Interno (firmado)',
      kind: 'policy',
      version: 'v3',
      approvedByUid: 'u1',
      updatedAt: '2026-05-01T00:00:00Z',
      hasValidSignature: true,
      accessCount90d: 40,
      readReceiptCount: 30,
      referencesNorm: true,
      isLinkedToOperations: true,
    };
    const weak = ghostDoc({ id: 'weak', title: 'Borrador sin firmar' });
    mockHygiene = {
      data: { documents: [strong, weak] },
      loading: false,
      error: null,
    };
    render(<Documents />);
    // The lowest-confidence doc is the weak one → its confidence card renders.
    expect(screen.getByTestId('doc-confidence-weak')).toBeInTheDocument();
    expect(screen.getByTestId('doc-confidence-level-weak').textContent).toBe('LOW');
    // Real computed score (weak doc → 0 positive factors): 0.
    expect(screen.getByTestId('doc-confidence-score-weak').textContent).toBe('0');
    // The strong doc is NOT the focused card.
    expect(screen.queryByTestId('doc-confidence-strong')).not.toBeInTheDocument();
  });

  it('empty-state honesto: sin documentos → 0 problemas y sin confidence card', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    mockHygiene = { data: { documents: [] }, loading: false, error: null };
    render(<Documents />);
    expect(screen.getByTestId('doc-hygiene-panel')).toBeInTheDocument();
    expect(screen.getByTestId('doc-ghost-count').textContent).toMatch(/0/);
    expect(screen.getByTestId('doc-unused-count').textContent).toMatch(/0/);
    // No documents → no lowest-confidence card.
    expect(
      screen.queryByTestId('doc-confidence-level-weak'),
    ).not.toBeInTheDocument();
  });
});

describe('<Documents /> legal-document generator mount', () => {
  it('el generador legal está oculto por defecto y se revela con el toggle', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    render(<Documents />);
    // Hidden initially.
    expect(screen.queryByTestId('documents-legalgen-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legaldoc-form')).not.toBeInTheDocument();
    // Reveal it.
    fireEvent.click(screen.getByTestId('documents-legalgen-toggle'));
    expect(screen.getByTestId('documents-legalgen-section')).toBeInTheDocument();
    expect(screen.getByTestId('legaldoc-form')).toBeInTheDocument();
    // The default RIOHS required fields render → the real form is mounted.
    expect(screen.getByTestId('legaldoc-field-companyName')).toBeInTheDocument();
  });

  it('genera un documento legal REAL desde la página (download con markdown del usuario)', () => {
    mockProject = { id: 'p-1', name: 'Faena Norte' };
    render(<Documents />);
    fireEvent.click(screen.getByTestId('documents-legalgen-toggle'));

    // Fill all required RIOHS tokens so the generate button enables.
    fireEvent.change(screen.getByTestId('legaldoc-field-companyName'), {
      target: { value: 'Constructora Andes' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-companyRut'), {
      target: { value: '76.111.222-3' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-projectName'), {
      target: { value: 'Obra Andina' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-date'), {
      target: { value: '2026-05-12' },
    });
    fireEvent.change(screen.getByTestId('legaldoc-field-workerCount'), {
      target: { value: '120' },
    });

    fireEvent.click(screen.getByTestId('legaldoc-generate-btn'));

    // REAL generation: the page-mounted form drove the PDF download with the
    // markdown rendered by the actual legalDocTemplates service (user data in).
    expect(downloadLegalDocPdf).toHaveBeenCalledTimes(1);
    const [pdfInput, kindArg] = downloadLegalDocPdf.mock.calls[0];
    expect(kindArg).toBe('RIOHS');
    expect(pdfInput.markdown).toContain('Constructora Andes');
    expect(pdfInput.markdown).toContain('Obra Andina');
    expect(pdfInput.references.join(' ')).toMatch(/Ley 16\.744/);
  });
});
