// Praeventio Guard — Sprint K: Adopción + Embudo Conversión + Churn + First Value.
//
// Cierra: Documento usuario "§164-170"
//
// Métricas de producto:
//   - Adopción de módulos: qué % de tenants usa cada módulo
//   - Embudo: signup → first_project → first_team → first_incident → daily_active
//   - Churn: cuántos tenants se fueron y por qué señal
//   - Onboarding por rol: tiempo a "first value"
//   - Venta consultiva: identificar tenants estancados antes de churn
//
// Determinístico.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ModuleUsageKind =
  | 'projects'
  | 'workers'
  | 'incidents'
  | 'findings'
  | 'documents'
  | 'cphs'
  | 'training'
  | 'epp'
  | 'audit_portal'
  | 'sitebook'
  | 'work_permits';

export interface TenantUsageSnapshot {
  tenantId: string;
  /** Fecha del snapshot. */
  snapshotAt: string;
  /** Días desde signup. */
  daysSinceSignup: number;
  /** Módulos activamente usados (>= 1 evento en 30d). */
  activeModules: Set<ModuleUsageKind>;
  /** Eventos totales últimos 30d. */
  events30d: number;
  /** Workers/projects/incidents activos. */
  activeWorkers: number;
  activeProjects: number;
  /** Si tiene plan pago activo. */
  hasPaidPlan: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Module adoption (§164)
// ────────────────────────────────────────────────────────────────────────

export interface ModuleAdoptionReport {
  totalTenants: number;
  byModule: Record<ModuleUsageKind, { adopters: number; adoptionPercent: number }>;
}

export function buildModuleAdoptionReport(snapshots: TenantUsageSnapshot[]): ModuleAdoptionReport {
  const total = snapshots.length;
  const modules: ModuleUsageKind[] = [
    'projects',
    'workers',
    'incidents',
    'findings',
    'documents',
    'cphs',
    'training',
    'epp',
    'audit_portal',
    'sitebook',
    'work_permits',
  ];

  const byModule: ModuleAdoptionReport['byModule'] = {} as ModuleAdoptionReport['byModule'];
  for (const m of modules) {
    const adopters = snapshots.filter((s) => s.activeModules.has(m)).length;
    byModule[m] = {
      adopters,
      adoptionPercent: total > 0 ? Math.round((adopters / total) * 100) : 0,
    };
  }
  return { totalTenants: total, byModule };
}

// ────────────────────────────────────────────────────────────────────────
// Funnel (§165 embudo)
// ────────────────────────────────────────────────────────────────────────

export type FunnelStage =
  | 'signup'
  | 'first_project'
  | 'first_team'
  | 'first_incident_logged'
  | 'first_document_uploaded'
  | 'daily_active';

export interface FunnelReport {
  stages: Array<{ stage: FunnelStage; reached: number; percentOfPrevious: number; percentOfSignup: number }>;
}

export function buildFunnelReport(snapshots: TenantUsageSnapshot[]): FunnelReport {
  const total = snapshots.length;

  const counts = {
    signup: total,
    first_project: snapshots.filter((s) => s.activeProjects >= 1).length,
    first_team: snapshots.filter((s) => s.activeWorkers >= 3).length,
    first_incident_logged: snapshots.filter((s) => s.activeModules.has('incidents')).length,
    first_document_uploaded: snapshots.filter((s) => s.activeModules.has('documents')).length,
    daily_active: snapshots.filter((s) => s.events30d >= 30).length, // ~1/día
  };

  const ordered: FunnelStage[] = [
    'signup',
    'first_project',
    'first_team',
    'first_incident_logged',
    'first_document_uploaded',
    'daily_active',
  ];

  const stages = ordered.map((stage, i) => {
    const reached = counts[stage];
    const prev = i > 0 ? counts[ordered[i - 1]] : reached;
    return {
      stage,
      reached,
      percentOfPrevious: prev > 0 ? Math.round((reached / prev) * 100) : 0,
      percentOfSignup: total > 0 ? Math.round((reached / total) * 100) : 0,
    };
  });

  return { stages };
}

// ────────────────────────────────────────────────────────────────────────
// Churn risk (§166)
// ────────────────────────────────────────────────────────────────────────

export interface ChurnRiskReport {
  tenantId: string;
  /** Score 0-100, mayor = más riesgo. */
  riskScore: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
}

export function assessChurnRisk(snapshot: TenantUsageSnapshot): ChurnRiskReport {
  let score = 0;
  const signals: string[] = [];

  if (snapshot.events30d === 0) {
    score += 50;
    signals.push('0 eventos en 30 días');
  } else if (snapshot.events30d < 5) {
    score += 30;
    signals.push(`Solo ${snapshot.events30d} eventos en 30d`);
  }

  if (snapshot.activeModules.size <= 1) {
    score += 20;
    signals.push('Usa 1 o menos módulos');
  }

  if (snapshot.activeWorkers === 0) {
    score += 15;
    signals.push('Sin trabajadores activos');
  }

  if (snapshot.daysSinceSignup > 30 && snapshot.activeProjects === 0) {
    score += 25;
    signals.push('30d+ sin crear primer proyecto');
  }

  if (!snapshot.hasPaidPlan && snapshot.daysSinceSignup > 14) {
    score += 10;
    signals.push('Trial sin conversión a paid');
  }

  score = Math.min(score, 100);
  let level: ChurnRiskReport['level'];
  if (score >= 75) level = 'critical';
  else if (score >= 50) level = 'high';
  else if (score >= 25) level = 'medium';
  else level = 'low';

  return { tenantId: snapshot.tenantId, riskScore: score, level, signals };
}

// ────────────────────────────────────────────────────────────────────────
// First value time (§167-169)
// ────────────────────────────────────────────────────────────────────────

export interface FirstValueEvent {
  tenantId: string;
  signupAt: string;
  /** Cuándo logró el primer "valor" (proyecto + worker + 1er incidente registrado). */
  firstValueAt?: string;
}

export interface FirstValueReport {
  total: number;
  reachedFirstValue: number;
  averageDaysToFirstValue: number;
  /** Tenants que pasaron 7d+ sin first value. */
  stuckCount: number;
}

export function buildFirstValueReport(
  events: FirstValueEvent[],
  nowIso: string = new Date().toISOString(),
): FirstValueReport {
  const total = events.length;
  const reached = events.filter((e) => e.firstValueAt);
  const totalDays = reached.reduce((sum, e) => {
    return sum + (Date.parse(e.firstValueAt!) - Date.parse(e.signupAt)) / 86_400_000;
  }, 0);
  const averageDays =
    reached.length > 0 ? Math.round((totalDays / reached.length) * 10) / 10 : 0;
  const nowMs = Date.parse(nowIso);
  const stuckCount = events.filter(
    (e) => !e.firstValueAt && nowMs - Date.parse(e.signupAt) > 7 * 86_400_000,
  ).length;

  return {
    total,
    reachedFirstValue: reached.length,
    averageDaysToFirstValue: averageDays,
    stuckCount,
  };
}
