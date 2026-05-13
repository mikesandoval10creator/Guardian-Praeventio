// Praeventio Guard — Sprint 41 Fase F.30: Telemetría agregada.
//
// Cierra Plan F.30 "Telemetría agregada (feed para Vertex AI; prepara D.9)".
//
// NOTA: Vertex AI Trainer está DESCARTADO por directiva usuario para tiers
// no-enterprise. Este servicio se mantiene como base de telemetría agregada
// reutilizable para dashboards ejecutivos, alertas y futuras integraciones.
//
// Compone un feed estable de eventos operacionales en time-series:
//   - Aggregaciones por proyecto / por tenant
//   - Rolling windows (7d / 30d / 90d)
//   - Privacy-preserving: NUNCA exporta PII; solo conteos + scores
//
// 100% determinístico. Sin LLM. Sin I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type TelemetryEventKind =
  | 'incident_recorded'
  | 'training_completed'
  | 'epp_delivered'
  | 'inspection_done'
  | 'permit_issued'
  | 'permit_closed'
  | 'corrective_action_opened'
  | 'corrective_action_closed'
  | 'sos_triggered'
  | 'micro_training_passed'
  | 'audit_export';

export interface TelemetryEvent {
  /** ID estable. */
  id: string;
  kind: TelemetryEventKind;
  /** ISO-8601. */
  occurredAt: string;
  projectId: string;
  tenantId?: string;
  /** Si el evento tiene severity contextual. */
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export type AggregationWindow = '7d' | '30d' | '90d';

export interface AggregatedFeed {
  tenantId?: string;
  projectId: string;
  window: AggregationWindow;
  /** Start ISO de la ventana. */
  windowStartIso: string;
  /** End ISO de la ventana (now). */
  windowEndIso: string;
  /** Conteos por kind. */
  countByKind: Partial<Record<TelemetryEventKind, number>>;
  /** Conteos por severity. */
  countBySeverity: Record<'low' | 'medium' | 'high' | 'critical', number>;
  /** Total eventos. */
  totalEvents: number;
}

const WINDOW_DAYS: Record<AggregationWindow, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// ────────────────────────────────────────────────────────────────────────
// Aggregation
// ────────────────────────────────────────────────────────────────────────

function emptySeverityCount(): AggregatedFeed['countBySeverity'] {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

export interface AggregateInputs {
  events: TelemetryEvent[];
  projectId: string;
  tenantId?: string;
  window: AggregationWindow;
  now?: Date;
}

export function aggregateFeed(input: AggregateInputs): AggregatedFeed {
  const now = input.now ?? new Date();
  const days = WINDOW_DAYS[input.window];
  const startMs = now.getTime() - days * 86_400_000;
  const startIso = new Date(startMs).toISOString();
  const endIso = now.toISOString();

  const inRange = input.events.filter((e) => {
    if (e.projectId !== input.projectId) return false;
    if (input.tenantId && e.tenantId !== input.tenantId) return false;
    const t = Date.parse(e.occurredAt);
    return Number.isFinite(t) && t >= startMs && t <= now.getTime();
  });

  const countByKind: Partial<Record<TelemetryEventKind, number>> = {};
  const countBySeverity = emptySeverityCount();
  for (const e of inRange) {
    countByKind[e.kind] = (countByKind[e.kind] ?? 0) + 1;
    if (e.severity) countBySeverity[e.severity] += 1;
  }

  return {
    tenantId: input.tenantId,
    projectId: input.projectId,
    window: input.window,
    windowStartIso: startIso,
    windowEndIso: endIso,
    countByKind,
    countBySeverity,
    totalEvents: inRange.length,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Velocity (events per day, for trend dashboard)
// ────────────────────────────────────────────────────────────────────────

export interface KindVelocity {
  kind: TelemetryEventKind;
  count: number;
  perDay: number;
}

export function computeVelocities(feed: AggregatedFeed): KindVelocity[] {
  const days = WINDOW_DAYS[feed.window];
  const out: KindVelocity[] = [];
  for (const [kind, count] of Object.entries(feed.countByKind)) {
    if (typeof count !== 'number') continue;
    out.push({
      kind: kind as TelemetryEventKind,
      count,
      perDay: Math.round((count / days) * 100) / 100,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

// ────────────────────────────────────────────────────────────────────────
// Tenant rollup (suma de N proyectos del tenant)
// ────────────────────────────────────────────────────────────────────────

export interface TenantRollup {
  tenantId: string;
  window: AggregationWindow;
  totalProjects: number;
  totalEvents: number;
  countByKind: Partial<Record<TelemetryEventKind, number>>;
  countBySeverity: AggregatedFeed['countBySeverity'];
  /** Proyectos ordenados por totalEvents desc. */
  topProjects: Array<{ projectId: string; totalEvents: number }>;
}

export function rollupTenant(feeds: AggregatedFeed[], tenantId: string): TenantRollup {
  const ownFeeds = feeds.filter((f) => f.tenantId === tenantId);
  const window: AggregationWindow = ownFeeds[0]?.window ?? '7d';
  const countByKind: Partial<Record<TelemetryEventKind, number>> = {};
  const countBySeverity = emptySeverityCount();
  let totalEvents = 0;
  for (const f of ownFeeds) {
    totalEvents += f.totalEvents;
    for (const [k, c] of Object.entries(f.countByKind)) {
      if (typeof c !== 'number') continue;
      const key = k as TelemetryEventKind;
      countByKind[key] = (countByKind[key] ?? 0) + c;
    }
    for (const sev of ['low', 'medium', 'high', 'critical'] as const) {
      countBySeverity[sev] += f.countBySeverity[sev];
    }
  }
  const topProjects = ownFeeds
    .map((f) => ({ projectId: f.projectId, totalEvents: f.totalEvents }))
    .sort((a, b) => b.totalEvents - a.totalEvents)
    .slice(0, 5);

  return {
    tenantId,
    window,
    totalProjects: ownFeeds.length,
    totalEvents,
    countByKind,
    countBySeverity,
    topProjects,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Privacy guard (filtra cualquier evento con campos personales)
// ────────────────────────────────────────────────────────────────────────

/**
 * Verifica que un evento no contiene campos PII inesperados. Tira si
 * el caller intentó pasar workerUid u otros campos personales que no
 * son parte del shape canónico.
 */
export function assertNoPII(event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const blockedKeys = ['workerUid', 'fullName', 'rut', 'email', 'phone', 'address'];
  for (const k of blockedKeys) {
    if (Object.prototype.hasOwnProperty.call(event, k)) {
      throw new Error(
        `[telemetry.privacy] Forbidden PII field '${k}' on telemetry event. Aggregation must NEVER export personal data.`,
      );
    }
  }
}
