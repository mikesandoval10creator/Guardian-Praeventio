// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustodyChainTimelineCard } from './CustodyChainTimelineCard.js';
import type {
  EvidenceArtifact,
  CustodyEvent,
} from '../../services/evidenceChain/custodyChainService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const HASH = 'a'.repeat(64);

const artifact: EvidenceArtifact = {
  id: HASH,
  kind: 'photo',
  mimeType: 'image/jpeg',
  byteSize: 102400,
  uploadedByUid: 'u1',
  uploadedAt: '2026-05-10T10:00:00Z',
};

function ev(kind: CustodyEvent['eventKind'], at: string): CustodyEvent {
  return {
    artifactHash: HASH,
    eventKind: kind,
    actorUid: 'u2',
    actorRole: 'supervisor',
    at,
  };
}

describe('<CustodyChainTimelineCard />', () => {
  it('renderiza summary y timeline', () => {
    render(
      <CustodyChainTimelineCard
        artifact={artifact}
        events={[
          ev('upload', '2026-05-10T10:00:00Z'),
          ev('access', '2026-05-11T08:30:00Z'),
          ev('export', '2026-05-12T09:00:00Z'),
        ]}
      />,
    );
    expect(screen.getByTestId(`custody-chain-${HASH}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custody-event-${HASH}-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`custody-event-${HASH}-1`)).toBeInTheDocument();
  });

  it('flag replaced si artifact tiene replacedByHash', () => {
    const replaced: EvidenceArtifact = {
      ...artifact,
      replacedByHash: 'b'.repeat(64),
      replacedAt: '2026-05-12T11:00:00Z',
    };
    render(<CustodyChainTimelineCard artifact={replaced} events={[]} />);
    expect(screen.getByTestId(`custody-replaced-${HASH}`)).toBeInTheDocument();
  });

  it('cuenta accesos y exports en summary', () => {
    render(
      <CustodyChainTimelineCard
        artifact={artifact}
        events={[
          ev('access', '2026-05-11T08:30:00Z'),
          ev('access', '2026-05-11T10:00:00Z'),
          ev('export', '2026-05-12T09:00:00Z'),
        ]}
      />,
    );
    const card = screen.getByTestId(`custody-chain-${HASH}`);
    expect(card.textContent).toMatch(/Accesos[^0-9]*2/);
  });
});
