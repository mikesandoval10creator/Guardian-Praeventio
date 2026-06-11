// Praeventio Guard — canonical gamification point values (B6, Fase 5).
//
// SINGLE SOURCE OF TRUTH for "how many points each safety action is worth".
// Pure data (no deps) so it is importable by BOTH the browser client
// (`gamificationService.ts`, for UI display) AND the server route
// (`src/server/routes/gamification.ts`, which is AUTHORITATIVE).
//
// Security: the server awards `POINT_VALUES[reason]` — it MUST NOT trust a
// client-supplied `amount`. Previously `/api/gamification/points` incremented
// the caller's score by whatever `amount` the body contained, so any user
// could grant themselves unlimited points (leaderboard/medal abuse). The
// reason must be one of these whitelisted keys or the award is rejected.

export const POINT_VALUES = {
  morning_checkin: 10,
  training_completed: 50,
  quiz_passed: 25,
  mandown_acknowledged: 30,
  zone_violation_reported: 20,
  incident_reported: 15,
  sos_resolved: 40,
  // Arista B4 — paralización resuelta con veredicto JUSTIFICADA: premia
  // estructuralmente el coraje de detener trabajos ante un riesgo real
  // (stop-work authority). Server-awarded only (see SERVER_AWARDED_REASONS):
  // granted by POST /:projectId/stoppage/resolve to the DECLARER; the public
  // /gamification/points endpoint rejects it so callers cannot self-claim.
  stoppage_justified: 30,
} as const;

/**
 * Reasons that may ONLY be awarded by server-side flows where the recipient
 * is someone other than the caller (e.g. the stoppage-resolution prize goes
 * to the worker who declared the stoppage). The public
 * POST /api/gamification/points endpoint — which always awards to the caller
 * — must reject these to prevent XP self-farming.
 */
export const SERVER_AWARDED_REASONS: ReadonlySet<PointReason> = new Set([
  'stoppage_justified',
]);

export type PointReason = keyof typeof POINT_VALUES;

/** Type guard: is `reason` a whitelisted point-earning action? */
export function isPointReason(reason: unknown): reason is PointReason {
  return typeof reason === 'string' && Object.prototype.hasOwnProperty.call(POINT_VALUES, reason);
}
