// Praeventio Guard — Sprint 28 Bucket B6.
//
// SUSESO (Superintendencia de Seguridad Social) form types for DIAT and
// DIEP. The DIAT (Declaración Individual de Accidente del Trabajo) is
// mandated by DS 101 — the regulation for accident notification under
// Ley 16.744 art. 76. The DIEP (Declaración Individual de Enfermedad
// Profesional) is mandated by DS 109 + DS 110 — the calification of
// occupational disease under the same Ley.
//
// Audit hallazgo H28 (P1, 8 SP): the previous implementation only emitted
// AI-generated metadata via Gemini (see legacy `susesoBackend.ts`); there
// was no PDF, no folio counter, and no electronic signature. This module
// closes that gap.
//
// Forms are IMMUTABLE post-creation. Firestore rules enforce
// `allow update: if false` so any correction requires a brand-new folio
// (the audit-trail invariant required by Ley 16.744 art. 76).

/**
 * The two SUSESO declaration kinds.
 *
 * - `DIAT` — accidents (work, commute, fatal). Tipified per DS 101.
 * - `DIEP` — occupational diseases. Tipified per DS 110.
 *
 * The string is also used as the URL suffix in folios (so it appears in
 * QR-verification payloads and audit logs).
 */
export type SusesoFormKind = 'DIAT' | 'DIEP';

/**
 * Approved Chilean mutualidades + ISL (Instituto de Seguridad Laboral,
 * the public alternative). The list is closed by Ley 16.744 — adding a
 * new identifier here without a regulatory change would be a bug.
 */
export type SusesoMutualidad = 'achs' | 'mutual_seguridad' | 'ist' | 'isl';

/**
 * DS 101 (DIAT) — incident sub-classification. SUSESO requires this to
 * route the form to the correct mutualidad workflow.
 */
export type SusesoIncidentClassification =
  | 'accidente_trabajo'
  | 'enfermedad_profesional'
  | 'accidente_trayecto';

/**
 * Witness identification. RUT is mandatory per DS 101 to allow the
 * mutualidad to call them for follow-up testimony.
 */
export interface SusesoWitness {
  fullName: string;
  rut: string;
}

/**
 * Reporter identification. Mirrors `auditServerEvent` shape — uid is the
 * Firebase Auth uid; rut and fullName are denormalized so the form is
 * self-contained even after the user record is deleted (GDPR/Ley 19.628
 * right-to-erasure: the mutualidad still needs the original reporter
 * data).
 */
export interface SusesoReporter {
  uid: string;
  rut: string;
  fullName: string;
}

/**
 * Electronic signature (Ley 19.799 art. 3 — firma electrónica simple).
 *
 * - `algorithm: 'webauthn-ecdsa-p256'` — preferred path. The signer's
 *   browser holds a WebAuthn credential (platform authenticator or
 *   security key); we sign the PDF body hash with their ECDSA P-256
 *   private key. Non-repudiation is acceptable for "firma simple" but
 *   NOT for "firma avanzada" (which requires a SUSESO-recognized PSC).
 * - `algorithm: 'kms-sign-rsa'` — fallback for service accounts. Used
 *   only when the form is auto-generated (e.g. from an emergency dispatch
 *   pipeline) and no human signer is online; the mutualidad is informed
 *   via the algorithm field.
 *
 * `payloadHashHex` is the SHA-256 of the PDF byte stream BEFORE the
 * signature page is appended (so the verifier can reproduce the hash
 * deterministically by stripping the last page).
 */
import type { ComplianceSignatureAuditFields } from '../compliance/complianceSignature.js';

export interface SusesoSignature extends ComplianceSignatureAuditFields {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256' | 'kms-sign-rsa';
  /** Base64-encoded raw signature bytes. */
  signatureB64: string;
  /** SHA-256 hex digest of the PDF body the signature covers. */
  payloadHashHex: string;
}

/**
 * Full SUSESO form record. Stored as-is in Firestore at
 * `tenants/{tenantId}/suseso_forms/{formId}`.
 */
export interface SusesoForm {
  kind: SusesoFormKind;
  /**
   * Format: `${kind}-${year}-${tenantSlug}-${seq:06d}`.
   *
   * Example: `DIAT-2026-praevent-000042`.
   *
   * The tenant slug is the first 8 chars of the tenantId, lowercased
   * with non-alphanumeric stripped. Sequence is monotonic per
   * (tenantId, year, kind) — see folioGenerator.ts.
   */
  folio: string;

  /** Server-computed SHA-256 of the unsigned PDF bytes at `payloadRendererVersion`. */
  payloadHashHex?: string;
  /**
   * Versioned byte-rendering contract used to reproduce the digest.
   *
   * v1 — body without the verification QR (every document signed before
   *      2026-07). v2 — body WITH the QR drawn from `qrCodeUrl`.
   *
   * Verification MUST render at the version stored on the document, never
   * at "whatever the current renderer emits": bumping the renderer while
   * verifying against the newest output would make every previously-signed
   * declaration report a payload mismatch — i.e. accuse valid legal
   * documents of having been altered.
   */
  payloadRendererVersion?: 1 | 2;
  /**
   * Absolute URL the printed QR encodes (`…/verificar/{folio}`).
   *
   * Persisted rather than recomputed because in v2 it is part of the
   * SIGNED bytes: rebuilding it from an environment variable would make
   * the digest depend on where verification happens to run.
   */
  qrCodeUrl?: string;

  // Worker
  workerRut: string;
  workerFullName: string;

  // Employer
  companyRut: string;
  companyName: string;
  mutualidad: SusesoMutualidad;

  // Incident
  /** ISO-8601 timestamp of the incident. */
  incidentDate: string;
  incidentDescription: string;
  incidentLocation: string;
  bodyPartsAffected: string[];
  incidentClassification: SusesoIncidentClassification;

  // DS 101 / DS 110 specific causales
  /** DS 101 causal (only for DIAT). */
  ds101Causal?: string;
  /** DS 110 causal (only for DIEP). */
  ds110Causal?: string;

  // Witnesses + reporter
  witnesses: SusesoWitness[];
  reportedBy: SusesoReporter;

  // Signature (optional pre-sign, mandatory pre-submit)
  signature?: SusesoSignature;

  // Audit fields
  /** ISO-8601 timestamp of form creation. */
  createdAt: string;
  /** ISO-8601 timestamp when submitted to the mutualidad portal. */
  submittedAt?: string;
}

/**
 * Public verification response for `GET /api/suseso/verify/:folio`.
 *
 * Intentionally does NOT include the worker's RUT, body parts affected,
 * or any clinical detail — only enough to confirm the document is real
 * and tied to a known signer. Mirrors the "HealthVault Viewer" pattern
 * but read-only (no document download).
 */
export interface SusesoVerificationResult {
  valid: boolean;
  verificationStatus?: 'verified' | 'invalid' | 'unverifiable';
  kind?: SusesoFormKind;
  signedAt?: string;
  signerRut?: string;
  /** Reason for `valid: false` — e.g. 'unknown_folio', 'unsigned'. */
  reason?: string;
}
