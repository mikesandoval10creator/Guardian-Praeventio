// OLA 1 (VIDA, 2026-06-14) — resolveEmergencyModeTransition.
//
// Pins the SOS-button-visibility fix: a declared emergency flips AppMode to
// 'emergency' (so RootLayout's global SOSButton renders), reverts to 'normal'
// when cleared, and NEVER clobbers 'driving'.

import { describe, it, expect } from 'vitest';
import { resolveEmergencyModeTransition } from './emergencyModeSync';

describe('resolveEmergencyModeTransition', () => {
  it('declared while in normal → switches to emergency (surfaces the SOS button)', () => {
    expect(resolveEmergencyModeTransition(true, 'normal')).toBe('emergency');
  });

  it('declared while in driving → switches to emergency (emergency takes over)', () => {
    expect(resolveEmergencyModeTransition(true, 'driving')).toBe('emergency');
  });

  it('declared while already emergency → no change (no re-render loop)', () => {
    expect(resolveEmergencyModeTransition(true, 'emergency')).toBeNull();
  });

  it('cleared while in emergency → reverts to normal', () => {
    expect(resolveEmergencyModeTransition(false, 'emergency')).toBe('normal');
  });

  it('cleared while in driving → no change (never clobber driving mode)', () => {
    expect(resolveEmergencyModeTransition(false, 'driving')).toBeNull();
  });

  it('cleared while in normal → no change', () => {
    expect(resolveEmergencyModeTransition(false, 'normal')).toBeNull();
  });
});
