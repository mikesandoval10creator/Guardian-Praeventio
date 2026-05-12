// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocConfidenceCard } from './DocConfidenceCard.js';
import type { DocumentRecord } from '../../services/documentHygiene/documentHygieneEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'd1',
    title: 'Procedimiento Trabajo en Altura',
    kind: 'procedure',
    version: '1.0',
    approvedByUid: 'u1',
    approvedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    hasValidSignature: true,
    accessCount90d: 40,
    readReceiptCount: 25,
    referencesNorm: true,
    isLinkedToOperations: true,
    ...over,
  };
}

describe('<DocConfidenceCard />', () => {
  it('renderiza score y level high para doc completo', () => {
    render(<DocConfidenceCard document={doc()} nowIso="2026-05-12T00:00:00Z" />);
    expect(screen.getByTestId('doc-confidence-d1')).toBeInTheDocument();
    expect(screen.getByTestId('doc-confidence-level-d1').textContent).toBe('HIGH');
  });

  it('renderiza level low para doc sin firma y sin links', () => {
    render(
      <DocConfidenceCard
        document={doc({
          id: 'd2',
          approvedByUid: undefined,
          hasValidSignature: false,
          referencesNorm: false,
          isLinkedToOperations: false,
          accessCount90d: 0,
          readReceiptCount: 0,
        })}
        nowIso="2026-05-12T00:00:00Z"
      />,
    );
    expect(screen.getByTestId('doc-confidence-level-d2').textContent).toBe('LOW');
  });

  it('renderiza lista de factores', () => {
    render(<DocConfidenceCard document={doc()} nowIso="2026-05-12T00:00:00Z" />);
    expect(screen.getByTestId('doc-confidence-factors-d1')).toBeInTheDocument();
    expect(screen.getByTestId('doc-confidence-factor-d1-0')).toBeInTheDocument();
  });
});
