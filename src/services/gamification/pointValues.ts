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
} as const;

export type PointReason = keyof typeof POINT_VALUES;

/** Type guard: is `reason` a whitelisted point-earning action? */
export function isPointReason(reason: unknown): reason is PointReason {
  return typeof reason === 'string' && Object.prototype.hasOwnProperty.call(POINT_VALUES, reason);
}
