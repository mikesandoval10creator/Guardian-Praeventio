/**
 * Firestore writer for REBA / RULA ergonomic assessments.
 *
 * Compliance note (Ley 16.744 + ISO 45001 §7.5.3 — Control of documented
 * information): once an assessment is signed by the responsable técnico
 * (`metadata.signedAt` becomes a timestamp), the document MUST be append-only.
 * The Firestore security rules enforce this hard contract; this client-side
 * service additionally validates pre-conditions and refuses to overwrite a
 * signed doc, so a signing race or stale optimistic UI never silently mutates
 * legally-binding history.
 *
 * The doc shape is:
 *   {
 *     workerId,           // assessed worker
 *     projectId,          // scope for security rules + audit trail
 *     type,               // 'REBA' | 'RULA'
 *     inputs,             // raw factor inputs (opaque blob — engines own validation)
 *     score,              // numeric final score from calculateReba/calculateRula
 *     actionLevel,        // categorical action level (string for REBA, 1-4 for RULA)
 *     computedAt,         // ISO timestamp
 *     metadata: {
 *       author,           // uid of the prevencionista who ran the assessment
 *       signedAt,         // null until signed; ISO timestamp once signed
 *       signedBy,         // uid of the signer (gerente / supervisor)
 *     }
 *   }
 *
 * The audit-log entry is emitted server-side via `logAuditAction` with the
 * action key `safety.<type>.completed` (or `safety.<type>.signed` on signing).
 */
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logAuditAction } from '../auditService';

export type ErgonomicAssessmentType = 'REBA' | 'RULA';

export interface ErgonomicAssessmentPayload {
  workerId: string;
  projectId: string;
  type: ErgonomicAssessmentType;
  /** Raw factor inputs (whatever the engine accepts). */
  inputs: unknown;
  /** Numeric final score returned by the deterministic engine. */
  score: number;
  /**
   * Categorical action level. REBA returns a string ('low' | 'medium' …),
   * RULA returns 1..4. Persist whatever the engine emits — the UI maps it.
   */
  actionLevel: string | number;
  computedAt: string;
  authorUid: string;
  /**
   * Round 18 (R5): how long the prevencionista spent in the wizard, in
   * minutes (modal-open → submit). Forwarded into the audit log so the
   * curriculum aggregator can roll it into `stats.safeHours`. Optional —
   * legacy callers (and tests that don't track time) can omit it.
   */
  durationMin?: number;
}

const COLLECTION = 'ergonomic_assessments';

const ASSESSMENT_TYPES: ReadonlySet<string> = new Set(['REBA', 'RULA']);

function validate(payload: ErgonomicAssessmentPayload): void {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ergonomic_assessments: payload required');
  }
  if (!ASSESSMENT_TYPES.has(payload.type)) {
    throw new Error(
      `ergonomic_assessments: unsupported type '${String(payload.type)}' (expected REBA|RULA)`,
    );
  }
  if (typeof payload.score !== 'number' || !Number.isFinite(payload.score)) {
    throw new Error('ergonomic_assessments: score must be a finite number');
  }
  if (
    typeof payload.actionLevel !== 'string' &&
    typeof payload.actionLevel !== 'number'
  ) {
    throw new Error('ergonomic_assessments: actionLevel must be string|number');
  }
  if (typeof payload.workerId !== 'string' || payload.workerId.length === 0) {
    throw new Error('ergonomic_assessments: workerId required');
  }
  if (typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
    throw new Error('ergonomic_assessments: projectId required');
  }
  if (typeof payload.computedAt !== 'string' || payload.computedAt.length === 0) {
    throw new Error('ergonomic_assessments: computedAt required');
  }
  if (typeof payload.authorUid !== 'string' || payload.authorUid.length === 0) {
    throw new Error('ergonomic_assessments: authorUid required');
  }
}

function newId(): string {
  // Mirror useRiskEngine.ts: rely on Web Crypto when available, else timestamp.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `asmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persist a new ergonomic assessment and emit a safety.<type>.completed audit
 * log. Returns the freshly-generated document id.
 */
export async function recordErgonomicAssessment(
  payload: ErgonomicAssessmentPayload,
): Promise<{ id: string }> {
  validate(payload);

  const id = newId();
  const ref = doc(db, COLLECTION, id);

  const dbPayload = {
    workerId: payload.workerId,
    projectId: payload.projectId,
    type: payload.type,
    inputs: payload.inputs,
    score: payload.score,
    actionLevel: payload.actionLevel,
    computedAt: payload.computedAt,
    metadata: {
      author: payload.authorUid,
      signedAt: null,
    },
  };

  await setDoc(ref, dbPayload);

  // Round 18 (R5): forward `durationMin` only when the caller provided a
  // finite positive value — guarantees `historyAggregator.safeHours` is
  // never poisoned by a stray 0/NaN/negative.
  const auditDetails: Record<string, unknown> = {
    assessmentId: id,
    workerId: payload.workerId,
    type: payload.type,
    score: payload.score,
    actionLevel: payload.actionLevel,
  };
  if (
    typeof payload.durationMin === 'number' &&
    Number.isFinite(payload.durationMin) &&
    payload.durationMin > 0
  ) {
    auditDetails.durationMin = payload.durationMin;
  }

  await logAuditAction(
    `safety.${payload.type.toLowerCase()}.completed`,
    'safety',
    auditDetails,
    payload.projectId,
  );

  return { id };
}

/**
 * Mark an assessment as signed. After this, the Firestore rules + the local
 * pre-condition both refuse further mutations: the doc is append-only.
 *
 * Throws when the doc does not exist or is already signed (one-shot).
 */
export async function signErgonomicAssessment(
  id: string,
  signerUid: string,
): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('signErgonomicAssessment: id required');
  }
  if (typeof signerUid !== 'string' || signerUid.length === 0) {
    throw new Error('signErgonomicAssessment: signerUid required');
  }

  const ref = doc(db, COLLECTION, id);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error(`signErgonomicAssessment: assessment '${id}' not found`);
  }

  const existing = snap.data() as
    | { type?: string; projectId?: string; metadata?: { signedAt?: string | null } }
    | undefined;

  if (existing?.metadata?.signedAt) {
    throw new Error(`signErgonomicAssessment: assessment '${id}' already signed`);
  }

  const signedAt = new Date().toISOString();

  await updateDoc(ref, {
    'metadata.signedAt': signedAt,
    'metadata.signedBy': signerUid,
  });

  const assessmentType = String(existing?.type ?? 'reba').toLowerCase();
  await logAuditAction(
    `safety.${assessmentType}.signed`,
    'safety',
    { assessmentId: id, signerUid, signedAt },
    existing?.projectId,
  );
}
