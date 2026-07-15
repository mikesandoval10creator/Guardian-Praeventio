import { describe, expect, it } from 'vitest';
import {
  canonicalizeComplianceSigningIntent,
  createComplianceSigningIntent,
  deriveComplianceSigningChallenge,
  matchesComplianceSigningContext,
  type ComplianceSigningContext,
  type ComplianceSigningIntentV1,
} from './complianceSigningIntent.js';

const HASH = 'ab'.repeat(32);

const INTENT: ComplianceSigningIntentV1 = {
  version: 1,
  purpose: 'compliance-document-sign',
  tenantId: 'tenant-1',
  formId: 'form-1',
  documentKind: 'suseso',
  action: 'sign',
  payloadHashHex: HASH,
  signerUid: 'user-1',
  signerRut: '12.345.678-5',
  issuedAtMs: 1_700_000_000_000,
  expiresAtMs: 1_700_000_300_000,
  nonceB64u: 'AQIDBA',
};

describe('canonicalizeComplianceSigningIntent', () => {
  it('uses the versioned exact key order', () => {
    expect(canonicalizeComplianceSigningIntent(INTENT)).toBe(
      '{"version":1,"purpose":"compliance-document-sign","tenantId":"tenant-1","formId":"form-1","documentKind":"suseso","action":"sign","payloadHashHex":"' +
        HASH +
        '","signerUid":"user-1","signerRut":"12.345.678-5","issuedAtMs":1700000000000,"expiresAtMs":1700000300000,"nonceB64u":"AQIDBA"}',
    );
  });

  it('normalizes an uppercase SHA-256 digest to lowercase', () => {
    expect(
      canonicalizeComplianceSigningIntent({ ...INTENT, payloadHashHex: HASH.toUpperCase() }),
    ).toContain(`"payloadHashHex":"${HASH}"`);
  });

  it.each([
    ['empty tenant', { tenantId: '' }],
    ['empty form', { formId: '   ' }],
    ['unsupported kind', { documentKind: 'other' }],
    ['short hash', { payloadHashHex: 'ab12' }],
    ['non-hex hash', { payloadHashHex: 'z'.repeat(64) }],
    ['invalid lifetime', { expiresAtMs: INTENT.issuedAtMs }],
    ['empty nonce', { nonceB64u: '' }],
  ] as const)('rejects %s', (_label, patch) => {
    expect(() =>
      canonicalizeComplianceSigningIntent({ ...INTENT, ...patch } as ComplianceSigningIntentV1),
    ).toThrow();
  });
});

describe('deriveComplianceSigningChallenge', () => {
  it('is deterministic and returns exactly 32 SHA-256 bytes', () => {
    const first = deriveComplianceSigningChallenge(INTENT);
    const second = deriveComplianceSigningChallenge({ ...INTENT });

    expect(first).toHaveLength(32);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it.each([
    ['tenantId', 'tenant-2'],
    ['formId', 'form-2'],
    ['documentKind', 'ds67'],
    ['payloadHashHex', 'cd'.repeat(32)],
    ['signerUid', 'user-2'],
    ['signerRut', '9.999.999-9'],
    ['expiresAtMs', INTENT.expiresAtMs + 1],
    ['nonceB64u', 'BQYHCA'],
  ] as const)('changes when %s changes', (field, value) => {
    const changed = { ...INTENT, [field]: value } as ComplianceSigningIntentV1;
    expect(Buffer.from(deriveComplianceSigningChallenge(changed))).not.toEqual(
      Buffer.from(deriveComplianceSigningChallenge(INTENT)),
    );
  });
});

describe('createComplianceSigningIntent', () => {
  it('uses the injected server clock and nonce and derives the challenge', () => {
    const context: ComplianceSigningContext = {
      tenantId: 'tenant-1',
      formId: 'form-1',
      documentKind: 'ds76',
      payloadHashHex: HASH.toUpperCase(),
      signerUid: 'user-1',
      signerRut: '12.345.678-5',
    };

    const created = createComplianceSigningIntent(context, {
      now: () => 10_000,
      randomBytes: () => new Uint8Array([1, 2, 3, 4]),
      ttlMs: 60_000,
    });

    expect(created.intent).toEqual({
      version: 1,
      purpose: 'compliance-document-sign',
      ...context,
      payloadHashHex: HASH,
      action: 'sign',
      issuedAtMs: 10_000,
      expiresAtMs: 70_000,
      nonceB64u: 'AQIDBA',
    });
    expect(Buffer.from(created.challenge)).toEqual(
      Buffer.from(deriveComplianceSigningChallenge(created.intent)),
    );
  });

  it('rejects non-positive or unsafe TTL values', () => {
    const context: ComplianceSigningContext = {
      tenantId: 'tenant-1',
      formId: 'form-1',
      documentKind: 'suseso',
      payloadHashHex: HASH,
      signerUid: 'user-1',
      signerRut: '12.345.678-5',
    };

    expect(() => createComplianceSigningIntent(context, { ttlMs: 0 })).toThrow();
    expect(() => createComplianceSigningIntent(context, { ttlMs: Number.MAX_VALUE })).toThrow();
  });
});

describe('matchesComplianceSigningContext', () => {
  const context: ComplianceSigningContext = {
    tenantId: INTENT.tenantId,
    formId: INTENT.formId,
    documentKind: INTENT.documentKind,
    payloadHashHex: INTENT.payloadHashHex,
    signerUid: INTENT.signerUid,
    signerRut: INTENT.signerRut,
  };

  it('matches the exact authoritative context', () => {
    expect(matchesComplianceSigningContext(INTENT, context)).toBe(true);
  });

  it.each([
    ['tenantId', 'tenant-x'],
    ['formId', 'form-x'],
    ['documentKind', 'ds67'],
    ['payloadHashHex', 'ef'.repeat(32)],
    ['signerUid', 'user-x'],
    ['signerRut', '1-9'],
  ] as const)('rejects a mismatched %s', (field, value) => {
    expect(matchesComplianceSigningContext(INTENT, { ...context, [field]: value })).toBe(false);
  });
});
