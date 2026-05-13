import { describe, it, expect } from 'vitest';
import {
  createAckSession,
  validateAckScan,
  rejectDuplicateAck,
  QrAckValidationError,
  type Signer,
  type Verifier,
  type AckScanRequest,
} from './qrAckSessionEngine.js';

const NOW = new Date('2026-05-12T22:00:00Z');

// Stub HMAC determinístico para tests.
const SECRET = 'test-secret';
const signer: Signer = (payload) => `hmac:${SECRET}:${payload.length}:${payload.slice(0, 8)}`;
const verifier: Verifier = (payload, sig) => sig === signer(payload);

describe('createAckSession', () => {
  it('genera sesión con expiry 5min por defecto', () => {
    const s = createAckSession(
      {
        projectId: 'p1',
        createdByUid: 'sup-1',
        itemKind: 'training',
        itemId: 'altura-r1',
        itemLabel: 'Curso Trabajo en Altura R1',
      },
      signer,
      { now: NOW, sessionIdGenerator: () => 'sid-deterministic' },
    );
    expect(s.sessionId).toBe('sid-deterministic');
    expect(s.itemLabel).toBe('Curso Trabajo en Altura R1');
    const expSec = Math.floor(new Date(s.expiresAt).getTime() / 1000);
    const iatSec = Math.floor(new Date(s.createdAt).getTime() / 1000);
    expect(expSec - iatSec).toBe(300);
    expect(s.signature).toMatch(/^hmac:/);
  });

  it('respeta TTL custom dentro del rango [60, 1800]', () => {
    const s = createAckSession(
      {
        projectId: 'p1',
        createdByUid: 'sup-1',
        itemKind: 'epp',
        itemId: 'casco',
        itemLabel: 'Casco azul nuevo',
        ttlSeconds: 600,
      },
      signer,
      { now: NOW, sessionIdGenerator: () => 'sid-2' },
    );
    const diff =
      Math.floor(new Date(s.expiresAt).getTime() / 1000) -
      Math.floor(new Date(s.createdAt).getTime() / 1000);
    expect(diff).toBe(600);
  });

  it('TTL < 60s se clampa a 60', () => {
    const s = createAckSession(
      {
        projectId: 'p1',
        createdByUid: 'sup-1',
        itemKind: 'talk',
        itemId: 'charla-1',
        itemLabel: 'Charla 5 minutos: uso correcto de arnés',
        ttlSeconds: 10,
      },
      signer,
      { now: NOW, sessionIdGenerator: () => 'sid-3' },
    );
    const diff =
      Math.floor(new Date(s.expiresAt).getTime() / 1000) -
      Math.floor(new Date(s.createdAt).getTime() / 1000);
    expect(diff).toBe(60);
  });

  it('TTL > 1800s se clampa a 1800', () => {
    const s = createAckSession(
      {
        projectId: 'p1',
        createdByUid: 'sup-1',
        itemKind: 'document',
        itemId: 'doc-1',
        itemLabel: 'Procedimiento PTS-001',
        ttlSeconds: 999999,
      },
      signer,
      { now: NOW, sessionIdGenerator: () => 'sid-4' },
    );
    const diff =
      Math.floor(new Date(s.expiresAt).getTime() / 1000) -
      Math.floor(new Date(s.createdAt).getTime() / 1000);
    expect(diff).toBe(1800);
  });

  it('rechaza projectId vacío', () => {
    expect(() =>
      createAckSession(
        {
          projectId: '',
          createdByUid: 'sup-1',
          itemKind: 'training',
          itemId: 'x',
          itemLabel: 'x',
        },
        signer,
      ),
    ).toThrowError(QrAckValidationError);
  });

  it('rechaza itemLabel vacío (solo whitespace)', () => {
    expect(() =>
      createAckSession(
        {
          projectId: 'p1',
          createdByUid: 'sup-1',
          itemKind: 'epp',
          itemId: 'x',
          itemLabel: '   ',
        },
        signer,
      ),
    ).toThrowError(/missing_label/);
  });
});

describe('validateAckScan — happy path', () => {
  it('escaneo válido produce ack con todos los campos correctos', () => {
    const s = createAckSession(
      {
        projectId: 'p1',
        createdByUid: 'sup-1',
        itemKind: 'epp',
        itemId: 'casco-001',
        itemLabel: 'Casco azul',
      },
      signer,
      { now: NOW, sessionIdGenerator: () => 'sid-happy' },
    );

    const result = validateAckScan(
      {
        qrPayload: s.qrPayload,
        signature: s.signature,
        scannedByUid: 'w1',
        consent: true,
        biometricUsed: true,
      },
      verifier,
      { now: NOW },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ack.sessionId).toBe('sid-happy');
      expect(result.ack.workerUid).toBe('w1');
      expect(result.ack.itemId).toBe('casco-001');
      expect(result.ack.biometricUsed).toBe(true);
      expect(result.ack.ackId).toBe('ack-sid-happy-w1');
    }
  });
});

describe('validateAckScan — rejection paths', () => {
  function makeRequest(over: Partial<AckScanRequest> = {}): AckScanRequest {
    const s = createAckSession(
      {
        projectId: 'p1',
        createdByUid: 'sup-1',
        itemKind: 'training',
        itemId: 't1',
        itemLabel: 'Training X',
      },
      signer,
      { now: NOW, sessionIdGenerator: () => 'sid-reject' },
    );
    return {
      qrPayload: s.qrPayload,
      signature: s.signature,
      scannedByUid: 'w1',
      consent: true,
      biometricUsed: false,
      ...over,
    };
  }

  it('payload mal formado → bad_payload', () => {
    const r = validateAckScan(
      { ...makeRequest(), qrPayload: 'not-base64-at-all-$$$' },
      verifier,
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_payload');
  });

  it('firma mal → bad_signature', () => {
    const r = validateAckScan(
      { ...makeRequest(), signature: 'hmac:wrong:sig' },
      verifier,
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_signature');
  });

  it('sesión expirada → expired', () => {
    const r = validateAckScan(makeRequest(), verifier, {
      now: new Date(NOW.getTime() + 10 * 60 * 1000),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('expired');
  });

  it('sin consent → no_consent', () => {
    const r = validateAckScan({ ...makeRequest(), consent: false }, verifier, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_consent');
  });

  it('sessionId ya usado → replay', () => {
    const r = validateAckScan(makeRequest(), verifier, {
      now: NOW,
      usedSessionIds: new Set(['sid-reject']),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('replay');
  });

  it('supervisor intenta firmar su propia sesión → creator_cannot_self_sign', () => {
    const r = validateAckScan({ ...makeRequest(), scannedByUid: 'sup-1' }, verifier, {
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('creator_cannot_self_sign');
  });
});

describe('rejectDuplicateAck', () => {
  const ack = {
    ackId: 'a-1',
    sessionId: 's-1',
    projectId: 'p1',
    itemKind: 'epp' as const,
    itemId: 'casco',
    workerUid: 'w1',
    signedAt: '2026-05-12T22:00:00Z',
    biometricUsed: true,
  };

  it('mismo uid mismo session → true (duplicado)', () => {
    expect(rejectDuplicateAck([ack], 's-1', 'w1')).toBe(true);
  });

  it('mismo session distinto uid → false (permite firmas múltiples)', () => {
    expect(rejectDuplicateAck([ack], 's-1', 'w2')).toBe(false);
  });

  it('distinto session mismo uid → false', () => {
    expect(rejectDuplicateAck([ack], 's-2', 'w1')).toBe(false);
  });
});
