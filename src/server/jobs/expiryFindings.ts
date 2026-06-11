// SPDX-License-Identifier: MIT
//
// Phase 5 arista A3 (2026-06) — shared helpers for the expiry → finding
// pipeline ("el sistema se inspecciona solo").
//
// Expiry reapers (checkExpiredPpe, checkExpiredBrigadeResources) detect a
// lapsed safety item, but a push notification alone leaves the corrective
// cycle open: someone has to remember it. These helpers close the loop by
// materialising a corrective-action finding in the canonical
// `projects/{pid}/findings` collection (same shape the client writes from
// BioAnalysis.tsx — title / description / type / status / priority /
// projectId / reportedBy / createdAt).
//
// Idempotency contract: finding ids are DETERMINISTIC per source item
// (`epp-expiry_{assignmentId}`, `brigade-expiry_{resourceId}`) and creation
// is get-then-set. Re-runs and crash-replays neither duplicate the finding
// nor clobber one a prevencionista already closed.

import type { Firestore } from 'firebase-admin/firestore';

/** Finding priority vocabulary used across the app (see Matrix.tsx). */
export type FindingPriority = 'Crítica' | 'Alta' | 'Media' | 'Baja';

/**
 * Map a free-form criticality value (Spanish or English) onto the finding
 * priority vocabulary. Unknown / missing values default to the provided
 * fallback — expiry of a safety item is never less than 'Alta' by default.
 */
export function priorityFromCriticality(
  criticality: unknown,
  fallback: FindingPriority = 'Alta',
): FindingPriority {
  if (typeof criticality !== 'string') return fallback;
  switch (criticality.trim().toLowerCase()) {
    case 'crítica':
    case 'critica':
    case 'critical':
      return 'Crítica';
    case 'alta':
    case 'high':
      return 'Alta';
    case 'media':
    case 'medium':
      return 'Media';
    case 'baja':
    case 'low':
      return 'Baja';
    default:
      return fallback;
  }
}

/**
 * Format an ISO-8601 date as Chilean DD-MM-YYYY for user-facing copy.
 * Falls back to the raw input when it does not look like an ISO date.
 */
export function formatDateCl(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export interface ExpiryFindingPayload {
  title: string;
  description: string;
  priority: FindingPriority;
  /** Origin marker, e.g. 'epp_expiry' | 'brigade_resource_expiry'. */
  source: string;
  /** Extra traceability fields merged into the finding doc. */
  extra?: Record<string, unknown>;
}

/**
 * Idempotently create a system-reported finding at
 * `projects/{projectId}/findings/{findingId}`.
 *
 * Returns `true` when the finding was created on this call, `false` when a
 * doc with that deterministic id already existed (replay) — in which case
 * the existing doc is left untouched so a finding the team already worked
 * (or closed) is never reset to 'Abierto'.
 *
 * `createdAt` is written as a JS Date (Admin SDK stores it as a Firestore
 * Timestamp) so range queries like wisdomCapsule's `where('createdAt','>=',…)`
 * keep matching system-created findings.
 */
export async function ensureExpiryFinding(
  db: Firestore,
  projectId: string,
  findingId: string,
  now: Date,
  payload: ExpiryFindingPayload,
): Promise<boolean> {
  const ref = db
    .collection('projects')
    .doc(projectId)
    .collection('findings')
    .doc(findingId);
  const snap = await ref.get();
  if (snap.exists) return false;
  await ref.set({
    title: payload.title,
    description: payload.description,
    type: 'Condición Subestándar',
    status: 'Abierto',
    priority: payload.priority,
    projectId,
    reportedBy: 'sistema',
    createdAt: now,
    source: payload.source,
    ...(payload.extra ?? {}),
  });
  return true;
}
