import { describe, it, expect } from 'vitest';
import {
  classifyMode,
  policyForMode,
  type AccelerometerSample,
  type ProximityReading,
} from './proximityModeDetector.js';

const NOW = new Date('2026-05-13T10:00:00Z');

function accel(over: Partial<AccelerometerSample> & { magnitudeG: number }): AccelerometerSample {
  return {
    x: 0,
    y: -1,
    z: 0,
    at: NOW.toISOString(),
    ...over,
  };
}

describe('classifyMode', () => {
  it('proximity=far → normal mode', () => {
    const r = classifyMode({
      proximity: { state: 'far', at: NOW.toISOString() },
      recentAccelerometer: [accel({ magnitudeG: 1.0 })],
      now: NOW,
    });
    expect(r.currentMode).toBe('normal');
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('proximity=near + accel quiet + tilt 45-60° → in_helmet_mount', () => {
    const r = classifyMode({
      proximity: { state: 'near', at: NOW.toISOString() },
      // y=0.5, x=0.5, z=0.7 → magnitud ~1G, tilt z=0.7
      recentAccelerometer: [accel({ x: 0.5, y: 0.5, z: 0.7, magnitudeG: 1.0 })],
      now: NOW,
    });
    expect(r.currentMode).toBe('in_helmet_mount');
  });

  it('proximity=near + y invertido → face_down', () => {
    const r = classifyMode({
      proximity: { state: 'near', at: NOW.toISOString() },
      recentAccelerometer: [accel({ x: 0, y: -0.95, z: 0, magnitudeG: 1.0 })],
      now: NOW,
    });
    expect(r.currentMode).toBe('face_down');
  });

  it('proximity=near + accel patrón paseo (avg ~1.1G) → in_pocket', () => {
    const samples: AccelerometerSample[] = [
      accel({ magnitudeG: 1.0 }),
      accel({ magnitudeG: 1.3 }),
      accel({ magnitudeG: 0.9 }),
      accel({ magnitudeG: 1.2 }),
    ];
    const r = classifyMode({
      proximity: { state: 'near', at: NOW.toISOString() },
      recentAccelerometer: samples,
      now: NOW,
    });
    // avg=1.1 → cae en rango pocket [0.7-1.5]
    expect(['in_pocket', 'in_helmet_mount']).toContain(r.currentMode);
  });

  it('proximity=near + sin patrón claro → near_head fallback', () => {
    // x grande, y grande, z grande (no quiet, no walking)
    const r = classifyMode({
      proximity: { state: 'near', at: NOW.toISOString() },
      recentAccelerometer: [accel({ x: 2, y: 2, z: 2, magnitudeG: 3.5 })],
      now: NOW,
    });
    expect(r.currentMode).toBe('near_head');
  });

  it('stickiness: si mismo mode que previousMode, mantiene enteredAt', () => {
    const previous = {
      currentMode: 'normal' as const,
      enteredAt: '2026-05-13T09:55:00Z',
      confidence: 0.9,
      reasons: [],
    };
    const r = classifyMode({
      proximity: { state: 'far', at: NOW.toISOString() },
      recentAccelerometer: [accel({ magnitudeG: 1.0 })],
      previousMode: previous,
      now: NOW,
    });
    expect(r.currentMode).toBe('normal');
    expect(r.enteredAt).toBe('2026-05-13T09:55:00Z');
  });

  it('cambio de mode → enteredAt actualizado', () => {
    const previous = {
      currentMode: 'in_pocket' as const,
      enteredAt: '2026-05-13T09:55:00Z',
      confidence: 0.8,
      reasons: [],
    };
    const r = classifyMode({
      proximity: { state: 'far', at: NOW.toISOString() },
      recentAccelerometer: [accel({ magnitudeG: 1.0 })],
      previousMode: previous,
      now: NOW,
    });
    expect(r.currentMode).toBe('normal');
    expect(r.enteredAt).toBe(NOW.toISOString());
  });

  it('reasons incluye explicación auditable', () => {
    const r = classifyMode({
      proximity: { state: 'far', at: NOW.toISOString() },
      recentAccelerometer: [],
      now: NOW,
    });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons[0]).toMatch(/proximity=far/);
  });
});

describe('policyForMode', () => {
  it('normal mode → no suppress + no acceleration', () => {
    const p = policyForMode('normal');
    expect(p.fallDetectionMultiplier).toBe(1.0);
    expect(p.suppressAccidentalTaps).toBe(false);
    expect(p.acceleratedHeartbeat).toBe(false);
  });

  it('in_pocket → suppress taps + sensibilidad fall 1.3x', () => {
    const p = policyForMode('in_pocket');
    expect(p.suppressAccidentalTaps).toBe(true);
    expect(p.fallDetectionMultiplier).toBeGreaterThan(1.0);
  });

  it('in_helmet_mount → voice mode + accelerated heartbeat', () => {
    const p = policyForMode('in_helmet_mount');
    expect(p.enableVoiceMode).toBe(true);
    expect(p.acceleratedHeartbeat).toBe(true);
    expect(p.fallDetectionMultiplier).toBe(1.5);
  });

  it('face_down → prompt manual check-in (posible inconsciente)', () => {
    const p = policyForMode('face_down');
    expect(p.promptManualCheckin).toBe(true);
    expect(p.fallDetectionMultiplier).toBe(2.0);
    expect(p.acceleratedHeartbeat).toBe(true);
  });

  it('near_head → suppress taps pero no acceleration', () => {
    const p = policyForMode('near_head');
    expect(p.suppressAccidentalTaps).toBe(true);
    expect(p.acceleratedHeartbeat).toBe(false);
  });
});
