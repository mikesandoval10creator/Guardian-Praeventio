/**
 * Client-side dispatcher for the DS-594 art. 110 legal trigger.
 *
 * WHY this is a thin HTTP call and NOT a direct service invocation:
 * the legal trigger must allocate a DIEP folio from the counter at
 * `tenants/{tid}/suseso_counters/{year}-DIEP`, which `firestore.rules`
 * denies to ALL clients (server-only, `allow read, write: if false`).
 * A browser-built folioStore would therefore be rejected in production.
 * So the ergonomics wizard persists the technical assessment with the
 * client SDK and then FIRE-AND-FORGET POSTs here; the server route
 * (`src/server/routes/ergonomics.ts` → POST /:projectId/ergonomics/
 * legal-trigger) builds the Admin-SDK folioStore and runs
 * `triggerLegalConsequencesIfNeeded`.
 *
 * Contract:
 *   - NEVER throws and NEVER blocks the caller — the technical assessment
 *     is the record-of-truth; the legal consequence is a side-effect.
 *   - Identity + tenant are resolved server-side from the verified token;
 *     we deliberately do NOT send them in the body (CLAUDE.md #3).
 */
import { apiAuthHeader } from '../../lib/apiAuth';
import { logger } from '../../utils/logger';

export interface LegalTriggerDispatch {
  projectId: string;
  assessmentId: string;
  workerId: string;
  type: 'REBA' | 'RULA';
  score: number;
  computedAt: string;
}

export async function dispatchLegalTrigger(payload: LegalTriggerDispatch): Promise<void> {
  try {
    const authHeader = await apiAuthHeader();
    if (!authHeader) return; // no auth → skip; the assessment save already succeeded
    const res = await fetch(
      `/api/sprint-k/${encodeURIComponent(payload.projectId)}/ergonomics/legal-trigger`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          assessmentId: payload.assessmentId,
          workerId: payload.workerId,
          type: payload.type,
          score: payload.score,
          computedAt: payload.computedAt,
        }),
      },
    );
    if (!res.ok) {
      logger.warn('ergonomic_legal_trigger_failed', { status: res.status });
    }
  } catch (err) {
    logger.warn('ergonomic_legal_trigger_error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
