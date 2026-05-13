// Praeventio Guard — Sprint K: Supplier Scoring 4 dimensiones.
//
// Cierra: §180-181 (3ra tanda usuario).
//
// Ranking determinístico de proveedores/contratistas por desempeño en
// seguridad, cumplimiento documental, capacidad de respuesta y reputación.
// Pesos: 40/30/20/10. Distinto de supplierQualityService (que mide SLA).
//
// Determinístico, sin LLM ni I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface SupplierKpis {
  /** Incidentes registrados en los últimos 12 meses. */
  incidents: number;
  /** Casi-accidentes reportados en los últimos 12 meses. */
  nearMisses: number;
  /** Razón de docs vigentes / docs requeridos. 0-1. */
  documentComplianceRatio: number;
  /** Horas promedio de respuesta ante solicitudes. */
  avgResponseHours: number;
  /** Score reputacional ext. 0-1 (encuestas, referencias). */
  reputationScore: number;
}

export interface SupplierRecord {
  id: string;
  legalName: string;
  kpis: SupplierKpis;
}

export interface ScoreBreakdown {
  safetyPerformance: number;
  documentCompliance: number;
  responsiveness: number;
  reputation: number;
}

export interface ScoredSupplier {
  id: string;
  legalName: string;
  /** Score total 0-100. */
  score: number;
  breakdown: ScoreBreakdown;
}

// ────────────────────────────────────────────────────────────────────────
// Weights
// ────────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  safety: 0.4,
  documents: 0.3,
  responsiveness: 0.2,
  reputation: 0.1,
} as const;

// ────────────────────────────────────────────────────────────────────────
// Sub-scoring (each returns 0-100)
// ────────────────────────────────────────────────────────────────────────

/** Más incidentes = peor. Penaliza también near-misses (peso menor). */
function scoreSafety(k: SupplierKpis): number {
  // Modelo: cada incidente -15, cada near-miss -3, partiendo de 100, floor 0.
  const raw = 100 - k.incidents * 15 - k.nearMisses * 3;
  return Math.max(0, Math.min(100, raw));
}

function scoreDocuments(k: SupplierKpis): number {
  const ratio = Math.max(0, Math.min(1, k.documentComplianceRatio));
  return Math.round(ratio * 100);
}

/** Respuesta < 4h = 100. >= 72h = 0. Linear entre medias. */
function scoreResponsiveness(k: SupplierKpis): number {
  if (k.avgResponseHours <= 4) return 100;
  if (k.avgResponseHours >= 72) return 0;
  const range = 72 - 4;
  const over = k.avgResponseHours - 4;
  return Math.round(100 - (over / range) * 100);
}

function scoreReputation(k: SupplierKpis): number {
  const r = Math.max(0, Math.min(1, k.reputationScore));
  return Math.round(r * 100);
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

function validate(s: SupplierRecord): void {
  const k = s.kpis;
  // Codex P2 PR #129: rechazar valores no-finitos antes de scoring.
  // NaN/Infinity desde parsing de spreadsheet propagaría NaN al score
  // total y rompería el orden determinístico de rankSuppliersByScore.
  const finiteChecks: Array<[string, number]> = [
    ['incidents', k.incidents],
    ['nearMisses', k.nearMisses],
    ['avgResponseHours', k.avgResponseHours],
    ['documentComplianceRatio', k.documentComplianceRatio],
    ['reputationScore', k.reputationScore],
  ];
  for (const [name, val] of finiteChecks) {
    if (!Number.isFinite(val)) {
      throw new Error(`supplier ${s.id}: KPI ${name} must be a finite number (got ${val})`);
    }
  }
  if (k.incidents < 0 || k.nearMisses < 0 || k.avgResponseHours < 0) {
    throw new Error(`supplier ${s.id}: counts/hours must be >= 0`);
  }
  if (k.documentComplianceRatio < 0 || k.documentComplianceRatio > 1) {
    throw new Error(`supplier ${s.id}: documentComplianceRatio must be in [0,1]`);
  }
  if (k.reputationScore < 0 || k.reputationScore > 1) {
    throw new Error(`supplier ${s.id}: reputationScore must be in [0,1]`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

export function scoreSupplier(supplier: SupplierRecord): ScoredSupplier {
  validate(supplier);
  const breakdown: ScoreBreakdown = {
    safetyPerformance: scoreSafety(supplier.kpis),
    documentCompliance: scoreDocuments(supplier.kpis),
    responsiveness: scoreResponsiveness(supplier.kpis),
    reputation: scoreReputation(supplier.kpis),
  };
  const score =
    Math.round(
      (breakdown.safetyPerformance * WEIGHTS.safety +
        breakdown.documentCompliance * WEIGHTS.documents +
        breakdown.responsiveness * WEIGHTS.responsiveness +
        breakdown.reputation * WEIGHTS.reputation) *
        100,
    ) / 100;
  return { id: supplier.id, legalName: supplier.legalName, score, breakdown };
}

/**
 * Ranks suppliers desc by total score.
 * Ties broken by: safety > documents > responsiveness > reputation > id asc.
 */
export function rankSuppliersByScore(suppliers: SupplierRecord[]): ScoredSupplier[] {
  const scored = suppliers.map(scoreSupplier);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.breakdown.safetyPerformance !== a.breakdown.safetyPerformance) {
      return b.breakdown.safetyPerformance - a.breakdown.safetyPerformance;
    }
    if (b.breakdown.documentCompliance !== a.breakdown.documentCompliance) {
      return b.breakdown.documentCompliance - a.breakdown.documentCompliance;
    }
    if (b.breakdown.responsiveness !== a.breakdown.responsiveness) {
      return b.breakdown.responsiveness - a.breakdown.responsiveness;
    }
    if (b.breakdown.reputation !== a.breakdown.reputation) {
      return b.breakdown.reputation - a.breakdown.reputation;
    }
    return a.id.localeCompare(b.id);
  });
  return scored;
}
