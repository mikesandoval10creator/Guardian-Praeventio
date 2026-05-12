import { describe, it, expect } from 'vitest';
import {
  buildChallenge,
  verifyChallenge,
  buildSignedAcknowledgement,
  encodeForQr,
  decodeFromQr,
  generateNonceHex,
  QrSignatureValidationError,
  DEFAULT_TTL_MINUTES,
  MAX_TTL_MINUTES,
  type BuildChallengeInput,
} from './qrSignatureService.js';

const SECRET = 'test-secret-with-at-least-16-chars';
const NOW = new Date('2026-05-12T22:00:00Z');

function baseInput(over: Partial<BuildChallengeInput> = {}): BuildChallengeInput {
  return {
    challengeId: 'ch-1',
    itemId: 'epp-arnes-001',
    kind: 'epp_delivery',
    projectId: 'p1',
    initiatedByUid: 'sup-1',
    nonceHex: 'a'.repeat(32),
    now: NOW,
    ...over,
  };
}

describe('buildChallenge', () => {
  it('crea challenge con signatureHex no vacía', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    expect(ch.signatureHex.length).toBe(64); // sha256 hex
    expect(ch.expiresAt).toBe('2026-05-12T22:05:00.000Z'); // +5min
    expect(ch.schemaVersion).toBe(1);
  });

  it('respeta TTL custom dentro del cap', () => {
    const ch = buildChallenge(baseInput({ ttlMinutes: 10 }), SECRET);
    expect(ch.expiresAt).toBe('2026-05-12T22:10:00.000Z');
  });

  it('cappea TTL al MAX_TTL_MINUTES', () => {
    const ch = buildChallenge(baseInput({ ttlMinutes: 999 }), SECRET);
    const expMs = Date.parse(ch.expiresAt);
    const expectedMaxMs = NOW.getTime() + MAX_TTL_MINUTES * 60_000;
    expect(expMs).toBe(expectedMaxMs);
  });

  it('rechaza secret corto', () => {
    expect(() => buildChallenge(baseInput(), 'short')).toThrowError(
      QrSignatureValidationError,
    );
  });

  it('rechaza nonce débil', () => {
    expect(() => buildChallenge(baseInput({ nonceHex: 'abc' }), SECRET)).toThrowError(
      QrSignatureValidationError,
    );
  });

  it('rechaza campos requeridos faltantes', () => {
    expect(() =>
      buildChallenge(baseInput({ itemId: '' }) as BuildChallengeInput, SECRET),
    ).toThrowError(QrSignatureValidationError);
  });

  it('mismo input → misma signature (determinístico)', () => {
    const a = buildChallenge(baseInput(), SECRET);
    const b = buildChallenge(baseInput(), SECRET);
    expect(a.signatureHex).toBe(b.signatureHex);
  });

  it('nonce distinto → signature distinta', () => {
    const a = buildChallenge(baseInput({ nonceHex: 'a'.repeat(32) }), SECRET);
    const b = buildChallenge(baseInput({ nonceHex: 'b'.repeat(32) }), SECRET);
    expect(a.signatureHex).not.toBe(b.signatureHex);
  });
});

describe('verifyChallenge', () => {
  it('acepta challenge recién construido', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const r = verifyChallenge({ challenge: ch, serverSecret: SECRET, now: NOW });
    expect(r.valid).toBe(true);
  });

  it('rechaza expirado', () => {
    const ch = buildChallenge(baseInput({ ttlMinutes: 1 }), SECRET);
    const later = new Date(NOW.getTime() + 2 * 60_000);
    const r = verifyChallenge({ challenge: ch, serverSecret: SECRET, now: later });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('rechaza signature tampered', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const tampered = { ...ch, itemId: 'evil-item' };
    const r = verifyChallenge({ challenge: tampered, serverSecret: SECRET, now: NOW });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('rechaza secret incorrecto', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const r = verifyChallenge({
      challenge: ch,
      serverSecret: 'different-secret-of-correct-length',
      now: NOW,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('rechaza replay (nonce ya consumido)', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const r = verifyChallenge({
      challenge: ch,
      serverSecret: SECRET,
      now: NOW,
      consumedNonces: new Set([ch.nonceHex]),
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('replayed');
  });

  it('rechaza expiresAt malformado', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const broken = { ...ch, expiresAt: 'not-a-date' };
    const r = verifyChallenge({ challenge: broken, serverSecret: SECRET, now: NOW });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('malformed');
  });
});

describe('encodeForQr / decodeFromQr', () => {
  it('round-trip preserva el challenge', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const qr = encodeForQr(ch);
    const decoded = decodeFromQr(qr);
    expect(decoded).toEqual(ch);
  });

  it('QR text es URL-safe (sin +, /, =)', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const qr = encodeForQr(ch);
    expect(qr).not.toMatch(/[+/=]/);
  });

  it('decodeFromQr rechaza QR malformado', () => {
    expect(() => decodeFromQr('not-valid-base64-of-json')).toThrow();
  });
});

describe('buildSignedAcknowledgement', () => {
  it('crea ack con los datos del challenge + signer', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const ack = buildSignedAcknowledgement({
      challenge: ch,
      signedByUid: 'worker-77',
      biometricUsed: true,
      now: new Date('2026-05-12T22:03:00Z'),
    });
    expect(ack.challengeId).toBe(ch.challengeId);
    expect(ack.signedByUid).toBe('worker-77');
    expect(ack.biometricUsed).toBe(true);
    expect(ack.signedAt).toBe('2026-05-12T22:03:00.000Z');
  });

  it('incluye location si se provee', () => {
    const ch = buildChallenge(baseInput(), SECRET);
    const ack = buildSignedAcknowledgement({
      challenge: ch,
      signedByUid: 'w1',
      biometricUsed: false,
      location: { lat: -33.4, lng: -70.6 },
    });
    expect(ack.location).toEqual({ lat: -33.4, lng: -70.6 });
  });
});

describe('generateNonceHex', () => {
  it('produce 32 hex chars con random source default', () => {
    const nonce = generateNonceHex();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('determinístico con random source inyectable', () => {
    const source = () =>
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const nonce = generateNonceHex(source);
    expect(nonce).toBe('0102030405060708090a0b0c0d0e0f10');
  });

  it('rechaza source corto', () => {
    const source = () => new Uint8Array([1, 2, 3]);
    expect(() => generateNonceHex(source)).toThrowError(QrSignatureValidationError);
  });
});

describe('DEFAULT_TTL_MINUTES = 5', () => {
  it('export es 5min', () => {
    expect(DEFAULT_TTL_MINUTES).toBe(5);
  });
});
