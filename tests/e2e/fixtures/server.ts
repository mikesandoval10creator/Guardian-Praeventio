// Praeventio Guard — Sprint 19 / F-B02.
//
// Boots the Express server (`tsx server.ts`) as a child process with
// `E2E_MODE=1`, `NODE_ENV=test`, and a deterministic `E2E_TEST_SECRET`.
// The server listens on the port declared in env (`PORT`, defaulting to
// 3000); we wait for the existing `/health` endpoint to return 200 before
// resolving so Playwright tests don't race the boot.
//
// Production safety:
//   - server.ts itself owns the prod-vs-test guard (see verifyAuth.ts —
//     boot fails fast when NODE_ENV=production && E2E_MODE=1).
//   - This fixture is import-only by tests (paths under tests/e2e/),
//     never bundled into the runtime image.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export interface StartE2EServerOptions {
  /** TCP port the Express server will bind to. Defaults to 3000. */
  port?: number;
  /** Override the deterministic test secret. Use only when a spec needs to
   *  exercise the auth-rejection path with a wrong secret. */
  testSecret?: string;
  /** How long to wait for `/health` to respond 200 before giving up. */
  bootTimeoutMs?: number;
  /** Forwarded extra env vars (e.g. `FIRESTORE_EMULATOR_HOST`). */
  extraEnv?: Record<string, string>;
}

export interface RunningE2EServer {
  /** The port the server is listening on. */
  port: number;
  /** The shared E2E_TEST_SECRET (use to build E2E auth headers). */
  testSecret: string;
  /** Stop the server. Resolves once the child process exits. */
  stop: () => Promise<void>;
  /** Underlying child handle — use only if you need raw stdio access. */
  child: ChildProcessWithoutNullStreams;
}

const DEFAULT_TEST_SECRET = 'e2e-test-secret-do-not-use-in-prod';
const DEFAULT_PORT = 3000;
const DEFAULT_BOOT_TIMEOUT_MS = 60_000;

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = undefined;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }
  throw new Error(
    `Express server did not become healthy at ${url} within ${timeoutMs}ms (last: ${String(lastError)})`,
  );
}

/**
 * Boot the Express server in E2E mode and wait for `/health` to respond.
 *
 * Usage from a Playwright spec:
 *   const server = await startE2EServer();
 *   try {
 *     // tests run...
 *   } finally {
 *     await server.stop();
 *   }
 *
 * Or wire it as a Playwright fixture in `playwright.config.ts` so the
 * server's lifecycle matches the test run.
 */
export async function startE2EServer(
  options: StartE2EServerOptions = {},
): Promise<RunningE2EServer> {
  const port = options.port ?? DEFAULT_PORT;
  const testSecret = options.testSecret ?? DEFAULT_TEST_SECRET;
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    E2E_MODE: '1',
    E2E_TEST_SECRET: testSecret,
    PORT: String(port),
    ...options.extraEnv,
  };

  const child = spawn('npx', ['tsx', 'server.ts'], {
    env,
    cwd: process.cwd(),
    shell: true,
    stdio: 'pipe',
  }) as ChildProcessWithoutNullStreams;

  // Surface boot failures to the test runner — silence is the worst signal.
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[e2e-server] ${chunk.toString()}`);
  });

  await waitForHealth(`http://localhost:${port}/health`, bootTimeoutMs);

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      // Hard ceiling to avoid hanging the test runner if SIGTERM is ignored.
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5_000);
    });
  };

  return { port, testSecret, stop, child };
}
