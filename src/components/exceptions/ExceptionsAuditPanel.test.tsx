// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExceptionsAuditPanel } from './ExceptionsAuditPanel.js';
import type { ExceptionRecord } from '../../services/exceptions/exceptionEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T12:00:00Z');

function ex(over: Partial<ExceptionRecord> = {}): ExceptionRecord {
  return {
    id: 'e1',
    domain: 'training_gap',
    subjectRef: { kind: 'WORKER', id: 'w1' },
    reason: 'Falta curso altura R1, supervisor presente',
    alternativeMitigation: 'Supervisor directo durante toda la jornada',
    approvedByUid: 'sup1',
    approvedByRole: 'supervisor',
    approvedAt: '2026-05-12T08:00:00Z',
    validUntil: '2026-05-13T08:00:00Z',
    status: 'active',
    ...over,
  };
}

describe('<ExceptionsAuditPanel />', () => {
  it('renderiza summary 4 stats', () => {
    render(
      <ExceptionsAuditPanel
        records={[ex(), ex({ id: 'e2', domain: 'epp_expired' })]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('exceptions-audit-panel')).toBeInTheDocument();
    expect(screen.getByTestId('exceptions-active').textContent).toMatch(/2/);
  });

  it('agrupa por dominio', () => {
    render(
      <ExceptionsAuditPanel
        records={[
          ex(),
          ex({ id: 'e2', domain: 'epp_expired' }),
          ex({ id: 'e3', domain: 'epp_expired' }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('exceptions-domain-training_gap').textContent).toMatch(/1/);
    expect(screen.getByTestId('exceptions-domain-epp_expired').textContent).toMatch(/2/);
  });

  it('dispara onRevoke', () => {
    const onRev = vi.fn();
    render(<ExceptionsAuditPanel records={[ex()]} now={NOW} onRevoke={onRev} />);
    fireEvent.click(screen.getByTestId('exceptions-revoke-e1'));
    expect(onRev).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('empty state si sin records', () => {
    render(<ExceptionsAuditPanel records={[]} now={NOW} />);
    expect(screen.getByTestId('exceptions-list').textContent).toMatch(/Sin excepciones/);
  });
});
