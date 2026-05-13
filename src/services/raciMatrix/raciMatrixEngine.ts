// Praeventio Guard — Sprint 53: RACI matrix engine (§50-58 2da tanda usuario).
//
// Cierra: Documento usuario 2da tanda "§50-58 RACI matrix — Responsible /
// Accountable / Consulted / Informed para asignación de tareas".
//
// Asigna roles RACI clásicos a tareas (proyecto → cuadrilla → procesos →
// tareas, ver `product_organic_structure_2026-05-04`), valida cobertura
// mínima por matriz y detecta conflictos como sobrecarga de un uid o gaps
// críticos sin Consulted.
//
// Determinístico, sin LLM. Reglas:
//   1. Exactamente 1 'accountable' por task (mandatorio).
//   2. ≥1 'responsible' (mandatorio).
//   3. 'consulted' opcional pero recomendado para tareas críticas.
//   4. 'informed' puede ser muchos.
//   5. Un mismo uid puede tener máximo 1 role por task.
//   6. Si un uid supera 10 tasks como 'accountable' → overload warning.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RaciRole = 'responsible' | 'accountable' | 'consulted' | 'informed';

export type ValidationKind =
  | 'no_accountable'
  | 'multiple_accountable'
  | 'no_responsible'
  | 'role_overload_single_uid'
  | 'consulted_missing_for_critical'
  | 'informed_too_many';

export interface TaskRoleAssignment {
  taskId: string;
  uid: string;
  role: RaciRole;
}

export interface RaciValidationViolation {
  kind: ValidationKind;
  detail: string;
}

export interface RaciMatrix {
  taskId: string;
  taskTitle: string;
  /** True si la tarea está marcada como crítica (gating safety/SLA). */
  critical?: boolean;
  assignments: TaskRoleAssignment[];
  /** Si la matriz cumple las reglas RACI clásicas. */
  valid: boolean;
  violations: RaciValidationViolation[];
}

export interface RaciValidationResult {
  valid: boolean;
  violations: RaciValidationViolation[];
}

export interface RoleOverloadReport {
  uid: string;
  /** Total de roles asignados a este uid en todas las matrices. */
  totalRoles: number;
  /** Tareas donde uid es 'accountable' o 'responsible'. */
  criticalRoleCount: number;
  /** True si totalRoles supera el umbral (overload warning). */
  overloaded: boolean;
  /** Desglose por role. */
  byRole: Record<RaciRole, number>;
}

export interface CriticalGap {
  taskId: string;
  missingRoles: RaciRole[];
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

/** Umbral de overload: >10 tasks como accountable → warning. */
export const ACCOUNTABLE_OVERLOAD_THRESHOLD = 10;

/** Umbral de "informed_too_many" — ruido organizacional. */
export const INFORMED_NOISE_THRESHOLD = 20;

/** Umbral total de roles asignados para considerar uid sobrecargado. */
export const TOTAL_ROLES_OVERLOAD_THRESHOLD = 25;

// ────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────

/**
 * Construye una matriz RACI a partir de un set de asignaciones y la valida
 * en una sola pasada. La estructura resultante incluye los flags `valid` y
 * `violations` listas para persistir en Firestore o renderizar en UI.
 */
export function buildRaciMatrix(
  taskId: string,
  taskTitle: string,
  assignments: TaskRoleAssignment[],
  options?: { critical?: boolean },
): RaciMatrix {
  // Sólo conservamos asignaciones cuyo taskId coincide; ignoramos foráneas
  // para que un upstream sucio no contamine la matriz.
  const own = assignments.filter((a) => a.taskId === taskId);

  // Deduplicar por (uid, role): si el mismo par viene 2 veces lo unificamos.
  const seen = new Set<string>();
  const dedupAssignments: TaskRoleAssignment[] = [];
  for (const a of own) {
    const key = `${a.uid}::${a.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupAssignments.push({ ...a });
  }

  const matrixDraft: RaciMatrix = {
    taskId,
    taskTitle,
    critical: options?.critical,
    assignments: dedupAssignments,
    valid: true,
    violations: [],
  };

  const validation = validateRaci(matrixDraft);
  return {
    ...matrixDraft,
    valid: validation.valid,
    violations: validation.violations,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Validate
// ────────────────────────────────────────────────────────────────────────

/**
 * Valida una matriz RACI individual contra las reglas clásicas. No muta el
 * input; devuelve `valid` + lista de `violations` para que el caller decida
 * si bloquear el guardado o sólo mostrar warning.
 */
export function validateRaci(matrix: RaciMatrix): RaciValidationResult {
  const violations: RaciValidationViolation[] = [];
  const assignments = matrix.assignments;

  // Regla 1+2: exactamente 1 accountable.
  const accountables = assignments.filter((a) => a.role === 'accountable');
  if (accountables.length === 0) {
    violations.push({
      kind: 'no_accountable',
      detail: `Task ${matrix.taskId} no tiene 'accountable' asignado.`,
    });
  } else if (accountables.length > 1) {
    violations.push({
      kind: 'multiple_accountable',
      detail: `Task ${matrix.taskId} tiene ${accountables.length} 'accountable' (debe ser exactamente 1).`,
    });
  }

  // Regla 3: ≥1 responsible.
  const responsibles = assignments.filter((a) => a.role === 'responsible');
  if (responsibles.length === 0) {
    violations.push({
      kind: 'no_responsible',
      detail: `Task ${matrix.taskId} no tiene 'responsible' asignado.`,
    });
  }

  // Regla 5: un mismo uid puede tener máximo 1 role por task.
  const rolesByUid = new Map<string, RaciRole[]>();
  for (const a of assignments) {
    const list = rolesByUid.get(a.uid) ?? [];
    list.push(a.role);
    rolesByUid.set(a.uid, list);
  }
  for (const [uid, roles] of rolesByUid.entries()) {
    if (roles.length > 1) {
      violations.push({
        kind: 'role_overload_single_uid',
        detail: `uid ${uid} tiene ${roles.length} roles en task ${matrix.taskId} (${roles.join(', ')}); debe tener máximo 1.`,
      });
    }
  }

  // Regla 4: consulted recomendado para tareas críticas.
  if (matrix.critical === true) {
    const hasConsulted = assignments.some((a) => a.role === 'consulted');
    if (!hasConsulted) {
      violations.push({
        kind: 'consulted_missing_for_critical',
        detail: `Task crítica ${matrix.taskId} no tiene 'consulted' (recomendado para tareas críticas).`,
      });
    }
  }

  // Regla 6: informed_too_many (umbral de ruido organizacional).
  const informedCount = assignments.filter((a) => a.role === 'informed').length;
  if (informedCount > INFORMED_NOISE_THRESHOLD) {
    violations.push({
      kind: 'informed_too_many',
      detail: `Task ${matrix.taskId} tiene ${informedCount} 'informed' (>${INFORMED_NOISE_THRESHOLD} genera ruido).`,
    });
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Cross-matrix analysis
// ────────────────────────────────────────────────────────────────────────

/**
 * Detecta sobrecarga de un uid analizando *todas* las matrices del
 * proyecto. Un uid se considera overloaded si:
 *   - es 'accountable' en más de ACCOUNTABLE_OVERLOAD_THRESHOLD tasks, o
 *   - tiene más de TOTAL_ROLES_OVERLOAD_THRESHOLD roles totales.
 */
export function detectRoleOverload(
  allMatrices: RaciMatrix[],
  uid: string,
): RoleOverloadReport {
  const byRole: Record<RaciRole, number> = {
    responsible: 0,
    accountable: 0,
    consulted: 0,
    informed: 0,
  };

  for (const m of allMatrices) {
    for (const a of m.assignments) {
      if (a.uid !== uid) continue;
      byRole[a.role] += 1;
    }
  }

  const totalRoles =
    byRole.responsible + byRole.accountable + byRole.consulted + byRole.informed;
  const criticalRoleCount = byRole.responsible + byRole.accountable;
  const overloaded =
    byRole.accountable > ACCOUNTABLE_OVERLOAD_THRESHOLD ||
    totalRoles > TOTAL_ROLES_OVERLOAD_THRESHOLD;

  return {
    uid,
    totalRoles,
    criticalRoleCount,
    overloaded,
    byRole,
  };
}

/**
 * Identifica matrices con gaps críticos (sin accountable o sin responsible).
 * Pensado para dashboards "RACI Health" mostrando tareas que requieren
 * intervención del líder de proyecto.
 */
export function findCriticalGaps(matrices: RaciMatrix[]): CriticalGap[] {
  const gaps: CriticalGap[] = [];
  for (const m of matrices) {
    const missing: RaciRole[] = [];
    const hasAccountable = m.assignments.some((a) => a.role === 'accountable');
    const hasResponsible = m.assignments.some((a) => a.role === 'responsible');
    if (!hasAccountable) missing.push('accountable');
    if (!hasResponsible) missing.push('responsible');
    if (m.critical === true) {
      const hasConsulted = m.assignments.some((a) => a.role === 'consulted');
      if (!hasConsulted) missing.push('consulted');
    }
    if (missing.length > 0) {
      gaps.push({ taskId: m.taskId, missingRoles: missing });
    }
  }
  return gaps;
}

/**
 * Helper: lista uids únicos atravesando todas las matrices. Útil para
 * iterar `detectRoleOverload` sobre el universo completo.
 */
export function listUidsInMatrices(matrices: RaciMatrix[]): string[] {
  const set = new Set<string>();
  for (const m of matrices) {
    for (const a of m.assignments) {
      set.add(a.uid);
    }
  }
  return Array.from(set).sort();
}

/**
 * Agrega un reporte global de salud RACI para un proyecto: cuántas matrices
 * son válidas, cuántos gaps críticos hay y cuántos uids están overloaded.
 */
export function summarizeRaciHealth(matrices: RaciMatrix[]): {
  totalMatrices: number;
  validMatrices: number;
  criticalGapCount: number;
  overloadedUids: string[];
} {
  const validMatrices = matrices.filter((m) => m.valid).length;
  const gaps = findCriticalGaps(matrices);
  const uids = listUidsInMatrices(matrices);
  const overloadedUids = uids.filter(
    (uid) => detectRoleOverload(matrices, uid).overloaded,
  );
  return {
    totalMatrices: matrices.length,
    validMatrices,
    criticalGapCount: gaps.length,
    overloadedUids,
  };
}
