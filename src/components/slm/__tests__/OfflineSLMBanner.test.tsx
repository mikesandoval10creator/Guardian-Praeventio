// @vitest-environment jsdom
//
// Sprint 20 — Bucket Lambda — T-1.5 — OfflineSLMBanner tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { OfflineSLMBanner, SLM_SHOW_QUEUE_EVENT } from '../OfflineSLMBanner';

afterEach(() => {
  cleanup();
});

describe('OfflineSLMBanner', () => {
  it('renders the offline copy with status role + aria-live polite when forced visible', () => {
    render(<OfflineSLMBanner pendingCount={3} forceVisible />);

    const banner = screen.getByTestId('offline-slm-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    // Three-segment copy mentions queued consultations.
    expect(banner.textContent).toMatch(/Sin red/);
    expect(banner.textContent).toMatch(/3 consultas en cola/);
  });

  it('clamps negative pending counts to zero in the rendered copy', () => {
    render(<OfflineSLMBanner pendingCount={-7} forceVisible />);
    expect(screen.getByTestId('offline-slm-banner').textContent).toMatch(
      /0 consultas en cola/,
    );
  });

  it('dispatches the gp-slm-show-queue custom event when "Ver cola" is clicked', () => {
    const listener = vi.fn();
    window.addEventListener(SLM_SHOW_QUEUE_EVENT, listener as EventListener);
    render(<OfflineSLMBanner pendingCount={5} forceVisible />);

    fireEvent.click(screen.getByTestId('offline-slm-banner-show-queue'));
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent<{ pendingCount: number }>;
    expect(event.type).toBe(SLM_SHOW_QUEUE_EVENT);
    expect(event.detail.pendingCount).toBe(5);

    window.removeEventListener(SLM_SHOW_QUEUE_EVENT, listener as EventListener);
  });

  it('encodes the mode via data-mode for downstream styling assertions', () => {
    const { rerender } = render(
      <OfflineSLMBanner pendingCount={0} mode="driving" forceVisible />,
    );
    expect(screen.getByTestId('offline-slm-banner')).toHaveAttribute(
      'data-mode',
      'driving',
    );

    rerender(<OfflineSLMBanner pendingCount={0} mode="emergency" forceVisible />);
    expect(screen.getByTestId('offline-slm-banner')).toHaveAttribute(
      'data-mode',
      'emergency',
    );
  });
});
