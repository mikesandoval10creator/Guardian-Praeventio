/**
 * Smoke: QR signature end-to-end (build → encode → verify).
 *
 * Sprint 50 E.14 P1 H10 — closes ticket
 * 39aaa66d-73fe-8152-a481-f9896815828a ("Firma por QR no garantizada en
 * produccion"). The ticket noted that the QR signature endpoints would
 * return 500 if QR_SIG_SECRET is absent or <16 chars, but no smoke test
 * actually exercised the round-trip. This smoke proves the happy path
 * works against a real HMAC key, catching future regressions where the
 * secret wiring or the @noble/hashes API drift.
 *
 * If this smoke regresses, the production deployment is silently broken
 * (workers can't sign EPP delivery, safety talks, or permit acknowledgements).
 */

import { describe, expect, it } from 'vitest';

import {
  buildChallenge,
  verifyChallenge,
  encodeForQr,
  decodeFromQr,
  DEFAULT_TTL_MINUTES,
  SCHEMA_VERSION,
  type BuildChallengeInput,
} from '../services/qrSignature/qrSignatureService';

describe('smoke: QR signature end-to-end', () => {
  // 64 hex chars = 32 bytes = HMAC-SHA256 key with the same strength
  // as SESSION_SECRET / IOT_WEBHOOK_SECRET (the validate-env.cjs
  // minLength: 32 convention).
  const SECRET = 'a'.repeat(64);

  const sampleInput: BuildChallengeInput = {
    challengeId: 'smoke-challenge-001',
    itemId: 'epp-2026-001',
    kind: 'epp_delivery',
    projectId: 'proj-001',
    initiatedByUid: 'supervisor-uid',
    nonceHex: 'b'.repeat(32),
    ttlMinutes: DEFAULT_TTL_MINUTES,
  };

  it('buildChallenge produces a valid payload (SCHEMA_VERSION + signatureHex)', () => {
    const challenge = buildChallenge(sampleInput, SECRET);
    expect(challenge.schemaVersion).toBe(SCHEMA_VERSION);
    expect(challenge.challengeId).toBe('smoke-challenge-001');
    expect(challenge.itemId).toBe('epp-2026-001');
    expect(challenge.kind).toBe('epp_delivery');
    expect(challenge.projectId).toBe('proj-001');
    // HMAC-SHA256 hex digest is 64 chars.
    expect(challenge.signatureHex).toMatch(/^[0-9a-f]{64}$/);
    // expiresAt is ISO-8601 in the future.
    expect(new Date(challenge.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('encodeForQr → decodeFromQr round-trip preserves the challenge', () => {
    const challenge = buildChallenge(sampleInput, SECRET);
    const encoded = encodeForQr(challenge);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = decodeFromQr(encoded);
    expect(decoded.challengeId).toBe(challenge.challengeId);
    expect(decoded.signatureHex).toBe(challenge.signatureHex);
    expect(decoded.kind).toBe(challenge.kind);
  });

  it('verifyChallenge accepts a fresh challenge built with the same secret', () => {
    const challenge = buildChallenge(sampleInput, SECRET);
    // No drift in `now` between build and verify → within TTL.
    const result = verifyChallenge({ challenge, serverSecret: SECRET });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('verifyChallenge rejects a tampered signature', () => {
    const challenge = buildChallenge(sampleInput, SECRET);
    const tampered = {
      ...challenge,
      signatureHex: challenge.signatureHex.replace(/.$/, (c: string) => (c === '0' ? '1' : '0')),
    };
    const result = verifyChallenge({ challenge: tampered, serverSecret: SECRET });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('verifyChallenge rejects when the secret differs from the build secret', () => {
    const challenge = buildChallenge(sampleInput, SECRET);
    const otherSecret = 'z'.repeat(64);
    const result = verifyChallenge({ challenge, serverSecret: otherSecret });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });
});
