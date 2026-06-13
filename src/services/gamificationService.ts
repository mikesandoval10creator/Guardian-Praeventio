import { apiAuthHeaders } from '../lib/apiAuth';
// Canonical point values live in a shared, server-authoritative module (B6).
// Re-exported here so existing client imports of `POINT_VALUES`/`PointReason`
// keep working; the server uses the SAME table and ignores any client `amount`.
import { POINT_VALUES, type PointReason } from './gamification/pointValues';

export { POINT_VALUES, type PointReason };

async function authHeaders(): Promise<Record<string, string>> {
  // §2.20 fix (2026-05-21) — usa apiAuthHeaders() helper unificado que
  // prefiere `E2E <secret>:<uid>` (MODE=test) sobre `Bearer ${authHeader}`
  // productivo. Antes este authHeaders local hardcodeaba Bearer y
  // fallaba 401 silencioso en E2E full-stack (process-lifecycle spec
  // dependía de awardPoints para incrementar XP de la cuadrilla).
  return {
    'Content-Type': 'application/json',
    ...(await apiAuthHeaders()),
  };
}

export async function awardPoints(reason: PointReason): Promise<void> {
  try {
    const headers = await authHeaders();
    // The server awards the canonical POINT_VALUES[reason]; we only send the
    // reason. (No client-supplied amount — it would be ignored server-side.)
    await fetch('/api/gamification/points', {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
    // Fire-and-forget medal check after every award
    fetch('/api/gamification/check-medals', { method: 'POST', headers }).catch(() => {});
  } catch {
    // Gamification is non-critical — never throw
  }
}

/**
 * Ask the server to re-evaluate the caller's medal eligibility. Medals are
 * server-authoritative (firestore.rules forbids the owner from writing
 * `user_stats.medals`); the server re-derives them from real stats and writes
 * via the Admin SDK. Fire-and-forget — gamification is non-critical.
 */
export async function checkMedals(): Promise<void> {
  try {
    const headers = await authHeaders();
    await fetch('/api/gamification/check-medals', { method: 'POST', headers });
  } catch {
    // Non-critical — never throw.
  }
}

export async function getLeaderboard(): Promise<any[]> {
  try {
    const headers = await authHeaders();
    const res = await fetch('/api/gamification/leaderboard', { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.leaderboard ?? [];
  } catch {
    return [];
  }
}
