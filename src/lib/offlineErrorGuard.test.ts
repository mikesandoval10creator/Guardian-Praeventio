// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  isBenignOfflineReadRejection,
  installOfflineRejectionGuard,
} from './offlineErrorGuard';

describe('isBenignOfflineReadRejection', () => {
  it('matches the Firestore "client is offline" read rejection', () => {
    expect(
      isBenignOfflineReadRejection({
        message: 'Failed to get document because the client is offline.',
        code: 'unavailable',
      }),
    ).toBe(true);
  });

  it('does NOT match genuine faults (incl. a real online "unavailable")', () => {
    expect(isBenignOfflineReadRejection(new Error('permission-denied'))).toBe(false);
    // A real server outage while ONLINE carries a different message — must NOT
    // be suppressed even though its code is also 'unavailable'.
    expect(
      isBenignOfflineReadRejection({ message: 'The service is currently unavailable.', code: 'unavailable' }),
    ).toBe(false);
  });

  it('is safe for non-error / message-less reasons', () => {
    expect(isBenignOfflineReadRejection(undefined)).toBe(false);
    expect(isBenignOfflineReadRejection(null)).toBe(false);
    expect(isBenignOfflineReadRejection('client is offline')).toBe(false); // string, no .message
    expect(isBenignOfflineReadRejection({ code: 'unavailable' })).toBe(false); // no message
  });
});

describe('installOfflineRejectionGuard', () => {
  function fireUnhandled(reason: unknown) {
    const ev = new Event('unhandledrejection', { cancelable: true }) as Event & { reason?: unknown };
    ev.reason = reason;
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    const stopImmediate = vi.spyOn(ev, 'stopImmediatePropagation');
    window.dispatchEvent(ev);
    return { preventDefault, stopImmediate };
  }

  it('neutralises the benign offline read rejection and reports its code', () => {
    const onSuppress = vi.fn();
    installOfflineRejectionGuard(onSuppress);
    const { preventDefault, stopImmediate } = fireUnhandled({
      message: 'Failed to get document because the client is offline.',
      code: 'unavailable',
    });
    // stopImmediatePropagation guarantees only the first matching listener acts,
    // so preventDefault fires exactly once even if the guard is installed twice.
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopImmediate).toHaveBeenCalledOnce();
    expect(onSuppress).toHaveBeenCalledWith('unavailable');
  });

  it('leaves a genuine rejection untouched (still reported as an error)', () => {
    const onSuppress = vi.fn();
    installOfflineRejectionGuard(onSuppress);
    const { preventDefault, stopImmediate } = fireUnhandled(new Error('permission-denied'));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopImmediate).not.toHaveBeenCalled();
    expect(onSuppress).not.toHaveBeenCalled();
  });
});
