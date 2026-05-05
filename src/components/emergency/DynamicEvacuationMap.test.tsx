// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — DynamicEvacuationMap smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({ nodes: [] }),
}));

vi.mock('../../services/geminiService', () => ({
  calculateDynamicEvacuationRoute: vi.fn(async () => null),
}));

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => undefined),
}));

vi.mock('./VectorialEvacuationMap', () => ({
  VectorialEvacuationMap: () =>
    React.createElement('div', { 'data-testid': 'vectorial-map' }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { DynamicEvacuationMap } from './DynamicEvacuationMap';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DynamicEvacuationMap', () => {
  it('renders the panel with the underlying VectorialEvacuationMap', () => {
    const { getByTestId } = render(<DynamicEvacuationMap />);
    expect(getByTestId('vectorial-map')).toBeInTheDocument();
  });

  it('does not crash when no emergency/risk nodes are available', () => {
    const { container } = render(<DynamicEvacuationMap />);
    // Container is non-empty (panel chrome rendered) and no thrown errors.
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('renders a way for the user to add a blocked area (input present)', () => {
    const { container } = render(<DynamicEvacuationMap />);
    // The component exposes an input or button to add a user-blocked area.
    const interactive =
      container.querySelector('input') || container.querySelector('button');
    expect(interactive).toBeTruthy();
  });
});
