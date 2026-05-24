// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X — DS 76 firma electrónica
// avanzada via WebAuthn ECDSA-P256.
//
// ── Por qué este módulo existe ─────────────────────────────────────────
// DS 76 (Reglamento de Construcción Chile) exige que el libro de obras
// digital tenga "firma electrónica avanzada" — equivalente a la firma
// manuscrita ante notario. La Ley 19.799 §2.g define eso como una firma
// que:
//   (i)  permite identificar al firmante,
//   (ii) ha sido creada usando medios bajo el control exclusivo del firmante,
//   (iii) está vinculada a los datos firmados de tal modo que cualquier
//         modificación ulterior de los datos sea detectable.
//
// WebAuthn ECDSA-P256 (FIDO2 nivel 2) entrega LOS TRES requisitos:
//   (i)  el credential está registrado contra un uid + nombre del usuario,
//   (ii) la clave privada vive en el TPM/Secure Enclave del dispositivo o
//        en un security key físico — nunca sale del control del firmante,
//   (iii) la firma se computa sobre `clientDataJSON || authenticatorData`,
//         donde `clientDataJSON.challenge` está cryptographically bound
//         al hash de la entry — alterar la entry invalida la firma.
//
// ── El truco "challenge derivado del documento" ─────────────────────────
// El protocolo WebAuthn estándar usa challenges aleatorios de 32 bytes.
// Para document signing, derivamos el challenge del CONTENIDO del documento:
//
//     payloadHash = SHA-256(canonicalize(entry))
//     challenge   = SHA-256(SIGNING_DOMAIN_TAG || payloadHash)
//
// Esto garantiza que la firma queda matemáticamente bound al texto exacto
// de la entry. Si después alguien modifica `description` o `kind`, el
// payloadHash cambia → la firma deja de verificar.
//
// El `SIGNING_DOMAIN_TAG` ('praeventio.sitebook.sign.v1') asegura domain
// separation: una firma de SiteBook NO puede ser re-usada como firma de
// CPHS o de medical disclaimer (cada flow tendría su propio tag).
//
// ── Privacy on-device ──────────────────────────────────────────────────
// El payloadHashHex viaja al server (necesario para issue del challenge)
// pero el CONTENIDO de la entry NO necesita viajar — el server confía en
// el hash que el cliente computa, porque luego cualquier verifier puede
// re-computar el hash desde la entry persistida y comparar contra el
// `payloadHashHex` registrado en la firma. Si difieren → tampering.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { canonicalize } from '../../server/middleware/canonicalBody';
import type { SiteBookEntry } from './siteBookService';

/**
 * Domain separation tag. Versioneado para permitir rotación criptográfica
 * sin invalidar firmas viejas — cada firma queda permanentemente bound al
 * tag vigente cuando se emitió (registrado en `signature.algorithm` + la
 * derivación re-aplicada al verificar).
 */
export const SIGNING_DOMAIN_TAG = 'praeventio.sitebook.sign.v1';

/**
 * Campos de SiteBookEntry que se incluyen en el hash de firma. Excluye:
 *   - `status`     — cambia open→signed POST-firma, no es parte del payload
 *   - `recordedAt` — timestamp de ingreso al sistema, no es el evento mismo
 *   - `signature`  — la firma misma no se incluye (paradoja circular)
 *   - `evidenceUrls` — URLs de Storage pueden cambiar (signed URL refresh)
 *                      sin que el contenido del evento cambie. Si llegara
 *                      a importar, se firma cada URL como un commit aparte.
 *
 * Incluye campos sustantivos del registro DS 76:
 *   - id, projectId, folio, year, sequenceNumber → identidad única
 *   - kind, occurredAt → tipo + cuándo ocurrió el evento
 *   - recordedByUid, recordedByRole → quién lo registró
 *   - description → contenido del registro (la parte legalmente vinculante)
 *   - involvedWorkerUids → personas mencionadas (ordenadas alfabéticamente
 *                          para que la firma no dependa del orden de input)
 *   - location → lugar dentro del proyecto
 *   - correctsEntryFolio + correctionReason → trazabilidad de correcciones
 */
interface CanonicalSignaturePayload {
  id: string;
  projectId: string;
  folio: string;
  year: number;
  sequenceNumber: number;
  kind: string;
  occurredAt: string;
  recordedByUid: string;
  recordedByRole: string;
  description: string;
  involvedWorkerUids?: string[];
  location?: string;
  correctsEntryFolio?: string;
  correctionReason?: string;
  // Domain marker — protege contra "wrong-context replay": si alguien
  // intentara firmar otro tipo de documento usando un canonical-JSON
  // accidentalmente igual, este campo difiere.
  __schema: 'sitebook.entry.v1';
}

function buildCanonicalPayload(entry: SiteBookEntry): CanonicalSignaturePayload {
  if (!entry.folio || entry.folio.trim().length === 0) {
    throw new Error('siteBookSigning: folio vacío — no se puede firmar entry sin folio');
  }
  return {
    __schema: 'sitebook.entry.v1',
    id: entry.id,
    projectId: entry.projectId,
    folio: entry.folio,
    year: entry.year,
    sequenceNumber: entry.sequenceNumber,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    recordedByUid: entry.recordedByUid,
    recordedByRole: entry.recordedByRole,
    description: entry.description,
    // Normalizamos involvedWorkerUids a array ordenado alfabéticamente.
    // Esto hace la firma order-independent: mismo set de workers →
    // misma firma, sin importar en qué orden la UI los entregue.
    involvedWorkerUids:
      entry.involvedWorkerUids && entry.involvedWorkerUids.length > 0
        ? [...entry.involvedWorkerUids].sort()
        : undefined,
    location: entry.location,
    correctsEntryFolio: entry.correctsEntryFolio,
    correctionReason: entry.correctionReason,
  };
}

/**
 * Hash SHA-256 hex de la canonical-JSON serialization de los campos
 * sustantivos de la entry. 64 caracteres lowercase hex.
 *
 * Determinístico: la misma entry siempre produce el mismo hash, sin
 * importar el orden de las claves en el objeto original (lo garantiza
 * `canonicalize()` RFC 8785).
 */
export function computeEntryPayloadHashHex(entry: SiteBookEntry): string {
  const canonical = canonicalize(buildCanonicalPayload(entry));
  const bytes = new TextEncoder().encode(canonical);
  const digest = sha256(bytes);
  return bytesToHex(digest);
}

/**
 * Deriva el challenge WebAuthn de 32 bytes desde el payload hash.
 * Aplica domain separation con `SIGNING_DOMAIN_TAG`.
 *
 * Algoritmo:
 *   challenge = SHA-256(utf8(SIGNING_DOMAIN_TAG) || hexToBytes(payloadHashHex))
 *
 * El authenticator firmará `clientDataJSON || authenticatorData` donde
 * `clientDataJSON.challenge = base64url(challenge)`. Cualquier verifier
 * puede re-computar `challenge` desde el payload hash y validar que
 * `clientDataJSON.challenge` lo refleja — eso prueba que el firmante
 * vio el contenido del documento (no un challenge random).
 */
export function deriveSigningChallenge(payloadHashHex: string): Uint8Array {
  if (typeof payloadHashHex !== 'string' || payloadHashHex.length !== 64) {
    throw new Error(
      `siteBookSigning: payloadHashHex must be 64 hex chars (got length ${payloadHashHex?.length})`,
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(payloadHashHex)) {
    throw new Error('siteBookSigning: payloadHashHex contains non-hex characters');
  }
  const tag = new TextEncoder().encode(SIGNING_DOMAIN_TAG);
  const hashBytes = hexToBytes(payloadHashHex.toLowerCase());
  const combined = new Uint8Array(tag.length + hashBytes.length);
  combined.set(tag, 0);
  combined.set(hashBytes, tag.length);
  return sha256(combined);
}

/**
 * Shape mínima del WebAuthn assertion que el browser produce y el cliente
 * envía al server. Base64url-encoded para JSON transport.
 *
 * El cliente convierte `PublicKeyCredential.response` (que tiene
 * ArrayBuffers) a esta shape antes de POST.
 */
export interface AssertionFromBrowser {
  /** `credential.id` — base64url ID del authenticator. */
  credentialId: string;
  /** `credential.rawId` — same bytes, base64url. */
  rawId: string;
  /** `response.clientDataJSON` base64url. Incluye el challenge. */
  clientDataJSONB64u: string;
  /** `response.authenticatorData` base64url. */
  authenticatorDataB64u: string;
  /** `response.signature` — DER-encoded ECDSA signature, base64url. */
  signatureB64u: string;
}

/**
 * Input para construir el SignatureRecord. Separa los datos del browser
 * (assertion) de los datos del server (signerUid + signedAtIso) — eso
 * fuerza al caller a pensar en quién es la fuente de verdad de cada uno.
 */
export interface BuildSignatureRecordInput {
  /** UID Firebase del firmante (de verifyAuth, no client-controllable). */
  signerUid: string;
  /** ISO-8601 timestamp del server (no client). */
  signedAtIso: string;
  /** Hash hex que el firmante committed (debe matchear re-cómputo server). */
  payloadHashHex: string;
  /** Datos del browser-side WebAuthn ceremony. */
  assertion: AssertionFromBrowser;
}

/**
 * Shape final persistida en `SiteBookEntry.signature`. Extiende el
 * minimum del service base con metadata de WebAuthn opcional para
 * auditoría (credentialId + authenticatorDataB64u). NO incluye la
 * signature raw bytes — esa se persiste aparte si se requiere re-verify.
 */
export interface SiteBookSignatureRecord {
  signerUid: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256';
  payloadHashHex: string;
  /** Plan D.X: traceability extras. Opcionales para back-compat. */
  credentialId?: string;
  authenticatorDataB64u?: string;
}

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;

export function buildSignatureRecord(
  input: BuildSignatureRecordInput,
): SiteBookSignatureRecord {
  if (!input.signerUid || input.signerUid.trim().length === 0) {
    throw new Error('siteBookSigning: signerUid is required');
  }
  if (!ISO_REGEX.test(input.signedAtIso)) {
    throw new Error(`siteBookSigning: signedAtIso must be ISO-8601 (got "${input.signedAtIso}")`);
  }
  if (typeof input.payloadHashHex !== 'string' || input.payloadHashHex.length !== 64) {
    throw new Error('siteBookSigning: payloadHashHex must be 64 hex chars');
  }
  if (!/^[0-9a-f]{64}$/i.test(input.payloadHashHex)) {
    throw new Error('siteBookSigning: payloadHashHex contains non-hex characters');
  }
  const a = input.assertion;
  if (!a || !a.credentialId || !a.rawId || !a.clientDataJSONB64u || !a.authenticatorDataB64u || !a.signatureB64u) {
    throw new Error('siteBookSigning: assertion fields incomplete (credentialId/rawId/clientDataJSON/authenticatorData/signature required)');
  }
  return {
    signerUid: input.signerUid,
    signedAt: input.signedAtIso,
    algorithm: 'webauthn-ecdsa-p256',
    payloadHashHex: input.payloadHashHex.toLowerCase(),
    credentialId: a.credentialId,
    authenticatorDataB64u: a.authenticatorDataB64u,
  };
}
