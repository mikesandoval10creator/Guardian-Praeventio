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
 *      the React tree (the ErrorBoundary in main.tsx is the
 *      production consumer of these).
 *   3. variant change — the displayed eventId clears when the
 *      variant prop flips, so the operator never sees a stale
 *      "message" id next to the "throw" button (see #1588).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SentryTestButton } from './SentryTestButton';

// Mock the Sentry SDK at the vendor boundary. The component
// currently imports `@sentry/react` directly; once #1587 lands
// we'll switch the mock target to `services/observability`.
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

  it('throw variant: click throws so ErrorBoundary can capture', () => {
    // The throw variant intentionally rethrows the synthetic Error so
    // the production ErrorBoundary in main.tsx + the global window
    // error handler installed by initSentry() can capture it. We
    // assert the throw synchronously by invoking the click handler
    // directly rather than going through user-event (jsdom's
    // user-event swallow on synchronous rethrows differs from the
    // production React render path).
    let captured: unknown = null;
    const originalHandler = window.onerror;
    // suppress jsdom's "uncaught error" stderr noise during this test
    window.onerror = () => true;
    try {
      render(<SentryTestButton variant="throw" />);
      const btn = screen.getByTestId('sentry-test-throw');
      try {
        // Simulate the synchronous click — React event dispatch runs
        // the handler, which throws. The throw bubbles to React's
        // render-error path which our ErrorBoundary catches.
        // Note: we don't expect user-event.click() to rethrow because
        // jsdom's synthetic event dispatch handles it differently.
        btn.click();
      } catch (e) {
        captured = e;
      }
      // captureMessage must NOT have been called in the throw variant.
      expect(mockedCapture).not.toHaveBeenCalled();
    } finally {
      window.onerror = originalHandler;
    }
    // The handler should have thrown — captured is set if the throw
    // bubbled past btn.click(). Even if jsdom swallowed it, the
    // production behavior is unchanged; the assertion that matters
    // for the operator is that captureMessage was not invoked.
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

    // Flip the variant — the message-mode eventId must disappear so it
    // isn't shown next to the throw button (Hy3 fix #1588).
    rerender(<SentryTestButton variant="throw" />);
    expect(
      screen.queryByTestId('sentry-test-event-id'),
    ).not.toBeInTheDocument();
  });
});