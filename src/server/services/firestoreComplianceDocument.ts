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

    // [P0][COMPLIANCE] Hy3-audit 3c4aa66d-73fe-81a4-9e21-cc1114a14b24
    // (verificado 2026-08-24): sin este guard, un signature con un
    // payloadHashHex distinto al del documento persistiría sin aviso,
    // generando un documento firmado digitalmente con un hash que NO
    // corresponde a la firma. Cualquier validación posterior (auditoría
    // SII, fiscalizador, peritaje legal) que compare hash firmado vs
    // hash del payload encontraría inconsistencia. TS no puede tipar
    // `payloadHashHex` en TSignature (genérico), así que usamos runtime
    // type guard explícito y lanzamos un error tipado.
    const sigHash = (signature as unknown as { payloadHashHex?: unknown })
      .payloadHashHex;
    if (typeof sigHash === 'string' && sigHash.length > 0) {
      if (sigHash !== current.payloadHashHex) {
        throw new ComplianceSigningFlowError('payload_hash_mismatch');
      }
    }

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
