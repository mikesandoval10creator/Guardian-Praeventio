// Praeventio Guard — OLA 1 C5 (2026-06-14): nearest-DEA lookup for a project.
//
// Thin READ-ONLY join used by the lone-worker escalation cron to route a
// responder to the closest defibrillator. Kept out of the route file on
// purpose: (a) it makes the listAll + nearestDea join unit-testable in
// isolation, and (b) it keeps `new DeaAdapter(...)` out of src/server/routes/*
// so the convention guard's coarse "new *Adapter ⇒ mutating route" heuristic
// doesn't false-flag the read-only cron (check-convention-guard.cjs MUTATE_RE).

import { DeaAdapter, type DeaFirestoreDb } from './deaFirestoreAdapter';
import { nearestDea } from './deaService';

export interface NearestDeaResult {
  /** Human-readable DEA location ("Recepción Principal"). */
  location: string;
  /** Distance from `loc` in metres (rounded by the caller for transport). */
  distanceM: number;
  /** The DEA's own coordinates, when it has them. */
  coords?: { lat: number; lng: number };
}

/**
 * The project's DEA closest to `loc`, or `null` if the project has no located
 * DEA. Read-only (no writes). Errors propagate — the caller decides whether a
 * lookup failure is fatal (the cron treats it as non-fatal: the escalation
 * still goes out without the AED hint).
 */
export async function nearestDeaForProject(
  db: DeaFirestoreDb,
  tenantId: string,
  projectId: string,
  loc: { lat: number; lng: number },
): Promise<NearestDeaResult | null> {
  const deas = await new DeaAdapter(db, tenantId, projectId).listAll();
  const near = nearestDea(deas, { lat: loc.lat, lng: loc.lng });
  if (!near) return null;
  return { location: near.dea.location, distanceM: near.distanceM, coords: near.dea.coordinates };
}
