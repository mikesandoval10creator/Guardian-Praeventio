// What a SUSESO inspector reads when they scan the QR on a DIAT/DIEP.
//
// WHY THIS EXISTS: the QR used to point straight at `/api/suseso/verify/:folio`,
// so scanning a legally-required document showed raw JSON —
// `{"valid":false,"verificationStatus":"unverifiable","reason":"legacy_unverifiable"}`
// — to a government inspector standing in a worksite. Someone who cannot read
// that does not conclude "the system is being careful"; they conclude something
// is wrong with the document. This module turns the verifier's machine outcome
// into a verdict a person can act on.
//
// The hardest case is `unverifiable`, and it is the one that matters most:
// "we cannot prove who signed this" is NOT "this is fake". Saying either of
// those wrongly has real consequences for the company being inspected, so the
// copy states exactly what is known and exactly what is not.
//
// Copy is es-CL (CLAUDE.md #2).

import type { SusesoVerificationResult } from './types';

export type VerificationTone = 'verified' | 'unverifiable' | 'invalid' | 'unknown';

export interface VerificationCopy {
  /** Drives the visual treatment (green / amber / red / neutral). */
  tone: VerificationTone;
  /** Short verdict — the first thing read. */
  title: string;
  /** What the system actually knows. */
  detail: string;
  /** What this person can do next. */
  guidance: string;
}

/** Nuance per machine reason, layered on top of the status verdict. */
const UNVERIFIABLE_DETAIL: Record<string, string> = {
  legacy_unverifiable:
    'El documento está registrado, pero fue firmado con un método anterior que no permite comprobar criptográficamente quién lo firmó.',
  relying_party_mismatch:
    'El documento está registrado, pero su firma quedó asociada a un dominio distinto del actual, por lo que no es posible comprobarla desde este verificador.',
  verification_key_unavailable:
    'El documento está registrado, pero la clave pública necesaria para comprobar su firma ya no está disponible.',
  evidence_attestation_key_unavailable:
    'El documento está registrado, pero falta la clave con la que se selló su evidencia, así que no podemos comprobar que no haya sido alterada en el archivo.',
  verification_service_unavailable:
    'No pudimos consultar el servicio de verificación en este momento. El documento no ha sido descartado: simplemente no se pudo comprobar ahora.',
};

const INVALID_DETAIL: Record<string, string> = {
  payload_hash_mismatch:
    'El contenido del documento no coincide con lo que se firmó: fue modificado después de la firma.',
  context_mismatch:
    'La firma pertenece a otro documento o a otra persona: no corresponde a este folio.',
  signature_invalid:
    'La firma electrónica no es válida para este documento.',
  evidence_attestation_invalid:
    'El sello del archivo no cuadra: la evidencia de la firma fue alterada después de guardarse.',
};

/**
 * Turn the public verifier's response into the verdict shown on screen.
 *
 * Deliberately conservative in both directions: it never says "válido" unless
 * the signature actually verified, and it never says "falso" for a document it
 * merely cannot check.
 */
export function verificationCopy(
  result: SusesoVerificationResult | null,
): VerificationCopy {
  if (!result) {
    return {
      tone: 'unknown',
      title: 'No pudimos consultar este documento',
      detail: 'No hubo respuesta del servicio de verificación.',
      guidance: 'Revisa tu conexión y vuelve a escanear el código. Si el problema persiste, solicita el documento original a la empresa.',
    };
  }

  const status = result.verificationStatus
    ?? (result.valid ? 'verified' : 'unverifiable');
  const reason = typeof result.reason === 'string' ? result.reason : '';

  // Two records share this folio: a data problem on our side, not the
  // inspector's, and not evidence against the document.
  if (reason === 'ambiguous_folio') {
    return {
      tone: 'unverifiable',
      title: 'No podemos identificar este folio',
      detail: 'Hay más de un documento registrado con este número, así que no podemos determinar cuál corresponde al que tienes en mano.',
      guidance: 'Esto NO significa que el documento sea falso. Solicita a la empresa el documento original y repórtalo: este folio necesita corrección en el registro.',
    };
  }

  // Folio that does not exist, or isn't even folio-shaped — distinct from a
  // signature problem, so it must not read as a verdict on a signature.
  if (reason === 'unknown_folio' || reason === 'not_found' || reason === 'malformed_folio') {
    return {
      tone: 'unknown',
      title: 'No encontramos este folio',
      detail: 'No existe un documento registrado con este número.',
      guidance: 'Verifica el número del folio, o solicita el documento original a la empresa.',
    };
  }

  if (status === 'verified' && result.valid) {
    return {
      tone: 'verified',
      title: 'Documento verificado',
      detail: 'La firma electrónica corresponde a este documento y su contenido no ha sido alterado desde que se firmó.',
      guidance: 'Los datos que aparecen abajo provienen del registro firmado.',
    };
  }

  if (status === 'invalid') {
    return {
      tone: 'invalid',
      title: 'La firma no corresponde a este documento',
      detail: INVALID_DETAIL[reason]
        ?? 'La firma electrónica no es válida para este folio.',
      guidance: 'No consideres este documento como firmado. Solicita a la empresa que emita uno nuevo debidamente firmado.',
    };
  }

  // `unverifiable` — the honest middle ground. Never call it fake.
  if (reason === 'unsigned') {
    return {
      tone: 'unverifiable',
      title: 'Documento sin firma',
      detail: 'Este folio está registrado, pero todavía no ha sido firmado.',
      guidance: 'Solicita a la empresa la versión firmada del documento.',
    };
  }

  return {
    tone: 'unverifiable',
    title: 'No podemos comprobar la firma',
    detail: UNVERIFIABLE_DETAIL[reason]
      ?? 'El documento está registrado, pero no es posible comprobar su firma con la información disponible.',
    guidance: 'Esto NO significa que el documento sea falso: significa que el sistema no puede probar quién lo firmó. Solicita a la empresa el respaldo original si necesitas certeza.',
  };
}
