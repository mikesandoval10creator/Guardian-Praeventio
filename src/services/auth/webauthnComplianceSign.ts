// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan v2 B2 (2026-05-26).
//
// Helper de firma WebAuthn para los compliance builders DS 67 / DS 76 /
// SUSESO. Reemplaza el literal `'STUB_REPLACE_WITH_WEBAUTHN_ASSERTION'`
// que vivía hardcoded en 3 components.
//
// Estrategia simple: usa el `payloadHashHex` (SHA-256 del payload del
// form generado por el server) directamente como WebAuthn challenge.
// El authenticator firma `clientDataJSON || authenticatorData`, donde
// clientDataJSON incluye el challenge re-codificado — cualquier verifier
// puede chequear que la firma corresponde al payload exacto.
//
// **Bug pre-existente NO cerrado por este PR:** los endpoints server
// `/api/compliance/ds76/:formId/sign`, `/api/compliance/ds67/:formId/sign`
// y `/api/suseso/.../sign` aceptan el `signatureB64` sin verificarlo
// criptográficamente — solo lo persisten en Firestore. Esto significa
// que un atacante con credenciales válidas (ya autenticado) podría enviar
// cualquier base64 string. Issue para PR separado:
//
//   1. Negociar challenge server-side (igual que sitebookSign hace via
//      `storeWebAuthnChallenge` + `deriveSigningChallenge`).
//   2. Verificar la assertion con `@simplewebauthn/server` antes de
//      persistir.
//   3. Atomicamente consumir el challenge (anti-replay).
//
// Este PR cierra el lado cliente (el STUB hardcoded era visible incluso
// en producción: el signatureB64 era el string literal). El refactor
// server-side queda como follow-up.

import { bufferToBase64url, isWebAuthnSupported, WebAuthnCancelledError, WebAuthnNotSupportedError } from './webauthnClient';

export type ComplianceSignAlgorithm = 'webauthn-ecdsa-p256' | 'kms-sign-rsa';

export interface ComplianceSignature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: ComplianceSignAlgorithm;
  signatureB64: string;
  payloadHashHex: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('payloadHashHex inválido');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Ejecuta la ceremonia WebAuthn `navigator.credentials.get()` usando
 * el `payloadHashHex` como challenge y retorna la signature lista para
 * enviar al endpoint server `/sign`.
 *
 * @throws WebAuthnNotSupportedError — browser sin platform authenticator + sin security key.
 * @throws WebAuthnCancelledError — el usuario dismisseó el prompt nativo.
 */
export async function requestComplianceSignature(
  payloadHashHex: string,
  signerUid: string,
  signerRut: string,
): Promise<ComplianceSignature> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnNotSupportedError();
  }

  const challenge = hexToBytes(payloadHashHex);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge as unknown as BufferSource,
        // Empty allowCredentials → el browser muestra todos los
        // authenticators registrados para este origin. Si en el futuro
        // queremos filtrar por user (defense-in-depth si el browser
        // expone múltiples cuentas), agregar un endpoint server que
        // retorne credentialIds del uid logueado (ver sitebookSign.ts:174).
        allowCredentials: [],
        userVerification: 'preferred',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new WebAuthnCancelledError();
    }
    throw err;
  }
  if (!credential) {
    throw new WebAuthnCancelledError();
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  const signatureB64 = bufferToBase64url(response.signature);

  return {
    signerUid,
    signerRut,
    signedAt: new Date().toISOString(),
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64,
    payloadHashHex,
  };
}
