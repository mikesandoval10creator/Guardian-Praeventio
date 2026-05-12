// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FiveSAuditForm } from './FiveSAuditForm.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<FiveSAuditForm />', () => {
  it('renderiza las 5 dimensiones', () => {
    render(<FiveSAuditForm zoneId="zone1" onSubmit={vi.fn()} />);
    expect(screen.getByTestId('five-s-dim-seiri')).toBeInTheDocument();
    expect(screen.getByTestId('five-s-dim-seiton')).toBeInTheDocument();
    expect(screen.getByTestId('five-s-dim-seiso')).toBeInTheDocument();
    expect(screen.getByTestId('five-s-dim-seiketsu')).toBeInTheDocument();
    expect(screen.getByTestId('five-s-dim-shitsuke')).toBeInTheDocument();
  });

  it('submit envía report con score', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<FiveSAuditForm zoneId="zone1" onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByTestId('five-s-audit-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const report = onSubmit.mock.calls[0][0];
    expect(report.zoneId).toBe('zone1');
    expect(report.overallScore).toBe(0);
  });

  it('rating 2 en todos los items → overallScore 100', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<FiveSAuditForm zoneId="zone1" onSubmit={onSubmit} />);
    // Set all to rating 2
    const buttons = screen.queryAllByTestId(/^five-s-rating-.*-2$/);
    for (const btn of buttons) fireEvent.click(btn);
    fireEvent.submit(screen.getByTestId('five-s-audit-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].overallScore).toBe(100);
  });
});
