// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentReadConfirmCard } from './DocumentReadConfirmCard.js';
import type {
  DocumentForRead,
  ReadReceipt,
} from '../../services/readReceipts/readReceiptService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T10:00:00Z');

const doc: DocumentForRead = {
  id: 'doc-1',
  version: 2,
  title: 'Procedimiento trabajo en altura',
  audience: { allWorkers: true },
  publishedAt: '2026-05-01T00:00:00Z',
  readDeadlineDays: 7,
};

function receipt(over: Partial<ReadReceipt> = {}): ReadReceipt {
  return {
    documentId: 'doc-1',
    documentVersion: 2,
    workerUid: 'w-self',
    acknowledgedAt: null,
    deadlineAt: '2026-05-08T00:00:00Z', // pasado vs NOW => overdue
    status: 'pending',
    ...over,
  };
}

describe('<DocumentReadConfirmCard />', () => {
  it('renderiza summary con totales', () => {
    const receipts: ReadReceipt[] = [
      receipt({ workerUid: 'w1', acknowledgedAt: '2026-05-05T00:00:00Z' }),
      receipt({ workerUid: 'w2' }),
      receipt({ workerUid: 'w3' }),
    ];
    render(<DocumentReadConfirmCard doc={doc} receipts={receipts} now={NOW} />);
    expect(screen.getByTestId('read-receipt-card')).toBeInTheDocument();
    expect(screen.getByTestId('read-receipt-doc-title')).toHaveTextContent(
      'Procedimiento trabajo en altura',
    );
    expect(screen.getByTestId('rr-total')).toHaveTextContent('3');
    expect(screen.getByTestId('rr-ack')).toHaveTextContent('1');
  });

  it('muestra estado overdue propio del worker actual', () => {
    const receipts: ReadReceipt[] = [receipt({ workerUid: 'w-self' })];
    render(
      <DocumentReadConfirmCard
        doc={doc}
        receipts={receipts}
        currentWorkerUid="w-self"
        now={NOW}
      />,
    );
    expect(screen.getByTestId('rr-self-status-overdue')).toBeInTheDocument();
  });

  it('dispara onAcknowledge cuando worker confirma', () => {
    const onAcknowledge = vi.fn();
    const receipts: ReadReceipt[] = [
      receipt({
        workerUid: 'w-self',
        deadlineAt: '2026-06-01T00:00:00Z', // pending (futuro)
      }),
    ];
    render(
      <DocumentReadConfirmCard
        doc={doc}
        receipts={receipts}
        currentWorkerUid="w-self"
        onAcknowledge={onAcknowledge}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('rr-acknowledge'));
    expect(onAcknowledge).toHaveBeenCalled();
  });

  it('no muestra botón si ya está acknowledged', () => {
    const onAcknowledge = vi.fn();
    const receipts: ReadReceipt[] = [
      receipt({
        workerUid: 'w-self',
        acknowledgedAt: '2026-05-05T00:00:00Z',
      }),
    ];
    render(
      <DocumentReadConfirmCard
        doc={doc}
        receipts={receipts}
        currentWorkerUid="w-self"
        onAcknowledge={onAcknowledge}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('rr-self-status-acknowledged')).toBeInTheDocument();
    expect(screen.queryByTestId('rr-acknowledge')).toBeNull();
  });

  it('muestra coverage 100 cuando no hay audiencia', () => {
    render(<DocumentReadConfirmCard doc={doc} receipts={[]} now={NOW} />);
    expect(screen.getByTestId('rr-coverage')).toHaveTextContent('100');
  });
});
