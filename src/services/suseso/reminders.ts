// Praeventio Guard — Sprint 28 follow-up.
//
// SUSESO DIAT/DIEP legal-deadline reminder system.
//
// SCOPE CLARIFICATION (Sprint 28 follow-up, user 2026-05-05):
//   Praeventio does NOT submit forms to SUSESO/the mutualidad. The
//   EMPLOYER (la empresa) is the entity legally bound to submit per
//   Ley 16.744 art. 76 + DS 101. Praeventio's role is:
//
//     1. Generate a folio-stamped, signed PDF (Bucket B6 — folioGenerator
//        + susesoCertificate + susesoService).
//     2. Compute the legal deadline.
//     3. REMIND the employer (gerente / admin / supervisor of the project,
//        plus the DIAT-affected worker) that the legal clock is ticking.
//     4. Track when the empresa marks the form as "submitted to mutualidad"
//        so reminders stop.
//
//   Legal plazos:
//     • DIAT  — DS 101 art. 71 → 5 días corridos desde el accidente.
//     • DIEP  — DS 109 → 5 días corridos desde la detección de la
//       enfermedad profesional (incidentDate is the detection date for
//       DIEP forms).
//
// This file holds ONLY pure helpers + the discriminated reminder record
// type. The cron job (sendSusesoReminders) lives in src/server/jobs/
// because it touches Firestore + FCM, not pure logic.

// TODO Sprint 28 B6 post-merge: replace these re-exports with imports
// from `./types` once the bucket B6 main branch lands. Until then we
// keep the surface decoupled so this module compiles standalone.
export type SusesoFormKindLocal = 'DIAT' | 'DIEP';

/**
 * Lifecycle of an empresa's submission obligation:
 *
 * - `pending` — clock is ticking, reminders fire.
 * - `submitted_by_company` — gerente/admin pressed "Marcar como enviado"
 *   (the empresa uploaded to the mutualidad portal). Reminders stop.
 * - `overdue` — legalDeadline elapsed without a submitted_by_company
 *   transition. Reminders escalate.
 *
 * `overdue` is computed by the scheduler — we don't persist it eagerly;
 * the `daysUntilDeadline < 0` predicate is the source of truth. This
 * field exists for UI badges that read the doc directly.
 */
export type SusesoDeadlineStatus = 'pending' | 'submitted_by_company' | 'overdue';

export interface SusesoReminderEntry {
  /** ISO-8601 timestamp of when this reminder was dispatched. */
  sentAt: string;
  channel: 'push' | 'email';
  /** Firebase Auth uid of the recipient. */
  recipientUid: string;
}

/**
 * The deadline-tracking projection of a SusesoForm. Stored as a sub-set
 * of the SusesoForm document fields so the cron scan only loads what
 * it needs (legalDeadline + status + remindersSent).
 */
export interface SusesoDeadline {
  formId: string;
  formKind: SusesoFormKindLocal;
  /** ISO-8601 incident date (accident or disease detection). */
  incidentDate: string;
  /** ISO-8601 incidentDate + 5 días corridos. */
  legalDeadline: string;
  status: SusesoDeadlineStatus;
  /** ISO-8601 timestamp set when the empresa pressed "Marcar enviado". */
  submittedByCompanyAt?: string;
  /** Audit trail of every reminder dispatched for this form. */
  remindersSent: SusesoReminderEntry[];
}

/**
 * Visual escalation level driving the badge color in
 * `SusesoDeadlineBadge`. The 5 levels mirror the 4-mode token palette:
 *
 *   green    → ≥ 5 days remaining
 *   yellow   → 3–4 days remaining
 *   orange   → 1–2 days remaining
 *   red      → exactly 0 days (vence HOY)
 *   overdue  → daysLeft < 0 (already past)
 */
export type EscalationLevel = 'green' | 'yellow' | 'orange' | 'red' | 'overdue';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Compute the legal deadline for a DIAT or DIEP form.
 *
 * Both DS 101 (DIAT) and DS 109 (DIEP) prescribe 5 días corridos from
 * the incident / detection date. We treat `incidentDate` as the start of
 * the window and add exactly 5 * 24 * 60 * 60 * 1000 ms — "días corridos"
 * means consecutive calendar days including weekends, so a millisecond
 * offset is the legally correct discretization.
 *
 * Returns an ISO-8601 string. Throws on invalid input dates so the
 * caller cannot silently store a NaN deadline.
 */
export function computeLegalDeadline(
  formKind: SusesoFormKindLocal,
  incidentDate: string,
): string {
  const t = Date.parse(incidentDate);
  if (Number.isNaN(t)) {
    throw new Error(`computeLegalDeadline: invalid incidentDate "${incidentDate}"`);
  }
  // Both kinds use 5 días corridos. Branch retained for future-proofing
  // (e.g. if a DS 109 amendment changes the DIEP plazo independently).
  void formKind;
  return new Date(t + FIVE_DAYS_MS).toISOString();
}

/**
 * Days remaining until the legal deadline. Returns a signed integer:
 *
 *   • Positive   → still in plazo legal (e.g. 3 = vence en 3 días).
 *   • Zero       → vence HOY.
 *   • Negative   → ya venció (e.g. -2 = venció hace 2 días).
 *
 * Computed against UTC midnight boundaries via floor(diffMs / 86400e3).
 * We use `Math.floor` (not round) so a deadline 23h 59m away still reads
 * as "0 días" — vence HOY, not "vence mañana". This matches how a SUSESO
 * inspector would count the days off a wall calendar.
 */
export function daysUntilDeadline(deadline: string, now = Date.now()): number {
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) {
    throw new Error(`daysUntilDeadline: invalid deadline "${deadline}"`);
  }
  const diffMs = t - now;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Map signed days-left to an EscalationLevel.
 *
 *   daysLeft >= 5 → green
 *   daysLeft 3..4 → yellow
 *   daysLeft 1..2 → orange
 *   daysLeft === 0 → red (vence HOY)
 *   daysLeft  < 0  → overdue
 */
export function escalationLevel(daysLeft: number): EscalationLevel {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'red';
  if (daysLeft <= 2) return 'orange';
  if (daysLeft <= 4) return 'yellow';
  return 'green';
}

/**
 * Idempotency key for a per-day reminder.
 *
 * Format: `${formId}:${recipientUid}:${YYYY-MM-DD}` — collisions are the
 * point. The cron job hashes today's UTC date so a recipient receives at
 * most one reminder per calendar day per form regardless of how often
 * the scheduler fires (Cloud Scheduler may fire ~1/h).
 */
export function reminderIdempotencyKey(
  formId: string,
  recipientUid: string,
  now = new Date(),
): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${formId}:${recipientUid}:${yyyy}-${mm}-${dd}`;
}
