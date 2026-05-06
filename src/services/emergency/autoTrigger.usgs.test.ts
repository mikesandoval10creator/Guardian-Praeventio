// Sprint 39 J3c — autoTrigger USGS cross-check tests.
//
// Reglas verificadas:
//  - blockOperation siempre false.
//  - USGS confirma → severity 'high'.
//  - USGS no confirma → severity 'caution'.
//  - USGS timeout → severity 'caution' + warn log.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ingestAccelerationSample,
  checkSismoEnriched,
  pushUsgsAdapter,
  pushDeviceLocation,
  __resetEmergencyBridges,
} from './autoTrigger';
import type { UsgsEarthquake } from '../external/usgs/types';

const G = 9.80665;

function highMagSample() {
  // 1.6g magnitude in z-axis → dynamic 0.6g over 1g baseline.
  const targetMag = 1.6 * G;
  return { x: 0, y: 0, z: targetMag };
}

function fakeQuake(): UsgsEarthquake {
  return {
    type: 'Feature',
    id: 'usgs_eq_z',
    properties: { mag: 4.0, place: 'Test', time: 1_700_000_000_000 },
    geometry: { type: 'Point', coordinates: [-70.6, -33.5, 12] },
  };
}

async function triggerSismicEdge(): Promise<void> {
  // Sustain 0.6g for >300ms in the sliding window.
  const t0 = 1_700_000_000_000;
  vi.setSystemTime(t0);
  ingestAccelerationSample(highMagSample(), t0);
  vi.setSystemTime(t0 + 400);
  ingestAccelerationSample(highMagSample(), t0 + 400);
}

describe('checkSismoEnriched', () => {
  beforeEach(() => {
    __resetEmergencyBridges();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1) USGS confirms sismo => severity high + externalConfirmed true + blockOperation false', async () => {
    const fetchRecentEarthquakes = vi.fn().mockResolvedValue([fakeQuake()]);
    pushUsgsAdapter({ fetchRecentEarthquakes });
    pushDeviceLocation({ lat: -33.45, lon: -70.66 });

    await triggerSismicEdge();

    const result = await checkSismoEnriched();
    expect(result.fired).toBe(true);
    expect(result.severity).toBe('high');
    expect(result.externalConfirmed).toBe(true);
    expect(result.matchedEvents).toHaveLength(1);
    expect(result.blockOperation).toBe(false);
    expect(fetchRecentEarthquakes).toHaveBeenCalledOnce();
  });

  it('2) USGS does NOT confirm => severity caution + blockOperation false', async () => {
    const fetchRecentEarthquakes = vi.fn().mockResolvedValue([]);
    pushUsgsAdapter({ fetchRecentEarthquakes });
    pushDeviceLocation({ lat: -33.45, lon: -70.66 });

    await triggerSismicEdge();

    const result = await checkSismoEnriched();
    expect(result.fired).toBe(true);
    expect(result.severity).toBe('caution');
    expect(result.externalConfirmed).toBe(false);
    expect(result.blockOperation).toBe(false);
  });

  it('3) USGS fetch timeout => severity caution + warn log + blockOperation false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // adapter that hangs forever — withTimeout will reject.
    const fetchRecentEarthquakes = vi
      .fn()
      .mockImplementation(() => new Promise(() => {}));
    pushUsgsAdapter({ fetchRecentEarthquakes });
    pushDeviceLocation({ lat: -33.45, lon: -70.66 });

    await triggerSismicEdge();

    // Use real timers ONLY for the timeout race; vitest fake timers would
    // freeze the setTimeout inside withTimeout.
    vi.useRealTimers();
    const result = await checkSismoEnriched({ timeoutMs: 50 });
    expect(result.fired).toBe(true);
    expect(result.severity).toBe('caution');
    expect(result.externalConfirmed).toBe(false);
    expect(result.blockOperation).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
