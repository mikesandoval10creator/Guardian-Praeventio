// SPDX-License-Identifier: MIT
//
// Sprint 25 Bucket TT — Daily Climate Risk Scan Orchestrator.
//
// La cadena automática que cierra "tiene la lógica" → "ejecuta la prevención":
//
//   Cron diario 05:00 Santiago (08:00 UTC)
//     ↓
//   1. Lista proyectos activos por tenant (status='active', outdoor=true).
//     ↓
//   2. Por cada proyecto, fetch 3-day forecast con sus geo coords.
//     ↓
//   3. buildClimateRiskNodes(forecasts, [project]) — función pura ya
//      testeada en climateRiskCoupling.test.ts.
//     ↓
//   4. Persiste nodos vía writeNodes (idempotent — re-running no duplica).
//     ↓
//   5. Para nodos severity >= minSeverityForFcm, multicast FCM a
//      supervisorUids.
//     ↓
//   6. Audit log: 'climate.daily_scan.completed' con counts.
//
// Toda la chain es DI-testeable. El único lado "no-puro" es el fetch de
// forecast y el sendFcmMulticast — ambos inyectables. Errores en un
// proyecto NO abortan los demás (pattern de firestoreCriticalReplicate).
//
// Severity mapping: la versión actual de `buildClimateRiskNodes` devuelve
// un `ClimateRiskAssessment` que NO trae `severity` directo (los Bernoulli
// nodes de `RiskNodePayload` sí, pero los CLIMATE_RISK genéricos derivan
// severity de los risk-factors). Mapeamos aquí: lightning + heat-stress
// crítico ⇒ 'critical'; falling-objects/electrical-hazard ⇒ 'high';
// slippery + reduced-visibility ⇒ 'medium'; resto ⇒ 'low'.

import type {
  ClimateForecastDay,
  ClimateProjectContext,
  ClimateRiskAssessment,
  ClimateRiskFactor,
} from '../../services/zettelkasten/climateRiskCoupling';
import { tracedAsync } from '../../services/observability/tracing.js';

export type DailyScanSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface DailyScanProject extends ClimateProjectContext {
  tenantId: string;
  name: string;
  geo?: { lat: number; lng: number };
  supervisorUids: string[];
}

export interface DailyScanNode {
  /** Project the node belongs to. */
  projectId: string;
  /** Severity computed from the assessment (used to gate FCM). */
  severity: DailyScanSeverity;
  /** Underlying assessment (kept for callers that need the full payload). */
  assessment: ClimateRiskAssessment;
}

export interface ClimateRiskScanDeps {
  /** Active outdoor projects across all tenants. */
  listActiveProjects: () => Promise<DailyScanProject[]>;

  /** Fetch a forecast for a geo. Implementations should return [] on error. */
  fetchForecast: (
    geo: { lat: number; lng: number },
    days: number,
  ) => Promise<ClimateForecastDay[]>;

  /** Persist nodes (idempotent — reuses writeNodes hash). */
  persistNodes: (
    assessments: ClimateRiskAssessment[],
    projectId: string,
  ) => Promise<{ ok: boolean; ids?: string[] }>;

  /** Multicast FCM to a list of supervisor UIDs. */
  sendFcmMulticast: (opts: {
    uids: string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }) => Promise<{ successCount: number; failureCount: number }>;

  /** Append an audit-log row. */
  audit: (action: string, details: Record<string, unknown>) => Promise<void>;

  /** Now in ms. Defaults to Date.now. */
  now?: () => number;
}

export interface ClimateRiskScanResult {
  startedAt: number;
  completedAt: number;
  projectsScanned: number;
  forecastsFetched: number;
  nodesGenerated: number;
  nodesPersisted: number;
  notificationsSent: number;
  notificationsFailed: number;
  errors: Array<{ projectId: string; reason: string }>;
}

export interface ClimateRiskScanOptions {
  /** Days to forecast. Default 3. */
  forecastDays?: number;
  /** Minimum severity that triggers an FCM notification. Default 'medium'. */
  minSeverityForFcm?: DailyScanSeverity;
}

const SEVERITY_RANK: Record<DailyScanSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Map a climate-risk assessment to a coarse severity bucket. The rules
 * mirror the controls in CONTROLS_BY_FACTOR: anything that triggers
 * "suspender trabajo" is at least 'high'; the Bernoulli warnings carry
 * their own copy in the payload.description, so for those we read the
 * windload/venturi node type directly.
 */
function severityFor(assessment: ClimateRiskAssessment): DailyScanSeverity {
  const t = assessment.riskNodePayload.type;
  if (t === 'windload-warning') return 'critical';
  if (t === 'venturi-warning') return 'high';

  const factors = new Set<ClimateRiskFactor>(assessment.riskFactors);
  if (factors.has('lightning-exposure')) return 'critical';
  if (factors.has('electrical-hazard')) return 'high';
  if (factors.has('falling-objects')) return 'high';
  if (factors.has('heat-stress')) return 'high';
  if (factors.has('hypothermia')) return 'medium';
  if (factors.has('slippery-surface') || factors.has('reduced-visibility')) {
    return 'medium';
  }
  return 'low';
}

function shortLabel(a: ClimateRiskAssessment): string {
  // Compact "title: severity" line for FCM body.
  return a.riskNodePayload.title;
}

export async function runDailyClimateRiskScan(
  deps: ClimateRiskScanDeps,
  options: ClimateRiskScanOptions = {},
): Promise<ClimateRiskScanResult> {
  return tracedAsync(
    'job.daily_climate_risk_scan',
    {
      forecastDays: options.forecastDays ?? 3,
      minSeverityForFcm: options.minSeverityForFcm ?? 'medium',
    },
    () => runDailyClimateRiskScanInner(deps, options),
  );
}

async function runDailyClimateRiskScanInner(
  deps: ClimateRiskScanDeps,
  options: ClimateRiskScanOptions = {},
): Promise<ClimateRiskScanResult> {
  const nowFn = deps.now ?? Date.now;
  const startedAt = nowFn();
  const forecastDays = options.forecastDays ?? 3;
  const minSeverity = options.minSeverityForFcm ?? 'medium';
  const minRank = SEVERITY_RANK[minSeverity];

  const result: ClimateRiskScanResult = {
    startedAt,
    completedAt: 0,
    projectsScanned: 0,
    forecastsFetched: 0,
    nodesGenerated: 0,
    nodesPersisted: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    errors: [],
  };

  let projects: DailyScanProject[];
  try {
    projects = await deps.listActiveProjects();
  } catch (err) {
    // Catastrophic: still log audit so we know the cron fired.
    await safeAudit(deps, 'climate.daily_scan.completed', {
      ...summarize(result, nowFn()),
      fatal: 'listActiveProjects_failed',
      reason: String(err),
    });
    result.completedAt = nowFn();
    result.errors.push({ projectId: '*', reason: `listActiveProjects: ${String(err)}` });
    return result;
  }
  result.projectsScanned = projects.length;

  // Lazy import to keep the module side-effect free for tests that don't
  // exercise the persistence path. Equivalent to firestoreCriticalReplicate.
  const { buildClimateRiskNodes } = await import(
    '../../services/zettelkasten/climateRiskCoupling.js'
  );

  for (const project of projects) {
    if (!project.geo || !project.outdoor) continue; // Skip indoor / no-coords.

    try {
      const forecasts = await deps.fetchForecast(project.geo, forecastDays);
      result.forecastsFetched += forecasts.length;
      if (forecasts.length === 0) continue;

      const assessments = buildClimateRiskNodes(forecasts, [
        {
          id: project.id,
          outdoor: project.outdoor,
          workTypes: project.workTypes,
        },
      ]);
      result.nodesGenerated += assessments.length;
      if (assessments.length === 0) continue;

      // Persist (idempotent at the writeNodes layer via SHA-256 keys).
      const persistRes = await deps.persistNodes(assessments, project.id);
      if (persistRes.ok) result.nodesPersisted += assessments.length;

      // Tag severities and pick the urgent slice for FCM.
      const ranked: DailyScanNode[] = assessments.map((a) => ({
        projectId: project.id,
        severity: severityFor(a),
        assessment: a,
      }));
      const urgent = ranked.filter((n) => SEVERITY_RANK[n.severity] >= minRank);

      if (urgent.length > 0 && project.supervisorUids.length > 0) {
        const titles = urgent.slice(0, 3).map((n) => shortLabel(n.assessment));
        const fcm = await deps.sendFcmMulticast({
          uids: project.supervisorUids,
          title: `Clima — ${urgent.length} riesgo(s) en ${project.name}`,
          body: titles.join(' · '),
          data: {
            type: 'climate_risk_daily',
            projectId: project.id,
            tenantId: project.tenantId,
            nodeCount: String(urgent.length),
            topSeverity: highestSeverity(urgent),
          },
        });
        result.notificationsSent += fcm.successCount;
        result.notificationsFailed += fcm.failureCount;
      }
    } catch (err) {
      result.errors.push({ projectId: project.id, reason: String(err) });
    }
  }

  result.completedAt = nowFn();

  await safeAudit(deps, 'climate.daily_scan.completed', summarize(result, result.completedAt));

  return result;
}

function summarize(result: ClimateRiskScanResult, completedAt: number) {
  return {
    projectsScanned: result.projectsScanned,
    forecastsFetched: result.forecastsFetched,
    nodesGenerated: result.nodesGenerated,
    nodesPersisted: result.nodesPersisted,
    notificationsSent: result.notificationsSent,
    notificationsFailed: result.notificationsFailed,
    durationMs: completedAt - result.startedAt,
    errorCount: result.errors.length,
  };
}

function highestSeverity(nodes: DailyScanNode[]): DailyScanSeverity {
  let top: DailyScanSeverity = 'info';
  for (const n of nodes) {
    if (SEVERITY_RANK[n.severity] > SEVERITY_RANK[top]) top = n.severity;
  }
  return top;
}

async function safeAudit(
  deps: ClimateRiskScanDeps,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.audit(action, details);
  } catch {
    // Audit must never break the cron return path.
  }
}
