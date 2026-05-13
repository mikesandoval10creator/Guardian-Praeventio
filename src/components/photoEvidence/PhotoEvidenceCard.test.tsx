// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotoEvidenceCard } from './PhotoEvidenceCard.js';
import type { EvidenceArtifact } from '../../services/photoEvidence/photoEvidenceEngine.js';

const baseArtifact: EvidenceArtifact = {
  id: 'a'.repeat(64),
  mimeType: 'image/jpeg',
  byteSize: 1024 * 512,
  originalFilename: 'IMG_001.jpg',
  capturedAt: '2026-05-12T08:00:00Z',
  capturedByUid: 'u1',
  capturedLocation: { lat: -33.4489, lng: -70.6693 },
  linkages: [{ nodeKind: 'incident', nodeId: 'inc-42' }],
  registeredAt: '2026-05-12T08:01:00Z',
};

describe('<PhotoEvidenceCard />', () => {
  it('renderiza nombre, mime, tamaño y hash corto', () => {
    render(<PhotoEvidenceCard artifact={baseArtifact} />);
    expect(screen.getByTestId('photoEvidence.card.title')).toHaveTextContent('IMG_001.jpg');
    expect(screen.getByTestId('photoEvidence.card.mime')).toHaveTextContent('image/jpeg');
    expect(screen.getByTestId('photoEvidence.card.size').textContent).toMatch(/KB|MB/);
    expect(screen.getByTestId('photoEvidence.card.hash').textContent).toContain('aaaaaaaa');
  });

  it('muestra location y linkages cuando existen', () => {
    render(<PhotoEvidenceCard artifact={baseArtifact} />);
    expect(screen.getByTestId('photoEvidence.card.location').textContent).toContain('-33.4');
    expect(screen.getByTestId('photoEvidence.card.linkages').textContent).toContain('incident');
  });
});
