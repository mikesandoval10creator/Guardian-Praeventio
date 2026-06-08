// SPDX-License-Identifier: MIT
//
// DEA (Desfibrilador Externo Automático) — Ley 21.156.
//
// Pure types + business logic. Firestore wiring vive en
// `deaFirestoreAdapter.ts`; el UI lo consume vía un hook a definir
// (TODO: useProjectDeas).
//
// 2026-05-15: este archivo reemplaza el MOCK_DEAS hardcoded de
// `src/pages/DEAZones.tsx`. Antes el panel mostraba 3 DEAs ficticios
// y aprobaciones de inspección no persistían — un "fake" crítico
// porque Ley 21.156 EXIGE registro y mantenimiento documentado.

/**
 * Estado operativo de un DEA. Se calcula determinísticamente desde
 * las fechas de vencimiento — no se setea manualmente.
 *
 *   - operational: ambos consumibles vigentes con holgura (>30 días)
 *   - warning:    al menos uno vence en ≤30 días
 *   - critical:   al menos uno vencido O última revisión >90 días atrás
 */
export type DeaStatus = 'operational' | 'warning' | 'critical';

/**
 * Registro de un DEA físico. Lo que se persiste en Firestore
 * (`tenants/{tid}/projects/{pid}/deas/{id}`).
 */
export interface Dea {
  id: string;
  /** Ubicación legible — "Recepción Principal", "Casino Nivel 2", etc. */
  location: string;
  /** Detalle complementario para identificar visualmente — "Muro este junto a extintor". */
  description: string;
  /** Fecha vencimiento batería (ISO YYYY-MM-DD). Ley 21.156 art.5 b). */
  batteryExpiry: string;
  /** Fecha vencimiento parches (electrodos) (ISO YYYY-MM-DD). */
  padsExpiry: string;
  /** Última inspección registrada (ISO YYYY-MM-DD). */
  lastCheck: string;
  /** UID del responsable asignado (obligación de mantenimiento). */
  assignedToUid: string;
  /** Nombre display del responsable (cacheado para no requerir join). */
  assignedToName: string;
  /** Cuándo se creó el registro. */
  createdAt: string;
  /** Quién creó el registro. */
  createdBy: string;
  /**
   * Optional geographic position, for the "DEA más cercano a mí" finder + map.
   * Captured from the registrar's device (geolocation) or entered manually.
   * Legacy records have no coordinates — the geo finder skips those.
   */
  coordinates?: GeoCoord;
}

/** A latitude/longitude point (WGS84 degrees). */
export interface GeoCoord {
  lat: number;
  lng: number;
}

/**
 * Resultado de una inspección. Subcolección
 * `tenants/{tid}/projects/{pid}/deas/{deaId}/inspections/{inspectionId}`.
 */
export interface DeaInspection {
  id: string;
  deaId: string;
  /** ISO YYYY-MM-DD. */
  performedAt: string;
  /** UID del inspector. */
  performedByUid: string;
  /** Nombre display del inspector. */
  performedByName: string;
  /**
   * Resultado del checklist de 5 items. Cada item es booleano (passed).
   * Si CUALQUIERA es false, la inspección falla y el DEA pasa a
   * `critical` hasta que se corrija + nueva inspección OK.
   */
  checklist: {
    statusLightGreen: boolean;
    batteryConnectedValid: boolean;
    padsSealedValid: boolean;
    responseKitComplete: boolean;
    cabinetIntactAlarmOperative: boolean;
  };
  /** Notas opcionales del inspector. */
  notes?: string;
}

/**
 * Cuántos días faltan entre `today` y `dateIso`. Negativo si ya pasó.
 *
 * `nowIso` se inyecta para tests determinísticos; producción usa
 * `new Date().toISOString()`.
 */
export function daysUntil(
  dateIso: string,
  nowIso: string = new Date().toISOString(),
): number {
  const ms = Date.parse(dateIso) - Date.parse(nowIso);
  if (!Number.isFinite(ms)) return Number.NEGATIVE_INFINITY;
  return Math.floor(ms / 86_400_000);
}

/**
 * Calcula el status operativo del DEA en base a sus fechas.
 *
 * Reglas Ley 21.156 + criterio operativo Praeventio:
 *   - Si batería vencida O parches vencidos O última inspección
 *     >90 días: CRITICAL.
 *   - Si batería vence en ≤30d O parches vencen en ≤30d O última
 *     inspección entre 60-90 días: WARNING.
 *   - En cualquier otro caso: OPERATIONAL.
 *
 * Si las fechas son inválidas, se asume CRITICAL (fail-closed —
 * un DEA sin info confiable no se puede contar como operativo).
 */
export function computeDeaStatus(
  dea: Pick<Dea, 'batteryExpiry' | 'padsExpiry' | 'lastCheck'>,
  nowIso: string = new Date().toISOString(),
): DeaStatus {
  const battDays = daysUntil(dea.batteryExpiry, nowIso);
  const padsDays = daysUntil(dea.padsExpiry, nowIso);
  const checkAgeDays = -daysUntil(dea.lastCheck, nowIso); // antiguedad = -daysUntil

  if (
    !Number.isFinite(battDays) ||
    !Number.isFinite(padsDays) ||
    !Number.isFinite(checkAgeDays)
  ) {
    return 'critical';
  }

  if (battDays < 0 || padsDays < 0 || checkAgeDays > 90) return 'critical';
  if (battDays <= 30 || padsDays <= 30 || checkAgeDays >= 60) return 'warning';
  return 'operational';
}

/**
 * Verifica que un checklist está completo (todos los items pasaron).
 * Se usa antes de aceptar una inspección para evitar guardar checks
 * a medias que dejarían el DEA en estado ambiguo.
 */
export function isChecklistComplete(checklist: DeaInspection['checklist']): boolean {
  return (
    checklist.statusLightGreen &&
    checklist.batteryConnectedValid &&
    checklist.padsSealedValid &&
    checklist.responseKitComplete &&
    checklist.cabinetIntactAlarmOperative
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Geo — "DEA más cercano a mí" (#4). Pure + deterministic, so it works offline
// (a cardiac arrest is exactly when there's no time to wait for the network).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Great-circle (haversine) distance in METRES between two lat/lng points.
 * Deterministic; no side effects. Mean Earth radius 6 371 000 m.
 */
export function distanceMeters(a: GeoCoord, b: GeoCoord): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // clamp guards against tiny FP overshoot of 1 → NaN from asin.
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The DEA closest to `from`, with its distance in metres. DEAs without
 * `coordinates` are skipped (they cannot be located). Returns `null` when no
 * DEA has coordinates. On ties the FIRST nearest wins (stable for a given list
 * order).
 */
export function nearestDea(
  deas: readonly Dea[],
  from: GeoCoord,
): { dea: Dea; distanceM: number } | null {
  let best: { dea: Dea; distanceM: number } | null = null;
  for (const dea of deas) {
    if (!dea.coordinates) continue;
    const distanceM = distanceMeters(from, dea.coordinates);
    if (best === null || distanceM < best.distanceM) {
      best = { dea, distanceM };
    }
  }
  return best;
}
