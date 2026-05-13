// Praeventio Guard — Sprint K: BBS (Behavior-Based Safety) Observation Engine.
//
// Cierra: Documento usuario "Recomendaciones nuevas (cultura preventiva)".
//
// BBS es metodología estándar (DuPont, BST): observadores entrenados
// registran observaciones de comportamiento — seguros o de riesgo —
// y se construye un perfil estadístico:
//   - % comportamientos seguros vs riesgo
//   - Categorías con más desviación
//   - Sin nombres (anti-blaming): se reporta por área, no por trabajador
//
// Importante: §52 directriz "no culpar". El motor agrupa por área o
// proceso, nunca expone identidad individual fuera del observador.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ObservationCategory =
  | 'epp'
  | 'positioning'
  | 'tools_equipment'
  | 'procedures'
  | 'housekeeping'
  | 'ergonomics'
  | 'communication';

export type BehaviorOutcome = 'safe' | 'at_risk';

export interface BbsObservation {
  observationId: string;
  tenantId: string;
  /** Área u proceso (NUNCA workerUid). */
  areaId: string;
  category: ObservationCategory;
  outcome: BehaviorOutcome;
  /** Descripción breve. */
  note: string;
  /** Observador anónimo solo por uid (no se expone afuera). */
  observerUid: string;
  /** ISO-8601. */
  observedAt: string;
}

export interface BbsProfile {
  tenantId: string;
  windowStart: string;
  windowEnd: string;
  totalObservations: number;
  safePercentage: number;
  byCategory: Record<ObservationCategory, CategoryStats>;
  /** Categorías con safePercentage < 70 → foco intervención. */
  focusCategories: ObservationCategory[];
  /** Áreas con mayor % at_risk (top 3). */
  topRiskAreas: Array<{ areaId: string; atRiskPct: number; total: number }>;
}

export interface CategoryStats {
  total: number;
  safe: number;
  atRisk: number;
  safePercentage: number;
}

export class BbsValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'BbsValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Record observation
// ────────────────────────────────────────────────────────────────────────

export interface RecordObservationInput {
  observationId: string;
  tenantId: string;
  areaId: string;
  category: ObservationCategory;
  outcome: BehaviorOutcome;
  note: string;
  observerUid: string;
  now?: Date;
}

export function recordObservation(input: RecordObservationInput): BbsObservation {
  if (!input.observationId?.trim()) throw new BbsValidationError('NO_ID', 'observationId requerido');
  if (!input.tenantId?.trim()) throw new BbsValidationError('NO_TENANT', 'tenantId requerido');
  if (!input.areaId?.trim()) throw new BbsValidationError('NO_AREA', 'areaId requerido');
  if (!input.observerUid?.trim()) throw new BbsValidationError('NO_OBSERVER', 'observerUid requerido');
  if (input.note.trim().length < 5) {
    throw new BbsValidationError('NOTE_TOO_SHORT', 'nota debe tener >=5 caracteres');
  }
  // Anti-blame: rechazar notas que mencionen rut/nombres obvios.
  if (containsPersonalIdentifier(input.note)) {
    throw new BbsValidationError(
      'NOTE_HAS_PII',
      'la nota no debe contener nombres o RUT — BBS es anónimo',
    );
  }
  const now = input.now ?? new Date();
  return {
    observationId: input.observationId,
    tenantId: input.tenantId,
    areaId: input.areaId,
    category: input.category,
    outcome: input.outcome,
    note: input.note.trim(),
    observerUid: input.observerUid,
    observedAt: now.toISOString(),
  };
}

const RUT_RE = /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/;
const NAME_HINT_RE = /(^|\s)(sr\.|sra\.|don|doña)\s/i;

function containsPersonalIdentifier(text: string): boolean {
  if (RUT_RE.test(text)) return true;
  if (NAME_HINT_RE.test(text)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Profile aggregation
// ────────────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: ObservationCategory[] = [
  'epp',
  'positioning',
  'tools_equipment',
  'procedures',
  'housekeeping',
  'ergonomics',
  'communication',
];

export interface BuildProfileInput {
  tenantId: string;
  observations: BbsObservation[];
  windowStart: Date;
  windowEnd: Date;
}

export function buildProfile(input: BuildProfileInput): BbsProfile {
  if (!input.tenantId?.trim()) throw new BbsValidationError('NO_TENANT', 'tenantId requerido');
  if (input.windowEnd.getTime() < input.windowStart.getTime()) {
    throw new BbsValidationError('BAD_WINDOW', 'windowEnd < windowStart');
  }
  const startMs = input.windowStart.getTime();
  const endMs = input.windowEnd.getTime();

  // Multi-tenant isolation: filtrar solo observaciones del tenant + ventana.
  const filtered = input.observations.filter((o) => {
    if (o.tenantId !== input.tenantId) return false;
    const t = Date.parse(o.observedAt);
    if (Number.isNaN(t)) return false;
    return t >= startMs && t <= endMs;
  });

  const byCategory = {} as Record<ObservationCategory, CategoryStats>;
  for (const c of ALL_CATEGORIES) {
    byCategory[c] = { total: 0, safe: 0, atRisk: 0, safePercentage: 0 };
  }
  const byArea = new Map<string, { total: number; atRisk: number }>();

  let safe = 0;
  for (const o of filtered) {
    const cs = byCategory[o.category];
    cs.total += 1;
    if (o.outcome === 'safe') {
      cs.safe += 1;
      safe += 1;
    } else {
      cs.atRisk += 1;
    }
    const area = byArea.get(o.areaId) ?? { total: 0, atRisk: 0 };
    area.total += 1;
    if (o.outcome === 'at_risk') area.atRisk += 1;
    byArea.set(o.areaId, area);
  }

  for (const c of ALL_CATEGORIES) {
    const cs = byCategory[c];
    cs.safePercentage = cs.total === 0 ? 0 : Math.round((cs.safe / cs.total) * 1000) / 10;
  }

  const focusCategories = ALL_CATEGORIES.filter(
    (c) => byCategory[c].total > 0 && byCategory[c].safePercentage < 70,
  );

  const topRiskAreas = Array.from(byArea.entries())
    .map(([areaId, v]) => ({
      areaId,
      atRiskPct: v.total === 0 ? 0 : Math.round((v.atRisk / v.total) * 1000) / 10,
      total: v.total,
    }))
    .sort((a, b) => b.atRiskPct - a.atRiskPct || b.total - a.total)
    .slice(0, 3);

  const totalObservations = filtered.length;
  const safePercentage =
    totalObservations === 0 ? 0 : Math.round((safe / totalObservations) * 1000) / 10;

  return {
    tenantId: input.tenantId,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    totalObservations,
    safePercentage,
    byCategory,
    focusCategories,
    topRiskAreas,
  };
}
