// Phase 5 remediation — tests for the REAL hygiene metric derivations that
// replace the hardcoded chart + fabricated 92%/78% gauges in Hygiene.tsx.
//
// These exercise the real production functions in ./hygieneMetrics (no SUT
// mock): they take the real RiskNode / CalendarEntry shapes and assert the
// derived numbers come from the input data, not constants.

import { describe, it, expect } from 'vitest';
import {
  computeMonthlyHygieneTrend,
  computeMedicalExamCompliance,
  TREND_MONTHS,
} from './hygieneMetrics';
import { NodeType, type RiskNode } from '../types';
import type { CalendarEntry } from '../services/legalCalendar/legalObligationsCalendar';

function hygieneNode(
  id: string,
  value: number,
  limit: number,
  createdAt: string,
): RiskNode {
  return {
    id,
    type: NodeType.HYGIENE,
    title: `n-${id}`,
    description: '',
    tags: [],
    connections: [],
    createdAt,
    updatedAt: createdAt,
    metadata: { value, limit, parameter: 'Ruido Ambiental', unit: 'dB' },
  };
}

function obligationEntry(
  id: string,
  kind: CalendarEntry['kind'],
  isOverdue: boolean,
): CalendarEntry {
  return {
    id,
    kind,
    label: `obl-${id}`,
    legalCitation: 'DS 109',
    recurrence: 'annual',
    alertLeadDays: 30,
    nextDueAt: new Date().toISOString(),
    daysUntilDue: isOverdue ? -5 : 40,
    isInAlertWindow: false,
    isOverdue,
  };
}

describe('computeMonthlyHygieneTrend', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('returns hasData:false and all-zero bars when there are no nodes', () => {
    const t = computeMonthlyHygieneTrend([], now);
    expect(t.hasData).toBe(false);
    expect(t.bars).toHaveLength(TREND_MONTHS);
    expect(t.bars.every((b) => b === 0)).toBe(true);
    expect(t.labels).toHaveLength(TREND_MONTHS);
  });

  it('places a measurement in the correct month bucket as % of limit', () => {
    // 60 dB against an 85 dB limit ≈ 70.6% → rounds to 71. June is the last
    // (12th) bucket when now is June.
    const t = computeMonthlyHygieneTrend(
      [hygieneNode('a', 60, 85, '2026-06-10T00:00:00Z')],
      now,
    );
    expect(t.hasData).toBe(true);
    expect(t.bars[TREND_MONTHS - 1]).toBe(71);
    // Earlier months untouched.
    expect(t.bars[0]).toBe(0);
  });

  it('averages multiple measurements in the same month', () => {
    // 85/85=100% and 51/85≈60% in the same month → mean 80%.
    const t = computeMonthlyHygieneTrend(
      [
        hygieneNode('a', 85, 85, '2026-06-02T00:00:00Z'),
        hygieneNode('b', 51, 85, '2026-06-20T00:00:00Z'),
      ],
      now,
    );
    expect(t.bars[TREND_MONTHS - 1]).toBe(80);
  });

  it('clamps over-limit exposure to 100 and ignores invalid/old rows', () => {
    const t = computeMonthlyHygieneTrend(
      [
        hygieneNode('over', 200, 85, '2026-06-05T00:00:00Z'), // >100 → 100
        hygieneNode('zerolimit', 50, 0, '2026-06-06T00:00:00Z'), // limit 0 → skip
        hygieneNode('old', 50, 85, '2024-01-01T00:00:00Z'), // outside window → skip
      ],
      now,
    );
    expect(t.bars[TREND_MONTHS - 1]).toBe(100);
    expect(t.hasData).toBe(true);
  });
});

describe('computeMedicalExamCompliance', () => {
  it('returns null when there are no medical-exam obligations (honest no-data)', () => {
    expect(computeMedicalExamCompliance([])).toBeNull();
    expect(
      computeMedicalExamCompliance([obligationEntry('x', 'audit', true)]),
    ).toBeNull();
  });

  it('computes % of non-overdue medical-exam obligations', () => {
    const entries = [
      obligationEntry('1', 'medical_exam', false),
      obligationEntry('2', 'medical_exam', false),
      obligationEntry('3', 'medical_exam', false),
      obligationEntry('4', 'medical_exam', true), // overdue
    ];
    // 3 of 4 compliant → 75.
    expect(computeMedicalExamCompliance(entries)).toBe(75);
  });

  it('ignores non-medical kinds when computing the ratio', () => {
    const entries = [
      obligationEntry('1', 'medical_exam', false),
      obligationEntry('2', 'audit', true),
      obligationEntry('3', 'drill', true),
    ];
    // Only the single medical_exam counts, and it is compliant → 100.
    expect(computeMedicalExamCompliance(entries)).toBe(100);
  });
});
