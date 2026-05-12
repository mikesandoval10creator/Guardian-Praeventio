// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentHygienePanel } from './DocumentHygienePanel.js';
import type { DocumentRecord } from '../../services/documentHygiene/documentHygieneEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function doc(over: Partial<DocumentRecord> & { id: string }): DocumentRecord {
  return {
    id: over.id,
    title: over.title ?? 'Test',
    kind: 'procedure',
    version: 'v1',
    updatedAt: over.updatedAt ?? '2026-05-01T00:00:00Z',
    hasValidSignature: over.hasValidSignature ?? true,
    accessCount90d: over.accessCount90d ?? 10,
    readReceiptCount: over.readReceiptCount ?? 5,
    referencesNorm: over.referencesNorm ?? true,
    isLinkedToOperations: over.isLinkedToOperations ?? true,
    authorUid: 'a1',
  };
}

describe('<DocumentHygienePanel />', () => {
  it('counters muestran 0 si todo OK', () => {
    render(<DocumentHygienePanel documents={[doc({ id: 'a' })]} />);
    expect(screen.getByTestId('doc-unused-count').textContent).toMatch(/0/);
  });

  it('detecta ghost docs', () => {
    render(
      <DocumentHygienePanel
        documents={[
          doc({ id: 'g', isLinkedToOperations: false, readReceiptCount: 0, accessCount90d: 0 }),
        ]}
      />,
    );
    expect(screen.getByTestId('doc-ghost-list')).toBeInTheDocument();
    expect(screen.getByTestId('doc-ghost-g')).toBeInTheDocument();
  });

  it('onReview dispara para ghost', () => {
    const onReview = vi.fn();
    render(
      <DocumentHygienePanel
        documents={[
          doc({ id: 'g', isLinkedToOperations: false, readReceiptCount: 0, accessCount90d: 0 }),
        ]}
        onReview={onReview}
      />,
    );
    fireEvent.click(screen.getByTestId('doc-review-g'));
    expect(onReview).toHaveBeenCalledWith('g');
  });
});
