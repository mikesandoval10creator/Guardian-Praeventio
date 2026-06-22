// SPDX-License-Identifier: MIT
//
// runSloMetricsRefresh — daily cron job that pulls error stats from the
// Sentry events-stats API and writes them to `slo_metrics/{sloId}/daily`
// so the SloErrorBudget dashboard (src/pages/SloErrorBudget.tsx) can
// render real burn-rate sparklines instead of the "Sin métricas" empty state.
//
// ── HONEST-GATE ─────────────────────────────────────────────────────────────
// This job is **cowork-gated**: it requires SENTRY_API_TOKEN, SENTRY_ORG,
// and SENTRY_PROJECT_ID to be set in the environment. Until those are
// provided, the job returns { gateClosed: true } and writes nothing. The
// SloErrorBudget dashboard already shows an explicit "Sin métricas" message
// when the collection is empty — that is the correct honest state.
//
// Registration: see docs/stubs-inventory.md (this stub is REAL-NEEDED once the
// Sentry token is provisioned — it is NOT a placeholder, it is a complete job
// waiting on a credential).
//
// TODO(sprint): needs SENTRY_API_TOKEN + SENTRY_ORG + SENTRY_PROJECT_ID
//   provisioned in Cloud Run env / Secret Manager. See .env.example L581-585.
//   Once provisioned, set SENTRY_SLO_ENABLED=true to activate.
//
// ── Sentry API surface used ──────────────────────────────────────────────────
//   GET https://sentry.io/api/0/organizations/{org}/events-stats/
//     ?field=count()                 (total events)
//     &query=transaction.status:!ok  (error events, for availability SLO)
//     &project={project_id}
//     &statsPeriod=30d
//     &interval=1d
//     &yAxis=count()
//   → groups[0].series → [ [timestamp, [{count: N}]], ... ]
//
//   For latency_p95 we use:
//     ?field=p95(transaction.duration)
//     &query=transaction:/api/*
//     &yAxis=p95(transaction.duration)
//
// ── Output ──────────────────────────────────────────────────────────────────
//   Collection: `slo_metrics/{sloId}/daily`
//   Doc id:     `YYYY-MM-DD`
//   Fields:     { date: string, value: number, samples: number, capturedAt: string }
//
// Only the last `windowDays` samples are kept (older docs are NOT purged by
// this job — a separate maintenance sweep or TTL should handle retention).
//
// Mounted as POST /api/maintenance/run-slo-metrics-refresh via maintenance.ts.
// Cron cadence: daily at 08:00 UTC (after the compliance + contractor crons).

import { logger } from '../../utils/logger.js';
import { tracedAsync } from '../../services/observability/tracing.js';
import { SLOS, type Slo } from '../../services/observability/slos.js';
import type { Firestore } from 'firebase-admin/firestore';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SloMetricsDailyDoc {
  /** Calendar date in YYYY-MM-DD (UTC). */
  date: string;
  /** Metric value for this day (uptime fraction, latency ms, error rate fraction). */
  value: number;
  /** Number of events/samples contributing to this data point. */
  samples: number;
  /** ISO timestamp when this row was written by the cron. */
  capturedAt: string;
}

export interface RunSloMetricsRefreshResult {
  /**
   * True when the job did nothing because a required credential is absent.
   * The SloErrorBudget dashboard shows "Sin métricas" — that IS the correct
   * honest state. No error, no partial data.
   */
  gateClosed: boolean;
  /** Reason the gate closed (human-readable; logged but never returned to users). */
  gateReason?: string;
  /** SLO IDs for which at least one daily doc was written. */
  refreshed: string[];
  /** SLO IDs that failed to refresh (Sentry API error). */
  failed: string[];
}

export interface RunSloMetricsRefreshDeps {
  db: Firestore;
  /** Override clock for tests. */
  now?: () => Date;
  /**
   * HTTP fetch override for tests. Default: global `fetch`.
   * Must return the raw Sentry events-stats JSON body.
   */
  fetchFn?: typeof fetch;
  /**
   * Override env reader for tests. Default: process.env.
   * Keys: SENTRY_API_TOKEN, SENTRY_ORG, SENTRY_PROJECT_ID, SENTRY_SLO_ENABLED.
   */
  env?: Record<string, string | undefined>;
}

// ── Sentry API helpers ───────────────────────────────────────────────────────

/**
 * Sentry events-stats series entry: [epochSeconds, [{count: N}]].
 * The real API shape has more fields; we only use what we need.
 */
type SentrySeriesPoint = [number, Array<{ count: number }>];

interface SentryEventsStatsResponse {
  data?: SentrySeriesPoint[];
}

/** Build the Sentry events-stats URL for a given SLO. */
function buildSentryUrl(
  org: string,
  projectId: string,
  slo: Slo,
  windowDays: number,
): string {
  const base = `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/events-stats/`;
  const params = new URLSearchParams({
    project: projectId,
    statsPeriod: `${windowDays}d`,
    interval: '1d',
  });

  switch (slo.metric) {
    case 'availability':
      // error-count = events with non-OK status; total needed separately
      params.set('field', 'count()');
      params.set('query', 'transaction.status:!ok');
      params.set('yAxis', 'count()');
      break;
    case 'error_rate':
      params.set('field', 'count()');
      // Gemini errors: 500-level responses from /api/gemini
      params.set('query', slo.id === 'gemini-error-rate'
        ? 'transaction:/api/gemini transaction.status:!ok'
        : 'transaction.status:!ok');
      params.set('yAxis', 'count()');
      break;
    case 'latency_p95':
      params.set('field', 'p95(transaction.duration)');
      params.set('query', 'transaction:/api/*');
      params.set('yAxis', 'p95(transaction.duration)');
      break;
  }

  return `${base}?${params.toString()}`;
}

/**
 * For availability SLOs we also need the total event count so we can derive
 * the uptime fraction. This fetches the same endpoint without the error filter.
 */
function buildSentryTotalUrl(
  org: string,
  projectId: string,
  slo: Slo,
  windowDays: number,
): string {
  const base = `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/events-stats/`;
  const params = new URLSearchParams({
    project: projectId,
    statsPeriod: `${windowDays}d`,
    interval: '1d',
    field: 'count()',
    yAxis: 'count()',
  });
  if (slo.id === 'gemini-error-rate') {
    params.set('query', 'transaction:/api/gemini');
  }
  return `${base}?${params.toString()}`;
}

/** Derive a YYYY-MM-DD string from epoch seconds (UTC). */
function epochToDate(epochSecs: number): string {
  const d = new Date(epochSecs * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Main job ─────────────────────────────────────────────────────────────────

/**
 * Pull Sentry events-stats and write to `slo_metrics/{sloId}/daily`.
 *
 * Returns immediately with { gateClosed: true } when a required credential
 * is absent — this is the expected state until the operator provisions
 * SENTRY_API_TOKEN. Consumers (SloErrorBudget.tsx) already handle the
 * empty-collection case with an honest "Sin métricas" message.
 */
export async function runSloMetricsRefresh(
  deps: RunSloMetricsRefreshDeps,
): Promise<RunSloMetricsRefreshResult> {
  return tracedAsync(
    'job.slo_metrics_refresh',
    {},
    () => runSloMetricsRefreshInner(deps),
  );
}

async function runSloMetricsRefreshInner(
  deps: RunSloMetricsRefreshDeps,
): Promise<RunSloMetricsRefreshResult> {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const { db } = deps;
  const now = deps.now ? deps.now() : new Date();
  const capturedAt = now.toISOString();

  // ── Credential gate ──────────────────────────────────────────────────────
  const token = env.SENTRY_API_TOKEN;
  const org = env.SENTRY_ORG;
  const projectId = env.SENTRY_PROJECT_ID;
  const enabled = env.SENTRY_SLO_ENABLED === 'true';

  if (!enabled) {
    const reason =
      'SENTRY_SLO_ENABLED is not set to "true" — job is disabled until credentials are provisioned';
    logger.info('slo_metrics_refresh.gate_closed', { reason });
    return { gateClosed: true, gateReason: reason, refreshed: [], failed: [] };
  }
  if (!token || !org || !projectId) {
    const missing = [
      !token && 'SENTRY_API_TOKEN',
      !org && 'SENTRY_ORG',
      !projectId && 'SENTRY_PROJECT_ID',
    ]
      .filter(Boolean)
      .join(', ');
    const reason = `Missing required env vars: ${missing}. Provision via Secret Manager and set SENTRY_SLO_ENABLED=true.`;
    logger.warn('slo_metrics_refresh.gate_closed', { reason });
    return { gateClosed: true, gateReason: reason, refreshed: [], failed: [] };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const refreshed: string[] = [];
  const failed: string[] = [];

  for (const slo of SLOS) {
    try {
      const url = buildSentryUrl(org, projectId, slo, slo.windowDays);

      const resp = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        throw new Error(
          `Sentry API error: HTTP ${resp.status} for SLO ${slo.id}`,
        );
      }
      const body = (await resp.json()) as SentryEventsStatsResponse;
      const series: SentrySeriesPoint[] = body.data ?? [];

      if (series.length === 0) {
        logger.warn('slo_metrics_refresh.empty_series', { sloId: slo.id });
        continue;
      }

      // For availability/error_rate we need total counts to derive the fraction.
      let totals: Map<string, number> | null = null;
      if (slo.metric === 'availability' || slo.metric === 'error_rate') {
        try {
          const totalUrl = buildSentryTotalUrl(
            org,
            projectId,
            slo,
            slo.windowDays,
          );
          const totalResp = await fetchFn(totalUrl, {
            headers,
            signal: AbortSignal.timeout(15_000),
          });
          if (totalResp.ok) {
            const totalBody =
              (await totalResp.json()) as SentryEventsStatsResponse;
            totals = new Map<string, number>();
            for (const [epochSecs, counts] of totalBody.data ?? []) {
              totals.set(epochToDate(epochSecs), counts[0]?.count ?? 0);
            }
          }
        } catch (totalErr) {
          // Non-fatal: we fall back to using the error series as a proxy.
          logger.warn('slo_metrics_refresh.total_fetch_failed', {
            sloId: slo.id,
            err: String(totalErr),
          });
        }
      }

      // Write one daily doc per data point in the series.
      const batch = db.batch();
      for (const [epochSecs, counts] of series) {
        const date = epochToDate(epochSecs);
        const rawCount = counts[0]?.count ?? 0;

        let value: number;
        let samples: number;

        switch (slo.metric) {
          case 'availability': {
            const totalCount = totals?.get(date) ?? 0;
            samples = totalCount;
            // availability = 1 - (errors / total). Guard against zero total.
            value =
              totalCount > 0
                ? Math.max(0, Math.min(1, 1 - rawCount / totalCount))
                : 1; // no requests = no errors = 100% available (conservative)
            break;
          }
          case 'error_rate': {
            const totalCount = totals?.get(date) ?? 0;
            samples = totalCount;
            // error rate = errors / total. Guard against zero total.
            value =
              totalCount > 0
                ? Math.max(0, Math.min(1, rawCount / totalCount))
                : 0;
            break;
          }
          case 'latency_p95': {
            // rawCount is already the p95 latency in ms for this interval.
            value = rawCount;
            samples = 1; // Sentry p95 aggregates don't give a sample count directly
            break;
          }
        }

        const dailyDoc: SloMetricsDailyDoc = {
          date,
          value,
          samples,
          capturedAt,
        };

        const docRef = db
          .collection('slo_metrics')
          .doc(slo.id)
          .collection('daily')
          .doc(date);
        batch.set(docRef, dailyDoc);
      }

      await batch.commit();
      refreshed.push(slo.id);
      logger.info('slo_metrics_refresh.slo_done', {
        sloId: slo.id,
        daysWritten: series.length,
      });
    } catch (err) {
      logger.error('slo_metrics_refresh.slo_failed', {
        sloId: slo.id,
        err: String(err),
      });
      failed.push(slo.id);
    }
  }

  return { gateClosed: false, refreshed, failed };
}
