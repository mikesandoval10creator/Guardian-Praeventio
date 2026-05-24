// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X tests for SiteBook signing.
//
// Cubre helpers PUROS del flow "firma electrónica avanzada DS 76 via
// WebAuthn ECDSA-P256". Estos helpers NO tocan red ni DOM — son
// determinísticos + reproducibles + testeables sin browser.
//
// El flow completo (client orchestrator + server route) se cubre en
// tests de integración separados — acá solo verificamos las pruebas
// criptográficas que ANCLAN la firma al contenido del documento.

import { describe, it, expect } from 'vitest';
import {
  computeEntryPayloadHashHex,
  deriveSigningChallenge,
  buildSignatureRecord,
  type AssertionFromBrowser,
  SIGNING_DOMAIN_TAG,
} from './siteBookSigning';
import type { SiteBookEntry } from './siteBookService';

function makeEntry(overrides: Partial<SiteBookEntry> = {}): SiteBookEntry {
  return {
    id: 'entry-abc123',
    projectId: 'proj-mineradora',
    folio: 'SB-2026-000042',
    year: 2026,
    sequenceNumber: 42,
    kind: 'inspection',
    occurredAt: '2026-05-24T10:30:00.000Z',
    recordedAt: '2026-05-24T11:00:00.000Z',
    recordedByUid: 'uid-supervisor-juan',
    recordedByRole: 'supervisor',
    description: 'Inspección rutinaria del frente de avance — todos los EPP en regla',
    status: 'open',
    ...overrides,
  };
}

describe('computeEntryPayloadHashHex', () => {
  it('es determinístico para una entry estable', () => {
    const e = makeEntry();
    const h1 = computeEntryPayloadHashHex(e);
    const h2 = computeEntryPayloadHashHex(e);
    expect(h1).toBe(h2);
  });

  it('produce 64-hex-char SHA-256 output', () => {
    const e = makeEntry();
    const h = computeEntryPayloadHashHex(e);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cambia si una sola letra de la descripción cambia (avalanche)', () => {
    const a = makeEntry();
    const b = makeEntry({ description: a.description + '.' });
    expect(computeEntryPayloadHashHex(a)).not.toBe(computeEntryPayloadHashHex(b));
  });

  it('cambia si cambia el folio (entradas distintas → firmas distintas)', () => {
    const a = makeEntry({ folio: 'SB-2026-000042' });
    const b = makeEntry({ folio: 'SB-2026-000043' });
    expect(computeEntryPayloadHashHex(a)).not.toBe(computeEntryPayloadHashHex(b));
  });

  it('IGNORA campos volátiles que NO deben estar bound a la firma', () => {
    // status, recordedAt y signature pueden cambiar después de firmar
    // (e.g. status pasa de open→signed) — la firma se compone sobre los
    // campos sustantivos del registro, no sobre la metadata de firma.
    const a = makeEntry({ status: 'open' });
    const b = makeEntry({
      status: 'signed',
      recordedAt: '2099-01-01T00:00:00.000Z',
      signature: {
        signerUid: 'someone',
        signedAt: 'whatever',
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'deadbeef',
      },
    });
    expect(computeEntryPayloadHashHex(a)).toBe(computeEntryPayloadHashHex(b));
  });

  it('ES sensible a involvedWorkerUids ordering normalizado (no order-dependent)', () => {
    const a = makeEntry({ involvedWorkerUids: ['uid-A', 'uid-B'] });
    const b = makeEntry({ involvedWorkerUids: ['uid-B', 'uid-A'] });
    // Misma multiset de workers → misma firma (caller no debe poder
    // re-firmar la entrada con un orden distinto pretendiendo otra cosa).
    expect(computeEntryPayloadHashHex(a)).toBe(computeEntryPayloadHashHex(b));
  });

  it('rechaza entries con folio vacío (defensa en profundidad)', () => {
    expect(() =>
      computeEntryPayloadHashHex(makeEntry({ folio: '' })),
    ).toThrow(/folio/i);
  });
});

describe('deriveSigningChallenge', () => {
  it('produce 32 bytes (256 bits) — match WebAuthn challenge spec', () => {
    const payloadHashHex = 'a'.repeat(64);
    const challenge = deriveSigningChallenge(payloadHashHex);
    expect(challenge.length).toBe(32);
  });

  it('es determinístico para el mismo payload hash', () => {
    const payloadHashHex = 'b'.repeat(64);
    const c1 = deriveSigningChallenge(payloadHashHex);
    const c2 = deriveSigningChallenge(payloadHashHex);
    expect(c1).toEqual(c2);
  });

  it('cambia con un payload hash distinto', () => {
    const c1 = deriveSigningChallenge('a'.repeat(64));
    const c2 = deriveSigningChallenge('b'.repeat(64));
    expect(c1).not.toEqual(c2);
  });

  it('incluye domain separation — challenge ≠ payload hash raw', () => {
    // Sin domain separation, un attacker podría re-usar una firma de
    // otro contexto que casualmente firmó el mismo hash. Verificamos
    // que la derivación NO es la identidad — el tag de dominio cambia
    // el resultado.
    const payloadHashHex = 'c'.repeat(64);
    const challenge = deriveSigningChallenge(payloadHashHex);
    const rawHashBytes = new Uint8Array(32).fill(0xcc);
    expect(challenge).not.toEqual(rawHashBytes);
  });

  it('rechaza payload hash con longitud incorrecta', () => {
    expect(() => deriveSigningChallenge('abc')).toThrow(/hash/i);
    expect(() => deriveSigningChallenge('a'.repeat(63))).toThrow(/hash/i);
    expect(() => deriveSigningChallenge('a'.repeat(65))).toThrow(/hash/i);
  });

  it('rechaza payload hash con caracteres no-hex', () => {
    expect(() => deriveSigningChallenge('Z'.repeat(64))).toThrow(/hex/i);
  });

  it('expone SIGNING_DOMAIN_TAG público para auditoría', () => {
    // El tag debe estar versioneado para permitir rotación criptográfica
    // futura sin invalidar firmas viejas (cada firma queda bound al tag
    // vigente cuando se emitió).
    expect(SIGNING_DOMAIN_TAG).toMatch(/^praeventio\.sitebook\.sign\.v\d+$/);
  });
});

describe('buildSignatureRecord', () => {
  const validAssertion: AssertionFromBrowser = {
    credentialId: 'cred-id-base64url',
    rawId: 'cred-id-base64url',
    clientDataJSONB64u: 'eyJjaGFsbGVuZ2UiOiJ4eHgifQ',
    authenticatorDataB64u: 'AAAAAAAA',
    signatureB64u: 'MEUCIQ...',
  };

  it('produce signature blob con shape correcto', () => {
    const sig = buildSignatureRecord({
      signerUid: 'uid-juan',
      signedAtIso: '2026-05-24T11:30:00.000Z',
      payloadHashHex: 'a'.repeat(64),
      assertion: validAssertion,
    });
    expect(sig.signerUid).toBe('uid-juan');
    expect(sig.signedAt).toBe('2026-05-24T11:30:00.000Z');
    expect(sig.algorithm).toBe('webauthn-ecdsa-p256');
    expect(sig.payloadHashHex).toBe('a'.repeat(64));
    expect(sig.credentialId).toBe('cred-id-base64url');
    expect(sig.authenticatorDataB64u).toBe('AAAAAAAA');
  });

  it('rechaza signerUid vacío', () => {
    expect(() =>
      buildSignatureRecord({
        signerUid: '',
        signedAtIso: '2026-05-24T11:30:00.000Z',
        payloadHashHex: 'a'.repeat(64),
        assertion: validAssertion,
      }),
    ).toThrow(/signerUid/i);
  });

  it('rechaza signedAt no-ISO', () => {
    expect(() =>
      buildSignatureRecord({
        signerUid: 'uid-juan',
        signedAtIso: 'ayer',
        payloadHashHex: 'a'.repeat(64),
        assertion: validAssertion,
      }),
    ).toThrow(/iso|date/i);
  });

  it('rechaza payloadHashHex con shape incorrecto', () => {
    expect(() =>
      buildSignatureRecord({
        signerUid: 'uid-juan',
        signedAtIso: '2026-05-24T11:30:00.000Z',
        payloadHashHex: 'abc',
        assertion: validAssertion,
      }),
    ).toThrow(/hash/i);
  });

  it('rechaza assertion incompleta', () => {
    expect(() =>
      buildSignatureRecord({
        signerUid: 'uid-juan',
        signedAtIso: '2026-05-24T11:30:00.000Z',
        payloadHashHex: 'a'.repeat(64),
        assertion: { ...validAssertion, credentialId: '' },
      }),
    ).toThrow(/credentialId|assertion/i);
  });
});
