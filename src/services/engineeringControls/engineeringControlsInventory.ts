// Praeventio Guard — Sprint K: Inventario Controles Ingeniería + Jerarquía + EPP Quality Audit.
//
// Cierra: Documento usuario "§42-44"
//
// Catálogo separado de los controles de ingeniería de un proyecto:
// barreras físicas, ventilación, encapsulamientos, interlocks, sensores.
// Cuenta TANTO porque la jerarquía ISO 45001 dice que estos son
// preferibles al EPP, y este módulo permite:
//
//   - Auditoría de qué controles de ingeniería existen vs. cuáles
//     deberían existir según los riesgos del proyecto (§42)
//   - Verificar la jerarquía aplicada: si hay controles físicos en su
//     lugar antes de recurrir a admin/EPP (§43)
//   - Auditoría de calidad de EPP: estado, mantenimiento, registros
//     (§44)
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Engineering controls
// ────────────────────────────────────────────────────────────────────────

export type EngineeringControlKind =
  | 'physical_barrier'      // baranda, malla, mampara
  | 'ventilation'           // ventilación forzada / local
  | 'extraction'            // extracción localizada
  | 'encapsulation'         // encapsulamiento de fuente
  | 'interlock'             // interlock electromecánico
  | 'sensor_safety'         // sensor de presencia, gas, llama
  | 'noise_attenuation'     // atenuación acústica
  | 'thermal_insulation'    // aislamiento térmico
  | 'spill_containment';    // contención de derrame

export interface EngineeringControl {
  id: string;
  kind: EngineeringControlKind;
  label: string;
  /** Categoría de riesgo que mitiga. */
  mitigatesRiskCategory: string;
  /** Ubicación. */
  location: string;
  /** Estado operativo. */
  status: 'operativo' | 'mantenimiento_pendiente' | 'fuera_servicio';
  /** ISO-8601 del último check. */
  lastCheckedAt?: string;
  /** UID del responsable de mantención. */
  maintainedByUid: string;
}

export interface EngineeringInventoryReport {
  total: number;
  byKind: Record<EngineeringControlKind, number>;
  /** Riesgos cubiertos por al menos 1 control físico operativo. */
  coveredRiskCategories: string[];
  /** Riesgos del proyecto SIN ningún control físico → flag. */
  uncoveredRiskCategories: string[];
  /** Controles fuera de servicio (gap operativo inmediato). */
  outOfService: EngineeringControl[];
}

export function buildEngineeringInventoryReport(
  controls: EngineeringControl[],
  projectRiskCategories: string[],
): EngineeringInventoryReport {
  const byKind = {
    physical_barrier: 0,
    ventilation: 0,
    extraction: 0,
    encapsulation: 0,
    interlock: 0,
    sensor_safety: 0,
    noise_attenuation: 0,
    thermal_insulation: 0,
    spill_containment: 0,
  } as Record<EngineeringControlKind, number>;

  for (const c of controls) byKind[c.kind] += 1;

  const operative = controls.filter((c) => c.status === 'operativo');
  const coveredRiskCategories = [...new Set(operative.map((c) => c.mitigatesRiskCategory))];
  const uncoveredRiskCategories = projectRiskCategories.filter(
    (r) => !coveredRiskCategories.includes(r),
  );
  const outOfService = controls.filter((c) => c.status === 'fuera_servicio');

  return {
    total: controls.length,
    byKind,
    coveredRiskCategories,
    uncoveredRiskCategories,
    outOfService,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Hierarchy audit (§43)
// ────────────────────────────────────────────────────────────────────────

export type HierarchyLevel = 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'epp';

export interface RiskHierarchyState {
  riskCategory: string;
  /** Si hay controles de cada nivel aplicados en operación. */
  presentLevels: Set<HierarchyLevel>;
}

export interface HierarchyAuditResult {
  riskCategory: string;
  highestLevelApplied: HierarchyLevel | null;
  /** True si el riesgo depende SOLO de EPP/admin (señal mala). */
  onlyLowerTier: boolean;
  /** Niveles sugeridos a agregar. */
  suggestedAdditions: HierarchyLevel[];
}

const HIERARCHY_ORDER: HierarchyLevel[] = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
];

export function auditRiskHierarchy(state: RiskHierarchyState): HierarchyAuditResult {
  const present = HIERARCHY_ORDER.filter((l) => state.presentLevels.has(l));
  const highestLevelApplied = present[0] ?? null;
  const onlyLowerTier =
    present.length > 0 &&
    !state.presentLevels.has('elimination') &&
    !state.presentLevels.has('substitution') &&
    !state.presentLevels.has('engineering');

  const suggestedAdditions: HierarchyLevel[] = [];
  if (!state.presentLevels.has('engineering') && !state.presentLevels.has('substitution')) {
    suggestedAdditions.push('engineering');
  }
  if (!state.presentLevels.has('elimination')) {
    suggestedAdditions.push('elimination');
  }

  return {
    riskCategory: state.riskCategory,
    highestLevelApplied,
    onlyLowerTier,
    suggestedAdditions,
  };
}

// ────────────────────────────────────────────────────────────────────────
// EPP quality audit (§44)
// ────────────────────────────────────────────────────────────────────────

export interface EppItem {
  id: string;
  category: string; // 'arnés', 'casco', 'guantes', ...
  workerUid: string;
  /** ISO-8601 cuando se entregó. */
  handedOverAt: string;
  /** Si fue inspeccionado periódicamente. */
  lastInspectedAt?: string;
  /** Vida útil estimada (días). */
  estimatedLifespanDays: number;
  /** ISO-8601 calculado: handedOverAt + lifespan. */
  expectedReplacementAt?: string;
  /** Estado registrado en la última inspección. */
  inspectedState?: 'apto' | 'observado' | 'inutilizable';
  /** Si está aún en uso. */
  inUse: boolean;
}

export interface EppQualityIssue {
  eppId: string;
  category: string;
  workerUid: string;
  issue:
    | 'never_inspected'
    | 'overdue_inspection'
    | 'inutilizable_still_in_use'
    | 'past_lifespan'
    | 'observado_no_action';
  description: string;
}

export interface EppQualityReport {
  totalEpp: number;
  withIssues: number;
  byIssue: Record<EppQualityIssue['issue'], number>;
  issues: EppQualityIssue[];
}

const INSPECTION_INTERVAL_DAYS = 90;

export function auditEppQuality(
  items: EppItem[],
  nowIso: string = new Date().toISOString(),
): EppQualityReport {
  const nowMs = Date.parse(nowIso);
  const issues: EppQualityIssue[] = [];

  for (const e of items) {
    if (!e.inUse) continue;

    if (!e.lastInspectedAt) {
      const ageDays = (nowMs - Date.parse(e.handedOverAt)) / 86_400_000;
      if (ageDays > INSPECTION_INTERVAL_DAYS) {
        issues.push({
          eppId: e.id,
          category: e.category,
          workerUid: e.workerUid,
          issue: 'never_inspected',
          description: `EPP ${e.category} de ${e.workerUid} nunca inspeccionado (${Math.floor(ageDays)}d en uso).`,
        });
      }
    } else {
      const sinceInspection = (nowMs - Date.parse(e.lastInspectedAt)) / 86_400_000;
      if (sinceInspection > INSPECTION_INTERVAL_DAYS) {
        issues.push({
          eppId: e.id,
          category: e.category,
          workerUid: e.workerUid,
          issue: 'overdue_inspection',
          description: `EPP ${e.category} de ${e.workerUid} sin inspección hace ${Math.floor(sinceInspection)}d (> ${INSPECTION_INTERVAL_DAYS}d).`,
        });
      }
    }

    if (e.inspectedState === 'inutilizable') {
      issues.push({
        eppId: e.id,
        category: e.category,
        workerUid: e.workerUid,
        issue: 'inutilizable_still_in_use',
        description: `EPP ${e.category} marcado inutilizable pero sigue inUse=true. Retirar inmediatamente.`,
      });
    } else if (e.inspectedState === 'observado') {
      issues.push({
        eppId: e.id,
        category: e.category,
        workerUid: e.workerUid,
        issue: 'observado_no_action',
        description: `EPP ${e.category} marcado observado sin acción de reemplazo registrada.`,
      });
    }

    if (e.expectedReplacementAt && Date.parse(e.expectedReplacementAt) < nowMs) {
      issues.push({
        eppId: e.id,
        category: e.category,
        workerUid: e.workerUid,
        issue: 'past_lifespan',
        description: `EPP ${e.category} superó vida útil estimada (${e.estimatedLifespanDays}d).`,
      });
    }
  }

  const byIssue = {
    never_inspected: 0,
    overdue_inspection: 0,
    inutilizable_still_in_use: 0,
    past_lifespan: 0,
    observado_no_action: 0,
  } as Record<EppQualityIssue['issue'], number>;
  for (const i of issues) byIssue[i.issue] += 1;

  const eppsWithIssues = new Set(issues.map((i) => i.eppId));
  return {
    totalEpp: items.length,
    withIssues: eppsWithIssues.size,
    byIssue,
    issues,
  };
}
