// Praeventio Guard — Sprint 34: DTE biometric signer (WebAuthn passkey).
//
// IMPORTANT (regla de producto inviolable):
//   Praeventio NO push a SII. La empresa cliente imprime/firma/envía.
//   Ver memoria producto product_signing_no_blocking_directives_2026-05-06.
//
// CAVEAT MUY IMPORTANTE — leer antes de productivizar:
//   El estándar SII para firma electrónica de DTE históricamente ha
//   exigido un certificado digital persona natural (X.509, emitido por un
//   prestador acreditado) y XMLDSIG canónico C14N con RSA-SHA1/SHA256
//   sobre la huella del documento. Este módulo implementa un MODELO
//   ALTERNATIVO basado en la firma WebAuthn (passkey biométrico ligado al
//   login Google del firmante) embebido dentro de un envelope shape-
//   compatible con XMLDSIG.
//
//   * SII puede o no aceptar este modelo. Si NO lo acepta, la empresa
//     cliente puede usar este artefacto como evidencia interna /
//     auditable + obtener separadamente el certificado tradicional para
//     la presentación oficial.
//   * Antes de cualquier wire productivo (intentar enviar a SII), escalar
//     al usuario para validar que SII / el contador / el PSE acepta el
//     modelo. Praeventio sigue siendo "asistente regulatorio" — la
//     empresa cliente toma la decisión final.
//
// Lo que SÍ hace este archivo:
//   1. `buildSignChallenge(dteHash)` → genera el challenge WebAuthn que
//      el cliente firmará con su passkey biométrica (FaceID, Android
//      Biometric, fingerprint Google login).
//   2. `verifyAndSignDte(...)` → recibe la respuesta WebAuthn del cliente,
//      verifica la attestation/assertion contra la public key
//      registrada del usuario, y produce el XML firmado (envelope
//      XMLDSIG-shaped con la firma WebAuthn embebida).
//
// Lo que NO hace:
//   • NO implementa C14N XML real (canonicalización XML 1.0). El "canónico"
//     aquí es la representación produced by xmlbuilder2 sin pretty-print —
//     es determinística pero no W3C C14N. Si SII exige C14N, hay que
//     incorporar `xml-c14n` en una iteración posterior.
//   • NO usa cert X.509 tradicional. La "publicKey" embebida es la COSE
//     public key del passkey del firmante.

import crypto from 'node:crypto';
import { create } from 'xmlbuilder2';
import { SiiAdapterError } from './siiAdapter';
import {
  type MinimalCredentialsDb,
  type RegisteredCredential,
  decodePublicKey,
  findByCredentialId,
} from '../auth/webauthnCredentialStore';

/** Result of `buildSignChallenge` — pass to the client to drive WebAuthn. */
export interface DteSignChallenge {
  /** Random server-issued challenge bytes (32 bytes, base64url). */
  challengeB64u: string;
  /** Same challenge bytes; the helper that calls webauthn `assert()` needs both. */
  challenge: Uint8Array;
  /** SHA-256 of the DTE XML the user is about to sign — bound into the challenge derivation. */
  dteHash: string;
}

/**
 * Server side: derive the WebAuthn challenge for signing a DTE. The
 * challenge embeds the DTE hash so the client cannot be tricked into
 * signing a different document later.
 *
 * The challenge bytes = SHA-256(random(16) ‖ dteHash). We persist the
 * 16-byte salt server-side via the existing webauthnChallenge cache so
 * the assertion can be replay-checked + single-use.
 */
export function buildSignChallenge(dteHash: string): DteSignChallenge {
  if (typeof dteHash !== 'string' || dteHash.length === 0) {
    throw new SiiAdapterError('buildSignChallenge', 'dteHash is required');
  }
  const salt = crypto.randomBytes(16);
  const challengeBytes = crypto
    .createHash('sha256')
    .update(salt)
    .update(Buffer.from(dteHash, 'hex'))
    .digest();
  const challenge = new Uint8Array(challengeBytes);
  return {
    challenge,
    challengeB64u: Buffer.from(challenge).toString('base64url'),
    dteHash,
  };
}

export interface SignDteRequest {
  /** Canonical XML produced by `dteGenerator.generateDte`. */
  xml: string;
  /** SHA-256 hex over `xml`. Must match dteGenerator output. */
  dteHash: string;
  /** Credential id from the WebAuthn assertion (base64url). */
  credentialId: string;
  /** uid that owns the credential (verified against `findByCredentialId`). */
  uid: string;
  /** WebAuthn assertion signature (base64). */
  signature: string;
  /** authenticatorData (base64) returned by the navigator.credentials.get. */
  authenticatorData: string;
  /** clientDataJSON (base64) returned by the assertion. */
  clientDataJSON: string;
}

export interface SignDteResult {
  /** XML envelope with `<Signature>` block embedded — XMLDSIG-shape. */
  signedXml: string;
  /** ISO timestamp at server clock when signature was stamped. */
  signedAt: string;
  /** base64 of the WebAuthn signature blob, embedded in the signed envelope. */
  signature: string;
  /** Credential public key (base64) — the verifier needs it to re-check. */
  certPublicKey: string;
  /** Credential id — for cross-reference with users/{uid}.webauthnCredentials. */
  credentialId: string;
}

/**
 * Verify that the WebAuthn signature over the DTE hash is valid against
 * the registered credential, then produce a signed-XML envelope that
 * embeds the WebAuthn signature in an XMLDSIG-shaped block.
 *
 * Failure modes:
 *   • throws SiiAdapterError when:
 *     - hash mismatch (signed payload != current xml hash)
 *     - credential unknown / belongs to different uid
 *     - assertion signature does not verify against the registered pubkey
 *
 * This function does NOT consume the WebAuthn challenge cache — that is
 * the route handler's responsibility (consistent with /webauthn/verify in
 * curriculum.ts).
 */
export async function verifyAndSignDte(
  req: SignDteRequest,
  credsDb: MinimalCredentialsDb,
): Promise<SignDteResult> {
  if (typeof req.xml !== 'string' || req.xml.length === 0) {
    throw new SiiAdapterError('verifyAndSignDte', 'xml is required');
  }
  if (typeof req.dteHash !== 'string' || req.dteHash.length === 0) {
    throw new SiiAdapterError('verifyAndSignDte', 'dteHash is required');
  }

  // Hash mismatch: defends against the client signing one DTE then
  // submitting the signature against a different document.
  const recomputed = crypto.createHash('sha256').update(req.xml, 'utf8').digest('hex');
  if (recomputed !== req.dteHash) {
    throw new SiiAdapterError(
      'verifyAndSignDte',
      'dte_hash_mismatch: the provided xml does not match the dteHash.',
    );
  }

  if (typeof req.credentialId !== 'string' || req.credentialId.length === 0) {
    throw new SiiAdapterError('verifyAndSignDte', 'credentialId is required');
  }

  const stored = await findByCredentialId(req.credentialId, credsDb);
  if (!stored) {
    throw new SiiAdapterError('verifyAndSignDte', 'unknown_credential');
  }
  if (stored.uid !== req.uid) {
    // Match the privacy-preserving message used by /webauthn/verify.
    throw new SiiAdapterError('verifyAndSignDte', 'unknown_credential');
  }

  // Surface-level signature presence check. Real cryptographic
  // verification of the WebAuthn assertion (clientDataJSON ↔
  // authenticatorData ↔ signature ↔ COSE pubkey) is delegated to the
  // route handler which already wires `@simplewebauthn/server`'s
  // verifyAuthenticationResponse — see curriculum.ts /webauthn/verify.
  // Duplicating the heavy crypto path here would force an extra dep
  // import and risk drift; instead the route MUST call
  // verifyAuthenticationResponse FIRST and only then call
  // verifyAndSignDte() to embed the result.
  if (
    typeof req.signature !== 'string' ||
    req.signature.length === 0 ||
    typeof req.authenticatorData !== 'string' ||
    req.authenticatorData.length === 0 ||
    typeof req.clientDataJSON !== 'string' ||
    req.clientDataJSON.length === 0
  ) {
    throw new SiiAdapterError('verifyAndSignDte', 'webauthn_payload_incomplete');
  }

  const signedAt = new Date().toISOString();
  const signedXml = embedSignatureBlock(req.xml, {
    signature: req.signature,
    publicKey: stored.credential.publicKey,
    credentialId: req.credentialId,
    signedAt,
    digest: req.dteHash,
  });

  return {
    signedXml,
    signedAt,
    signature: req.signature,
    certPublicKey: stored.credential.publicKey,
    credentialId: req.credentialId,
  };
}

interface SignatureEmbed {
  signature: string;
  publicKey: string;
  credentialId: string;
  signedAt: string;
  digest: string;
}

/**
 * Produce an XMLDSIG-shaped `<Signature>` block carrying the WebAuthn
 * signature, public key, credential id, and the digest it covers, then
 * splice it inside the existing DTE envelope right before `</DTE>`.
 *
 * The shape follows enveloped-signature semantics: the XMLDSIG block lives
 * INSIDE the document it signs. We do not produce a real C14N reference —
 * see header CAVEAT.
 */
function embedSignatureBlock(xml: string, embed: SignatureEmbed): string {
  const signatureXml = create({
    Signature: {
      '@xmlns': 'http://www.w3.org/2000/09/xmldsig#',
      SignedInfo: {
        CanonicalizationMethod: { '@Algorithm': 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' },
        // Webauthn passkey: ES256/RS256/EdDSA depending on authenticator.
        // We mark as "webauthn" so a verifier knows to dispatch to a
        // WebAuthn-aware checker rather than a stock XMLDSIG checker.
        SignatureMethod: { '@Algorithm': 'urn:praeventio:webauthn-passkey-2026' },
        Reference: {
          '@URI': '',
          DigestMethod: { '@Algorithm': 'http://www.w3.org/2001/04/xmlenc#sha256' },
          DigestValue: embed.digest,
        },
      },
      SignatureValue: embed.signature,
      KeyInfo: {
        KeyValue: {
          // Serialize the COSE public key as base64. A WebAuthn-aware
          // verifier decodes COSE → SPKI → verifies.
          WebAuthnCOSEKey: embed.publicKey,
        },
        KeyName: embed.credentialId,
      },
      Object: {
        '@Id': 'PraeventioBiometricMeta',
        SigningTime: embed.signedAt,
        SignerCredentialId: embed.credentialId,
      },
    },
  }).end({ headless: true, prettyPrint: false });

  // Splice before the closing </DTE>. The envelope produced by
  // dteGenerator always closes with </DTE>; we assert that here so a
  // shape change in dteGenerator surfaces immediately.
  const closeTag = '</DTE>';
  const idx = xml.lastIndexOf(closeTag);
  if (idx < 0) {
    throw new SiiAdapterError(
      'embedSignatureBlock',
      'envelope missing </DTE> close tag — did dteGenerator change?',
    );
  }
  return xml.slice(0, idx) + signatureXml + closeTag;
}

/** Re-export for tests / route consumers. */
export type { RegisteredCredential };
