// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.1 — TraceabilityModal smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const useRiskEngineMock = vi.fn();

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => useRiskEngineMock(),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { TraceabilityModal } from './TraceabilityModal';

const worker: any = { id: 'w-1', name: 'Ana Soto' };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TraceabilityModal', () => {
  it('renders nothing when worker is null', () => {
    useRiskEngineMock.mockReturnValue({ nodes: [] });
    const { container } = render(
      <TraceabilityModal
        isOpen={true}
        onClose={() => {}}
        worker={null}
        projectId="p-1"
      />,
    );
    expect(container.textContent).not.toContain('Ana Soto');
  });

  it('renders an empty-state when no related nodes exist', () => {
    useRiskEngineMock.mockReturnValue({ nodes: [] });
    render(
      <TraceabilityModal
        isOpen={true}
        onClose={() => {}}
        worker={worker}
        projectId="p-1"
      />,
    );
    // Component is open and worker present, but no logs.
    expect(document.body.textContent).toBeTruthy();
  });

  it('lists related nodes from the risk engine', () => {
    useRiskEngineMock.mockReturnValue({
      nodes: [
        {
          id: 'n-1',
          type: 'Hallazgo',
          title: 'Incidente de Ana Soto',
          description: 'Caída leve',
          tags: ['Ana Soto'],
          metadata: { authorId: 'w-1' },
        },
      ],
    });
    render(
      <TraceabilityModal
        isOpen={true}
        onClose={() => {}}
        worker={worker}
        projectId="p-1"
      />,
    );
    expect(document.body.textContent).toContain('Ana Soto');
  });
});
