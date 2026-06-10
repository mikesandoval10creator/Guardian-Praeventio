// SPDX-License-Identifier: MIT
// AUDIT-2026-06 B19 — graceful shutdown helper.
//
// The previous SIGTERM handler unsubscribed the Firestore listeners and
// then called `process.exit(0)` IMMEDIATELY — in-flight HTTP requests were
// killed mid-response on every Cloud Run revision rollover (Cloud Run
// sends SIGTERM ~10s before SIGKILL). This helper:
//
//   1. runs the cleanup callbacks (best-effort — one throwing cleanup
//      never blocks the rest),
//   2. calls `server.close()` so the listener stops accepting new
//      connections and in-flight requests drain,
//   3. exits 0 when drained, or exits anyway after `timeoutMs` (default
//      8s — inside Cloud Run's ~10s SIGTERM→SIGKILL budget) so a hung
//      keep-alive socket can't turn a rolling deploy into a SIGKILL.
//
// DI-shaped (server/exit/log injectable) so the drain semantics are unit
// tested without binding a real port.

export interface ClosableServer {
  close(cb?: (err?: Error) => void): unknown;
}

export interface GracefulShutdownDeps {
  /** The handle returned by `app.listen()`. Null when not yet listening. */
  server: ClosableServer | null;
  /** Listener/interval teardowns. Errors are logged and swallowed. */
  cleanups: Array<() => unknown>;
  /** Injectable for tests; defaults to process.exit. */
  exit?: (code: number) => void;
  /** Drain budget before forcing exit. Default 8000ms. */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export function gracefulShutdown(deps: GracefulShutdownDeps): void {
  const {
    server,
    cleanups,
    exit = (code: number) => process.exit(code),
    timeoutMs = 8000,
    log = (msg: string) => console.warn(msg),
  } = deps;

  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (err) {
      log(`[shutdown] cleanup failed (continuing): ${String(err)}`);
    }
  }

  let exited = false;
  const exitOnce = (code: number, reason: string) => {
    if (exited) return;
    exited = true;
    log(`[shutdown] exiting (${reason})`);
    exit(code);
  };

  if (!server) {
    exitOnce(0, 'no http server');
    return;
  }

  const timer = setTimeout(() => {
    exitOnce(0, `drain timeout after ${timeoutMs}ms`);
  }, timeoutMs);
  // Never keep the process alive just for the watchdog.
  timer.unref?.();

  server.close((err) => {
    clearTimeout(timer);
    if (err) log(`[shutdown] server.close error: ${String(err)}`);
    exitOnce(0, 'http server drained');
  });
}
