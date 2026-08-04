// Praeventio Guard — sincronización del consentimiento de analítica.
//
// Tarea Notion `[P1][privacidad] El consentimiento de analitica no gobierna
// la analitica`: el opt-out de 'Mis datos' no detenía los eventos ni los
// breadcrumbs porque el AnalyticsAdapter solo leía localStorage, sin
// sincronizar con la fuente autoritativa (compliance_consents en Firestore,
// vía /api/compliance/consent).
//
// Este módulo traduce el estado Firestore del consentimiento 'analytics' a
// la clave localStorage que el adapter consulta (analytics_opt_out).
// Semántica de privacidad: sin consentimiento EXPLÍCITO registrado, la
// analítica queda apagada (opt-out por defecto).

/** Clave que el AnalyticsAdapter consulta (src/services/analytics/adapter.ts). */
export const ANALYTICS_OPT_OUT_STORAGE_KEY = 'analytics_opt_out';

export interface ConsentLike {
  granted?: boolean;
}

export interface ConsentsLike {
  analytics?: ConsentLike | null;
}

/**
 * Estado de opt-out derivado del consentimiento Firestore:
 * `'1'` (apagado) salvo que analytics esté explícitamente granted.
 */
export function analyticsOptOutFromConsents(
  consents: ConsentsLike | undefined,
): string {
  return consents?.analytics?.granted === true ? '0' : '1';
}

/**
 * Escribe en localStorage el estado derivado de Firestore, para que el
 * AnalyticsAdapter (síncrono) respete la fuente autoritativa.
 */
export function applyAnalyticsConsentToLocalStorage(
  consents: ConsentsLike | undefined,
): void {
  try {
    window.localStorage.setItem(
      ANALYTICS_OPT_OUT_STORAGE_KEY,
      analyticsOptOutFromConsents(consents),
    );
  } catch {
    // Storage no disponible: el adapter mantiene su fallback por defecto.
  }
}
