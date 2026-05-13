// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InboxPrevencionistaPanel } from './InboxPrevencionistaPanel.js';
import type { InboxItem, InboxSummary } from '../../services/inbox/inboxAggregator.js';

function makeItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    kind: 'document_pending_approval',
    title: 'Aprobar PTS-001',
    description: 'Procedimiento subido por Juan G.',
    urgency: 'high',
    assignedToUid: 'prev-1',
    sourceRef: { collection: 'documents', docId: 'doc-1' },
    createdAt: '2026-05-12T10:00:00Z',
    dueAt: '2026-05-15T18:00:00Z',
    quickActions: [
      { kind: 'approve', label: 'Aprobar' },
      { kind: 'reject', label: 'Rechazar', needsConfirm: true },
    ],
    priorityScore: 70,
    ...over,
  };
}

function makeSummary(over: Partial<InboxSummary> = {}): InboxSummary {
  return {
    total: 1,
    byUrgency: { urgent: 0, high: 1, medium: 0, low: 0 },
    byKind: { document_pending_approval: 1 },
    overdueCount: 0,
    ...over,
  };
}

describe('InboxPrevencionistaPanel', () => {
  it('renderiza título + summary', () => {
    render(<InboxPrevencionistaPanel items={[makeItem()]} summary={makeSummary()} />);
    expect(screen.getByTestId('inbox.panel.title')).toHaveTextContent(/Bandeja/i);
    expect(screen.getByTestId('inbox.panel')).toBeInTheDocument();
  });

  it('estado vacío cuando no hay items activos', () => {
    render(
      <InboxPrevencionistaPanel
        items={[]}
        summary={{
          total: 0,
          byUrgency: { urgent: 0, high: 0, medium: 0, low: 0 },
          byKind: {},
          overdueCount: 0,
        }}
      />,
    );
    expect(screen.getByTestId('inbox.panel.empty')).toBeInTheDocument();
  });

  it('filtra items con dismissedAt', () => {
    const dismissed = makeItem({ id: 'd-1', dismissedAt: '2026-05-12T22:00:00Z' });
    const active = makeItem({ id: 'a-1' });
    render(<InboxPrevencionistaPanel items={[dismissed, active]} summary={makeSummary()} />);
    expect(screen.queryByTestId('inbox.item.d-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox.item.a-1')).toBeInTheDocument();
  });

  it('muestra badges de urgencia con count > 0 solamente', () => {
    const summary = makeSummary({
      total: 5,
      byUrgency: { urgent: 2, high: 1, medium: 0, low: 2 },
    });
    render(<InboxPrevencionistaPanel items={[makeItem()]} summary={summary} />);
    expect(screen.getByTestId('inbox.panel.urgency.urgent')).toHaveTextContent('2');
    expect(screen.getByTestId('inbox.panel.urgency.high')).toHaveTextContent('1');
    expect(screen.queryByTestId('inbox.panel.urgency.medium')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox.panel.urgency.low')).toHaveTextContent('2');
  });

  it('invoca onAction con el item y kind cuando se clickea quick action', () => {
    const onAction = vi.fn();
    render(
      <InboxPrevencionistaPanel
        items={[makeItem()]}
        summary={makeSummary()}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox.item.item-1.action.approve'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[1]).toBe('approve');
  });

  it('invoca onOpenDetail con el item', () => {
    const onOpenDetail = vi.fn();
    render(
      <InboxPrevencionistaPanel
        items={[makeItem()]}
        summary={makeSummary()}
        onOpenDetail={onOpenDetail}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox.item.item-1.open'));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail.mock.calls[0]?.[0].id).toBe('item-1');
  });

  it('attribute data-kind y data-urgency exponen estado al test runner', () => {
    render(
      <InboxPrevencionistaPanel
        items={[makeItem({ kind: 'sif_precursor_pending', urgency: 'urgent' })]}
        summary={makeSummary({ byUrgency: { urgent: 1, high: 0, medium: 0, low: 0 } })}
      />,
    );
    const item = screen.getByTestId('inbox.item.item-1');
    expect(item).toHaveAttribute('data-kind', 'sif_precursor_pending');
    expect(item).toHaveAttribute('data-urgency', 'urgent');
  });
});
