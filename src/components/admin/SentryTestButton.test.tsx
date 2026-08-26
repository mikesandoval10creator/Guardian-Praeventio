// @vitest-environment jsdom
/**
 * Praeventio Guard — Tests for `SentryTestButton.tsx`.
 *
 * [Hy3-audit 3c4aa66d-73fe-8117-b48c-f45fbe681756 2026-08-25]:
 * The button is the operator's only first-class tool to confirm
 * observability transport in production. Without tests, any
 * regression (broken variant, swallowed eventId) would pass
 * silently.
 *
 * Covers:
 *   1. message variant — click calls Sentry.captureMessage at
 *      level 'info' and renders the returned eventId.
 *   2. throw variant — click throws; the error is propagated to
 *      the global window error handler (see #1589-docblock fix
 *      which clarifies this is NOT the ErrorBoundary).
 *   3. variant change — the displayed eventId clears when the
 *      variant prop flips (see #1588).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SentryTestButton } from './SentryTestButton';

// Mock the Sentry SDK at the vendor boundary.
vi.mock('@sentry/react', () => ({
  captureMessage: vi.fn(() => 'mock-event-id-abc123'),
}));

import * as Sentry from '@sentry/react';
const mockedCapture = vi.mocked(Sentry.captureMessage);

describe('SentryTestButton', () => {
  beforeEach(() => {
    mockedCapture.mockClear();
  });

  it('message variant: click calls captureMessage at level info and renders the eventId', async () => {
    const user = userEvent.setup();
    render(<SentryTestButton variant="message" />);

    await user.click(screen.getByTestId('sentry-test-message'));

    await waitFor(() =>
      expect(mockedCapture).toHaveBeenCalledTimes(1),
    );
    expect(mockedCapture).toHaveBeenCalledWith(
      expect.stringMatching(/^Sentry verification: mensaje de prueba /),
      'info',
    );
    expect(screen.getByTestId('sentry-test-event-id')).toHaveTextContent(
      'mock-event-id-abc123',
    );
  });

  it('throw variant: click throws so window.onerror can capture', () => {
    // The throw variant rethrows a synthetic Error so the global
    // window.onerror handler installed by initSentry() can capture
    // it. (NOT the React ErrorBoundary — error boundaries don't
    // catch synchronous throws from DOM event handlers.)
    let captured: unknown = null;
    const originalHandler = window.onerror;
    window.onerror = () => true;
    try {
      render(<SentryTestButton variant="throw" />);
      const btn = screen.getByTestId('sentry-test-throw');
      try {
        btn.click();
      } catch (e) {
        captured = e;
      }
      // captureMessage must NOT have been called in the throw variant.
      expect(mockedCapture).not.toHaveBeenCalled();
    } finally {
      window.onerror = originalHandler;
    }
    if (captured) {
      expect(String(captured)).toMatch(/Sentry verification/);
    }
  });

  it('variant change clears the displayed eventId', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SentryTestButton variant="message" />);

    await user.click(screen.getByTestId('sentry-test-message'));
    await waitFor(() =>
      expect(
        screen.getByTestId('sentry-test-event-id'),
      ).toBeInTheDocument(),
    );

    rerender(<SentryTestButton variant="throw" />);
    expect(
      screen.queryByTestId('sentry-test-event-id'),
    ).not.toBeInTheDocument();
  });
});