// vehicleDocStatus — pure, deterministic classification of a vehicle
// compliance document (revisión técnica / permiso de circulación) by its
// expiry date. No side effects, no I/O. Used by the "Documentos Vehiculares"
// view in Conducción Segura to render vigente / por vencer / vencido badges.
//
// Chile context: revisión técnica and permiso de circulación are annual legal
// requirements; driving with an expired one is an infraction and a safety risk.

export type VehicleDocState = 'sin_dato' | 'vigente' | 'por_vencer' | 'vencido';

export interface VehicleDocStatus {
  state: VehicleDocState;
  /** Whole days until expiry (negative if already expired); null when no date. */
  daysLeft: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Classify a document by its ISO-8601 expiry date.
 * @param expiresAt ISO date string (e.g. "2026-09-01") or undefined.
 * @param now reference instant (defaults to current time).
 * @param warnWithinDays window (in days) before expiry that counts as "por vencer". Default 30.
 */
export function vehicleDocStatus(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
  warnWithinDays = 30,
): VehicleDocStatus {
  if (!expiresAt) return { state: 'sin_dato', daysLeft: null };

  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return { state: 'sin_dato', daysLeft: null };

  // Compare at day granularity in UTC so date-only ISO inputs (parsed as UTC
  // midnight) align with `now` regardless of the runtime's local timezone.
  // Mixing local-tz getters with UTC-parsed dates produced an off-by-one in any
  // UTC-negative zone — including Chile (America/Santiago) — so a document
  // expiring "today" wrongly read as vencido. "Expires today" must stay
  // por_vencer (daysLeft 0), never prematurely vencido.
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfExpiry = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const daysLeft = Math.round((startOfExpiry - startOfToday) / MS_PER_DAY);

  if (daysLeft < 0) return { state: 'vencido', daysLeft };
  if (daysLeft <= warnWithinDays) return { state: 'por_vencer', daysLeft };
  return { state: 'vigente', daysLeft };
}

/** Spanish-CL label for a document state. */
export function vehicleDocStateLabel(state: VehicleDocState): string {
  switch (state) {
    case 'vigente':
      return 'Vigente';
    case 'por_vencer':
      return 'Por vencer';
    case 'vencido':
      return 'Vencido';
    case 'sin_dato':
    default:
      return 'Sin registrar';
  }
}
