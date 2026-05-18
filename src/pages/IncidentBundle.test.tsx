// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.3 page wrapper tests.

import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { IncidentBundle } from './IncidentBundle';
import type {
  IncidentBundleManifest,
} from '../services/incidentBundle/incidentEvidenceBundle';
import type { IncidentBundleResponse } from '../hooks/useIncidentBundle';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockUseBundle: {
  data: IncidentBundleResponse | null;
  loading: boolean;
  error: Error | null;
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useIncidentBundle', () => ({
  useIncidentBundle: () => mockUseBundle,
}));

function renderAtPath(ui: ReactElement, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/incidents/:incidentId/bundle" element={ui} />
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockUseBundle = { data: null, loading: false, error: null };
});

function fixtureManifest(): IncidentBundleManifest {
  return {
    bundleId: 'inc-1',
    generatedAt: '2026-05-17T03:00:00.000Z',
    incident: {
      id: 'inc-1',
      projectId: 'p-1',
      occurredAt: '2026-05-16T10:00:00.000Z',
      severity: 'high',
      summary: 'Caída de andamio en sector 3.',
      reportedByUid: 'u-1',
      reportedAt: '2026-05-16T10:15:00.000Z',
    },
    affectedWorkers: [],
    evidence: [],
    appliedControls: [],
    requiredEpp: [],
    requiredTrainings: [],
    normativeRefs: [],
    auditLog: [],
    completenessScore: 30,
    gaps: [
      { kind: 'no_evidence', detail: 'Sin fotos.', weight: 25 },
      { kind: 'no_affected_workers_declared', detail: 'No declarado.', weight: 25 },
      { kind: 'no_root_cause_assigned', detail: 'Sin RCA.', weight: 20 },
    ],
    recommendations: [
      'Subir al menos una foto del lugar.',
      'Declarar trabajadores afectados.',
    ],
  };
}

describe('<IncidentBundle /> page wrapper (Fase F.3)', () => {
  it('renderiza no-id state cuando la URL no tiene incidentId', () => {
    renderAtPath(<IncidentBundle />, '/sin-id');
    expect(screen.getByTestId('incident-bundle-page-noid')).toBeInTheDocument();
  });

  it('renderiza empty-state cuando no hay proyecto', () => {
    mockSelectedProject = null;
    renderAtPath(<IncidentBundle />, '/incidents/inc-1/bundle');
    expect(screen.getByTestId('incident-bundle-page-empty')).toBeInTheDocument();
  });

  it('renderiza loading', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockUseBundle = { data: null, loading: true, error: null };
    renderAtPath(<IncidentBundle />, '/incidents/inc-1/bundle');
    expect(screen.getByTestId('incident-bundle-loading')).toBeInTheDocument();
  });

  it('renderiza error', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockUseBundle = { data: null, loading: false, error: new Error('Boom') };
    renderAtPath(<IncidentBundle />, '/incidents/inc-1/bundle');
    expect(screen.getByTestId('incident-bundle-error')).toBeInTheDocument();
    expect(screen.getByText(/Boom/i)).toBeInTheDocument();
  });

  it('renderiza el card con el manifest', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockUseBundle = { data: { manifest: fixtureManifest() }, loading: false, error: null };
    renderAtPath(<IncidentBundle />, '/incidents/inc-1/bundle');
    expect(screen.getByTestId('incident-bundle-page')).toBeInTheDocument();
    // The card itself renders the summary text:
    expect(screen.getByText(/Caída de andamio/i)).toBeInTheDocument();
  });

  it('muestra offline chip cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockIsOnline = false;
    mockUseBundle = { data: { manifest: fixtureManifest() }, loading: false, error: null };
    renderAtPath(<IncidentBundle />, '/incidents/inc-1/bundle');
    expect(screen.getByTestId('incident-bundle-offline-chip')).toBeInTheDocument();
  });
});
