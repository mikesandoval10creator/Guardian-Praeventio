import { describe, it, expect } from 'vitest';
import {
  deriveUxMode,
  profileToCssVars,
  diffProfiles,
  type UxModeContext,
} from './uxModeAdapter.js';

describe('deriveUxMode — accessibility prefs', () => {
  it('default ctx → standard profile', () => {
    const p = deriveUxMode({});
    expect(p.fontScale).toBe(1);
    expect(p.minTapTargetPx).toBe(44);
    expect(p.preferPictograms).toBe(false);
    expect(p.theme).toBe('light');
    expect(p.essentialOnlyMode).toBe(false);
  });

  it('large_text → fontScale 1.25', () => {
    const p = deriveUxMode({ accessibility: ['large_text'] });
    expect(p.fontScale).toBe(1.25);
  });

  it('easy_read → preferPictograms + fontScale ≥1.15', () => {
    const p = deriveUxMode({ accessibility: ['easy_read'] });
    expect(p.preferPictograms).toBe(true);
    expect(p.fontScale).toBeGreaterThanOrEqual(1.15);
  });

  it('high_contrast preference → highContrastMode true', () => {
    const p = deriveUxMode({ accessibility: ['high_contrast'] });
    expect(p.highContrastMode).toBe(true);
  });

  it('reduce_motion preference → reduceMotion true', () => {
    const p = deriveUxMode({ accessibility: ['reduce_motion'] });
    expect(p.reduceMotion).toBe(true);
  });
});

describe('deriveUxMode — hands context', () => {
  it('gloved_hands → tap target 64px + preferPictograms + disableMultiTouch', () => {
    const p = deriveUxMode({ hands: 'gloved_hands' });
    expect(p.minTapTargetPx).toBe(64);
    expect(p.preferPictograms).toBe(true);
    expect(p.disableMultiTouchGestures).toBe(true);
  });

  it('one_hand → tap target ≥56', () => {
    const p = deriveUxMode({ hands: 'one_hand' });
    expect(p.minTapTargetPx).toBeGreaterThanOrEqual(56);
    expect(p.disableMultiTouchGestures).toBe(true);
  });

  it('voice_only → preferPictograms', () => {
    const p = deriveUxMode({ hands: 'voice_only' });
    expect(p.preferPictograms).toBe(true);
  });
});

describe('deriveUxMode — battery thresholds', () => {
  it('battery critical → essentialOnly + sync 300s', () => {
    const p = deriveUxMode({ battery: 'critical' });
    expect(p.essentialOnlyMode).toBe(true);
    expect(p.hideHeavyFeatures).toBe(true);
    expect(p.syncIntervalSeconds).toBe(300);
  });

  it('battery low → hideHeavyFeatures + sync 120s', () => {
    const p = deriveUxMode({ battery: 'low' });
    expect(p.hideHeavyFeatures).toBe(true);
    expect(p.essentialOnlyMode).toBe(false);
    expect(p.syncIntervalSeconds).toBe(120);
  });

  it('battery plenty → no special mode', () => {
    const p = deriveUxMode({ battery: 'plenty' });
    expect(p.essentialOnlyMode).toBe(false);
    expect(p.hideHeavyFeatures).toBe(false);
  });

  it('charging → no penalty', () => {
    const p = deriveUxMode({ battery: 'charging' });
    expect(p.essentialOnlyMode).toBe(false);
  });
});

describe('deriveUxMode — network classes', () => {
  it('offline → essentialOnly + sync 9999', () => {
    const p = deriveUxMode({ network: 'offline' });
    expect(p.essentialOnlyMode).toBe(true);
    expect(p.syncIntervalSeconds).toBe(9999);
  });

  it('2G/edge → hideHeavyFeatures + sync ≥180', () => {
    const p = deriveUxMode({ network: 'cellular_2g' });
    expect(p.hideHeavyFeatures).toBe(true);
    expect(p.syncIntervalSeconds).toBeGreaterThanOrEqual(180);
  });

  it('3G → sync ≥60', () => {
    const p = deriveUxMode({ network: 'cellular_3g' });
    expect(p.syncIntervalSeconds).toBeGreaterThanOrEqual(60);
    expect(p.essentialOnlyMode).toBe(false);
  });

  it('wifi_strong → sync default 30s', () => {
    const p = deriveUxMode({ network: 'wifi_strong' });
    expect(p.syncIntervalSeconds).toBe(30);
  });
});

describe('deriveUxMode — theme + ambient', () => {
  it('manualTheme override beats ambient', () => {
    const p = deriveUxMode({ manualTheme: 'dark', ambientLight: 'bright_sunlight' });
    expect(p.theme).toBe('dark');
  });

  it('bright_sunlight ambient → light + high_contrast', () => {
    const p = deriveUxMode({ ambientLight: 'bright_sunlight' });
    expect(p.theme).toBe('light');
    expect(p.highContrastMode).toBe(true);
  });

  it('night ambient → dark', () => {
    const p = deriveUxMode({ ambientLight: 'night' });
    expect(p.theme).toBe('dark');
  });
});

describe('deriveUxMode — combinaciones complejas', () => {
  it('worker minero (gloved + sol + battery low + 3G + easy_read) — todo aplicado', () => {
    const ctx: UxModeContext = {
      hands: 'gloved_hands',
      ambientLight: 'bright_sunlight',
      battery: 'low',
      network: 'cellular_3g',
      accessibility: ['easy_read'],
    };
    const p = deriveUxMode(ctx);
    expect(p.minTapTargetPx).toBe(64);
    expect(p.highContrastMode).toBe(true);
    expect(p.preferPictograms).toBe(true);
    expect(p.hideHeavyFeatures).toBe(true); // por battery low
    expect(p.theme).toBe('light');
    expect(p.appliedReasons.length).toBeGreaterThan(3);
  });
});

describe('profileToCssVars', () => {
  it('produce CSS vars con valores correctos', () => {
    const p = deriveUxMode({ hands: 'gloved_hands' });
    const vars = profileToCssVars(p);
    expect(vars['--ux-tap-min']).toBe('64px');
    expect(vars['--ux-disable-multitouch']).toBe('1');
  });
});

describe('diffProfiles', () => {
  it('detecta cambios entre profiles', () => {
    const prev = deriveUxMode({ battery: 'plenty' });
    const next = deriveUxMode({ battery: 'critical' });
    const plan = diffProfiles(prev, next);
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(plan.requiresShellReload).toBe(true);
  });

  it('no requireShellReload si essentialOnly no cambia', () => {
    const prev = deriveUxMode({ network: 'wifi_strong' });
    const next = deriveUxMode({ network: 'cellular_3g' });
    const plan = diffProfiles(prev, next);
    expect(plan.requiresShellReload).toBe(false);
  });

  it('mismos contextos → 0 changes', () => {
    const p = deriveUxMode({ battery: 'plenty' });
    const plan = diffProfiles(p, p);
    expect(plan.changes).toHaveLength(0);
  });
});
