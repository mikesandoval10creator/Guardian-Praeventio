// Praeventio Guard — Job Safety Analysis (JSA / Análisis de Seguridad
// en el Trabajo).
//
// El JSA es el documento operativo MÁS USADO en faena después del work
// permit: el supervisor descompone la tarea en pasos, identifica
// peligros por paso, aplica controles según la jerarquía ISO 45001, y
// calcula el riesgo residual.
//
// Diferencia con `workPermitEngine`:
//   - Work permit: autorización para EJECUTAR una tarea crítica (altura,
//     caliente, confinado, etc.) — válido por horas.
//   - JSA: descomposición DETALLADA paso-a-paso de cualquier tarea, NO
//     solo críticas. Se firma una vez, sirve de plantilla para tareas
//     similares (DS 76 art. 21).
//
// Este servicio es PURO + determinístico — sin LLM. El caller:
//   1. Construye un `JsaDraft` con sus pasos
//   2. Llama `validateJsa(draft)` que devuelve issues + completeness
//   3. Llama `computeResidualRisks(draft, riskMatrix)` que aplica la
//      jerarquía ISO 45001 a cada paso y devuelve el risk score residual
//   4. Llama `finalize(draft, approver, signature)` que sella el JSA
//      y produce el shape inmutable para Firestore
//
// Reglas codificadas:
//   - Cada paso necesita al menos 1 hazard
//   - Cada hazard necesita al menos 1 control
//   - La jerarquía ISO 45001 reduce el risk score por capas:
//       elimination: divide ×0.0 (anula)
//       substitution: ×0.2
//       engineering: ×0.4
//       administrative: ×0.7
//       epp: ×0.9
//   - Residual = round(initial × productoControles) — clamped a [1,25]
//
// Risk score asume matriz 5×5 (Probabilidad × Severidad), valor 1-25
// (ISO 31000 / IPER chileno estándar).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ControlLevel =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'epp';

/** Multipliers ISO 45001 — más alto en la jerarquía = más reducción. */
const CONTROL_MULTIPLIER: Record<ControlLevel, number> = {
  elimination: 0.0,
  substitution: 0.2,
  engineering: 0.4,
  administrative: 0.7,
  epp: 0.9,
};

export interface JsaControl {
  level: ControlLevel;
  description: string;
  /** UID del responsable de aplicar el control (operador / supervisor). */
  responsibleUid?: string;
}

export interface JsaHazard {
  /** Identificador del hazard dentro del step (slug corto). */
  id: string;
  description: string;
  /** Risk score inicial (sin controles), matriz 5×5: probabilidad × severidad. */
  probability: 1 | 2 | 3 | 4 | 5;
  severity: 1 | 2 | 3 | 4 | 5;
  /** Controles aplicados a este hazard. */
  controls: JsaControl[];
}

export interface JsaStep {
  /** Order matters — pasos secuenciales. */
  order: number;
  description: string;
  hazards: JsaHazard[];
  /** Quién ejecuta el paso (puede ser distinto al supervisor). */
  performerUid?: string;
}

export interface JsaDraft {
  /** UUID del JSA. */
  id: string;
  projectId: string;
  /** Título de la tarea ("Cambio de tubería túnel 4 sector NW"). */
  taskTitle: string;
  /** Ubicación específica. */
  location?: string;
  /** UID del prevencionista/supervisor que construye. */
  authorUid: string;
  /** ISO timestamp de creación. */
  createdAt: string;
  /** Pasos en orden. */
  steps: JsaStep[];
  /** EPP requerido transversal (no por paso). */
  baselineEpp?: string[];
}

export interface JsaIssue {
  severity: 'blocking' | 'advisory';
  code: string;
  message: string;
  /** Si aplica, índice del step + hazard. */
  context?: {
    stepIndex?: number;
    hazardId?: string;
  };
}

export interface JsaValidationResult {
  valid: boolean;
  issues: JsaIssue[];
  completenessPct: number;
}

export interface JsaResidualRisk {
  stepOrder: number;
  hazardId: string;
  initialScore: number;
  residualScore: number;
  /** Lista de controles aplicados en orden. */
  controlsApplied: ControlLevel[];
  /** Severidad del riesgo residual (low/medium/high/critical). */
  residualClass: ResidualClass;
}

export type ResidualClass = 'low' | 'medium' | 'high' | 'critical';

export interface FinalizedJsa extends JsaDraft {
  status: 'signed';
  approverUid: string;
  signedAt: string;
  signatureHashHex: string;
  residualRisks: JsaResidualRisk[];
  overallResidualClass: ResidualClass;
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

const MIN_STEP_DESC_LEN = 10;
const MIN_HAZARD_DESC_LEN = 6;
const MIN_CONTROL_DESC_LEN = 6;

export function validateJsa(draft: JsaDraft): JsaValidationResult {
  const issues: JsaIssue[] = [];

  if (!draft.taskTitle || draft.taskTitle.trim().length < 5) {
    issues.push({
      severity: 'blocking',
      code: 'TASK_TITLE_TOO_SHORT',
      message: 'taskTitle debe tener al menos 5 caracteres.',
    });
  }

  if (draft.steps.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'NO_STEPS',
      message: 'JSA debe tener al menos 1 paso.',
    });
  }

  // Verificar orden consecutivo
  const orders = draft.steps.map((s) => s.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      issues.push({
        severity: 'advisory',
        code: 'NON_CONSECUTIVE_STEPS',
        message: `Order de pasos no es consecutivo 1..N. Encontrado: ${orders.join(',')}.`,
      });
      break;
    }
  }

  for (let i = 0; i < draft.steps.length; i++) {
    const step = draft.steps[i]!;
    if (step.description.trim().length < MIN_STEP_DESC_LEN) {
      issues.push({
        severity: 'blocking',
        code: 'STEP_DESC_TOO_SHORT',
        message: `Paso ${step.order}: descripción muy corta (mínimo ${MIN_STEP_DESC_LEN} chars).`,
        context: { stepIndex: i },
      });
    }
    if (step.hazards.length === 0) {
      issues.push({
        severity: 'blocking',
        code: 'STEP_NO_HAZARDS',
        message: `Paso ${step.order}: sin hazards identificados. Todo paso debe tener al menos 1.`,
        context: { stepIndex: i },
      });
      continue;
    }
    for (const h of step.hazards) {
      if (h.description.trim().length < MIN_HAZARD_DESC_LEN) {
        issues.push({
          severity: 'blocking',
          code: 'HAZARD_DESC_TOO_SHORT',
          message: `Paso ${step.order} / hazard ${h.id}: descripción muy corta.`,
          context: { stepIndex: i, hazardId: h.id },
        });
      }
      if (h.controls.length === 0) {
        issues.push({
          severity: 'blocking',
          code: 'HAZARD_NO_CONTROLS',
          message: `Paso ${step.order} / hazard ${h.id}: sin controles aplicados.`,
          context: { stepIndex: i, hazardId: h.id },
        });
      }
      for (const c of h.controls) {
        if (c.description.trim().length < MIN_CONTROL_DESC_LEN) {
          issues.push({
            severity: 'blocking',
            code: 'CONTROL_DESC_TOO_SHORT',
            message: `Paso ${step.order} / hazard ${h.id}: descripción de control muy corta.`,
            context: { stepIndex: i, hazardId: h.id },
          });
        }
      }
      // Advisory: solo controles EPP / administrative (jerarquía baja)
      const levels = new Set(h.controls.map((c) => c.level));
      if (
        levels.size > 0 &&
        ![...levels].some((l) =>
          ['elimination', 'substitution', 'engineering'].includes(l),
        )
      ) {
        issues.push({
          severity: 'advisory',
          code: 'CONTROLS_LOW_HIERARCHY',
          message: `Paso ${step.order} / hazard ${h.id}: solo controles admin/EPP. Considera elim/substitución/ingeniería (ISO 45001 jerarquía).`,
          context: { stepIndex: i, hazardId: h.id },
        });
      }
    }
  }

  // Completeness pct: cuántos hazards tienen ≥1 control válido del total
  let totalHazards = 0;
  let goodHazards = 0;
  for (const step of draft.steps) {
    for (const h of step.hazards) {
      totalHazards++;
      if (
        h.controls.length > 0 &&
        h.controls.every((c) => c.description.trim().length >= MIN_CONTROL_DESC_LEN)
      ) {
        goodHazards++;
      }
    }
  }
  const completenessPct =
    totalHazards === 0
      ? 0
      : Math.round((goodHazards / totalHazards) * 100);

  return {
    valid: issues.filter((i) => i.severity === 'blocking').length === 0,
    issues,
    completenessPct,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Residual risk computation
// ────────────────────────────────────────────────────────────────────────

export function classifyResidual(score: number): ResidualClass {
  if (score >= 17) return 'critical';
  if (score >= 9) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export function computeResidualRisks(draft: JsaDraft): JsaResidualRisk[] {
  const out: JsaResidualRisk[] = [];
  for (const step of draft.steps) {
    for (const h of step.hazards) {
      const initial = h.probability * h.severity;
      // Aplicar el MEJOR control de cada nivel — un control de
      // elimination ya anula, no necesitamos otros del mismo nivel.
      // Tomamos el multiplier MÁS BAJO (más reductor) por nivel.
      const levelsApplied = new Set<ControlLevel>(
        h.controls.map((c) => c.level),
      );
      // Producto de multipliers únicos por nivel
      let product = 1;
      for (const level of levelsApplied) {
        product *= CONTROL_MULTIPLIER[level];
      }
      // Clamp a [1, 25] — si product=0 (elimination), residual=0.
      let residual = Math.round(initial * product);
      if (residual === 0 && !levelsApplied.has('elimination')) {
        residual = 1;
      }
      if (residual > 25) residual = 25;
      out.push({
        stepOrder: step.order,
        hazardId: h.id,
        initialScore: initial,
        residualScore: residual,
        controlsApplied: [...levelsApplied].sort(),
        residualClass: classifyResidual(residual),
      });
    }
  }
  return out;
}

export function overallResidualClass(
  risks: JsaResidualRisk[],
): ResidualClass {
  if (risks.length === 0) return 'low';
  // El peor define el overall.
  const order: ResidualClass[] = ['low', 'medium', 'high', 'critical'];
  let worst: ResidualClass = 'low';
  for (const r of risks) {
    if (order.indexOf(r.residualClass) > order.indexOf(worst)) {
      worst = r.residualClass;
    }
  }
  return worst;
}

// ────────────────────────────────────────────────────────────────────────
// Finalization
// ────────────────────────────────────────────────────────────────────────

export class JsaFinalizationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'JsaFinalizationError';
  }
}

export interface FinalizeJsaInput {
  draft: JsaDraft;
  approverUid: string;
  signedAtIso: string;
  /**
   * Hash hex precomputado de la signature payload — el caller decide
   * la algoritmo (WebAuthn ECDSA o KMS RSA). Aquí solo lo embebemos
   * para que la entrada sea trazable.
   */
  signatureHashHex: string;
}

export function finalize(input: FinalizeJsaInput): FinalizedJsa {
  const v = validateJsa(input.draft);
  if (!v.valid) {
    throw new JsaFinalizationError(
      'VALIDATION_FAILED',
      `JSA tiene ${v.issues.filter((i) => i.severity === 'blocking').length} blockers.`,
    );
  }
  if (input.approverUid === input.draft.authorUid) {
    throw new JsaFinalizationError(
      'APPROVER_SAME_AS_AUTHOR',
      'Approver debe ser distinto del author (separación de funciones).',
    );
  }
  const risks = computeResidualRisks(input.draft);
  const overall = overallResidualClass(risks);
  return {
    ...input.draft,
    status: 'signed',
    approverUid: input.approverUid,
    signedAt: input.signedAtIso,
    signatureHashHex: input.signatureHashHex,
    residualRisks: risks,
    overallResidualClass: overall,
  };
}
