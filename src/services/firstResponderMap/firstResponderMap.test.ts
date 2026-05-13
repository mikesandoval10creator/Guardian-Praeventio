import { describe, it, expect } from 'vitest';
import {
  buildDispatchPlan,
  analyzeCoverage,
  type Responder,
} from './firstResponderMap.js';

const NOW = new Date('2026-05-13T10:00:00Z');
const RECENT = new Date(NOW.getTime() - 60_000).toISOString();
const STALE = new Date(NOW.getTime() - 600_000).toISOString();

const INCIDENT_LOC = { lat: -33.4500, lng: -70.6700, floor: 0 };

function makeResponder(over: Partial<Responder>): Responder {
  return {
    uid: 'r1',
    name: 'Test',
    roles: ['paramedic'],
    currentPosition: { lat: -33.4500, lng: -70.6700, floor: 0 },
    lastSeenAt: RECENT,
    availability: 'on_duty',
    ...over,
  };
}

describe('buildDispatchPlan — basic dispatch', () => {
  it('paramedico cercano on_duty → primary asignado', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'p1' })],
      { kind: 'medical_emergency', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary?.responderUid).toBe('p1');
    expect(plan.primary?.available).toBe(true);
  });

  it('sin responder de role requerido → noEligibleResponder', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'r1', roles: ['security_guard'] })],
      { kind: 'cardiac_arrest', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.noEligibleResponder).toBe(true);
    expect(plan.primary).toBeUndefined();
    expect(plan.recommendations.some((r) => /131 SAMU/i.test(r))).toBe(true);
  });

  it('responder más cercano gana score', () => {
    const close = makeResponder({
      uid: 'close',
      currentPosition: { lat: -33.4500, lng: -70.6700 },
    });
    const far = makeResponder({
      uid: 'far',
      currentPosition: { lat: -33.4600, lng: -70.6700 }, // ~1km
    });
    const plan = buildDispatchPlan([far, close], { kind: 'trauma_injury', location: INCIDENT_LOC }, NOW);
    expect(plan.primary?.responderUid).toBe('close');
  });

  it('on_duty preferido sobre on_break', () => {
    const onBreak = makeResponder({ uid: 'break', availability: 'on_break' });
    const onDuty = makeResponder({
      uid: 'duty',
      currentPosition: { lat: -33.4500, lng: -70.6701 }, // un poco más lejos
    });
    const plan = buildDispatchPlan([onBreak, onDuty], { kind: 'trauma_injury', location: INCIDENT_LOC }, NOW);
    // Ambos available, gana por matchScore (duty es más cercano)
    expect(plan.primary?.responderUid).toBe('duty');
  });

  it('off_site no es eligible', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'offsite', availability: 'off_site' })],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.noEligibleResponder).toBe(true);
  });

  it('lastSeen stale → no available', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'stale', lastSeenAt: STALE })],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary).toBeUndefined();
  });

  it('responder sin position known → marked rejected', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'nopos', currentPosition: undefined })],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary).toBeUndefined();
  });
});

describe('buildDispatchPlan — SIF certification', () => {
  it('fall_from_height SIN sifCertified → no eligible', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'no-sif', sifCertified: false })],
      { kind: 'fall_from_height', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.noEligibleResponder).toBe(true);
  });

  it('fall_from_height CON sifCertified → eligible + boost', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'sif-ok', sifCertified: true })],
      { kind: 'fall_from_height', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary?.responderUid).toBe('sif-ok');
    expect(plan.primary?.sifCertOk).toBe(true);
    expect(plan.recommendations.some((r) => /SIF cert verificada/i.test(r))).toBe(true);
  });

  it('confined_space_rescue requiere rescue_specialist + sif', () => {
    const plan = buildDispatchPlan(
      [
        makeResponder({ uid: 'p1', roles: ['paramedic'], sifCertified: true }),
        makeResponder({ uid: 'rs', roles: ['rescue_specialist'], sifCertified: true }),
      ],
      { kind: 'confined_space_rescue', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary?.matchedRole).toBe('rescue_specialist');
  });
});

describe('buildDispatchPlan — capacity', () => {
  it('responder al cap maxConcurrent → no eligible', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'full', maxConcurrent: 2, activeAssignments: 2 })],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary).toBeUndefined();
  });

  it('responder bajo cap → eligible', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'has-room', maxConcurrent: 3, activeAssignments: 1 })],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.primary?.responderUid).toBe('has-room');
  });
});

describe('buildDispatchPlan — backups', () => {
  it('lista hasta 3 backups', () => {
    const responders = Array.from({ length: 6 }, (_, i) =>
      makeResponder({
        uid: `r${i}`,
        currentPosition: { lat: -33.4500 + i * 0.001, lng: -70.6700 },
      }),
    );
    const plan = buildDispatchPlan(responders, { kind: 'trauma_injury', location: INCIDENT_LOC }, NOW);
    expect(plan.backups.length).toBeLessThanOrEqual(3);
    expect(plan.primary?.responderUid).toBe('r0'); // más cercano
  });

  it('warning sin backups', () => {
    const plan = buildDispatchPlan(
      [makeResponder({ uid: 'solo' })],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.backups).toHaveLength(0);
    expect(plan.recommendations.some((r) => /backups/i.test(r))).toBe(true);
  });
});

describe('buildDispatchPlan — ETA warnings', () => {
  it('ETA > 10 min → recomendación contacto mutual paralelo', () => {
    const plan = buildDispatchPlan(
      [
        makeResponder({
          uid: 'far',
          currentPosition: { lat: -33.4400, lng: -70.6500 }, // ~2km+
        }),
      ],
      { kind: 'trauma_injury', location: INCIDENT_LOC },
      NOW,
    );
    expect(plan.recommendations.some((r) => /mutual/i.test(r))).toBe(true);
  });
});

describe('analyzeCoverage', () => {
  it('sin paramedic on_duty → critical', () => {
    const gaps = analyzeCoverage([
      makeResponder({ uid: 'r1', roles: ['security_guard'] }),
      makeResponder({ uid: 'r2', roles: ['security_guard'] }),
    ]);
    expect(gaps.some((g) => g.kind === 'no_paramedic' && g.severity === 'critical')).toBe(true);
  });

  it('undermanned (<3 on_duty)', () => {
    const gaps = analyzeCoverage([makeResponder({})]);
    expect(gaps.some((g) => g.kind === 'undermanned')).toBe(true);
  });

  it('cobertura completa → solo posibles warnings de un sólo role', () => {
    const gaps = analyzeCoverage([
      makeResponder({ uid: 'p', roles: ['paramedic'], sifCertified: true }),
      makeResponder({ uid: 'f', roles: ['fire_brigade'] }),
      makeResponder({ uid: 'r', roles: ['rescue_specialist'] }),
    ]);
    expect(gaps.some((g) => g.severity === 'critical')).toBe(false);
  });
});
