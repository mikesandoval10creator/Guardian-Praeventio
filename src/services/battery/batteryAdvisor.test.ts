// Praeventio Guard — batteryAdvisor unit tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyBatteryThrottle,
  applyBatteryThrottleSync,
  getBatterySnapshot,
  getCachedBatterySnapshot,
  __resetBatteryCache,
  __setBatterySnapshotForTests,
  POLL_MULTIPLIERS,
  type BatteryMode,
} from './batteryAdvisor';

function mockNavigatorBattery(level: number, charging: boolean): void {
  vi.stubGlobal('navigator', {
    getBattery: async () => ({
      level,
      charging,
      addEventListener: () => undefined,
    }),
  });
}

describe('batteryAdvisor.classifyMode', () => {
  beforeEach(() => {
    __resetBatteryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('charging siempre es normal', async () => {
    mockNavigatorBattery(0.05, true);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('normal');
    expect(s.charging).toBe(true);
  });

  it('level >= 0.2 sin cargar → normal', async () => {
    mockNavigatorBattery(0.5, false);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('normal');
  });

  it('level 0.18 → conservative (entre 0.17 y 0.20)', async () => {
    mockNavigatorBattery(0.18, false);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('conservative');
  });

  it('level 0.15 → low', async () => {
    mockNavigatorBattery(0.15, false);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('low');
  });

  it('level 0.05 → critical', async () => {
    mockNavigatorBattery(0.05, false);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('critical');
  });

  it('hysteresis: 0.17 NO degrada a low aún (buffer 0.03 sobre umbral 0.20)', async () => {
    // Umbral low = LOW_THRESHOLD - RESTORE_BUFFER = 0.20 - 0.03 = 0.17.
    // 0.17 NO es < 0.17, por lo tanto sigue siendo conservative.
    mockNavigatorBattery(0.17, false);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('conservative');
  });

  it('hysteresis: 0.16 SÍ degrada a low (cruzó el buffer)', async () => {
    mockNavigatorBattery(0.16, false);
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('low');
  });

  it('graceful cuando navigator.getBattery no existe (jsdom/iOS)', async () => {
    vi.stubGlobal('navigator', { userAgent: 'jsdom' });
    const s = await getBatterySnapshot();
    expect(s.mode).toBe('normal');
    expect(s.level).toBeNull();
  });
});

describe('applyBatteryThrottle', () => {
  beforeEach(() => __resetBatteryCache());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normal mode: multiplier 1x', async () => {
    mockNavigatorBattery(0.5, false);
    const ms = await applyBatteryThrottle(5000);
    expect(ms).toBe(5000);
  });

  it('critical mode: multiplier 5x', async () => {
    mockNavigatorBattery(0.05, false);
    const ms = await applyBatteryThrottle(5000);
    expect(ms).toBe(25000);
  });

  it('low mode: multiplier 3x', async () => {
    mockNavigatorBattery(0.15, false);
    const ms = await applyBatteryThrottle(5000);
    expect(ms).toBe(15000);
  });

  it('criticalSensor: ignora throttle aunque batería baja', async () => {
    mockNavigatorBattery(0.05, false);
    const ms = await applyBatteryThrottle(5000, { criticalSensor: true });
    expect(ms).toBe(5000);
  });

  it('modeOverride salta llamada al navegador (útil en tests)', async () => {
    const ms = await applyBatteryThrottle(1000, { modeOverride: 'low' });
    expect(ms).toBe(3000);
  });
});

describe('applyBatteryThrottleSync', () => {
  it('compatible con todos los BatteryMode', () => {
    for (const mode of Object.keys(POLL_MULTIPLIERS) as BatteryMode[]) {
      const ms = applyBatteryThrottleSync(1000, mode);
      expect(ms).toBe(POLL_MULTIPLIERS[mode] * 1000);
    }
  });

  it('criticalSensor sync bypass', () => {
    expect(
      applyBatteryThrottleSync(1000, 'critical', { criticalSensor: true }),
    ).toBe(1000);
  });
});

describe('cached snapshot helpers', () => {
  it('__setBatterySnapshotForTests + getCachedBatterySnapshot round-trip', () => {
    __setBatterySnapshotForTests({
      level: 0.3,
      charging: false,
      mode: 'normal',
      capturedAt: '2026-01-01T00:00:00Z',
    });
    const s = getCachedBatterySnapshot();
    expect(s).toBeTruthy();
    expect(s!.level).toBe(0.3);
  });

  it('__resetBatteryCache borra el snapshot', () => {
    __setBatterySnapshotForTests({
      level: 0.3,
      charging: false,
      mode: 'normal',
      capturedAt: '2026-01-01T00:00:00Z',
    });
    __resetBatteryCache();
    expect(getCachedBatterySnapshot()).toBeNull();
  });
});
