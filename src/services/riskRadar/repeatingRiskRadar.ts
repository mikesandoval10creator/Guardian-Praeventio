// Praeventio Guard — Sprint 40 Fase F.13: Radar de Riesgos Repetidos.
//
// Cierra Plan F.13 "Radar Riesgos Repetidos (agregaciones simples
// sobre nodos por zona/tipo/tiempo, no ML)".
//
// Detecta patrones de eventos que se repiten en un proyecto:
//   - Mismo tipo de incidente en distintas zonas → patrón de proceso
//   - Misma zona con distintos tipos de incidente → patrón de lugar
//   - Mismo trabajador con N near-miss → patrón individual
//   - Misma tarea con N incidentes → tarea problemática
//   - Mismo turno con incidentes → patrón temporal (nocturno, etc.)
//
// 100% determinístico, sin ML. Feed listo para F.8 Inbox
// (repeatingRiskAlerts).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RiskPatternKind =
  | 'same_kind_across_zones'
  | 'same_zone_multiple_kinds'
  | 'same_worker_repeated'
  | 'same_task_repeated'
  | 'same_shift_pattern'
  | 'time_cluster';

export interface IncidentSample {
  id: string;
  /** ISO-8601 cuando ocurrió. */
  occurredAt: string;
  /** Categoría del incidente (caída, golpe, atrapamiento, ...). */
  kind: string;
  /** Zona del proyecto donde ocurrió. */
  zoneId: string;
  /** Tarea durante la cual ocurrió. */
  taskId?: string;
  /** Worker involucrado. */
  workerUid?: string;
  /** Turno: día/tarde/noche. */
  shift?: 'day' | 'evening' | 'night';
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface RepeatingPattern {
  /** Identificador único del patrón (estable para idempotency). */
  id: string;
  kind: RiskPatternKind;
  /** Etiqueta humana del patrón. */
  label: string;
  /** Lista de IDs de incidentes involucrados. */
  involvedIncidentIds: string[];
  /** Cuántas ocurrencias. */
  occurrences: number;
  /** Cuando se detectó (latest occurredAt). */
  lastSeenAt: string;
  /** Recomendación accionable derivada del patrón. */
  recommendedAction: string;
  /** Severity derivada (max de los incidentes involucrados). */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────

export interface RadarConfig {
  /** Mínimo de ocurrencias para reportar un patrón. Default 3. */
  minOccurrences: number;
  /** Ventana temporal en días (mira solo incidents recientes). Default 90. */
  windowDays: number;
  /** Override now. */
  now?: Date;
}

const DEFAULT_CONFIG: Required<Omit<RadarConfig, 'now'>> = {
  minOccurrences: 3,
  windowDays: 90,
};

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 } as const;

function maxSeverity(
  list: IncidentSample[],
): 'low' | 'medium' | 'high' | 'critical' {
  let best: keyof typeof SEVERITY_ORDER = 'low';
  for (const i of list) {
    const s = i.severity ?? 'low';
    if (SEVERITY_ORDER[s] > SEVERITY_ORDER[best]) best = s;
  }
  return best;
}

// ────────────────────────────────────────────────────────────────────────
// Pattern detectors
// ────────────────────────────────────────────────────────────────────────

function filterRecent(
  incidents: IncidentSample[],
  windowDays: number,
  now: Date,
): IncidentSample[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - windowDays * 86_400_000;
  // Codex P2 PR #100: drop incidents with future timestamps (clock skew /
  // bad import / scheduled test data) — they would generate patterns with
  // lastSeenAt in the future and survive across runs.
  return incidents.filter((i) => {
    const t = Date.parse(i.occurredAt);
    return Number.isFinite(t) && t >= cutoff && t <= nowMs;
  });
}

function groupBy<K extends string>(
  list: IncidentSample[],
  keyFn: (i: IncidentSample) => K | undefined,
): Map<K, IncidentSample[]> {
  const map = new Map<K, IncidentSample[]>();
  for (const i of list) {
    const k = keyFn(i);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return map;
}

function latestIso(list: IncidentSample[]): string {
  // Codex P2 PR #100: compare by parsed timestamps, not lexicographic — ISO
  // strings with timezone offsets break string compare ('2026-05-10T23:30:00-03:00'
  // is later than '2026-05-11T00:15:00Z' but sorts earlier).
  let latest = list[0].occurredAt;
  let latestMs = Date.parse(latest);
  if (!Number.isFinite(latestMs)) latestMs = -Infinity;
  for (const i of list) {
    const t = Date.parse(i.occurredAt);
    if (Number.isFinite(t) && t > latestMs) {
      latest = i.occurredAt;
      latestMs = t;
    }
  }
  return latest;
}

function detectSameKindAcrossZones(
  incidents: IncidentSample[],
  minOccurrences: number,
): RepeatingPattern[] {
  const byKind = groupBy(incidents, (i) => i.kind);
  const out: RepeatingPattern[] = [];
  for (const [kind, list] of byKind) {
    if (list.length < minOccurrences) continue;
    const zones = new Set(list.map((i) => i.zoneId));
    if (zones.size < 2) continue; // solo 1 zona = patrón de lugar, no de proceso
    out.push({
      id: `same_kind:${kind}`,
      kind: 'same_kind_across_zones',
      label: `Incidentes ${kind} en ${zones.size} zonas distintas`,
      involvedIncidentIds: list.map((i) => i.id),
      occurrences: list.length,
      lastSeenAt: latestIso(list),
      recommendedAction: `Revisar el procedimiento/training de ${kind} — el problema no es local a una zona.`,
      severity: maxSeverity(list),
    });
  }
  return out;
}

function detectSameZoneMultipleKinds(
  incidents: IncidentSample[],
  minOccurrences: number,
): RepeatingPattern[] {
  const byZone = groupBy(incidents, (i) => i.zoneId);
  const out: RepeatingPattern[] = [];
  for (const [zone, list] of byZone) {
    if (list.length < minOccurrences) continue;
    const kinds = new Set(list.map((i) => i.kind));
    if (kinds.size < 2) continue; // 1 sólo kind = caso del otro detector
    out.push({
      id: `same_zone:${zone}`,
      kind: 'same_zone_multiple_kinds',
      label: `Zona ${zone} con ${kinds.size} tipos de incidente`,
      involvedIncidentIds: list.map((i) => i.id),
      occurrences: list.length,
      lastSeenAt: latestIso(list),
      recommendedAction: `Inspección integral de zona ${zone} — múltiples factores de riesgo concentrados.`,
      severity: maxSeverity(list),
    });
  }
  return out;
}

function detectSameWorkerRepeated(
  incidents: IncidentSample[],
  minOccurrences: number,
): RepeatingPattern[] {
  const byWorker = groupBy(incidents, (i) => i.workerUid);
  const out: RepeatingPattern[] = [];
  for (const [worker, list] of byWorker) {
    if (list.length < minOccurrences) continue;
    out.push({
      id: `same_worker:${worker}`,
      kind: 'same_worker_repeated',
      label: `Trabajador ${worker} con ${list.length} incidentes`,
      involvedIncidentIds: list.map((i) => i.id),
      occurrences: list.length,
      lastSeenAt: latestIso(list),
      recommendedAction: `Entrevista no-punitiva: cargas de trabajo, fatiga, capacitación. NO sancionar.`,
      severity: maxSeverity(list),
    });
  }
  return out;
}

function detectSameTaskRepeated(
  incidents: IncidentSample[],
  minOccurrences: number,
): RepeatingPattern[] {
  const byTask = groupBy(incidents, (i) => i.taskId);
  const out: RepeatingPattern[] = [];
  for (const [task, list] of byTask) {
    if (list.length < minOccurrences) continue;
    out.push({
      id: `same_task:${task}`,
      kind: 'same_task_repeated',
      label: `Tarea ${task} con ${list.length} incidentes`,
      involvedIncidentIds: list.map((i) => i.id),
      occurrences: list.length,
      lastSeenAt: latestIso(list),
      recommendedAction: `Re-diseñar la tarea ${task}: jerarquía de controles → ingeniería sobre EPP.`,
      severity: maxSeverity(list),
    });
  }
  return out;
}

function detectSameShiftPattern(
  incidents: IncidentSample[],
  minOccurrences: number,
): RepeatingPattern[] {
  const byShift = groupBy(incidents, (i) => i.shift);
  const out: RepeatingPattern[] = [];
  for (const [shift, list] of byShift) {
    if (list.length < minOccurrences) continue;
    out.push({
      id: `same_shift:${shift}`,
      kind: 'same_shift_pattern',
      label: `Turno ${shift} con ${list.length} incidentes`,
      involvedIncidentIds: list.map((i) => i.id),
      occurrences: list.length,
      lastSeenAt: latestIso(list),
      recommendedAction:
        shift === 'night'
          ? 'Revisar fatiga + iluminación + supervisión en turno nocturno.'
          : `Revisar carga de trabajo + descansos en turno ${shift}.`,
      severity: maxSeverity(list),
    });
  }
  return out;
}

function detectTimeCluster(
  incidents: IncidentSample[],
  minOccurrences: number,
  now: Date,
): RepeatingPattern[] {
  // Codex P2 PR #100: cluster window de 14d; iterate hasta agotar incidents
  // (no break tras el primero), y expand cada cluster a TODOS los
  // incidents dentro de la ventana (no solo minOccurrences). ID estable
  // basado en el rango de 14d-window-bucket, no en la fecha del primer
  // incident (que cambia con backfills).
  const out: RepeatingPattern[] = [];
  void now;
  if (incidents.length < minOccurrences) return out;
  const sorted = [...incidents].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
  const WINDOW_MS = 14 * 86_400_000;

  let i = 0;
  while (i <= sorted.length - minOccurrences) {
    const startMs = Date.parse(sorted[i].occurredAt);
    // Expand: include all incidents whose occurredAt is within 14d from start
    let endIdx = i;
    while (
      endIdx + 1 < sorted.length &&
      Date.parse(sorted[endIdx + 1].occurredAt) - startMs <= WINDOW_MS
    ) {
      endIdx += 1;
    }
    const sliceLen = endIdx - i + 1;
    if (sliceLen >= minOccurrences) {
      const slice = sorted.slice(i, endIdx + 1);
      const endMs = Date.parse(slice[slice.length - 1].occurredAt);
      // Stable ID: anchor to the 14-day window bucket starting at the
      // earliest UTC midnight that contains the slice start. Backfilling
      // an earlier incident within the same window keeps the same bucket.
      const bucketStartMs = Math.floor(startMs / WINDOW_MS) * WINDOW_MS;
      const bucketStartIso = new Date(bucketStartMs).toISOString().slice(0, 10);
      out.push({
        id: `time_cluster:${bucketStartIso}`,
        kind: 'time_cluster',
        label: `Pico de ${slice.length} incidentes en ${Math.ceil((endMs - startMs) / 86_400_000) || 0} días`,
        involvedIncidentIds: slice.map((s) => s.id),
        occurrences: slice.length,
        lastSeenAt: latestIso(slice),
        recommendedAction:
          'Revisar qué cambió en operación durante el período: nuevo contrato, cambio de cuadrilla, condiciones extremas, presión de plazo.',
        severity: maxSeverity(slice),
      });
      // Advance past this cluster so siguientes clusters no-overlapping
      // se reporten también (P2: do not stop at first cluster).
      i = endIdx + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Public entrypoint
// ────────────────────────────────────────────────────────────────────────

export interface RadarReport {
  patterns: RepeatingPattern[];
  totalPatterns: number;
  byKind: Partial<Record<RiskPatternKind, number>>;
  /** Severidad máxima detectada (helper para Inbox urgency). */
  maxSeverity: 'low' | 'medium' | 'high' | 'critical';
  /** Ventana analizada. */
  windowDays: number;
  /** Incidentes considerados (post filter por ventana). */
  consideredIncidents: number;
}

export function buildRepeatingRiskRadar(
  incidents: IncidentSample[],
  config: RadarConfig = DEFAULT_CONFIG,
): RadarReport {
  const cfg = {
    minOccurrences: config.minOccurrences ?? DEFAULT_CONFIG.minOccurrences,
    windowDays: config.windowDays ?? DEFAULT_CONFIG.windowDays,
    now: config.now ?? new Date(),
  };
  const recent = filterRecent(incidents, cfg.windowDays, cfg.now);

  const patterns: RepeatingPattern[] = [
    ...detectSameKindAcrossZones(recent, cfg.minOccurrences),
    ...detectSameZoneMultipleKinds(recent, cfg.minOccurrences),
    ...detectSameWorkerRepeated(recent, cfg.minOccurrences),
    ...detectSameTaskRepeated(recent, cfg.minOccurrences),
    ...detectSameShiftPattern(recent, cfg.minOccurrences),
    ...detectTimeCluster(recent, cfg.minOccurrences, cfg.now),
  ];

  // Ordenar por severity desc, luego occurrences desc
  patterns.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity];
    const sb = SEVERITY_ORDER[b.severity];
    if (sa !== sb) return sb - sa;
    return b.occurrences - a.occurrences;
  });

  const byKind: Partial<Record<RiskPatternKind, number>> = {};
  let topSev: 'low' | 'medium' | 'high' | 'critical' = 'low';
  for (const p of patterns) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    if (SEVERITY_ORDER[p.severity] > SEVERITY_ORDER[topSev]) topSev = p.severity;
  }

  return {
    patterns,
    totalPatterns: patterns.length,
    byKind,
    maxSeverity: topSev,
    windowDays: cfg.windowDays,
    consideredIncidents: recent.length,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Inbox feed adapter — emite shape compatible con F.8
// ────────────────────────────────────────────────────────────────────────

export interface InboxAlertCompat {
  id: string;
  label: string;
  occurrences: number;
  lastSeenAt: string;
}

export function toInboxAlerts(report: RadarReport): InboxAlertCompat[] {
  return report.patterns.map((p) => ({
    id: p.id,
    label: p.label,
    occurrences: p.occurrences,
    lastSeenAt: p.lastSeenAt,
  }));
}
