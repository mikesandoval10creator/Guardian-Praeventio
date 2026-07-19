import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { ComplianceSigningFlowError } from './complianceWebAuthnSigning.js';

interface StoredComplianceDocument {
  signature?: unknown;
  payloadHashHex?: string;
  payloadRendererVersion?: number;
}

/**
 * Attaches verified signature evidence only if the document still exists and
 * is unsigned at commit time. This is the final replay/concurrency boundary.
 */
export async function attachComplianceSignatureAtomically<
  TDocument extends StoredComplianceDocument,
  TSignature,
>(
  firestore: Firestore,
  ref: DocumentReference,
  signature: TSignature,
): Promise<TDocument & { signature: TSignature }> {
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new ComplianceSigningFlowError('not_found');
    const current = snapshot.data() as TDocument;
    if (current.signature) throw new ComplianceSigningFlowError('already_signed');

    tx.update(ref, { signature });
    return { ...current, signature };
  });
}

/**
 * Migrates a legacy unsigned document without replacing the complete record.
 * A concurrent signature, deletion, or different digest makes the operation
 * fail closed inside the same Firestore transaction.
 */
export async function persistComplianceDigestAtomically(
  firestore: Firestore,
  ref: DocumentReference,
  payloadHashHex: string,
  payloadRendererVersion: 1 | 2,
): Promise<void> {
  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new ComplianceSigningFlowError('not_found');
    const current = snapshot.data() as StoredComplianceDocument;
    if (current.signature) throw new ComplianceSigningFlowError('already_signed');

    const hasHash = current.payloadHashHex !== undefined;
    const hasVersion = current.payloadRendererVersion !== undefined;
    if (hasHash || hasVersion) {
      if (
        current.payloadHashHex === payloadHashHex &&
        current.payloadRendererVersion === payloadRendererVersion
      ) {
        return;
      }
      throw new ComplianceSigningFlowError('payload_hash_mismatch');
    }

    tx.update(ref, { payloadHashHex, payloadRendererVersion });
  });
}
