// OLA 1 (VIDA, 2026-06-14) — pure AppMode transition for a declared emergency.
//
// The worker-facing SOS button (RootLayout, global) renders ONLY when
// AppMode === 'emergency'. A DECLARED project emergency must therefore flip
// AppMode so the button appears — but the flip must NOT clobber 'driving'
// mode (a driver in an active commute should not be yanked out). This pure
// function isolates that decision so it can be unit-tested without rendering
// the heavy Emergency page.

import type { AppMode } from '../../contexts/AppModeContext';

/**
 * Given whether a project emergency is currently DECLARED and the current
 * AppMode, return the AppMode to switch to — or `null` for no change.
 *
 * Only toggles emergency↔normal:
 *  - declared & not already emergency → 'emergency' (surface the SOS button)
 *  - cleared & currently emergency    → 'normal'
 *  - any other case (incl. 'driving') → null (never clobber another mode)
 */
export function resolveEmergencyModeTransition(
  isEmergencyDeclared: boolean,
  currentMode: AppMode,
): AppMode | null {
  if (isEmergencyDeclared && currentMode !== 'emergency') return 'emergency';
  if (!isEmergencyDeclared && currentMode === 'emergency') return 'normal';
  return null;
}
