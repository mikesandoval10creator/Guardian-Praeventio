/**
 * Firestore writer for IPER (Identificación de Peligros y Evaluación de
 * Riesgos) matrix assessments.
 *
 * Compliance: same append-after-sign envelope as ergonomic_assessments
 * (Ley 16.744 + ISO 45001 §7.5.3). The deterministic IPER engine in
 * `src/services/protocols/iper.ts` produces the level/raw score; AI may
 * suggest CONTROLS but never the matrix classification.
 */
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logAuditAction } from '../auditService';

export interface IperAssessmentInputs {
  probability: 1 | 2 | 3 | 4 | 5;
  severity: 1 | 2 | 3 | 4 | 5;
  controlEffectiveness?: 'none' | 'low' | 'medium' | 'high';
}

export interface IperAssessmentPayload {
  /** Free-text description of the hazard / task. */
  description: string;
  projectId: string;
  inputs: IperAssessmentInputs;
  /** Computed level from `calculateIper` (e.g. 'moderado'). */
  level: string;
  /** P × S raw product. */
  rawScore: number;
  /** Computed recommendation copy from the engine. */
  recommendation: string;
  /** AI-suggested controls (the only place an LLM is allowed in this flow). */
  suggestedControls: string[];
  computedAt: string;
  authorUid: string;
}

const COLLECTION = 'iper_assessments';

function isInRange1to5(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}

function validate(payload: IperAssessmentPayload): void {
  if (!payload || typeof payload !== 'object') {
    throw new Error('iper_assessments: payload required');
  }
  if (typeof payload.level !== 'string' || payload.level.length === 0) {
    throw new Error('iper_assessments: level required');
  }
  if (typeof payload.rawScore !== 'number' || !Number.isFinite(payload.rawScore)) {
    throw new Error('iper_assessments: rawScore must be a finite number');
  }
  if (typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
    throw new Error('iper_assessments: projectId required');
  }
  if (typeof payload.authorUid !== 'string' || payload.authorUid.length === 0) {
    throw new Error('iper_assessments: authorUid required');
  }
  if (!payload.inputs || typeof payload.inputs !== 'object') {
    throw new Error('iper_assessments: inputs required');
  }
  if (!isInRange1to5(payload.inputs.probability)) {
    throw new Error('iper_assessments: inputs.probability must be 1..5');
  }
  if (!isInRange1to5(payload.inputs.severity)) {
    throw new Error('iper_assessments: inputs.severity must be 1..5');
  }
  if (!Array.isArray(payload.suggestedControls)) {
    throw new Error('iper_assessments: suggestedControls must be an array');
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `iper_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordIperAssessment(
  payload: IperAssessmentPayload,
): Promise<{ id: string }> {
  validate(payload);

  const id = newId();
  const ref = doc(db, COLLECTION, id);

  const dbPayload = {
    description: payload.description,
    projectId: payload.projectId,
    inputs: payload.inputs,
    level: payload.level,
    rawScore: payload.rawScore,
    recommendation: payload.recommendation,
    suggestedControls: payload.suggestedControls,
    computedAt: payload.computedAt,
    metadata: {
      author: payload.authorUid,
      signedAt: null,
    },
  };

  await setDoc(ref, dbPayload);

  await logAuditAction(
    'safety.iper.matrix.classified',
    'safety',
    {
      assessmentId: id,
      level: payload.level,
      rawScore: payload.rawScore,
      probability: payload.inputs.probability,
      severity: payload.inputs.severity,
    },
    payload.projectId,
  );

  return { id };
}

export async function signIperAssessment(
  id: string,
  signerUid: string,
): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('signIperAssessment: id required');
  }
  if (typeof signerUid !== 'string' || signerUid.length === 0) {
    throw new Error('signIperAssessment: signerUid required');
  }

  const ref = doc(db, COLLECTION, id);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error(`signIperAssessment: assessment '${id}' not found`);
  }

  const existing = snap.data() as
    | { projectId?: string; metadata?: { signedAt?: string | null } }
    | undefined;

  if (existing?.metadata?.signedAt) {
    throw new Error(`signIperAssessment: assessment '${id}' already signed`);
  }

  const signedAt = new Date().toISOString();

  await updateDoc(ref, {
    'metadata.signedAt': signedAt,
    'metadata.signedBy': signerUid,
  });

  await logAuditAction(
    'safety.iper.matrix.signed',
    'safety',
    { assessmentId: id, signerUid, signedAt },
    existing?.projectId,
  );
}
