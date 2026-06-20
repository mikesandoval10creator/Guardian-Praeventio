// @vitest-environment jsdom
//
// Connectivity ratchet (CLAUDE.md #21/#23) — Medicine.tsx page test that proves
// the DS 67 work-accident-notification modal is REALLY wired: the trigger button
// renders, and clicking it mounts the REAL <Ds67Modal/> (not a phantom import).
// Mocks only the boundary — the data hook, ProjectContext, i18n, framer-motion,
// and the heavy "workstation" child components / sibling modals — while driving
// the real Medicine page + real Ds67Modal through the open/close path.
//
// ADR 0012: Medicine.tsx must render <MedicalDisclaimer/>; this test pins that.
// DS 67 is a regulatory accident-notification document (Ley 16.744 art. 76), not
// a clinical diagnosis, so it is ADR-0012-compliant by construction.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ─── i18n: resolve `medicine.*` keys against the REAL es-CL locale so the
//     assertions run against the actual user-facing copy (not echoed keys).
//     (factory uses require() to dodge vi.mock hoisting of top-level imports) ─
vi.mock('react-i18next', () => {
  const esCommon = require('../i18n/locales/es/common.json') as {
    medicine: Record<string, string>;
  };
  const esMedicine = esCommon.medicine;
  return {
    useTranslation: () => ({
      t: (k: string, fb?: string) => {
        const m = /^medicine\.(.+)$/.exec(k);
        if (m && esMedicine[m[1]] !== undefined) return esMedicine[m[1]];
        return fb ?? k;
      },
    }),
  };
});

// ─── framer-motion: pass-through so JSX renders synchronously in jsdom ───────
vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

// ─── Data boundary ───────────────────────────────────────────────────────────
const addNodeMock = vi.fn(async () => ({ id: 'node-ds67' }));
vi.mock('../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ nodes: [], loading: false, addNode: addNodeMock }),
}));

let mockProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ─── Heavy workstation children + sibling modals: stub at the boundary so the
//     test isolates the DS 67 wiring (the real Ds67Modal is NOT stubbed). ─────
vi.mock('../components/health/MedicalDisclaimer', () => ({
  MedicalDisclaimer: () => React.createElement('div', { 'data-testid': 'medical-disclaimer' }),
}));
vi.mock('../components/medicine/AddMedicineModal', () => ({ AddMedicineModal: () => null }));
vi.mock('../components/occupational-health/HumanBodyViewer', () => ({
  HumanBodyViewer: () => null,
  BodyRegion: {},
}));
vi.mock('../components/occupational-health/SymptomDocumenter', () => ({ SymptomDocumenter: () => null }));
vi.mock('../components/medicine/DifferentialDiagnosis', () => ({ DifferentialDiagnosis: () => null }));
vi.mock('../components/medicine/AptitudeCertificateForm', () => ({ AptitudeCertificateForm: () => null }));
vi.mock('../components/medicine/AnatomyLibrary', () => ({ AnatomyLibrary: () => null }));
vi.mock('../components/medicine/VigilanciaScheduler', () => ({ VigilanciaScheduler: () => null }));
vi.mock('../components/medicine/DrugInteractions', () => ({ DrugInteractions: () => null }));
vi.mock('../components/medicine/Ds109Modal', () => ({ Ds109Modal: () => null }));

import { Medicine } from './Medicine';

beforeEach(() => {
  mockProject = { id: 'p-1', name: 'Faena Norte' };
  addNodeMock.mockClear();
});
afterEach(cleanup);

describe('<Medicine /> DS 67 modal wiring', () => {
  it('renders the MedicalDisclaimer (ADR 0012)', () => {
    render(<Medicine />);
    expect(screen.getByTestId('medical-disclaimer')).toBeInTheDocument();
  });

  it('renders the DS 67 trigger button with its real label', () => {
    render(<Medicine />);
    // Label comes from medicine.ds67_label → fallback echoes the i18n key.
    expect(screen.getByRole('button', { name: /Notificación DS 67/i })).toBeInTheDocument();
  });

  it('does NOT render the DS 67 modal until the trigger is clicked', () => {
    render(<Medicine />);
    // The modal heading is unique to the REAL Ds67Modal.
    expect(screen.queryByRole('heading', { name: /Notificación DS 67/i })).not.toBeInTheDocument();
  });

  it('opens the REAL Ds67Modal when the trigger is clicked', () => {
    render(<Medicine />);
    fireEvent.click(screen.getByRole('button', { name: /Notificación DS 67/i }));

    // Real modal is now mounted: aria-modal dialog + its own heading + the
    // legal citation footer that only the real component renders.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Notificación DS 67/i })).toBeInTheDocument();
    // Unique footer string rendered only by the real Ds67Modal (its legal-plazo note).
    expect(screen.getByText(/Plazo legal: 24 horas/i)).toBeInTheDocument();
    // The real form's submit button proves the form body rendered.
    expect(screen.getByRole('button', { name: /Generar DS 67 PDF/i })).toBeInTheDocument();
    // The real form's required worker-RUT field proves the form sections rendered.
    expect(screen.getByPlaceholderText('12.345.678-9')).toBeInTheDocument();
  });

  it('closes the modal via its close button', () => {
    render(<Medicine />);
    fireEvent.click(screen.getByRole('button', { name: /Notificación DS 67/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
