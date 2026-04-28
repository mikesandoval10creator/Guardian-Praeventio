/**
 * Google Fit adapter (DEPRECATED wrapper).
 *
 * @deprecated Google Fit REST API + OAuth scopes
 *   (`fitness.activity.read`, `fitness.heart_rate.read`, `fitness.body.read`)
 *   are sunsetting in 2026 and Google closed new sign-ups on **2024-05-01**.
 *   New work MUST target the `health-connect` adapter; remove this file once
 *   `healthConnectAdapter.isAvailable` is `true` on all supported platforms.
 *   See `HEALTH_CONNECT_MIGRATION.md`.
 *
 * What this adapter does:
 *   - Wraps the existing server endpoint `POST /api/fitness/sync` (defined in
 *     `server.ts`). The server holds the OAuth refresh-token; the client
 *     never sees an access token directly.
 *   - The `/api/fitness/sync` endpoint today returns a Google Fit
 *     `dataset:aggregate` response (last 7 days, bucketed by 86_400_000 ms)
 *     for `com.google.heart_rate.bpm` and `com.google.step_count.delta`.
 *     Calorie + sleep aggregation are NOT in the server payload yet —
 *     this adapter returns `[]` for those rather than fabricating values.
 *
 * Server contract (do NOT change in this round — Agent N4 scope excludes server.ts):
 *   POST /api/fitness/sync
 *   Headers: Authorization: Bearer <Firebase ID token>
 *   Body:    {}
 *   Response: { success: true, data: { bucket: [{ dataset: [...] }] } }
 *           | { error: string }   (401 if Google not linked, 5xx otherwise)
 */

import type {
  CaloriesSample,
  HealthAdapter,
  HealthDataRange,
  HealthScope,
  HeartRateSample,
  PermissionResult,
  SleepSample,
  StepsSample,
} from './types';

interface FitDatasetPoint {
  startTimeNanos?: string;
  endTimeNanos?: string;
  dataTypeName?: string;
  value?: Array<{ intVal?: number; fpVal?: number }>;
}

interface FitDataset {
  dataSourceId: string;
  point: FitDatasetPoint[];
}

interface FitBucket {
  startTimeMillis?: string;
  endTimeMillis?: string;
  dataset: FitDataset[];
}

interface FitSyncResponse {
  success?: boolean;
  data?: { bucket?: FitBucket[] };
  error?: string;
}

/** Lazy-resolved fetcher so this module is unit-testable without `fetch`. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface IdTokenProvider {
  getIdToken(): Promise<string | null>;
}

interface GoogleFitAdapterDeps {
  /** Resolves the user's Firebase ID token (server uses it to verify auth). */
  idTokenProvider?: IdTokenProvider;
  /** Override for tests / SSR. Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
  /**
   * Base URL for the API. In prod this comes from `import.meta.env.VITE_APP_URL`;
   * we read it lazily inside the adapter to keep this file framework-agnostic.
   */
  baseUrl?: string;
}

let deps: GoogleFitAdapterDeps = {};

/**
 * @deprecated Test/wiring hook. Once Telemetry.tsx is migrated (next round)
 * the page will call this with its `auth.currentUser` token provider.
 */
export function configureGoogleFitAdapter(next: GoogleFitAdapterDeps): void {
  deps = { ...deps, ...next };
}

async function fetchFitSync(): Promise<FitSyncResponse | null> {
  const fetchImpl = deps.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) return null;

  const idToken = deps.idTokenProvider ? await deps.idTokenProvider.getIdToken() : null;
  if (!idToken) return null;

  const base = deps.baseUrl ?? '';
  const res = await fetchImpl(`${base}/api/fitness/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) return null;
  return (await res.json()) as FitSyncResponse;
}

function extractLatestPointValue(
  buckets: FitBucket[] | undefined,
  dataSourceMatch: string,
): { value: number; timestamp: Date } | null {
  if (!buckets) return null;
  for (let i = buckets.length - 1; i >= 0; i--) {
    const bucket = buckets[i];
    for (const dataset of bucket.dataset) {
      if (!dataset.dataSourceId.includes(dataSourceMatch)) continue;
      if (dataset.point.length === 0) continue;
      const last = dataset.point[dataset.point.length - 1];
      const v = last.value?.[0];
      if (!v) continue;
      const numeric = v.fpVal ?? v.intVal;
      if (numeric == null) continue;
      const ts = last.endTimeNanos
        ? new Date(Number(BigInt(last.endTimeNanos) / 1_000_000n))
        : bucket.endTimeMillis
          ? new Date(Number(bucket.endTimeMillis))
          : new Date();
      return { value: numeric, timestamp: ts };
    }
  }
  return null;
}

/**
 * @deprecated Google Fit API sunsets 2026; migrate to Health Connect.
 *   See HEALTH_CONNECT_MIGRATION.md.
 */
export const googleFitAdapter: HealthAdapter = {
  name: 'google-fit-deprecated',
  /**
   * `isAvailable` is `true` so the facade can fall back to this adapter
   * while Health Connect rollout is in progress. Once the sunset hits,
   * flip to `false` here and let the noop adapter take over.
   */
  isAvailable: true,
  platform: 'web',

  /**
   * @deprecated Google Fit OAuth happens server-side via
   *   `GET /api/auth/google/url` (consent popup) and
   *   `GET /api/auth/google/callback` (token persist).
   *   Scope mapping is best-effort: we treat all granted scopes as a
   *   single bucket and report `granted` if the server responds 200 to
   *   `/api/fitness/sync`, otherwise everything is `denied`.
   */
  async requestPermissions(scopes: HealthScope[]): Promise<PermissionResult> {
    const synced = await fetchFitSync();
    if (synced && synced.success !== false) {
      return { granted: scopes, denied: [] };
    }
    return { granted: [], denied: scopes };
  },

  /** @deprecated Maps `com.google.heart_rate.bpm` aggregate -> latest sample. */
  async readHeartRate(_range: HealthDataRange): Promise<HeartRateSample[]> {
    const sync = await fetchFitSync();
    const latest = extractLatestPointValue(sync?.data?.bucket, 'heart_rate');
    if (!latest) return [];
    return [{ timestamp: latest.timestamp, bpm: Math.round(latest.value), source: 'wearable' }];
  },

  /** @deprecated Maps `com.google.step_count.delta` aggregate -> latest day. */
  async readSteps(_range: HealthDataRange): Promise<StepsSample[]> {
    const sync = await fetchFitSync();
    const latest = extractLatestPointValue(sync?.data?.bucket, 'step_count');
    if (!latest) return [];
    return [{ date: latest.timestamp, count: Math.round(latest.value), source: 'wearable' }];
  },

  /**
   * @deprecated `/api/fitness/sync` does not aggregate calories today.
   *   Returns `[]`. To enable, add `com.google.calories.expended` to
   *   `aggregateBy` in `server.ts:850-854` AFTER Webpay round lands
   *   (race avoidance with Agent N5).
   */
  async readCalories(_range: HealthDataRange): Promise<CaloriesSample[]> {
    return [];
  },

  /**
   * @deprecated Google Fit sleep is a separate REST resource not currently
   *   exposed by `/api/fitness/sync`. Returns `[]`.
   */
  async readSleep(_range: HealthDataRange): Promise<SleepSample[]> {
    return [];
  },
};
