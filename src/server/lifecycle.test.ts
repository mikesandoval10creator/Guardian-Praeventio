// SPDX-License-Identifier: MIT
// AUDIT-2026-06 B19 — tests for the graceful-shutdown drain semantics.
// The bug being pinned: the old SIGTERM handler called process.exit(0)
// without server.close(), killing in-flight requests on every Cloud Run
// revision rollover.

import { describe, it, expect, vi } from 'vitest';
import { gracefulShutdown, type ClosableServer } from './lifecycle';

function makeServer(behavior: 'immediate' | 'hang' | 'error'): ClosableServer & {
  closeCalls: number;
} {
  const s = {
    closeCalls: 0,
    close(cb?: (err?: Error) => void) {
      s.closeCalls += 1;
      if (behavior === 'immediate') cb?.();
      if (behavior === 'error') cb?.(new Error('not listening'));
      // 'hang': never calls back (stuck keep-alive sockets)
      return s;
    },
  };
  return s;
}

describe('gracefulShutdown', () => {
  it('runs cleanups, drains the server, exits 0 exactly once', () => {
    const exit = vi.fn();
    const cleanup = vi.fn();
    const server = makeServer('immediate');
    gracefulShutdown({ server, cleanups: [cleanup], exit, log: () => {} });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(server.closeCalls).toBe(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('a throwing cleanup never blocks the drain (best-effort)', () => {
    const exit = vi.fn();
    const second = vi.fn();
    gracefulShutdown({
      server: makeServer('immediate'),
      cleanups: [
        () => {
          throw new Error('listener already gone');
        },
        second,
      ],
      exit,
      log: () => {},
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('forces exit after the drain budget when sockets hang', () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      gracefulShutdown({
        server: makeServer('hang'),
        cleanups: [],
        exit,
        timeoutMs: 5000,
        log: () => {},
      });
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5001);
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still exits 0 when close reports an error (already not listening)', () => {
    const exit = vi.fn();
    gracefulShutdown({
      server: makeServer('error'),
      cleanups: [],
      exit,
      log: () => {},
    });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits immediately when there is no server handle yet', () => {
    const exit = vi.fn();
    gracefulShutdown({ server: null, cleanups: [], exit, log: () => {} });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
