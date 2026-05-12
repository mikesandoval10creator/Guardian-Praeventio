// Praeventio Guard — Sprint 39 Fase L.4: SIF Precursor Classifier.
//
// Cierra: Documento usuario "Recomendaciones nuevas §320-323"
//         Top 15 usuario #7
//
// SIF = Serious Injury or Fatality. Los "near-miss" no son todos iguales:
// algunos tienen potencial fatal y deben tratarse con un flujo distinto,
// más estricto, con revisión ejecutiva obligatoria (§322).
//
// Criterios (HSE + ICAM + Bureau Mining):
//   - caída de altura sin lesión (energía gravitacional liberable)
//   - energía liberada inesperadamente (eléctrica, hidráulica, neumática)
//   - casi golpe por equipo móvil (atropello evitado)
//   - pérdida de contención química / gas tóxico
//   - ingreso no autorizado a zona crítica (confinado, energizado, altura)
//
// Sin LLM, todo determinístico. La función `classifyAsSIF` recibe el
// near-miss + contexto y devuelve null si NO es precursor, o un
// `SIFPrecursor` con potential + revisión requerida.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SIFPrecursorKind =
  | 'altura_sin_lesion'
  | 'energia_liberada'
  | 'casi_golpe_movil'
  | 'perdida_contencion_quimica'
  | 'ingreso_no_autorizado_critico'
  | 'fuego_explosion_evitada'
  | 'colapso_estructural_evitado';

export type SIFPotential = 'moderate' | 'serious' | 'fatal';

export interface SIFPrecursor {
  kind: SIFPrecursorKind;
  potential: SIFPotential;
  /** Justificación textual citando los disparadores. */
  rationale: string[];
  /** True → exige revisión ejecutiva del CEO/Gerencia (§322). */
  executiveReviewRequired: boolean;
  /** True → exige notificación al cliente mandante (riesgo reputacional). */
  mandanteNotificationRequired: boolean;
}

export interface NearMissContext {
  /** Descripción libre del evento. */
  description: string;
  /** Etiquetas de categorías (ej: 'altura', 'electric', 'quimico'). */
  categoryTags: string[];
  /** Si involucró equipo móvil. */
  involvedMobileEquipment: boolean;
  /** Altura aproximada de la caída evitada (m). */
  fallHeightMeters?: number;
  /** Voltaje o presión involucrada si aplica. */
  energyMagnitude?: { kind: 'voltage' | 'pressure' | 'temperature'; value: number; unit: string };
  /** Cantidad de sustancia liberada si hubo derrame menor. */
  spillVolumeLiters?: number;
  /** Si el evento ocurrió en zona restringida. */
  inRestrictedZone: boolean;
  /** Si hubo trabajadores expuestos (no lesionados). */
  exposedWorkerCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// Classifier
// ────────────────────────────────────────────────────────────────────────

/**
 * Clasifica un near-miss. Si NO es SIF precursor devuelve null. Caso
 * contrario devuelve el precursor con `potential` derivado de la
 * magnitud + cantidad de expuestos.
 */
export function classifyAsSIF(ctx: NearMissContext): SIFPrecursor | null {
  const rationale: string[] = [];

  // 1. Altura sin lesión: caída evitada >= 1.8m → SIF (DS 594 art. 53).
  if (
    ctx.categoryTags.includes('altura') &&
    typeof ctx.fallHeightMeters === 'number' &&
    ctx.fallHeightMeters >= 1.8
  ) {
    rationale.push(`Caída evitada desde ${ctx.fallHeightMeters}m (umbral SIF 1.8m)`);
    return {
      kind: 'altura_sin_lesion',
      potential: ctx.fallHeightMeters >= 4 ? 'fatal' : 'serious',
      rationale,
      executiveReviewRequired: true,
      mandanteNotificationRequired: ctx.fallHeightMeters >= 4,
    };
  }

  // 2. Energía liberada: voltaje > 50V AC o presión > 7 bar.
  if (ctx.energyMagnitude) {
    if (ctx.energyMagnitude.kind === 'voltage' && ctx.energyMagnitude.value > 50) {
      rationale.push(`Energía eléctrica > 50V (${ctx.energyMagnitude.value} ${ctx.energyMagnitude.unit})`);
      return {
        kind: 'energia_liberada',
        potential: ctx.energyMagnitude.value > 1000 ? 'fatal' : 'serious',
        rationale,
        executiveReviewRequired: true,
        mandanteNotificationRequired: ctx.energyMagnitude.value > 1000,
      };
    }
    if (ctx.energyMagnitude.kind === 'pressure' && ctx.energyMagnitude.value > 7) {
      rationale.push(`Presión liberada > 7 bar (${ctx.energyMagnitude.value} ${ctx.energyMagnitude.unit})`);
      return {
        kind: 'energia_liberada',
        potential: ctx.energyMagnitude.value > 30 ? 'fatal' : 'serious',
        rationale,
        executiveReviewRequired: true,
        mandanteNotificationRequired: ctx.energyMagnitude.value > 30,
      };
    }
  }

  // 3. Casi golpe por equipo móvil
  if (ctx.involvedMobileEquipment && ctx.exposedWorkerCount > 0) {
    rationale.push(`Equipo móvil involucrado con ${ctx.exposedWorkerCount} trabajador(es) expuesto(s)`);
    return {
      kind: 'casi_golpe_movil',
      potential: ctx.exposedWorkerCount >= 3 ? 'fatal' : 'serious',
      rationale,
      executiveReviewRequired: ctx.exposedWorkerCount >= 2,
      mandanteNotificationRequired: ctx.exposedWorkerCount >= 3,
    };
  }

  // 4. Pérdida de contención química
  if (
    ctx.categoryTags.includes('quimico') &&
    typeof ctx.spillVolumeLiters === 'number' &&
    ctx.spillVolumeLiters > 0
  ) {
    rationale.push(`Derrame químico ${ctx.spillVolumeLiters}L`);
    return {
      kind: 'perdida_contencion_quimica',
      potential: ctx.spillVolumeLiters > 200 ? 'fatal' : ctx.spillVolumeLiters > 20 ? 'serious' : 'moderate',
      rationale,
      executiveReviewRequired: ctx.spillVolumeLiters > 20,
      mandanteNotificationRequired: ctx.spillVolumeLiters > 200,
    };
  }

  // 5. Ingreso no autorizado a zona crítica
  if (ctx.inRestrictedZone && ctx.exposedWorkerCount > 0) {
    rationale.push(`Ingreso no autorizado a zona restringida con ${ctx.exposedWorkerCount} expuesto(s)`);
    return {
      kind: 'ingreso_no_autorizado_critico',
      potential: 'serious',
      rationale,
      executiveReviewRequired: true,
      mandanteNotificationRequired: false,
    };
  }

  // Fallback heurístico simple — palabras clave en description
  const lower = ctx.description.toLowerCase();
  if (/fuego|llamas|explos[ií]/i.test(lower)) {
    rationale.push('Indicios de fuego/explosión en la descripción');
    return {
      kind: 'fuego_explosion_evitada',
      potential: 'serious',
      rationale,
      executiveReviewRequired: true,
      mandanteNotificationRequired: false,
    };
  }
  if (/colapso|derrumb|caída de material pesado/i.test(lower)) {
    rationale.push('Indicios de colapso estructural en la descripción');
    return {
      kind: 'colapso_estructural_evitado',
      potential: 'fatal',
      rationale,
      executiveReviewRequired: true,
      mandanteNotificationRequired: true,
    };
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Aggregations for dashboard / SIF panel
// ────────────────────────────────────────────────────────────────────────

export interface SIFPanelSummary {
  totalPrecursors: number;
  byKind: Record<SIFPrecursorKind, number>;
  byPotential: Record<SIFPotential, number>;
  pendingExecutiveReview: number;
  pendingMandanteNotification: number;
}

export function summarizeSIFPrecursors(
  precursors: Array<SIFPrecursor & { reviewedAt?: string; notifiedMandanteAt?: string }>,
): SIFPanelSummary {
  const byKind: Partial<Record<SIFPrecursorKind, number>> = {};
  const byPotential: Record<SIFPotential, number> = { moderate: 0, serious: 0, fatal: 0 };
  let pendingExec = 0;
  let pendingMand = 0;

  for (const p of precursors) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    byPotential[p.potential] += 1;
    if (p.executiveReviewRequired && !p.reviewedAt) pendingExec += 1;
    if (p.mandanteNotificationRequired && !p.notifiedMandanteAt) pendingMand += 1;
  }

  return {
    totalPrecursors: precursors.length,
    byKind: byKind as Record<SIFPrecursorKind, number>,
    byPotential,
    pendingExecutiveReview: pendingExec,
    pendingMandanteNotification: pendingMand,
  };
}
