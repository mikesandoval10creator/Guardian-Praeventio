// Praeventio Guard — Sprint K: PDCA + No Conformidades + Eficacia.
//
// Cierra: Documento usuario "§195-200" + relación NC→acción + eficacia
//
// Implementa el ciclo PDCA (Plan-Do-Check-Act) de ISO 45001 sobre
// hallazgos / no-conformidades:
//
//   PLAN: identificar NC, asignar responsable y acción
//   DO: ejecutar la acción
//   CHECK: verificar resultado (corto plazo)
//   ACT: medir EFICACIA (largo plazo, 30/90d post cierre) — §330-331
//
// También trackea:
//   - Relación NC → acción correctiva (link explícito)
//   - Rankings de zonas y tareas con más NC
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type NonConformitySeverity = 'minor' | 'major' | 'critical';
export type PDCAPhase = 'plan' | 'do' | 'check' | 'act';

export interface NonConformity {
  id: string;
  category: string;
  severity: NonConformitySeverity;
  /** Texto descriptivo. */
  description: string;
  detectedAt: string;
  /** Ubicación interna. */
  location: string;
  /** ID de tarea origen (si aplica). */
  taskId?: string;
  /** UID del responsable de cierre. */
  responsibleUid: string;
  status: 'open' | 'in_progress' | 'closed' | 'verified_effective' | 'reoccurred';
  /** ID de la acción correctiva vinculada. */
  correctiveActionId?: string;
  /** ISO-8601 del cierre. */
  closedAt?: string;
  /** ISO-8601 de verificación de eficacia (§330). */
  verifiedEffectiveAt?: string;
  /** Si reapareció después de cierre (§331). */
  reoccurredAt?: string;
}

// ────────────────────────────────────────────────────────────────────────
// PDCA phase progression
// ────────────────────────────────────────────────────────────────────────

export function currentPhase(nc: NonConformity): PDCAPhase {
  if (nc.status === 'open') return 'plan';
  if (nc.status === 'in_progress') return 'do';
  if (nc.status === 'closed') return 'check';
  if (nc.status === 'verified_effective') return 'act';
  if (nc.status === 'reoccurred') return 'plan'; // de vuelta al inicio
  return 'plan';
}

export interface PDCASummary {
  total: number;
  byPhase: Record<PDCAPhase, number>;
  /** % en fase act (verified_effective). */
  effectivenessRate: number;
  /** NCs reincidentes. */
  reoccurrences: number;
}

export function buildPDCASummary(items: NonConformity[]): PDCASummary {
  const byPhase: Record<PDCAPhase, number> = { plan: 0, do: 0, check: 0, act: 0 };
  let reoccurrences = 0;
  for (const nc of items) {
    byPhase[currentPhase(nc)] += 1;
    if (nc.status === 'reoccurred') reoccurrences += 1;
  }
  const verifiedCount = byPhase.act;
  const closedOrVerified = byPhase.check + byPhase.act;
  const effectivenessRate =
    closedOrVerified > 0 ? Math.round((verifiedCount / closedOrVerified) * 100) : 0;
  return { total: items.length, byPhase, effectivenessRate, reoccurrences };
}

// ────────────────────────────────────────────────────────────────────────
// NC → action linkage health (§195)
// ────────────────────────────────────────────────────────────────────────

export interface LinkageHealth {
  totalNCs: number;
  withAction: number;
  withoutAction: number;
  orphanRate: number; // %
  /** NCs en plan sin acción asignada por más de 7d. */
  staleOrphans: NonConformity[];
}

export function checkLinkageHealth(
  items: NonConformity[],
  nowIso: string = new Date().toISOString(),
): LinkageHealth {
  const totalNCs = items.length;
  const withAction = items.filter((nc) => !!nc.correctiveActionId).length;
  const withoutAction = totalNCs - withAction;
  const orphanRate = totalNCs > 0 ? Math.round((withoutAction / totalNCs) * 100) : 0;
  const nowMs = Date.parse(nowIso);
  const staleOrphans = items.filter(
    (nc) =>
      !nc.correctiveActionId &&
      nc.status === 'open' &&
      nowMs - Date.parse(nc.detectedAt) > 7 * 86_400_000,
  );
  return { totalNCs, withAction, withoutAction, orphanRate, staleOrphans };
}

// ────────────────────────────────────────────────────────────────────────
// Effectiveness verification (§196)
// ────────────────────────────────────────────────────────────────────────

export interface EffectivenessCheck {
  ncId: string;
  /** Días desde el cierre. */
  daysSinceClosure: number;
  /** True si superó el período de prueba sin reoccurrir. */
  passed: boolean;
  /** True si verificación está pendiente (30d post cierre). */
  pendingVerification: boolean;
}

const PROBATION_DAYS = 30;

export function evaluateEffectiveness(
  nc: NonConformity,
  nowIso: string = new Date().toISOString(),
): EffectivenessCheck | null {
  if (!nc.closedAt) return null;
  const daysSinceClosure = Math.floor(
    (Date.parse(nowIso) - Date.parse(nc.closedAt)) / 86_400_000,
  );
  if (nc.status === 'reoccurred') {
    return { ncId: nc.id, daysSinceClosure, passed: false, pendingVerification: false };
  }
  if (nc.status === 'verified_effective') {
    return { ncId: nc.id, daysSinceClosure, passed: true, pendingVerification: false };
  }
  const pendingVerification = daysSinceClosure >= PROBATION_DAYS;
  return { ncId: nc.id, daysSinceClosure, passed: false, pendingVerification };
}

// ────────────────────────────────────────────────────────────────────────
// Rankings: zones / tasks with most NCs (§199-200)
// ────────────────────────────────────────────────────────────────────────

export interface ZoneRankEntry {
  location: string;
  ncCount: number;
  criticalCount: number;
}

export function rankZonesByNonConformities(items: NonConformity[]): ZoneRankEntry[] {
  const map = new Map<string, ZoneRankEntry>();
  for (const nc of items) {
    let entry = map.get(nc.location);
    if (!entry) {
      entry = { location: nc.location, ncCount: 0, criticalCount: 0 };
      map.set(nc.location, entry);
    }
    entry.ncCount += 1;
    if (nc.severity === 'critical') entry.criticalCount += 1;
  }
  return [...map.values()].sort((a, b) => b.criticalCount - a.criticalCount || b.ncCount - a.ncCount);
}

export interface TaskRankEntry {
  taskId: string;
  ncCount: number;
  bySeverity: Record<NonConformitySeverity, number>;
}

export function rankTasksByNonConformities(items: NonConformity[]): TaskRankEntry[] {
  const map = new Map<string, TaskRankEntry>();
  for (const nc of items) {
    if (!nc.taskId) continue;
    let entry = map.get(nc.taskId);
    if (!entry) {
      entry = {
        taskId: nc.taskId,
        ncCount: 0,
        bySeverity: { minor: 0, major: 0, critical: 0 },
      };
      map.set(nc.taskId, entry);
    }
    entry.ncCount += 1;
    entry.bySeverity[nc.severity] += 1;
  }
  return [...map.values()].sort((a, b) => b.bySeverity.critical - a.bySeverity.critical || b.ncCount - a.ncCount);
}
