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

// Mock the observability adapter facade BEFORE importing the component.
// [Refactor 2026-08-25] The button no longer imports @sentry/react
// directly (PR #1587 routed it through the ErrorTrackingAdapter
// facade). Tests must stub the facade, not the vendor SDK.
vi.mock('../../services/observability', () => ({
  getErrorTracker: vi.fn(),
}));

import { SentryTestButton } from './SentryTestButton';
import * as Observability from '../../services/observability';
const mockedTracker = vi.mocked(Observability.getErrorTracker);

describe('SentryTestButton', () => {
  let mockCaptureMessage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockCaptureMessage = vi.fn(() => 'mock-event-id-abc123');
    mockedTracker.mockReturnValue({
      captureMessage: mockCaptureMessage,
      captureException: vi.fn(),
      // other methods unused by this component
      ...(vi.fn().mockReturnThis() as unknown as Record<string, unknown>),
    } as unknown as ReturnType<typeof Observability.getErrorTracker>);
  });

  it('message variant: click calls captureMessage at level info and renders the eventId', async () => {
    const user = userEvent.setup();
    render(<SentryTestButton variant="message" />);

    await user.click(screen.getByTestId('sentry-test-message'));

    await waitFor(() =>
      expect(mockCaptureMessage).toHaveBeenCalledTimes(1),
    );
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^Sentry verification: mensaje de prueba /),
      'info',
    );
    expect(screen.getByTestId('sentry-test-event-id')).toHaveTextContent(
      'mock-event-id-abc123',
    );
  });

  it('throw variant: click triggers window.onerror (NOT ErrorBoundary)', async () => {
    // The throw variant rethrows a synthetic Error so the global
    // window.onerror handler installed by initSentry() can capture
    // it. (NOT the React ErrorBoundary — error boundaries don't
    // catch synchronous throws from DOM event handlers.)
    //
    // We use userEvent.click() inside a try/catch — the production
    // behavior is that window.onerror catches it AFTER React's
    // synchronous dispatch. The test asserts the same thing
    // happened here.
    const user = userEvent.setup();
    const onError = vi.fn();
    window.addEventListener('error', onError);
    try {
      render(<SentryTestButton variant="throw" />);
      // captureMessage must NOT have been called in the throw variant.
      expect(mockCaptureMessage).not.toHaveBeenCalled();

      // user-event re-throws synchronously through React's event
      // dispatch. We catch it here so the test runner doesn't see
      // it as an unhandled error.
      try {
        await user.click(screen.getByTestId('sentry-test-throw'));
      } catch {
        /* expected — see comment above */
      }

      // The onerror listener must have fired — that's how production
      // observability sees the verification event.
      expect(onError).toHaveBeenCalled();
      const [event] = onError.mock.calls[0];
      expect(String(event.message ?? event)).toMatch(/Sentry verification/);
    } finally {
      window.removeEventListener('error', onError);
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