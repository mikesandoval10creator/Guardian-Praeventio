// Praeventio Guard — Sprint 31 Bucket PP.
//
// DS 67/1999 (MINSAL) types. The decree mandates every employer in Chile
// with 10+ workers to publish a "Reglamento Interno de Higiene y
// Seguridad" — an internal regulation covering worker rights, employer
// obligations, sanctions, and the complaint procedure. The document is
// IMMUTABLE once registered in the SEREMI: any modification requires a
// new version (NEVER an in-place edit), so the data model below mirrors
// the SUSESO immutability invariant.
//
// Folio format: `DS67-${year}-${tenantSlug}-${seq:06d}` — same shape as
// SUSESO so audit-log greps work uniformly.

export interface Ds67Signature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256' | 'kms-sign-rsa';
  signatureB64: string;
  payloadHashHex: string;
}

/**
 * Reglamento Interno de Higiene y Seguridad payload.
 *
 * Every section is required by DS 67 art. 16 (the "contenido mínimo").
 * Free-text fields land in the PDF as-is — the UI is responsible for
 * letting the user paste the full normative text. Lists are rendered
 * as bulleted blocks.
 */
export interface Ds67Form {
  /** `DS67-${year}-${slug}-${seq}`. */
  folio: string;

  /** Server-computed SHA-256 of renderer v1 unsigned PDF bytes. */
  payloadHashHex?: string;
  /** Versioned byte-rendering contract used to reproduce the digest. */
  payloadRendererVersion?: 1;

  // Identificación
  tenantId: string;
  companyName: string;
  companyRut: string;
  companyAddress: string;

  // Section 1 — Ámbito de aplicación.
  scopeOfApplication: string;
  // Section 2 — Obligaciones del trabajador.
  workerObligations: string[];
  // Section 3 — Prohibiciones del trabajador.
  workerProhibitions: string[];
  // Section 4 — Sanciones.
  sanctions: string;
  // Section 5 — Procedimiento de reclamo.
  complaintProcedure: string;
  // Section 6 — Vigencia (start ISO + optional end).
  effectiveFrom: string;
  effectiveUntil?: string;

  // Audit
  createdAt: string;
  signature?: Ds67Signature;
}
