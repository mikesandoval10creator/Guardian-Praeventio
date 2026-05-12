// Praeventio Guard — Sprint 39 Fase F.2: semáforo cumplimiento por proyecto.
//
// Cierra: Documento usuario "Recomendaciones nuevas §2"
//         Plan integral Fase F.2
//
// Convierte el estado del proyecto (vencimientos + reglas legales +
// hallazgos abiertos) en señal verde/amarillo/rojo por 8 categorías.
//
// Diseño:
//   - Determinístico (NO LLM), basado en reglas claras
//   - Reusa scanForExpirations (B.9) y getCriticalRequirements (B.10)
//   - Pure function: recibe el estado consolidado, devuelve el semáforo
//   - El caller (UI / dashboard) sólo presenta el resultado

import { scanForExpirations, type ExpirableItem } from '../expirations/expirationScanner.js';
import {
  getCriticalRequirements,
  type ProjectProfile,
} from '../legal/legalRuleEngine.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ComplianceCategory =
  | 'legal'
  | 'documentation'
  | 'training'
  | 'epp'
  | 'emergencies'
  | 'occupational_health'
  | 'maintenance'
  | 'audits';

export type TrafficLight = 'green' | 'yellow' | 'red';

export interface CategoryStatus {
  category: ComplianceCategory;
  light: TrafficLight;
  /** Resumen humano del estado para UI tooltip. */
  summary: string;
  /** Detalles para drill-down: ids de items críticos. */
  criticalItemIds: string[];
  /** Conteo de items con warning (no críticos pero pendientes). */
  warningCount: number;
}

export interface ComplianceTrafficLightResult {
  /** Overall = peor de las 8 categorías. */
  overall: TrafficLight;
  byCategory: CategoryStatus[];
  /** Score 0-100 derivado del overall + balance. */
  score: number;
  /** Timestamp del cómputo (caller lo persiste en cache). */
  computedAt: string;
}

export interface TrafficLightInput {
  profile: ProjectProfile;
  /** Items de cada categoría que tengan `expiresAt`. */
  expirableItems: ExpirableItem[];
  /** RuleIds críticos YA atendidos por el proyecto (proceso wired). */
  attendedLegalRuleIds: string[];
  /** Findings abiertos por categoría con severity ≥ media. */
  openFindings: Array<{
    id: string;
    category: ComplianceCategory;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  /** Override de "now" para tests. */
  now?: Date;
}

// ────────────────────────────────────────────────────────────────────────
// Engine
// ────────────────────────────────────────────────────────────────────────

const KIND_TO_CATEGORY: Record<string, ComplianceCategory> = {
  epp: 'epp',
  document: 'documentation',
  training: 'training',
  occupational_exam: 'occupational_health',
  medical_fitness: 'occupational_health',
  work_permit: 'documentation',
  license: 'documentation',
  contract: 'documentation',
  audit_action: 'audits',
};

export function computeTrafficLight(
  input: TrafficLightInput,
): ComplianceTrafficLightResult {
  const now = input.now ?? new Date();
  const scan = scanForExpirations(input.expirableItems, { now });

  // ── Categoría: legal ───────────────────────────────────────────────
  const criticalLegal = getCriticalRequirements(input.profile);
  const unmetLegal = criticalLegal.filter(
    (r) => !input.attendedLegalRuleIds.includes(r.ruleId),
  );
  const legalStatus: CategoryStatus = {
    category: 'legal',
    light: unmetLegal.length > 0 ? 'red' : 'green',
    summary:
      unmetLegal.length > 0
        ? `${unmetLegal.length} obligación(es) legales sin atender`
        : 'Obligaciones legales críticas atendidas',
    criticalItemIds: unmetLegal.map((r) => r.ruleId),
    warningCount: 0,
  };

  // ── Categorías que dependen de expirations ────────────────────────
  const buckets = bucketByCategory(scan);

  // ── Categoría: emergencias ────────────────────────────────────────
  // No tiene expirables propios; usa findings tipo 'emergency'/'safety'
  // como proxy.
  const emergencyFindings = input.openFindings.filter(
    (f) => f.category === 'emergencies',
  );
  const criticalEmergency = emergencyFindings.filter(
    (f) => f.severity === 'high' || f.severity === 'critical',
  );
  const emergenciesStatus: CategoryStatus = {
    category: 'emergencies',
    light:
      criticalEmergency.length > 0
        ? 'red'
        : emergencyFindings.length > 0
          ? 'yellow'
          : 'green',
    summary:
      criticalEmergency.length > 0
        ? `${criticalEmergency.length} hallazgo(s) crítico(s) de emergencias`
        : emergencyFindings.length > 0
          ? `${emergencyFindings.length} hallazgo(s) menores`
          : 'Sin hallazgos abiertos',
    criticalItemIds: criticalEmergency.map((f) => f.id),
    warningCount: emergencyFindings.length - criticalEmergency.length,
  };

  // ── Compose all 8 categories ──────────────────────────────────────
  const byCategory: CategoryStatus[] = [
    legalStatus,
    buildExpirationCategory('documentation', buckets.documentation),
    buildExpirationCategory('training', buckets.training),
    buildExpirationCategory('epp', buckets.epp),
    emergenciesStatus,
    buildExpirationCategory('occupational_health', buckets.occupational_health),
    buildExpirationCategory('maintenance', buckets.maintenance),
    buildExpirationCategory('audits', buckets.audits),
  ];

  // ── Overall = peor de todas. Score = % green + 50% yellow. ────────
  const lights = byCategory.map((c) => c.light);
  const overall: TrafficLight = lights.includes('red')
    ? 'red'
    : lights.includes('yellow')
      ? 'yellow'
      : 'green';

  const greenCount = lights.filter((l) => l === 'green').length;
  const yellowCount = lights.filter((l) => l === 'yellow').length;
  const score = Math.round(
    ((greenCount + yellowCount * 0.5) / byCategory.length) * 100,
  );

  return {
    overall,
    byCategory,
    score,
    computedAt: now.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

interface Buckets {
  documentation: { expired: ExpirableItem[]; warning: ExpirableItem[] };
  training: { expired: ExpirableItem[]; warning: ExpirableItem[] };
  epp: { expired: ExpirableItem[]; warning: ExpirableItem[] };
  occupational_health: { expired: ExpirableItem[]; warning: ExpirableItem[] };
  maintenance: { expired: ExpirableItem[]; warning: ExpirableItem[] };
  audits: { expired: ExpirableItem[]; warning: ExpirableItem[] };
}

function bucketByCategory(scan: ReturnType<typeof scanForExpirations>): Buckets {
  const buckets: Buckets = {
    documentation: { expired: [], warning: [] },
    training: { expired: [], warning: [] },
    epp: { expired: [], warning: [] },
    occupational_health: { expired: [], warning: [] },
    maintenance: { expired: [], warning: [] },
    audits: { expired: [], warning: [] },
  };

  // Maintenance no se mapea desde ExpirationKind directamente (sin kind
  // específico — los items de mantenimiento son tasks vencidas). Para esta
  // versión inicial dejamos maintenance vacío y el caller puede pasar
  // items con kind='audit_action' que termina en 'audits'.

  for (const outcome of scan.expired) {
    const cat = KIND_TO_CATEGORY[outcome.item.kind];
    if (cat && cat in buckets) (buckets as any)[cat].expired.push(outcome.item);
  }
  for (const outcome of [...scan.critical, ...scan.warning]) {
    const cat = KIND_TO_CATEGORY[outcome.item.kind];
    if (cat && cat in buckets) (buckets as any)[cat].warning.push(outcome.item);
  }

  return buckets;
}

function buildExpirationCategory(
  category: ComplianceCategory,
  bucket: { expired: ExpirableItem[]; warning: ExpirableItem[] },
): CategoryStatus {
  const expiredCount = bucket.expired.length;
  const warningCount = bucket.warning.length;
  const light: TrafficLight =
    expiredCount > 0 ? 'red' : warningCount > 0 ? 'yellow' : 'green';
  const summary =
    expiredCount > 0
      ? `${expiredCount} item(s) vencido(s) + ${warningCount} por vencer`
      : warningCount > 0
        ? `${warningCount} item(s) por vencer`
        : 'Sin alertas';
  return {
    category,
    light,
    summary,
    criticalItemIds: bucket.expired.map((i) => i.id),
    warningCount,
  };
}
