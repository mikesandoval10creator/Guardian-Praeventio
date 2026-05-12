import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Centralized route-scope error capture helper.
 *
 * Bridges the legacy `{endpoint, ...extras}` call-site shape used across
 * server routes to the `ErrorContext` shape that
 * `services/observability/sentryAdapter.ts` actually forwards
 * (it reads only `tags`, `extra`, `userId`).
 *
 * Previously each route defined its own local helper that passed
 * `{endpoint, ...extra}` as top-level properties of `ErrorContext`, so
 * `endpoint`, `callerUid`, `tenantId`, `projectId` were silently dropped
 * by the adapter (Codex P2 finding on PR #91).
 *
 * Scalar values (string/number/boolean) become Sentry `tags` (so they are
 * searchable in the issue list). Non-scalar values become `extra` (only
 * visible inside the issue detail). `null`/`undefined` are dropped.
 */
export function captureRouteError(
  err: unknown,
  endpoint: string,
  extras: Record<string, unknown> = {},
): void {
  try {
    const tags: Record<string, string> = { endpoint };
    const extra: Record<string, unknown> = {};
    let userId: string | undefined;
    let tenantId: string | undefined;
    for (const [k, v] of Object.entries(extras)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        tags[k] = String(v);
        if (k === 'callerUid' || k === 'userId') userId = String(v);
        if (k === 'tenantId') tenantId = String(v);
      } else {
        extra[k] = v;
      }
    }
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      {
        endpoint,
        userId,
        tenantId,
        tags,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      },
    );
  } catch (e) {
    logger.warn?.('observability.capture_failed', { err: String(e), endpoint });
  }
}
