// @vitest-environment jsdom
//
// OLA 1 (VIDA, 2026-06-14) — SosDeadLetterBanner. Pins that an undelivered SOS
// (dead-lettered after retries) is surfaced prominently with the in-person
// escalation instruction, and that acknowledging clears it and hides the banner.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OutboxEntry } from '../../services/emergency/sosOutbox';

const getMock = vi.fn();
const clearMock = vi.fn(async (_id: string) => undefined);
vi.mock('../../services/emergency/sosOutboxClient', () => ({
  getSosDeadLetters: () => getMock(),
  clearSosDeadLetter: (id: string) => clearMock(id),
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { SosDeadLetterBanner } from './SosDeadLetterBanner';

const entry = (id: string): OutboxEntry => ({
  event: { clientEventId: id, workerUid: 'w1', reason: 'manual_button', projectId: 'p1', occurredAt: '2026-06-14T00:00:00Z' },
  queuedAt: '2026-06-14T00:00:00Z',
  retryCount: 7,
  nextRetryAt: Number.POSITIVE_INFINITY,
  deadLettered: true,
});

beforeEach(() => {
  getMock.mockReset();
  clearMock.mockClear();
});

describe('SosDeadLetterBanner', () => {
  it('renders nothing when there are no dead-lettered SOS', async () => {
    getMock.mockResolvedValue([]);
    const { container } = render(<SosDeadLetterBanner />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('surfaces an undelivered SOS with the in-person escalation instruction', async () => {
    getMock.mockResolvedValue([entry('c1')]);
    render(<SosDeadLetterBanner />);
    await waitFor(() => expect(screen.getByText(/Tu alerta SOS NO salió/i)).toBeTruthy());
    expect(screen.getByText(/Avisa al supervisor presencialmente ahora/i)).toBeTruthy();
  });

  it('acknowledging clears the dead-letter and removes the banner', async () => {
    getMock.mockResolvedValueOnce([entry('c1')]).mockResolvedValue([]);
    render(<SosDeadLetterBanner />);
    await waitFor(() => expect(screen.getByText(/Ya avisé presencialmente/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/Ya avisé presencialmente/i));

    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText(/Tu alerta SOS NO salió/i)).toBeNull());
  });
});
