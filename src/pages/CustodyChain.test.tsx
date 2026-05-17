// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.24 page wrapper smoke test.
//
// Cubre:
//   1. Empty state cuando no hay proyecto.
//   2. Empty cuando no hay artifacts.
//   3. Renderiza list + timeline cuando hay datos.
//   4. Click en otro artifact cambia el timeline.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustodyChain } from './CustodyChain';
import type {
  EvidenceArtifact,
  CustodyEvent,
} from '../services/evidenceChain/custodyChainService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
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
      return k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function artifact(over: Partial<EvidenceArtifact> = {}): EvidenceArtifact {
  return {
    id: 'abc123def456' + '0'.repeat(52),
    kind: 'photo',
    mimeType: 'image/jpeg',
    byteSize: 1024,
    uploadedByUid: 'user-1',
    uploadedAt: '2026-05-17T10:00:00Z',
    ...over,
  };
}

function event(over: Partial<CustodyEvent> = {}): CustodyEvent {
  return {
    artifactHash: 'abc123def456' + '0'.repeat(52),
    eventKind: 'upload',
    actorUid: 'user-1',
    actorRole: 'inspector',
    at: '2026-05-17T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
});

describe('<CustodyChain /> (Fase F.24)', () => {
  it('renderiza empty cuando no hay proyecto seleccionado', () => {
    render(<CustodyChain artifacts={[artifact()]} events={[event()]} />);
    expect(screen.getByTestId('custody-chain-page-empty')).toBeInTheDocument();
  });

  it('renderiza empty cuando no hay artifacts', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    render(<CustodyChain artifacts={[]} events={[]} />);
    expect(screen.getByTestId('custody-chain-empty-state')).toBeInTheDocument();
  });

  it('renderiza lista + timeline con datos', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    const a = artifact();
    const events: CustodyEvent[] = [
      event(),
      event({
        eventKind: 'access',
        actorUid: 'user-2',
        actorRole: 'auditor',
        at: '2026-05-17T11:00:00Z',
      }),
      event({
        eventKind: 'export',
        actorUid: 'user-2',
        actorRole: 'auditor',
        at: '2026-05-17T12:00:00Z',
        notes: 'exported to PDF',
      }),
    ];
    render(<CustodyChain artifacts={[a]} events={events} />);
    expect(screen.getByTestId('custody-chain-page')).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-list')).toBeInTheDocument();
    expect(screen.getByTestId(`custody-chain-item-${a.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-events')).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-event-0')).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-event-1')).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-event-2')).toBeInTheDocument();
    expect(screen.getByTestId('custody-chain-summary')).toBeInTheDocument();
  });

  it('cambia de artifact al click', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    const a1 = artifact({ id: 'a'.repeat(64), kind: 'photo' });
    const a2 = artifact({ id: 'b'.repeat(64), kind: 'document_pdf' });
    const events: CustodyEvent[] = [
      event({ artifactHash: a1.id }),
      event({ artifactHash: a2.id, eventKind: 'access', actorUid: 'u2', actorRole: 'mgr' }),
    ];
    render(<CustodyChain artifacts={[a1, a2]} events={events} />);
    // Por defecto se selecciona el primero.
    expect(screen.getByTestId('custody-chain-detail-hash')).toHaveTextContent(a1.id);
    // Click en a2.
    fireEvent.click(screen.getByTestId(`custody-chain-item-${a2.id}`));
    expect(screen.getByTestId('custody-chain-detail-hash')).toHaveTextContent(a2.id);
  });

  it('muestra chip offline', () => {
    mockSelectedProject = { id: 'p1', name: 'Norte' };
    mockIsOnline = false;
    render(<CustodyChain artifacts={[]} events={[]} />);
    expect(screen.getByTestId('custody-chain-offline-chip')).toBeInTheDocument();
  });
});
