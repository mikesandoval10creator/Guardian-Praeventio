// SPDX-License-Identifier: MIT
// Praeventio Guard — Phase 5 remediation: real medical-surveillance metrics.
//
// Replaces the hardcoded "Vigilancia Activa" panel in src/pages/Medicine.tsx
// (the fabricated 45 / 28 / 15 "Cardiovascular / Ergonómico / Psicosocial"
// counts) with a REAL, derived breakdown of the project's MEDICINE graph
// records by their actual `examType`. Mirrors the hygieneMetrics.ts pattern
// (#787): a PURE function over already-fetched nodes, no Firestore reads, no
// Gemini, no side effects, no diagnosis (ADR 0012 — these are administrative
// exam-type tallies, never a clinical inference).
//
// The page passes the already-filtered, project-scoped MEDICINE nodes in. When
// there are no records the function returns an honest empty marker
// (hasData:false / empty rows) so the UI renders "Sin datos aún" instead of a
// synthesized number. The fabricated per-worker "programa" taxonomy never had a
// source in the data model — the AddMedicineModal only ever captured `examType`
// (Pre-ocupacional / Periódico / Retiro / Post-incapacidad / Vigilancia
// Epidemiológica), so that is the real axis we tally here.

import type { RiskNode } from '../types';

/**
 * Canonical exam-type identifiers persisted in MEDICINE node metadata by
 * AddMedicineModal. These are the Spanish canonical values (NOT user-facing
 * labels — the view localises each via `medicine.exam_*` keys). Kept in a
 * stable display order; any record whose `examType` is missing or outside this
 * set is bucketed under `other`.
 */
export const EXAM_TYPE_ORDER = [
  'Pre-ocupacional',
  'Periódico',
  'Retiro',
  'Post-incapacidad',
  'Vigilancia Epidemiológica',
] as const;

export type ExamType = (typeof EXAM_TYPE_ORDER)[number];

/** i18n key for each canonical exam type (reused from AddMedicineModal). */
export const EXAM_TYPE_I18N: Record<ExamType, string> = {
  'Pre-ocupacional': 'medicine.exam_pre_occupational',
  'Periódico': 'medicine.exam_periodic',
  'Retiro': 'medicine.exam_retirement',
  'Post-incapacidad': 'medicine.exam_post_disability',
  'Vigilancia Epidemiológica': 'medicine.exam_epidemiological',
};

export interface SurveillanceRow {
  /** Canonical exam-type identifier (one of EXAM_TYPE_ORDER, or 'other'). */
  examType: ExamType | 'other';
  /** i18n key for the localised label; `null` for the `other` bucket. */
  i18nKey: string | null;
  /** Number of real MEDICINE records of this exam type. */
  count: number;
}

export interface SurveillanceBreakdown {
  /** One row per exam type that has ≥1 real record, in EXAM_TYPE_ORDER. */
  rows: SurveillanceRow[];
  /** Largest single-row count, used to scale the bar widths (≥1). */
  max: number;
  /** Total records counted across all rows. */
  total: number;
  /** True when at least one real MEDICINE record contributed. */
  hasData: boolean;
}

/**
 * Build the active-surveillance breakdown from REAL MEDICINE records.
 *
 * Counts each node by its `metadata.examType`, grouping unknown/empty types
 * under an `other` bucket. Rows are emitted in EXAM_TYPE_ORDER (then `other`),
 * and only for buckets with ≥1 record so the panel never shows an empty bar.
 *
 * When `medicalNodes` is empty (or no node has a recognisable exam type),
 * `hasData` is false and `rows` is empty → the UI shows an honest "Sin datos
 * aún" state instead of fabricated counts.
 *
 * This is administrative tallying only — it never infers a diagnosis,
 * classifies a worker, or derives a clinical risk (ADR 0012).
 */
export function computeSurveillanceBreakdown(
  medicalNodes: RiskNode[],
): SurveillanceBreakdown {
  const counts = new Map<ExamType | 'other', number>();
  let total = 0;

  for (const node of medicalNodes) {
    const raw = node.metadata?.examType;
    const examType: ExamType | 'other' =
      typeof raw === 'string' && (EXAM_TYPE_ORDER as readonly string[]).includes(raw)
        ? (raw as ExamType)
        : 'other';
    counts.set(examType, (counts.get(examType) ?? 0) + 1);
    total += 1;
  }

  const rows: SurveillanceRow[] = [];
  for (const examType of EXAM_TYPE_ORDER) {
    const count = counts.get(examType) ?? 0;
    if (count > 0) {
      rows.push({ examType, i18nKey: EXAM_TYPE_I18N[examType], count });
    }
  }
  const otherCount = counts.get('other') ?? 0;
  if (otherCount > 0) {
    rows.push({ examType: 'other', i18nKey: null, count: otherCount });
  }

  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return {
    rows,
    max: Math.max(1, max),
    total,
    hasData: rows.length > 0,
  };
}
