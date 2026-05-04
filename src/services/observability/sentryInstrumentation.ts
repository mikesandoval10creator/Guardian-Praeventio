// Praeventio Guard — Sentry instrumentation helper.
//
// Sprint 20 third wave (Bucket Mu, Fase 2).
//
// `sentryAdapter.ts` already wraps `Sentry.init`/`captureException`/etc.
// behind our internal `ErrorTrackingAdapter` shape, but it was designed
// for top-level boot wiring. The OBSERVABILITY backlog asked for a
// per-service helper that:
//
//   • Tags every captured exception with `module=<service-name>` so an
//     operator scanning Sentry's issue list can filter by service.
//   • Attaches a structured `context` payload (the inputs to the failing
//     call, sanitised) so the issue page shows useful triage data
//     without needing source-map round-trips.
//   • Defensively swallows any Sentry SDK fault — observability MUST NOT
//     take down a healthy request path. If the SDK's `withScope` throws,
//     we still re-throw the ORIGINAL error so the caller's try/catch /
//     control flow is untouched.
//
// This is a thin wrapper around `@sentry/core`'s `withScope` rather than
// going through `getErrorTracker()` because:
//   1. The four target services (geminiBackend, webpayAdapter,
//      predictionBackend, writeNode) are imported BOTH server-side (Express
//      routes) AND client-side (React calls back to those endpoints with
//      shared types). Using `@sentry/core` keeps the helper browser-safe so
//      Vite doesn't drag the full Node-only Sentry+OpenTelemetry tree into
//      the frontend bundle.
//   2. `withScope` + `captureException` live in `@sentry/core` and are
//      re-exported by both `@sentry/node` (server) and `@sentry/react`
//      (browser). Whichever SDK is initialised at boot picks them up.
//   3. The adapter abstraction shines for boot/init; for per-call scope
//      tagging the SDK's `withScope` is the canonical surface and our
//      tests can mock the core API directly.
//
// PII NOTE: callers are responsible for sanitising the `context` payload.
// Do NOT pass raw user input, prompts, or PII. Pass the LLM `action`,
// projectId-prefixed shape, or counts — never the raw `prompt` string.

import * as Sentry from '@sentry/core';

/** Module identifier — fixed enum to keep cardinality bounded in Sentry. */
export type ObservabilityModule =
  | 'gemini'
  | 'webpay'
  | 'khipu'
  | 'prediction'
  | 'zettelkasten';

/** Free-form structured context shown on the Sentry issue page. */
export type SentryContextPayload = Record<string, unknown>;

/**
 * Run an async function inside a Sentry scope tagged with `module=<module>`
 * and a `context` blob describing the call's inputs.
 *
 * Behavior:
 *   • If `fn` throws, `captureException` fires with the scope set, then
 *     the original error is re-thrown so the caller's control flow is
 *     unchanged.
 *   • If the Sentry SDK itself throws (init not yet called, network blip,
 *     etc.) the wrapper still re-throws the ORIGINAL business error.
 *     Observability faults must never mask the real failure.
 *   • If `fn` resolves, the scope tag and context are NOT leaked to
 *     subsequent unrelated events — `withScope` automatically pops on
 *     exit per the Sentry SDK contract.
 *
 * Usage:
 *
 *   return withSentryScope(
 *     'gemini',
 *     { action: 'analyzeRiskWithAI', industry },
 *     async () => {
 *       // existing logic — no other changes needed
 *     },
 *   );
 */
export async function withSentryScope<T>(
  module: ObservabilityModule,
  context: SentryContextPayload,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await Sentry.withScope(async (scope) => {
      try {
        scope.setTag('module', module);
        scope.setContext('input', sanitizeContext(context));
      } catch {
        /* never let scope setup faults change control flow */
      }
      try {
        return await fn();
      } catch (err) {
        try {
          Sentry.captureException(err, { level: 'error' });
        } catch {
          /* observability faults must not mask the real error */
        }
        throw err;
      }
    });
  } catch (err) {
    // `withScope` itself can throw if Sentry isn't initialised (rare);
    // run the function plainly so we don't break callers in dev/CI.
    if (isSentrySetupError(err)) {
      return fn();
    }
    throw err;
  }
}

/**
 * Synchronous variant. Same semantics; for paths that aren't async (e.g.
 * mapping helpers in webpayAdapter that throw before any await).
 */
export function withSentryScopeSync<T>(
  module: ObservabilityModule,
  context: SentryContextPayload,
  fn: () => T,
): T {
  try {
    return Sentry.withScope((scope) => {
      try {
        scope.setTag('module', module);
        scope.setContext('input', sanitizeContext(context));
      } catch {
        /* swallow */
      }
      try {
        return fn();
      } catch (err) {
        try {
          Sentry.captureException(err, { level: 'error' });
        } catch {
          /* swallow */
        }
        throw err;
      }
    });
  } catch (err) {
    if (isSentrySetupError(err)) {
      return fn();
    }
    throw err;
  }
}

/**
 * Strip obviously-PII keys from a context payload before it leaves the
 * process. Centralised here so adding a new sensitive key (e.g.
 * `apiKey`) is a one-liner. The mutation is non-destructive — we return
 * a fresh shallow copy.
 */
// EXPORTED for the parametric REDACT_KEYS test (15th wave Bucket A — close
// Stryker mutant gaps from the 14th wave baseline). Each StringLiteral here
// was a surviving mutant; per-key tests need to enumerate this set directly
// rather than hardcoding a duplicate list that could drift from the source.
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'token',
  'apiKey',
  'api_key',
  'sessionId',
  'session',
  'password',
  'prompt',
  'rawPrompt',
  'userInput',
]);

// EXPORTED for direct unit testing — the 14th wave Stryker baseline showed
// 11 surviving StringLiteral mutants on REDACT_KEYS that were unreachable
// through `withSentryScope` alone (mock plumbing made per-key assertions
// fragile). Exposing the pure function lets the parametric test cover all
// 11 keys + a non-listed control with one round-trip per key.
export function sanitizeContext(ctx: SentryContextPayload): SentryContextPayload {
  const out: SentryContextPayload = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Heuristic — detect "Sentry isn't initialised" / "withScope unavailable"
 * style errors so callers can fall through to plain `fn()` execution.
 * Production with a real DSN never hits this branch.
 */
function isSentrySetupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('sentry') ||
    msg.includes('hub') ||
    msg.includes('not initialized')
  );
}
