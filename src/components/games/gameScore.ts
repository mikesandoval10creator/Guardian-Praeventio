// Round 15 / I4 — pure helpers shared by serious-game pages.
//
// The Praeventio serious-games persist scores to Firestore docs at
// `gamification_scores/{userId}_{gameId}` so that future Round-16 rules can
// gate them per project. The score documents follow this schema:
//
//   {
//     userId: string,
//     gameId: 'clawmachine' | 'poolgame' | ...,
//     bestScore: number,                      // monotonic max
//     bestTimeSeconds?: number,               // lower-is-better games
//     lastScore: number,
//     plays: number,
//     updatedAt: ISO string,
//     updatedBy: string,                      // displayName/email/uid
//   }
//
// We only export pure helpers from this module so they are exhaustively
// unit-testable without mounting React or hitting Firebase. The actual
// persistence call lives in the page (using `setDoc` + `merge: true`) so the
// helper stays Firebase-agnostic.
//
// Schema note for R6 reviewer / R16 follow-up: this collection still needs
// firestore.rules (append-only post-sign similar to ergonomic_assessments).
// Until then, writes are gated behind tier flags in the UI.

export interface GameScoreDoc {
  userId: string;
  gameId: string;
  bestScore: number;
  bestTimeSeconds?: number;
  lastScore: number;
  plays: number;
  updatedAt: string;
  updatedBy: string;
}

export interface MergeScoreInput {
  newScore: number;
  /** Lower-is-better games (e.g. evacuation time) supply this. */
  newTimeSeconds?: number;
  existing?: Partial<GameScoreDoc> | null;
  userId: string;
  gameId: string;
  updatedBy: string;
  /** Injectable for tests. Defaults to ISO `now`. */
  now?: () => string;
}

/**
 * Computes the merged score doc to persist. Pure function — no Firestore.
 *
 * Rules:
 *   • bestScore = max(existing.bestScore ?? 0, newScore)
 *   • bestTimeSeconds = min of the two when both are defined; otherwise the
 *     one that is defined (so the first run wins until beaten).
 *   • plays = (existing.plays ?? 0) + 1
 */
export function mergeScoreDoc(input: MergeScoreInput): GameScoreDoc {
  const { newScore, newTimeSeconds, existing, userId, gameId, updatedBy } = input;
  const now = (input.now ?? (() => new Date().toISOString()))();
  const prevBest = existing?.bestScore ?? 0;
  const prevTime = existing?.bestTimeSeconds;
  const prevPlays = existing?.plays ?? 0;

  let bestTime: number | undefined;
  if (typeof newTimeSeconds === 'number' && typeof prevTime === 'number') {
    bestTime = Math.min(prevTime, newTimeSeconds);
  } else if (typeof newTimeSeconds === 'number') {
    bestTime = newTimeSeconds;
  } else if (typeof prevTime === 'number') {
    bestTime = prevTime;
  }

  const merged: GameScoreDoc = {
    userId,
    gameId,
    bestScore: Math.max(prevBest, newScore),
    lastScore: newScore,
    plays: prevPlays + 1,
    updatedAt: now,
    updatedBy,
  };
  if (typeof bestTime === 'number') merged.bestTimeSeconds = bestTime;
  return merged;
}

export function gameScoreDocId(userId: string, gameId: string): string {
  return `${userId}_${gameId}`;
}
