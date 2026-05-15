import { describe, it, expect } from 'vitest';
import {
  validateIzajeCritico,
  validateExcavation,
  validateLoto,
  validateCriticalPermit,
  type IzajeMetadata,
  type ExcavationMetadata,
  type LotoMetadata,
} from './criticalPermitValidators.js';

// ────────────────────────────────────────────────────────────────────────
// Izaje crítico
// ────────────────────────────────────────────────────────────────────────

const baseIzaje = (over?: Partial<IzajeMetadata>): IzajeMetadata => ({
  loadWeightKg: 5000,
  operatingRadiusMeters: 10,
  craneCapacityAtRadiusKg: 10000,
  craneOperatorUid: 'op-1',
  craneOperatorCertified: true,
  riggerUid: 'rigger-1',
  signalerUid: 'sig-1',
  windSpeedMps: 5,
  exclusionZoneMarked: true,
  riggingInspected: true,
  ...over,
});

describe('validateIzajeCritico', () => {
  it('caso feliz: 0 issues', () => {
    const r = validateIzajeCritico(baseIzaje());
    expect(r.issues).toHaveLength(0);
    expect(r.hasBlockers).toBe(false);
  });

  it('carga > capacidad nominal: blocker OVER_CAPACITY', () => {
    const r = validateIzajeCritico(
      baseIzaje({ loadWeightKg: 12000, craneCapacityAtRadiusKg: 10000 }),
    );
    expect(r.hasBlockers).toBe(true);
    expect(r.issues.some((i) => i.code === 'OVER_CAPACITY')).toBe(true);
  });

  it('carga 90% capacidad: advisory NEAR_CAPACITY', () => {
    const r = validateIzajeCritico(
      baseIzaje({ loadWeightKg: 9000, craneCapacityAtRadiusKg: 10000 }),
    );
    expect(r.hasBlockers).toBe(false);
    expect(r.hasAdvisories).toBe(true);
    expect(r.issues.some((i) => i.code === 'NEAR_CAPACITY')).toBe(true);
  });

  it('operador no certificado: blocker', () => {
    const r = validateIzajeCritico(baseIzaje({ craneOperatorCertified: false }));
    expect(r.issues.some((i) => i.code === 'OPERATOR_NOT_CERTIFIED')).toBe(true);
  });

  it('rigger missing: blocker', () => {
    const r = validateIzajeCritico(baseIzaje({ riggerUid: undefined }));
    expect(r.issues.some((i) => i.code === 'RIGGER_MISSING')).toBe(true);
  });

  it('señalero missing: blocker', () => {
    const r = validateIzajeCritico(baseIzaje({ signalerUid: undefined }));
    expect(r.issues.some((i) => i.code === 'SIGNALER_MISSING')).toBe(true);
  });

  it('señalero === operador: blocker SIGNALER_DUAL_ROLE', () => {
    const r = validateIzajeCritico(baseIzaje({ signalerUid: 'op-1' }));
    expect(r.issues.some((i) => i.code === 'SIGNALER_DUAL_ROLE')).toBe(true);
  });

  it('señalero === rigger: blocker SIGNALER_DUAL_ROLE', () => {
    const r = validateIzajeCritico(baseIzaje({ signalerUid: 'rigger-1' }));
    expect(r.issues.some((i) => i.code === 'SIGNALER_DUAL_ROLE')).toBe(true);
  });

  it('viento ≥ 11 m/s: advisory WIND_ELEVATED', () => {
    const r = validateIzajeCritico(baseIzaje({ windSpeedMps: 12 }));
    expect(r.hasAdvisories).toBe(true);
    expect(r.issues.some((i) => i.code === 'WIND_ELEVATED')).toBe(true);
  });

  it('viento ≥ 15 m/s: blocker WIND_TOO_HIGH', () => {
    const r = validateIzajeCritico(baseIzaje({ windSpeedMps: 16 }));
    expect(r.hasBlockers).toBe(true);
    expect(r.issues.some((i) => i.code === 'WIND_TOO_HIGH')).toBe(true);
  });

  it('zona exclusión sin marcar: blocker', () => {
    const r = validateIzajeCritico(baseIzaje({ exclusionZoneMarked: false }));
    expect(r.issues.some((i) => i.code === 'EXCLUSION_ZONE_UNMARKED')).toBe(true);
  });

  it('rigging no inspeccionado: blocker', () => {
    const r = validateIzajeCritico(baseIzaje({ riggingInspected: false }));
    expect(r.issues.some((i) => i.code === 'RIGGING_NOT_INSPECTED')).toBe(true);
  });

  it('capacity inválida: blocker', () => {
    const r = validateIzajeCritico(baseIzaje({ craneCapacityAtRadiusKg: 0 }));
    expect(r.issues.some((i) => i.code === 'CRANE_CAPACITY_INVALID')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Excavación
// ────────────────────────────────────────────────────────────────────────

const baseExc = (over?: Partial<ExcavationMetadata>): ExcavationMetadata => ({
  depthMeters: 1.0,
  slopeAngleDeg: 30,
  shoringInstalled: false,
  soilKind: 'stable',
  buriedServicesMapped: true,
  ...over,
});

describe('validateExcavation', () => {
  it('caso feliz superficial: 0 issues', () => {
    const r = validateExcavation(baseExc());
    expect(r.issues).toHaveLength(0);
  });

  it('depth ≤ 0: blocker', () => {
    const r = validateExcavation(baseExc({ depthMeters: 0 }));
    expect(r.issues.some((i) => i.code === 'DEPTH_INVALID')).toBe(true);
  });

  it('talud >76° en suelo stable sin entibación: blocker UNSAFE_SLOPE', () => {
    const r = validateExcavation(baseExc({ slopeAngleDeg: 85 }));
    expect(r.issues.some((i) => i.code === 'UNSAFE_SLOPE_NO_SHORING')).toBe(true);
  });

  it('talud 85° con entibación en stable: pasa', () => {
    const r = validateExcavation(
      baseExc({ slopeAngleDeg: 85, shoringInstalled: true }),
    );
    expect(r.issues.some((i) => i.code === 'UNSAFE_SLOPE_NO_SHORING')).toBe(false);
  });

  it('suelo saturado + 50° sin entibación: blocker', () => {
    const r = validateExcavation(
      baseExc({ soilKind: 'saturated', slopeAngleDeg: 50 }),
    );
    expect(r.issues.some((i) => i.code === 'UNSAFE_SLOPE_NO_SHORING')).toBe(true);
  });

  it('depth ≥ 1.5 + suelo loose sin entibación: blocker DEPTH_REQUIRES_SHORING', () => {
    const r = validateExcavation(
      baseExc({ depthMeters: 2, soilKind: 'loose', slopeAngleDeg: 50 }),
    );
    expect(r.issues.some((i) => i.code === 'DEPTH_REQUIRES_SHORING')).toBe(true);
  });

  it('servicios enterrados sin mapear: blocker', () => {
    const r = validateExcavation(baseExc({ buriedServicesMapped: false }));
    expect(r.issues.some((i) => i.code === 'BURIED_SERVICES_NOT_MAPPED')).toBe(true);
  });

  it('depth > 1.2 sin medición atmosférica: blocker', () => {
    const r = validateExcavation(baseExc({ depthMeters: 1.5 }));
    expect(r.issues.some((i) => i.code === 'ATMOSPHERE_MEASUREMENT_REQUIRED')).toBe(true);
  });

  it('depth > 1.2 con medición buena: pasa atmósfera', () => {
    const r = validateExcavation(
      baseExc({
        depthMeters: 1.5,
        atmosphereMeasurement: {
          oxygenPct: 20.8,
          lelPct: 0,
          measuredAtIso: '2026-05-14T10:00:00Z',
        },
      }),
    );
    expect(r.issues.find((i) => i.code === 'ATMOSPHERE_MEASUREMENT_REQUIRED')).toBeUndefined();
  });

  it('O2 < 19.5%: blocker OXYGEN_OUT_OF_RANGE', () => {
    const r = validateExcavation(
      baseExc({
        depthMeters: 1.5,
        atmosphereMeasurement: {
          oxygenPct: 18.0,
          lelPct: 0,
          measuredAtIso: '2026-05-14T10:00:00Z',
        },
      }),
    );
    expect(r.issues.some((i) => i.code === 'OXYGEN_OUT_OF_RANGE')).toBe(true);
  });

  it('LEL ≥ 10%: blocker LEL_TOO_HIGH', () => {
    const r = validateExcavation(
      baseExc({
        depthMeters: 1.5,
        atmosphereMeasurement: {
          oxygenPct: 20.8,
          lelPct: 12,
          measuredAtIso: '2026-05-14T10:00:00Z',
        },
      }),
    );
    expect(r.issues.some((i) => i.code === 'LEL_TOO_HIGH')).toBe(true);
  });

  it('LEL 5-10%: advisory LEL_ELEVATED', () => {
    const r = validateExcavation(
      baseExc({
        depthMeters: 1.5,
        atmosphereMeasurement: {
          oxygenPct: 20.8,
          lelPct: 7,
          measuredAtIso: '2026-05-14T10:00:00Z',
        },
      }),
    );
    expect(r.issues.some((i) => i.code === 'LEL_ELEVATED')).toBe(true);
    expect(r.hasBlockers).toBe(false);
  });

  it('lluvia 30mm + suelo saturado: advisory RECENT_RAIN_SATURATED', () => {
    const r = validateExcavation(
      baseExc({
        depthMeters: 1.0,
        soilKind: 'saturated',
        slopeAngleDeg: 30,
        rainfallLast24hMm: 30,
      }),
    );
    expect(r.issues.some((i) => i.code === 'RECENT_RAIN_SATURATED')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// LOTO
// ────────────────────────────────────────────────────────────────────────

const baseLoto = (over?: Partial<LotoMetadata>): LotoMetadata => ({
  identifiedSources: ['electrical', 'mechanical'],
  locks: [
    { ownerUid: 'w-1', source: 'electrical', lockId: 'L-1', placedAtIso: '2026-05-14T10:00:00Z' },
    { ownerUid: 'w-1', source: 'mechanical', lockId: 'L-2', placedAtIso: '2026-05-14T10:00:00Z' },
  ],
  tryoutPerformed: true,
  tryoutByUid: 'w-1',
  ...over,
});

describe('validateLoto', () => {
  it('caso feliz: 0 blockers', () => {
    const r = validateLoto(baseLoto());
    expect(r.hasBlockers).toBe(false);
  });

  it('fuente sin candado: blocker SOURCE_NOT_LOCKED', () => {
    const r = validateLoto(
      baseLoto({
        identifiedSources: ['electrical', 'mechanical', 'hydraulic'],
      }),
    );
    expect(
      r.issues.some(
        (i) =>
          i.code === 'SOURCE_NOT_LOCKED' && i.context?.source === 'hydraulic',
      ),
    ).toBe(true);
  });

  it('lockId duplicado: blocker DUPLICATE_LOCK_ID', () => {
    const r = validateLoto(
      baseLoto({
        locks: [
          { ownerUid: 'w-1', source: 'electrical', lockId: 'L-1', placedAtIso: '2026-05-14T10:00:00Z' },
          { ownerUid: 'w-2', source: 'mechanical', lockId: 'L-1', placedAtIso: '2026-05-14T10:00:00Z' },
        ],
      }),
    );
    expect(r.issues.some((i) => i.code === 'DUPLICATE_LOCK_ID')).toBe(true);
  });

  it('try-out NO realizado: blocker', () => {
    const r = validateLoto(baseLoto({ tryoutPerformed: false }));
    expect(r.issues.some((i) => i.code === 'TRYOUT_NOT_PERFORMED')).toBe(true);
  });

  it('try-out sin UID del verificador: advisory', () => {
    const r = validateLoto(
      baseLoto({ tryoutPerformed: true, tryoutByUid: undefined }),
    );
    expect(r.issues.some((i) => i.code === 'TRYOUT_AUTHOR_MISSING')).toBe(true);
    expect(r.hasBlockers).toBe(false);
  });

  it('try-out por uid sin candado: blocker', () => {
    const r = validateLoto(baseLoto({ tryoutByUid: 'w-99' }));
    expect(r.issues.some((i) => i.code === 'TRYOUT_AUTHOR_NO_LOCK')).toBe(true);
  });

  it('sin fuentes identificadas + sin candados: 0 blockers (no aplica)', () => {
    const r = validateLoto(
      baseLoto({
        identifiedSources: [],
        locks: [],
        tryoutPerformed: true,
        tryoutByUid: undefined,
      }),
    );
    // Sin sources → ningún SOURCE_NOT_LOCKED, ningún NO_LOCKS_PLACED.
    // Sí queda TRYOUT_AUTHOR_MISSING como advisory.
    expect(r.hasBlockers).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────

describe('validateCriticalPermit dispatcher', () => {
  it('routes izaje_critico', () => {
    const r = validateCriticalPermit({
      kind: 'izaje_critico',
      data: baseIzaje(),
    });
    expect(r.kind).toBe('izaje_critico');
  });

  it('routes excavacion', () => {
    const r = validateCriticalPermit({
      kind: 'excavacion',
      data: baseExc(),
    });
    expect(r.kind).toBe('excavacion');
  });

  it('routes loto', () => {
    const r = validateCriticalPermit({
      kind: 'loto',
      data: baseLoto(),
    });
    expect(r.kind).toBe('loto');
  });
});
