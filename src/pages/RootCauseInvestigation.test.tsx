// @vitest-environment jsdom
//
// Praeventio Guard — page test for RootCauseInvestigation.
//
// Verifies the incident-investigation page mounts the REAL
// <CustodyChainTimelineCard /> fed by the custody-by-node hook: when the
// selected incident has evidence with a chain of custody, the page renders the
// artifact's unique timeline card (data-testid `custody-chain-<hash>`) with the
// real artifact + event data — not a fabricated empty shell. Also covers the
// honest empty-state when the incident has no linked evidence.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RootCauseInvestigation } from './RootCauseInvestigation';
import type { RootCauseAnalysis } from '../services/rootCause/rootCauseClassifier';
import type { CustodyChainByNodeResponse } from '../hooks/useCustodyChainByNode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
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
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return String((fallback as { defaultValue: string }).defaultValue);
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockUser: { uid: string } | null = null;
let mockAnalyses: RootCauseAnalysis[] = [];
let mockCustody: {
  data: CustodyChainByNodeResponse | null;
  loading: boolean;
  error: Error | null;
};

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser }),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../services/rootCause/rootCauseStore', () => ({
  saveRootCauseAnalysis: vi.fn(),
  subscribeRootCauseAnalyses: (
    _projectId: string,
    onSnap: (list: RootCauseAnalysis[]) => void,
  ) => {
    onSnap(mockAnalyses);
    return () => {};
  },
}));
vi.mock('../hooks/useCustodyChainByNode', () => ({
  useCustodyChainByNode: () => ({ ...mockCustody, refetch: vi.fn() }),
}));

const INCIDENT_ID = 'inc-2026-05-22-001';
const HASH = 'a'.repeat(64);

function analysis(): RootCauseAnalysis {
  return {
    incidentId: INCIDENT_ID,
    factors: ['falla_supervision'],
    primaryFactor: 'falla_supervision',
    fiveWhys: ['El andamio no tenía baranda en el nivel 3.'],
    analyzedByUid: 'sup-1',
    analyzedAt: '2026-05-22T12:00:00.000Z',
    suggestedActions: ['Instalar baranda permanente.'],
  };
}

function custodyResponse(): CustodyChainByNodeResponse {
  return {
    chains: [
      {
        artifact: {
          id: HASH,
          kind: 'photo',
          mimeType: 'image/jpeg',
          byteSize: 204800,
          uploadedByUid: 'sup-1',
          uploadedAt: '2026-05-22T10:00:00.000Z',
          linkedNodeId: INCIDENT_ID,
        },
        events: [
          {
            artifactHash: HASH,
            eventKind: 'upload',
            actorUid: 'sup-1',
            actorRole: 'supervisor',
            at: '2026-05-22T10:00:00.000Z',
          },
          {
            artifactHash: HASH,
            eventKind: 'access',
            actorUid: 'aud-1',
            actorRole: 'auditor',
            at: '2026-05-22T11:00:00.000Z',
          },
        ],
        summary: {
          artifactHash: HASH,
          uploadedAt: '2026-05-22T10:00:00.000Z',
          totalEvents: 2,
          accessCount: 1,
          exportCount: 0,
          isReplaced: false,
          lastAccessByUid: 'aud-1',
        },
      },
    ],
  };
}

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  mockUser = { uid: 'sup-1' };
  mockAnalyses = [analysis()];
  mockCustody = { data: null, loading: false, error: null };
});

describe('<RootCauseInvestigation /> custody chain wiring', () => {
  it('renders the real CustodyChainTimelineCard for the incident evidence', () => {
    mockCustody = { data: custodyResponse(), loading: false, error: null };
    render(<RootCauseInvestigation />);

    // The selected analysis is auto-selected (most recent), so its detail pane
    // is shown with the custody section.
    expect(screen.getByTestId('root-cause-custody')).toBeInTheDocument();
    expect(screen.getByTestId('root-cause-custody-chains')).toBeInTheDocument();

    // The REAL card renders with the artifact's unique hash-scoped testids,
    // proving real artifact + event data flowed through (not an empty shell).
    expect(screen.getByTestId(`custody-chain-${HASH}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custody-timeline-${HASH}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custody-event-${HASH}-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`custody-event-${HASH}-1`)).toBeInTheDocument();
  });

  it('shows the honest empty-state when the incident has no linked evidence', () => {
    mockCustody = { data: { chains: [] }, loading: false, error: null };
    render(<RootCauseInvestigation />);

    expect(screen.getByTestId('root-cause-custody-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('root-cause-custody-chains')).not.toBeInTheDocument();
  });

  it('shows a loading state while the custody chain is fetching', () => {
    mockCustody = { data: null, loading: true, error: null };
    render(<RootCauseInvestigation />);

    expect(screen.getByTestId('root-cause-custody-loading')).toBeInTheDocument();
  });
});
