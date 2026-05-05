// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Public health probe for Cloud Run / Marketplace listing health checks.
// Returns 200 + minimal payload when the server can talk to Firestore.
// Returns 503 when a critical dependency is unreachable.
//
// Mounted in server.ts AFTER helmet (so CSP headers apply) but BEFORE the
// /api/ rate limiter and verifyAuth — Cloud Run probes hit this endpoint
// frequently and without an auth token, so it must remain unauthenticated and
// unthrottled.
//
// Sprint 22 Bucket AA — added GET /api/health/deep, which fans out to the
// real downstream dependencies (Firestore, KMS, Gemini, Resend,
// Open-Meteo, photogrammetry worker) with a 2 s per-check timeout. Used
// by the ops dashboard / runbook investigations — Cloud Run liveness
// probe MUST stay on /api/health which is fast and side-effect-free.
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import { Router } from 'express';
import admin from 'firebase-admin';

const router = Router();

router.get('/health', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail' | 'skipped'> = {};
  let allOk = true;
  // Firestore reachability:
  try {
    await admin.firestore().listCollections(); // cheap admin op
    checks.firestore = 'ok';
  } catch {
    checks.firestore = 'fail';
    allOk = false;
  }
  // Add more checks as the deployment grows (Resend, Gemini, Webpay).
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION ?? 'dev',
    checks,
  });
});

// ─────────────────────────────────────────────────────────────────────
// /api/health/deep — full dependency fan-out.
//
// Each `check*` function returns `{ ok, latencyMs, [error] }`. Per-check
// timeout is 2000 ms. Concurrency: all checks fire in parallel via
// Promise.allSettled — one slow dep MUST NOT serialize the rest. The
// global response is 200 only when every required check passes; one
// failure flips the response to 503 even if everything else is healthy.
//
// Optional checks (photogrammetry worker) report `ok=true, skipped=true`
// when their config env vars are absent so we don't 503 in dev.
// ─────────────────────────────────────────────────────────────────────

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  skipped?: boolean;
  error?: string;
}

const TIMEOUT_MS = 2000;

class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

/** Reject the wrapped promise after `ms` milliseconds. EXPORTED for the
 *  test suite — the harness asserts both timeout precision and that the
 *  underlying promise's late resolution doesn't leak unhandled rejection
 *  warnings. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new TimeoutError());
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        resolve(v);
      },
      (err) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        reject(err);
      },
    );
  });
}

async function runCheck(fn: () => Promise<unknown>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await withTimeout(fn(), TIMEOUT_MS);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error:
        err instanceof TimeoutError
          ? `timeout_${TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

// ── Individual dependency probes. EXPORTED so tests can stub them
// individually via vi.mock + custom resolvers, instead of deep-mocking
// firebase-admin/fetch globally for every case.

export async function checkFirestore(): Promise<void> {
  // Read a single doc — same shape as a real query, exercises auth +
  // network. The doc need not exist; the .get() call is the probe.
  await admin.firestore().collection('_health').doc('ping').get();
}

export async function checkKms(): Promise<void> {
  // Lazy import — kmsAdapter pulls in `@google-cloud/kms` even when the
  // adapter resolves to in-memory-dev, and we want the deep-health code
  // to stay tree-shake-friendly for serverless cold starts on the
  // liveness probe path (which never imports this module).
  const mod = await import('../../services/security/kmsAdapter.js');
  // The adapter ships an `encrypt(plaintext: Buffer)` method on the
  // selected provider. We resolve the provider via the `getKmsAdapter`
  // factory if it exists, else fall back to a direct named export.
  // Either way we round-trip a tiny `ping` plaintext.
  const adapter = (mod as any).getKmsAdapter
    ? (mod as any).getKmsAdapter()
    : (mod as any).kmsAdapter ?? (mod as any).default;
  if (!adapter || typeof adapter.encrypt !== 'function') {
    throw new Error('kms_adapter_unavailable');
  }
  await adapter.encrypt(Buffer.from('ping'));
}

export async function checkGemini(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY_missing');
  }
  // Don't burn a real generation quota for a health probe — hit the
  // model list endpoint instead. It validates the API key against
  // Google's edge auth without consuming token budget.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS - 100);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}&pageSize=1`;
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`gemini_status_${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function checkResend(): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY_missing');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS - 100);
  try {
    // GET /domains validates the API key without sending email.
    const res = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: ctrl.signal,
    });
    if (!res.ok && res.status !== 401) {
      // 401 means the key is rejected — that's a fail too. We let it
      // fall through to the !ok branch via the strict equality above.
      throw new Error(`resend_status_${res.status}`);
    }
    if (res.status === 401) {
      throw new Error('resend_unauthorized');
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function checkOpenMeteo(): Promise<void> {
  // Open-Meteo is keyless and free-tier; we hit a stable lat/lng
  // (Santiago, CL) so the response is small and cacheable upstream.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS - 100);
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=-33.45&longitude=-70.66&current=temperature_2m';
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`open_meteo_status_${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPhotogrammetryWorker(): Promise<{ skipped: boolean }> {
  const url = process.env.PHOTOGRAMMETRY_WORKER_URL;
  if (!url) {
    return { skipped: true };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS - 100);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/healthz`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`photogrammetry_status_${res.status}`);
    }
    return { skipped: false };
  } finally {
    clearTimeout(timer);
  }
}

/** A probe returns either nothing (success) or `{ skipped: true }` when an
 *  optional dependency is unconfigured in the current environment. Throws
 *  on failure — the orchestrator wraps that into the `error` field. */
export type ProbeResult = void | { skipped: boolean };
export type Probe = () => Promise<ProbeResult>;

/** Resolver map. EXPORTED so the test harness can override individual
 *  probes (`{ ...defaults, gemini: customStub }`) instead of mocking
 *  network/firebase-admin globally. */
export const DEFAULT_PROBES: Record<string, Probe> = {
  firestore: checkFirestore,
  kms: checkKms,
  gemini: checkGemini,
  resend: checkResend,
  openMeteo: checkOpenMeteo,
  photogrammetry: checkPhotogrammetryWorker,
};

export type ProbeMap = Record<string, Probe>;

/** Run all checks in parallel and return the merged result. EXPORTED so
 *  tests can drive the orchestration directly without spinning up
 *  Express. */
export async function runDeepHealth(probes: ProbeMap = DEFAULT_PROBES) {
  const tasks: Promise<readonly [string, CheckResult]>[] = Object.entries(probes).map(
    async ([name, probe]) => {
    const started = Date.now();
    try {
      const out: ProbeResult = await withTimeout(
        Promise.resolve().then(() => probe()),
        TIMEOUT_MS,
      );
      // Photogrammetry probe returns { skipped: true } when not configured.
      if (out && typeof out === 'object' && (out as { skipped?: boolean }).skipped === true) {
        return [name, { ok: true, skipped: true, latencyMs: Date.now() - started }] as const;
      }
      return [name, { ok: true, latencyMs: Date.now() - started }] as const;
    } catch (err) {
      return [
        name,
        {
          ok: false,
          latencyMs: Date.now() - started,
          error:
            err instanceof TimeoutError
              ? `timeout_${TIMEOUT_MS}ms`
              : err instanceof Error
                ? err.message
                : String(err),
        },
      ] as const;
    }
  });
  const settled = await Promise.allSettled(tasks);
  const checks: Record<string, CheckResult> = {};
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const [name, result] = s.value;
      checks[name as string] = result;
    } else {
      // Should never happen — runCheck swallows errors. Defensive only.
      checks.unknown = {
        ok: false,
        latencyMs: 0,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    }
  }
  // A skipped optional check counts as healthy for the global verdict.
  const allHealthy = Object.values(checks).every((c) => c.ok);
  return { allHealthy, checks };
}

router.get('/health/deep', async (_req, res) => {
  const { allHealthy, checks } = await runDeepHealth();
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION ?? 'dev',
    checks,
  });
});

export default router;

// Re-export the probe error class for tests.
export { TimeoutError };
