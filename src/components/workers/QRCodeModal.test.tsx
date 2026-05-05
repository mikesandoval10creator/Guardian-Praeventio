// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.1 — QRCodeModal smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) =>
    React.createElement('svg', { 'data-testid': 'qr', 'data-value': value }),
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { QRCodeModal } from './QRCodeModal';

const worker: any = {
  id: 'worker-12345abc',
  nodeId: 'node-zzz',
  name: 'Ana Soto',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QRCodeModal', () => {
  it('renders the QR with a public-node URL when worker has a nodeId', () => {
    render(<QRCodeModal isOpen={true} onClose={() => {}} worker={worker} />);
    const qr = screen.getByTestId('qr');
    expect(qr).toBeInTheDocument();
    expect(qr.getAttribute('data-value')).toMatch(/\/public\/node\/node-zzz$/);
  });

  it('renders nothing when worker is null', () => {
    const { container } = render(
      <QRCodeModal isOpen={true} onClose={() => {}} worker={null} />,
    );
    expect(container.querySelector('svg[data-testid="qr"]')).toBeNull();
  });
});
