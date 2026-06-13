// Phase 5 remediation — tests for the REAL medical-surveillance breakdown that
// replaces the hardcoded 45 / 28 / 15 "Vigilancia Activa" counts in
// Medicine.tsx.
//
// These exercise the real production function in ./medicineMetrics (no SUT
// mock): they take the real RiskNode shape and assert the derived counts come
// from the input MEDICINE records, not constants. Intentionally a `.test.ts`
// (not `Medicine*.tsx`) so it is NOT matched by the ADR-0012 medical guard —
// the assertions are pure administrative tallies and never touch a disclaimer.

import { describe, it, expect } from 'vitest';
import { computeSurveillanceBreakdown, EXAM_TYPE_I18N } from './medicineMetrics';
import { NodeType, type RiskNode } from '../types';

function medicineNode(id: string, examType?: string): RiskNode {
  const now = new Date().toISOString();
  return {
    id,
    type: NodeType.MEDICINE,
    title: `exam-${id}`,
    description: '',
    tags: [],
    connections: [],
    createdAt: now,
    updatedAt: now,
    metadata: examType === undefined ? {} : { examType },
  };
}

describe('computeSurveillanceBreakdown', () => {
  it('returns hasData:false and no rows when there are no records (honest empty state)', () => {
    const b = computeSurveillanceBreakdown([]);
    expect(b.hasData).toBe(false);
    expect(b.rows).toEqual([]);
    expect(b.total).toBe(0);
    // No fabricated fallback counts.
    expect(b.rows.find((r) => r.count === 45 || r.count === 28 || r.count === 15)).toBeUndefined();
  });

  it('derives per-examType counts from the REAL records', () => {
    const b = computeSurveillanceBreakdown([
      medicineNode('1', 'Periódico'),
      medicineNode('2', 'Periódico'),
      medicineNode('3', 'Pre-ocupacional'),
      medicineNode('4', 'Retiro'),
    ]);
    expect(b.hasData).toBe(true);
    expect(b.total).toBe(4);

    const periodico = b.rows.find((r) => r.examType === 'Periódico');
    const pre = b.rows.find((r) => r.examType === 'Pre-ocupacional');
    const retiro = b.rows.find((r) => r.examType === 'Retiro');
    expect(periodico?.count).toBe(2);
    expect(pre?.count).toBe(1);
    expect(retiro?.count).toBe(1);
    // max reflects the largest real bucket, used to scale the bars.
    expect(b.max).toBe(2);
  });

  it('emits rows in canonical EXAM_TYPE_ORDER and only for non-empty buckets', () => {
    const b = computeSurveillanceBreakdown([
      medicineNode('1', 'Retiro'),
      medicineNode('2', 'Pre-ocupacional'),
    ]);
    // Pre-ocupacional precedes Retiro in EXAM_TYPE_ORDER regardless of input order.
    expect(b.rows.map((r) => r.examType)).toEqual(['Pre-ocupacional', 'Retiro']);
    // Each known row carries the reusable i18n label key.
    expect(b.rows[0].i18nKey).toBe(EXAM_TYPE_I18N['Pre-ocupacional']);
  });

  it('buckets unknown / missing exam types under `other` (null i18n key)', () => {
    const b = computeSurveillanceBreakdown([
      medicineNode('1', 'Tipo Inventado'),
      medicineNode('2'), // missing examType
      medicineNode('3', 'Periódico'),
    ]);
    const other = b.rows.find((r) => r.examType === 'other');
    expect(other?.count).toBe(2);
    expect(other?.i18nKey).toBeNull();
    // `other` is always emitted last, after the known canonical types.
    expect(b.rows[b.rows.length - 1].examType).toBe('other');
  });
});
