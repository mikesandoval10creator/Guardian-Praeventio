// Praeventio Guard — Executive ESG + ISO 45001 scorecards.
//
// Pure derivation of the ExecutiveDashboard radars from REAL node data. This
// replaces the previous in-component formulas that padded empty categories with
// fabricated floors (50 / 40 / `|| 70` / `?? 70`) and shipped those invented
// numbers into the mandante PDF. "Hacerlo honesto es hacerlo real": every axis
// is now a real ratio of real nodes; a category with no underlying data is
// flagged `insufficient_data` (and renders 0 / "—"), never a plausible constant.
//
// Mirrors the honest pattern already used in src/pages/Analytics.tsx
// (pct + insufficient_data). Extracted here so it is unit-testable in node-env.

import { type RiskNode, NodeType } from '../../types';

export interface RadarAxis {
  subject: string;
  /** 0–100 real ratio. 0 when `insufficient_data` (no underlying nodes). */
  A: number;
  /** True when the category has no data to derive a score from. */
  insufficient_data: boolean;
}

export interface ExecutiveScorecards {
  /** Environmental · Social · Governance · Capacitación · Incidentes. */
  esgData: RadarAxis[];
  /** EPP · Normativa · Conducta · Procesos · Entorno (ISO 45001). */
  isoData: RadarAxis[];
  /** Average of the ESG axes that HAVE data (empty axes never pad/drag it). */
  esgTotal: number;
  esgEnvironmental: number;
  esgSocial: number;
  esgGovernance: number;
}

export interface ScorecardInputs {
  nodes: RiskNode[];
  /** Project ids in scope (for incident-free ratio + governance availability). */
  projectIds: string[];
  /** Total workers across the projects (Σ workersCount). */
  totalWorkers: number;
  /** Real average compliance % (from calculateCompliance) — the Governance axis. */
  avgCompliance: number;
  /** "Now" in ms for the 30-day recent-incident window. Defaults to Date.now(). */
  nowMs?: number;
}

const CLOSED_STATES = new Set([
  'cerrado',
  'cerrada',
  'closed',
  'completed',
  'completado',
  'completada',
]);

/** num/den → 0–100 integer; 0 when there's no denominator. */
function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

export function computeExecutiveScorecards(input: ScorecardInputs): ExecutiveScorecards {
  const { nodes, projectIds, totalWorkers, avgCompliance } = input;
  const nowMs = input.nowMs ?? Date.now();
  const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;

  const byType = (t: NodeType) => nodes.filter((n) => n.type === t);

  // ── Shared real signals ────────────────────────────────────────────────
  const trainingNodes = byType(NodeType.TRAINING);
  const trainedCompleted = trainingNodes.filter((n) => n.metadata?.status === 'completed').length;

  const eppNodes = byType(NodeType.EPP);
  const eppConformes = eppNodes.filter((n) => n.metadata?.status === 'Conforme').length;

  const auditNodes = byType(NodeType.AUDIT);
  const auditsCumple = auditNodes.filter((a) => a.metadata?.status === 'Cumple').length;
  const auditsConItems = auditNodes.filter(
    (a) => Array.isArray(a.metadata?.items) && (a.metadata!.items as unknown[]).length > 0,
  );
  const auditsSinNoCumple = auditsConItems.filter((a) => {
    const items = a.metadata?.items as Array<{ status?: string }>;
    return !items.some((it) => it?.status === 'No Cumple');
  }).length;

  const findingNodes = byType(NodeType.FINDING);
  const closedFindings = findingNodes.filter((f) => {
    const s = (f.metadata?.status ?? f.metadata?.estado ?? '').toString().toLowerCase();
    return CLOSED_STATES.has(s);
  }).length;

  const riskNodes = byType(NodeType.RISK);
  const risksControlados = riskNodes.filter((r) => {
    const level = r.metadata?.level;
    return level !== 'Crítico' && level !== 'Alto';
  }).length;

  const recentIncidentProjects = new Set(
    byType(NodeType.INCIDENT)
      .filter((n) => {
        const t = new Date(n.createdAt).getTime();
        return Number.isFinite(t) && t >= thirtyDaysAgo;
      })
      .map((n) => n.projectId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const incidentFreeProjects = projectIds.filter((id) => !recentIncidentProjects.has(id)).length;

  // ── ESG axes (real ratios) ──────────────────────────────────────────────
  const esgEnvironmental = pct(risksControlados, riskNodes.length); // % riesgos controlados
  const esgSocial = pct(trainedCompleted, totalWorkers); // % trabajadores capacitados
  const esgGovernance = avgCompliance; // % cumplimiento real
  const esgCapacitacion = pct(trainedCompleted, trainingNodes.length); // % capacitaciones completas
  const esgIncidentes = pct(incidentFreeProjects, projectIds.length); // % proyectos sin incidente reciente

  const esgData: RadarAxis[] = [
    { subject: 'Ambiente', A: esgEnvironmental, insufficient_data: riskNodes.length === 0 },
    { subject: 'Social', A: esgSocial, insufficient_data: totalWorkers === 0 },
    { subject: 'Gobierno', A: esgGovernance, insufficient_data: projectIds.length === 0 },
    { subject: 'Capacitación', A: esgCapacitacion, insufficient_data: trainingNodes.length === 0 },
    { subject: 'Incidentes', A: esgIncidentes, insufficient_data: projectIds.length === 0 },
  ];

  const esgWithData = esgData.filter((d) => !d.insufficient_data);
  const esgTotal =
    esgWithData.length > 0
      ? Math.round(esgWithData.reduce((s, d) => s + d.A, 0) / esgWithData.length)
      : 0;

  // ── ISO 45001 axes (same real derivation as Analytics.tsx) ───────────────
  const isoData: RadarAxis[] = [
    { subject: 'EPP', A: pct(eppConformes, eppNodes.length), insufficient_data: eppNodes.length === 0 },
    { subject: 'Normativa', A: pct(auditsCumple, auditNodes.length), insufficient_data: auditNodes.length === 0 },
    { subject: 'Conducta', A: pct(closedFindings, findingNodes.length), insufficient_data: findingNodes.length === 0 },
    { subject: 'Procesos', A: pct(auditsSinNoCumple, auditsConItems.length), insufficient_data: auditsConItems.length === 0 },
    { subject: 'Entorno', A: pct(risksControlados, riskNodes.length), insufficient_data: riskNodes.length === 0 },
  ];

  return { esgData, isoData, esgTotal, esgEnvironmental, esgSocial, esgGovernance };
}
