// Pure function: maps operational state to Guardian mascot mood.
// No side effects, no panic escalation — calm, helpful tone.

import type { MascotMood } from '../shared/GuardianMascot';

interface FaenaState {
  emergencyActive: boolean;
  openIncidents: number;
  pendingActions: number;
}

/**
 * Maps faena state to the Guardian's mood.
 * - emergency → 'emergency'
 * - active incidents or many pending actions → 'alert'
 * - no incidents AND no pending actions → 'celebrating' (used sparingly)
 * - no incidents but some pending actions → 'default'
 */
export function guardianMood(s: FaenaState): MascotMood {
  if (s.emergencyActive) return 'emergency';
  if (s.openIncidents > 0 || s.pendingActions >= 5) return 'alert';
  if (s.openIncidents === 0 && s.pendingActions === 0) return 'celebrating';
  return 'default';
}
