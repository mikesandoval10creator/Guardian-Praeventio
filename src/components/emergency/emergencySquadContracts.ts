/**
 * Slice 2 — EmergencySquadManager fixes (vida-safety).
 *
 * The contracts are extracted as pure exported helpers so they can be tested
 * without a DOM (this repo ships no jsdom / @testing-library for this tree).
 *
 * Tickets addressed:
 *   • "Error de lectura GPS enmascarado como 'sin datos'"   -> classifyBreadcrumbLoad
 *   • "Llamado General no reporta fallo de notificacion"    -> describeGeneralCallOutcome
 *   • "formatTime produce 'Hace -N min' con relojes descalibrados" -> formatElapsed
 *   • "Companeros BLE sin filtro de antiguedad"              -> filterFreshPeers
 *   • "Vigencia de capacitacion calculada de forma distinta en UI vs servicio"
 *                                                         -> trainingExpiryDate (shared)
 *   • "Contrato de orden de getBreadcrumbs no documentado"  -> assertBreadcrumbOrder
 */

import { isTrainingValid, trainingExpiresAtMs } from '../../services/emergencyBrigade/trainingValidity';

/** A stored GPS breadcrumb. */
export interface Breadcrumb {
  lat: number;
  lng: number;
  timestamp: number;
}

/** A BLE peer observation. */
export interface PeerBreadcrumb {
  peerId: string;
  peerName?: string;
  timestamp: number;
}

/**
 * Ticket "Error de lectura GPS enmascarado como 'sin datos'".
 *
 * The old `.catch(() => setBreadcrumbs([]))` made a read failure look exactly
 * like "you have no GPS history", so the worker concluded they had no trail
 * when in fact the trail could not be READ. The three outcomes are now
 * distinct: loading, failed, empty.
 */
export type BreadcrumbLoadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'empty' }
  | { status: 'loaded'; breadcrumbs: Breadcrumb[] };

export function classifyBreadcrumbLoad(input: {
  loading: boolean;
  error: unknown;
  breadcrumbs: Breadcrumb[];
}): BreadcrumbLoadState {
  if (input.loading) return { status: 'loading' };
  if (input.error) {
    const message =
      input.error instanceof Error ? input.error.message : 'No se pudo leer el rastro GPS.';
    return { status: 'failed', message };
  }
  if (input.breadcrumbs.length === 0) return { status: 'empty' };
  return { status: 'loaded', breadcrumbs: input.breadcrumbs };
}

/**
 * Ticket "Llamado General no reporta fallo de notificacion".
 *
 * A failed general call used to revert the button to its normal state with no
 * feedback at all: the worker believed the brigade had been summoned.
 */
export type GeneralCallOutcome =
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export function describeGeneralCallOutcome(error: unknown): GeneralCallOutcome {
  if (!error) return { kind: 'sent' };
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'No se pudo activar el llamado general.';
  return { kind: 'failed', message };
}

/**
 * Ticket "formatTime produce 'Hace -N min' con relojes descalibrados".
 *
 * A field tablet with a skewed clock produced a negative delta and the UI
 * rendered "Hace -3 min". The delta is clamped at zero and a future timestamp
 * is reported as "ahora" rather than as a negative age.
 */
export function formatElapsed(ts: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(ts)) return 'Hora desconocida';
  const diff = Math.floor((nowMs - ts) / 60000);
  if (diff < 0) return 'Ahora';
  if (diff === 0) return 'Hace menos de 1 min';
  if (diff === 1) return 'Hace 1 min';
  return `Hace ${diff} min`;
}

/**
 * Ticket "Companeros BLE sin filtro de antiguedad (falsa presencia 'en rango')".
 *
 * The hook keeps peers seen minutes or hours ago, and the panel showed the
 * first ten of them as "detectados": a colleague who left the site still
 * appeared to be within range.
 */
export function filterFreshPeers(
  peers: readonly PeerBreadcrumb[],
  maxAgeMs: number,
  nowMs: number = Date.now(),
): PeerBreadcrumb[] {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return [];
  return peers.filter((peer) => {
    if (!Number.isFinite(peer.timestamp)) return false;
    const age = nowMs - peer.timestamp;
    // A future timestamp (skewed clock) is not evidence of a stale peer.
    return age <= maxAgeMs;
  });
}

/**
 * Ticket "Vigencia de capacitacion calculada de forma distinta en UI vs
 * servicio".
 *
 * The UI added calendar years while the brigade coverage rule adds 365-day
 * years, so a capability could read as valid in one surface and expired in
 * the other. The authoritative rule (the one that decides whether a brigade
 * meets its minimum coverage) lives in
 * `src/services/emergencyBrigade/trainingValidity.ts` and is imported here:
 * ONE source of truth, no divergence.
 */
export function trainingExpiryDate(trainedAt: string, validYears: number): Date | null {
  const expiresMs = trainingExpiresAtMs(trainedAt, validYears);
  // NaN means the validity window is unknown — there is no date to show.
  if (expiresMs === null || !Number.isFinite(expiresMs)) return null;
  return new Date(expiresMs);
}

export type TrainingState = { label: string; tone: 'emerald' | 'amber' | 'rose' };

export function trainingState(
  trainedAt: string,
  validYears: number,
  nowMs: number = Date.now(),
): TrainingState {
  const expires = trainingExpiryDate(trainedAt, validYears);
  if (!expires) return { label: 'Capacitación sin fecha registrada', tone: 'amber' };
  const fmt = expires.toLocaleDateString('es-CL');
  return isTrainingValid(trainedAt, validYears, nowMs)
    ? { label: `Capacitación vigente hasta ${fmt}`, tone: 'emerald' }
    : { label: `Capacitación vencida (${fmt})`, tone: 'rose' };
}

/**
 * Ticket "Contrato de orden de getBreadcrumbs no documentado/tipado".
 *
 * The UI assumes `breadcrumbs[0]` is the MOST RECENT entry. Both backends
 * currently sort DESC, but nothing declared it, so swapping the backend for
 * an unsorted collection would silently break the "last known position" badge.
 * The contract is now explicit and enforced at the point of use.
 */
export function assertBreadcrumbOrder(breadcrumbs: readonly Breadcrumb[]): void {
  for (let i = 1; i < breadcrumbs.length; i += 1) {
    const prev = breadcrumbs[i - 1];
    const cur = breadcrumbs[i];
    if (prev.timestamp < cur.timestamp) {
      throw new Error(
        'Breadcrumbs must be ordered most-recent-first: getBreadcrumbs() contract violated.',
      );
    }
  }
}

/** The most recent breadcrumb, or null. Relies on the DESC contract. */
export function latestBreadcrumb(breadcrumbs: readonly Breadcrumb[]): Breadcrumb | null {
  if (breadcrumbs.length === 0) return null;
  assertBreadcrumbOrder(breadcrumbs);
  return breadcrumbs[0];
}
