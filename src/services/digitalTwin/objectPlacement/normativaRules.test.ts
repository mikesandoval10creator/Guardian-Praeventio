// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  ruleExtinguisherCoverage,
  ruleExtinguisherDensity,
  ruleEvacuationSignage,
  ruleCriticalObjectsSpacing,
  runComplianceCheck,
  DS594_EXTINGUISHER_MAX_DISTANCE_M,
  DS594_EXTINGUISHER_AREA_PER_UNIT_M2,
} from './normativaRules';
import type { PlacedObject, PlacedObjectKind } from '../photogrammetry/types';

const obj = (
  id: string,
  kind: PlacedObjectKind,
  x: number,
  y: number,
  z: number,
  lifecycle: PlacedObject['lifecycle'] = 'planning',
): PlacedObject => ({
  id,
  kind,
  position: { x, y, z },
  lifecycle,
  createdAt: 0,
  updatedAt: 0,
});

const ws = (id: string, x: number, y: number, z: number) => ({
  id,
  position: { x, y, z },
});

describe('DS 594 art. 47 — extinguisher coverage', () => {
  it('passes when every workstation has an extinguisher within 25m', () => {
    const violations = ruleExtinguisherCoverage({
      placedObjects: [obj('e1', 'extinguisher_pqs', 10, 0, 0)],
      workstations: [ws('ws1', 0, 0, 0), ws('ws2', 20, 0, 0)],
    });
    expect(violations).toHaveLength(0);
  });

  it('flags workstations beyond 25m', () => {
    const violations = ruleExtinguisherCoverage({
      placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)],
      workstations: [ws('isolated', 30, 0, 0)],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('ds594-art47-extinguisher-coverage');
    expect(violations[0].severity).toBe('error');
    expect(violations[0].citation).toBe('DS 594 art. 47');
    expect(violations[0].objectIds).toEqual(['isolated']);
  });

  it('uses 3D distance (not just horizontal)', () => {
    // Workstation 24m horizontal but 10m vertical = 26m euclidean → out of range.
    const violations = ruleExtinguisherCoverage({
      placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)],
      workstations: [ws('upper', 24, 10, 0)],
    });
    expect(violations).toHaveLength(1);
  });

  it('exact 25m boundary: at boundary passes (not strictly greater)', () => {
    const violations = ruleExtinguisherCoverage({
      placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)],
      workstations: [ws('boundary', DS594_EXTINGUISHER_MAX_DISTANCE_M, 0, 0)],
    });
    expect(violations).toHaveLength(0);
  });

  it('retired extinguishers are NOT counted', () => {
    const violations = ruleExtinguisherCoverage({
      placedObjects: [obj('retired', 'extinguisher_pqs', 0, 0, 0, 'retired')],
      workstations: [ws('ws1', 5, 0, 0)],
    });
    expect(violations).toHaveLength(1); // workstation has no covering extinguisher
  });

  it('multiple workstations get individual violations', () => {
    const violations = ruleExtinguisherCoverage({
      placedObjects: [obj('e1', 'extinguisher_pqs', 100, 0, 0)],
      workstations: [ws('a', 0, 0, 0), ws('b', 50, 0, 0)],
    });
    expect(violations).toHaveLength(2);
  });

  it('no workstations → no violations (vacuously)', () => {
    const violations = ruleExtinguisherCoverage({
      placedObjects: [],
      workstations: [],
    });
    expect(violations).toHaveLength(0);
  });
});

describe('DS 594 art. 48 — extinguisher density', () => {
  it('passes when there are enough extinguishers per area', () => {
    const violations = ruleExtinguisherDensity(
      {
        placedObjects: [
          obj('e1', 'extinguisher_pqs', 0, 0, 0),
          obj('e2', 'extinguisher_pqs', 50, 0, 0),
        ],
      },
      DS594_EXTINGUISHER_AREA_PER_UNIT_M2 * 2, // exactly need 2
    );
    expect(violations).toHaveLength(0);
  });

  it('flags shortage with required count in message', () => {
    const violations = ruleExtinguisherDensity(
      { placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)] },
      450, // ceil(450/150) = 3 required, have 1 → shortage 2
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('3');
    expect(violations[0].suggestion).toContain('2');
  });

  it('skips check when facilityAreaM2 ≤ 0', () => {
    const violations = ruleExtinguisherDensity({ placedObjects: [] }, 0);
    expect(violations).toHaveLength(0);
  });

  it('handles fractional areas via ceil', () => {
    // 151 m² → ceil(151/150) = 2 required.
    const violations = ruleExtinguisherDensity(
      { placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)] },
      151,
    );
    expect(violations).toHaveLength(1);
  });
});

describe('NCh 1410 — evacuation signage', () => {
  it('passes when each exit has a sign within 10m', () => {
    const violations = ruleEvacuationSignage({
      placedObjects: [obj('s1', 'sign_evacuation', 5, 0, 0)],
      emergencyExits: [{ id: 'exit1', position: { x: 0, y: 0, z: 0 } }],
    });
    expect(violations).toHaveLength(0);
  });

  it('flags exit without signage within 10m as warning (not error)', () => {
    const violations = ruleEvacuationSignage({
      placedObjects: [],
      emergencyExits: [{ id: 'exit1', position: { x: 0, y: 0, z: 0 } }],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('warning');
    expect(violations[0].citation).toBe('NCh 1410 — Señalización de seguridad');
  });

  it('signs of other kinds (warning/mandatory) do NOT count for evacuation coverage', () => {
    const violations = ruleEvacuationSignage({
      placedObjects: [obj('w1', 'sign_warning', 5, 0, 0)],
      emergencyExits: [{ id: 'exit1', position: { x: 0, y: 0, z: 0 } }],
    });
    expect(violations).toHaveLength(1);
  });
});

describe('Critical objects spacing', () => {
  it('passes when critical objects are >= 1m apart', () => {
    const violations = ruleCriticalObjectsSpacing({
      placedObjects: [
        obj('e1', 'extinguisher_pqs', 0, 0, 0),
        obj('e2', 'extinguisher_co2', 1.5, 0, 0),
      ],
    });
    expect(violations).toHaveLength(0);
  });

  it('flags pairs within 1m as warning', () => {
    const violations = ruleCriticalObjectsSpacing({
      placedObjects: [
        obj('e1', 'extinguisher_pqs', 0, 0, 0),
        obj('e2', 'extinguisher_co2', 0.5, 0, 0),
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('warning');
    expect(violations[0].objectIds).toEqual(['e1', 'e2']);
  });

  it('does not pair non-critical objects', () => {
    const violations = ruleCriticalObjectsSpacing({
      placedObjects: [
        obj('s1', 'sign_warning', 0, 0, 0),
        obj('s2', 'sign_mandatory', 0.5, 0, 0),
      ],
    });
    expect(violations).toHaveLength(0);
  });

  it('symmetric pairs are reported once', () => {
    const violations = ruleCriticalObjectsSpacing({
      placedObjects: [
        obj('h1', 'hydrant', 0, 0, 0),
        obj('h2', 'hydrant', 0.5, 0, 0),
      ],
    });
    expect(violations).toHaveLength(1);
  });

  it('multiple pairs all reported', () => {
    const violations = ruleCriticalObjectsSpacing({
      placedObjects: [
        obj('a', 'extinguisher_pqs', 0, 0, 0),
        obj('b', 'extinguisher_co2', 0.5, 0, 0),
        obj('c', 'aed', 0.7, 0, 0),
      ],
    });
    // pairs: (a,b), (a,c), (b,c) — all within 1m
    expect(violations).toHaveLength(3);
  });
});

describe('runComplianceCheck — full report', () => {
  it('compliant=true when zero errors', () => {
    const report = runComplianceCheck({
      placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)],
      workstations: [ws('ws1', 5, 0, 0)],
      emergencyExits: [],
    });
    expect(report.compliant).toBe(true);
    expect(report.summary.error).toBe(0);
  });

  it('compliant=false when at least one error present', () => {
    const report = runComplianceCheck({
      placedObjects: [],
      workstations: [ws('ws1', 0, 0, 0)],
    });
    expect(report.compliant).toBe(false);
    expect(report.summary.error).toBeGreaterThan(0);
  });

  it('aggregates summary counts across rules', () => {
    const report = runComplianceCheck(
      {
        placedObjects: [
          obj('e1', 'extinguisher_pqs', 0, 0, 0),
          obj('e2', 'extinguisher_co2', 0.3, 0, 0), // close to e1 → spacing warning
        ],
        workstations: [ws('isolated', 100, 0, 0)], // no extinguisher within 25m → error
        emergencyExits: [{ id: 'ex1', position: { x: 200, y: 0, z: 0 } }], // no sign → warning
      },
    );
    expect(report.summary.error).toBeGreaterThanOrEqual(1);
    expect(report.summary.warning).toBeGreaterThanOrEqual(2);
  });

  it('density rule activates only with facilityAreaM2 option', () => {
    const without = runComplianceCheck({
      placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)],
      workstations: [ws('ws', 5, 0, 0)],
    });
    const with500m2 = runComplianceCheck(
      {
        placedObjects: [obj('e1', 'extinguisher_pqs', 0, 0, 0)],
        workstations: [ws('ws', 5, 0, 0)],
      },
      { facilityAreaM2: 500 },
    );
    expect(with500m2.summary.error).toBeGreaterThan(without.summary.error);
  });
});
