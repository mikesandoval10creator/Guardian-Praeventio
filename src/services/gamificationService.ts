import { auth } from './firebase';

async function authHeaders(): Promise<Record<string, string>> {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

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

export async function awardPoints(reason: PointReason, overrideAmount?: number): Promise<void> {
  const amount = overrideAmount ?? POINT_VALUES[reason];
  try {
    const headers = await authHeaders();
    await fetch('/api/gamification/points', {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount, reason }),
    });
    // Fire-and-forget medal check after every award
    fetch('/api/gamification/check-medals', { method: 'POST', headers }).catch(() => {});
  } catch {
    // Gamification is non-critical — never throw
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
