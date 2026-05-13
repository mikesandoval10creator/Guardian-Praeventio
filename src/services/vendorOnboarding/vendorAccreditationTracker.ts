// Praeventio Guard — Sprint 52 (2da tanda §47-48): Vendor Accreditation
// Tracker — observaciones post-acreditación.
//
// Cierra: Documento usuario "2da tanda §47-48" (Sprint K).
//
// Una vez que un vendor está acreditado (§vendorOnboardingFlow), el
// mandante puede levantar OBSERVACIONES por documentación que se vence,
// calidad de EPP entregada, comportamiento en faena, etc. Este módulo
// resume el estado de acreditación en términos accionables:
//
//   - openObservations: cuántas siguen sin resolver
//   - criticalCount: cuántas son críticas
//   - eligibleForRecurringWork: regla determinística — vendor con ≥1
//     observación crítica abierta NO puede recibir nuevas órdenes hasta
//     resolverla.
//
// Determinístico, sin LLM, sin I/O. Directiva #3 del usuario: nosotros
// NO bloqueamos al vendor, solo señalamos que "no es elegible para
// nuevos contratos" — el mandante decide.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ObservationKind =
  | 'documentation'        // doc vencido, doc faltante post-acreditación
  | 'epp_quality'          // EPP en mal estado entregado a sus trabajadores
  | 'training_compliance'  // no acreditó capacitación de sus trabajadores
  | 'site_behavior'        // conducta inadecuada en faena (sin incidente)
  | 'incident';            // incidente con consecuencias

export type ObservationSeverity = 'minor' | 'major' | 'critical';

export interface AccreditationObservation {
  id: string;
  vendorId: string;
  /** UID del observador del mandante. */
  observedByUid: string;
  kind: ObservationKind;
  severity: ObservationSeverity;
  description: string;
  /** ISO-8601. */
  observedAt: string;
  /** ISO-8601 si ya se resolvió. */
  resolvedAt?: string;
  /** UID quien dio por resuelta. */
  resolvedByUid?: string;
  /** Notas del cierre. */
  resolutionNotes?: string;
}

export interface AccreditationStatus {
  vendorId: string;
  /** Total de observaciones abiertas. */
  openObservations: number;
  /** Críticas abiertas. */
  criticalCount: number;
  /** Mayores abiertas. */
  majorCount: number;
  /** Menores abiertas. */
  minorCount: number;
  /** ISO-8601 de la observación más reciente, abierta o no. */
  lastObservationAt?: string;
  /**
   * Regla determinística:
   *   - false si hay ≥1 crítica abierta
   *   - false si hay ≥3 mayores abiertas
   *   - true en cualquier otro caso
   */
  eligibleForRecurringWork: boolean;
  /** Razón humana si no es elegible. */
  reasonIfNot?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Summarizer
// ────────────────────────────────────────────────────────────────────────

const MAJOR_THRESHOLD = 3;

export function summarizeAccreditation(
  vendorId: string,
  observations: AccreditationObservation[],
): AccreditationStatus {
  const ours = observations.filter((o) => o.vendorId === vendorId);
  const open = ours.filter((o) => !o.resolvedAt);

  const criticalCount = open.filter((o) => o.severity === 'critical').length;
  const majorCount = open.filter((o) => o.severity === 'major').length;
  const minorCount = open.filter((o) => o.severity === 'minor').length;

  const sorted = [...ours].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  );
  const lastObservationAt = sorted[0]?.observedAt;

  let eligibleForRecurringWork = true;
  let reasonIfNot: string | undefined;

  if (criticalCount > 0) {
    eligibleForRecurringWork = false;
    reasonIfNot = `${criticalCount} observación(es) crítica(s) abierta(s)`;
  } else if (majorCount >= MAJOR_THRESHOLD) {
    eligibleForRecurringWork = false;
    reasonIfNot = `${majorCount} observaciones mayores abiertas (umbral ${MAJOR_THRESHOLD})`;
  }

  return {
    vendorId,
    openObservations: open.length,
    criticalCount,
    majorCount,
    minorCount,
    lastObservationAt,
    eligibleForRecurringWork,
    reasonIfNot,
  };
}

/**
 * Returns true if an observation requires immediate notification to the
 * mandante (rule of thumb: critical OR repeated kind from same vendor
 * in window).
 */
export function shouldEscalateObservation(
  observation: AccreditationObservation,
  history: AccreditationObservation[],
  windowDays = 30,
): boolean {
  if (observation.severity === 'critical') return true;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const t = Date.parse(observation.observedAt);
  const recentSameKind = history.filter(
    (h) =>
      h.id !== observation.id &&
      h.vendorId === observation.vendorId &&
      h.kind === observation.kind &&
      Math.abs(t - Date.parse(h.observedAt)) <= windowMs,
  );
  // Mayor con reincidencia (≥2 en ventana) ⇒ escalar
  return observation.severity === 'major' && recentSameKind.length >= 2;
}

/**
 * Resolves an observation (returns a new object — pure).
 */
export function resolveObservation(
  observation: AccreditationObservation,
  resolvedByUid: string,
  resolvedAt: string,
  resolutionNotes?: string,
): AccreditationObservation {
  return {
    ...observation,
    resolvedAt,
    resolvedByUid,
    resolutionNotes,
  };
}
