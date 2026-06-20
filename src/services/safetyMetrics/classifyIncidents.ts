// Praeventio Guard — Bucket D: classify REGISTERED incident docs into the
// OSHA/ICMM `IncidentCounts` shape consumed by `buildSafetyMetricsReport`.
//
// This is the HONEST bridge between the project's real `incidents` collection
// and the TRIR/LTIFR engine. It does NOT invent data: when an incident doc
// lacks a field, the corresponding counter does not increment — never a
// fabricated default.
//
// Incident doc shape (see src/server/routes/incidents.ts +
// services/incidents/incidentRagService.ts):
//   - incidentType: 'near_miss' | 'incident' | 'post_mortem'
//   - severity:     'low' | 'med' | 'high' | 'critical'
//   - lostDays?:    number (subsidio por AT/EP — same field DS 67 reads)
//   - restricted?:  boolean (días con actividad restringida / transferida)
//   - fatal?:       boolean (explicit fatality flag — NOT inferred from severity)
//
// Classification rules (OSHA 1904.7 + ICMM SIF), conservative + auditable:
//   • near_miss            → NOT recordable (no injury), contributes nothing.
//   • incident|post_mortem → RECORDABLE.
//   • lostTime             → recordable AND numeric lostDays > 0.
//   • restrictedOrTransferred → recordable AND explicit `restricted === true`.
//   • SIF                  → recordable AND (severity === 'critical' OR fatal).
//   • fatalities           → ONLY explicit `fatal === true` (never inferred).
//   • totalLostDays        → sum of numeric lostDays across recordable docs.
//
// Pure function — deterministic, no Firestore reads, no side effects.

import type { IncidentCounts } from './osha.js';

/** The minimal subset of a registered incident doc we read. Unknown-safe. */
export interface RawIncidentDoc {
  incidentType?: unknown;
  severity?: unknown;
  lostDays?: unknown;
  restricted?: unknown;
  fatal?: unknown;
}

const RECORDABLE_TYPES = new Set(['incident', 'post_mortem']);

function numericLostDays(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  return 0;
}

/**
 * Fold an array of registered incident docs into `IncidentCounts`.
 *
 * Honest by construction: a near-miss never counts as recordable, a missing
 * `lostDays` never becomes a guessed value, and fatalities require an explicit
 * `fatal` flag (we do NOT promote a `severity: 'critical'` doc to a death).
 */
export function classifyIncidents(docs: ReadonlyArray<RawIncidentDoc>): IncidentCounts {
  const counts: IncidentCounts = {
    totalRecordable: 0,
    lostTime: 0,
    restrictedOrTransferred: 0,
    seriousInjuriesAndFatalities: 0,
    fatalities: 0,
    totalLostDays: 0,
  };

  for (const doc of docs) {
    const type = typeof doc.incidentType === 'string' ? doc.incidentType : '';
    if (!RECORDABLE_TYPES.has(type)) continue; // near_miss / unknown → skip

    counts.totalRecordable += 1;

    const lost = numericLostDays(doc.lostDays);
    if (lost > 0) {
      counts.lostTime += 1;
      counts.totalLostDays += lost;
    }

    if (doc.restricted === true) {
      counts.restrictedOrTransferred += 1;
    }

    const isFatal = doc.fatal === true;
    if (isFatal) counts.fatalities += 1;

    if (isFatal || doc.severity === 'critical') {
      counts.seriousInjuriesAndFatalities += 1;
    }
  }

  return counts;
}
