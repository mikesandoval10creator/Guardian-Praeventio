import { describe, it, expect } from 'vitest';
import { guardianMood } from './guardianMood';

describe('guardianMood', () => {
  it('emergency active → emergency', () => {
    expect(guardianMood({ emergencyActive: true, openIncidents: 0, pendingActions: 0 })).toBe('emergency');
  });
  it('open incidents → alert', () => {
    expect(guardianMood({ emergencyActive: false, openIncidents: 2, pendingActions: 0 })).toBe('alert');
  });
  it('many pending actions → alert', () => {
    expect(guardianMood({ emergencyActive: false, openIncidents: 0, pendingActions: 5 })).toBe('alert');
  });
  it('all clear → celebrating', () => {
    expect(guardianMood({ emergencyActive: false, openIncidents: 0, pendingActions: 0 })).toBe('celebrating');
  });
  it('few pending but no incidents → default (not fully clear)', () => {
    // 1 pending action = no incidents but work remains → 'default', not 'celebrating'
    expect(guardianMood({ emergencyActive: false, openIncidents: 0, pendingActions: 1 })).toBe('default');
  });
});
