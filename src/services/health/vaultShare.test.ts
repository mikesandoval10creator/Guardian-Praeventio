// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  createShareToken,
  consumeShareToken,
  revokeShareToken,
  verifySecret,
  validateShareAccess,
  recordIdInShareScope,
  buildAuditEntry,
  activateGrantSession,
  confirmGrantRecipient,
  createHealthAccessGrant,
  revokeHealthAccessGrant,
  validateGrantClaim,
  VaultShareError,
  DEFAULT_TTL_HOURS,
  DEFAULT_MAX_CONSUMES,
  type VaultShareToken,
} from './vaultShare';

const FIXED_NOW = 1_000_000_000_000; // 2001-09-09
const now = () => FIXED_NOW;

describe('createShareToken', () => {
  it('creates a token with default TTL 24h and 5 max consumes', () => {
    const { record, secret, qrPayload } = createShareToken({
      workerUid: 'worker-1',
      scope: 'full',
      now,
    });
    expect(record.workerUid).toBe('worker-1');
    expect(record.scope).toBe('full');
    expect(record.expiresAt - record.createdAt).toBe(DEFAULT_TTL_HOURS * 60 * 60 * 1000);
    expect(record.maxConsumes).toBe(DEFAULT_MAX_CONSUMES);
    expect(record.consumeCount).toBe(0);
    expect(record.revokedAt).toBeNull();
    expect(secret.length).toBeGreaterThan(20); // ~32 chars URL-safe
    expect(qrPayload).toMatch(/^https:\/\/praeventio\.app\/vault\/share\//);
    expect(qrPayload).toContain(secret);
  });

  it('honors custom ttl and maxConsumes', () => {
    const { record } = createShareToken({
      workerUid: 'worker-1',
      scope: 'recent',
      ttlHours: 1,
      maxConsumes: 1,
      now,
    });
    expect(record.expiresAt - record.createdAt).toBe(60 * 60 * 1000);
    expect(record.maxConsumes).toBe(1);
  });

  it('throws when scope=topic without topic field', () => {
    expect(() =>
      createShareToken({ workerUid: 'w1', scope: 'topic', now }),
    ).toThrow(VaultShareError);
  });

  it('NEVER stores raw secret — only hash + prefix', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(secret);
    expect(record.tokenPrefix).toBe(secret.slice(0, 8));
    expect(record.tokenHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('throws when workerUid missing', () => {
    expect(() =>
      createShareToken({ workerUid: '', scope: 'full', now }),
    ).toThrow(VaultShareError);
  });

  it('topic record stores the topic and recordIds', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'topic',
      topic: 'lumbalgia',
      recordIds: ['r1', 'r2'],
      now,
    });
    expect(record.topic).toBe('lumbalgia');
    expect(record.recordIds).toEqual(['r1', 'r2']);
  });
});

describe('verifySecret (constant time HMAC compare)', () => {
  it('returns true when secret matches hash', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    expect(verifySecret(secret, record.tokenHash)).toBe(true);
  });

  it('returns false when secret tampered', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    expect(verifySecret('not-the-real-secret-XXX', record.tokenHash)).toBe(false);
  });

  it('returns false on type mismatch', () => {
    expect(verifySecret('', 'abc')).toBe(false);
    expect(verifySecret('abc', '')).toBe(false);
  });

  it('returns false on length mismatch (early return, no leak)', () => {
    expect(verifySecret('short', 'a'.repeat(64))).toBe(false);
  });
});

describe('consumeShareToken', () => {
  const baseRecord = (): VaultShareToken => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    return record;
  };

  it('happy path: returns reveal=all when scope=full and increments counter', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    const result = consumeShareToken(
      record,
      secret,
      { name: 'Dr. Zapata', ipHash: 'ip-h' },
      { now: () => FIXED_NOW + 1000 },
    );
    expect(result.recordIdsToReveal).toBe('all');
    expect(result.patch.consumeCount).toBe(1);
    expect(result.patch.consumes[0].viewerName).toBe('Dr. Zapata');
    expect(result.patch.consumes[0].at).toBe(FIXED_NOW + 1000);
  });

  it('topic scope returns recordIds + topicHint', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'topic',
      topic: 'lumbalgia',
      recordIds: ['r1'],
      now,
    });
    const result = consumeShareToken(
      record,
      secret,
      { name: 'Dr. González' },
      { now },
    );
    expect(result.recordIdsToReveal).toEqual(['r1']);
    expect(result.topicHint).toBe('lumbalgia');
  });

  it('throws expired when now > expiresAt', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      ttlHours: 1,
      now,
    });
    expect(() =>
      consumeShareToken(
        record,
        secret,
        { name: 'Dr. X' },
        { now: () => FIXED_NOW + 2 * 60 * 60 * 1000 },
      ),
    ).toThrow(/expired/i);
  });

  it('throws revoked when revokedAt set', () => {
    const r = baseRecord();
    r.revokedAt = FIXED_NOW;
    const { secret } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(() =>
      consumeShareToken(r, secret, { name: 'Dr. X' }, { now }),
    ).toThrow(/revoked/i);
  });

  it('throws max_consumes_reached when limit hit', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      maxConsumes: 1,
      now,
    });
    record.consumeCount = 1;
    expect(() =>
      consumeShareToken(record, secret, { name: 'Dr. X' }, { now }),
    ).toThrow(/max consumes/i);
  });

  it('throws invalid_token when secret tampered', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    expect(() =>
      consumeShareToken(record, 'wrong-secret', { name: 'Dr. X' }, { now }),
    ).toThrow(/invalid/i);
  });

  it('error code field is properly typed', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    try {
      consumeShareToken(record, 'wrong', { name: 'Dr. X' }, { now });
    } catch (e) {
      expect(e).toBeInstanceOf(VaultShareError);
      expect((e as VaultShareError).code).toBe('invalid_token');
    }
  });
});

describe('revokeShareToken', () => {
  it('returns patch with revokedAt + revokedBy', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    const result = revokeShareToken(record, 'w1', { now: () => FIXED_NOW + 500 });
    expect(result.patch.revokedAt).toBe(FIXED_NOW + 500);
    expect(result.patch.revokedBy).toBe('w1');
  });

  it('idempotent — already revoked returns existing values', () => {
    const r: VaultShareToken = (() => {
      const { record } = createShareToken({ workerUid: 'w1', scope: 'full', now });
      return record;
    })();
    r.revokedAt = FIXED_NOW;
    r.revokedBy = 'w1';
    const result = revokeShareToken(r, 'w2', { now: () => FIXED_NOW + 1000 });
    expect(result.patch.revokedAt).toBe(FIXED_NOW);
    expect(result.patch.revokedBy).toBe('w1'); // original
  });
});

describe('buildAuditEntry', () => {
  it('emits action + safe details (no raw secret)', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'topic',
      topic: 'lumbalgia',
      recordIds: ['r1'],
      now,
    });
    const audit = buildAuditEntry('health_vault.share.created', record);
    expect(audit.action).toBe('health_vault.share.created');
    expect(audit.resourceType).toBe('health_vault');
    expect(audit.details.tokenId).toBe(record.id);
    expect(audit.details.scope).toBe('topic');
    expect(audit.details.topic).toBe('lumbalgia');
    expect(audit.details.tokenPrefix).toBe(record.tokenPrefix);
    // Safety: full secret not in audit
    const audSerialized = JSON.stringify(audit);
    expect(audSerialized).not.toContain(secret);
  });

  it('accepts extra fields for context', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      now,
    });
    const audit = buildAuditEntry('health_vault.share.consumed', record, {
      viewerName: 'Dr. Zapata',
    });
    expect(audit.details.viewerName).toBe('Dr. Zapata');
  });

  it('accepts the file_accessed action', () => {
    const { record } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    const audit = buildAuditEntry('health_vault.share.file_accessed', record, {
      recordId: 'r1',
    });
    expect(audit.action).toBe('health_vault.share.file_accessed');
    expect(audit.details.recordId).toBe('r1');
  });
});

describe('validateShareAccess (non-consuming re-check for the file proxy)', () => {
  it('passes for a fresh valid share + correct secret', () => {
    const { record, secret } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(() => validateShareAccess(record, secret, { now })).not.toThrow();
  });

  it('throws revoked when revokedAt set', () => {
    const { record, secret } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(() =>
      validateShareAccess({ ...record, revokedAt: FIXED_NOW }, secret, { now }),
    ).toThrow(/revoked/i);
  });

  it('throws expired past expiresAt', () => {
    const { record, secret } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(() =>
      validateShareAccess(record, secret, { now: () => record.expiresAt + 1 }),
    ).toThrow(/expired/i);
  });

  it('throws max_consumes_reached at the cap', () => {
    const { record, secret } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      maxConsumes: 1,
      now,
    });
    expect(() =>
      validateShareAccess({ ...record, consumeCount: 1 }, secret, { now }),
    ).toThrow(/max consumes/i);
  });

  it('throws invalid_token on wrong secret', () => {
    const { record } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(() => validateShareAccess(record, 'wrong-secret', { now })).toThrow(
      /invalid/i,
    );
  });

  it('does NOT mutate the record (no consumeCount increment)', () => {
    const { record, secret } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    validateShareAccess(record, secret, { now });
    expect(record.consumeCount).toBe(0);
  });
});

describe('recordIdInShareScope', () => {
  it('full scope without subset exposes any record', () => {
    const { record } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(recordIdInShareScope(record, 'rec_anything')).toBe(true);
  });

  it('full scope WITH explicit subset honors the subset', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'full',
      recordIds: ['rec_1'],
      now,
    });
    expect(recordIdInShareScope(record, 'rec_1')).toBe(true);
    expect(recordIdInShareScope(record, 'rec_2')).toBe(false);
  });

  it('topic scope only exposes pinned recordIds', () => {
    const { record } = createShareToken({
      workerUid: 'w1',
      scope: 'topic',
      topic: 'lumbalgia',
      recordIds: ['rec_5'],
      now,
    });
    expect(recordIdInShareScope(record, 'rec_5')).toBe(true);
    expect(recordIdInShareScope(record, 'rec_9')).toBe(false);
  });

  it('recent scope honors the day-window cutoff (parity with /view)', () => {
    const fixed = () => FIXED_NOW;
    const { record } = createShareToken({ workerUid: 'w1', scope: 'recent', now: fixed });
    const within = FIXED_NOW - 10 * 24 * 60 * 60 * 1000; // 10 days old
    const outside = FIXED_NOW - 200 * 24 * 60 * 60 * 1000; // 200 days old
    expect(
      recordIdInShareScope(record, 'rec_recent', {
        recordUploadedAt: within,
        recentDaysBack: 90,
        now: fixed,
      }),
    ).toBe(true);
    expect(
      recordIdInShareScope(record, 'rec_old', {
        recordUploadedAt: outside,
        recentDaysBack: 90,
        now: fixed,
      }),
    ).toBe(false);
  });

  it('rejects empty/non-string recordId', () => {
    const { record } = createShareToken({ workerUid: 'w1', scope: 'full', now });
    expect(recordIdInShareScope(record, '')).toBe(false);
  });
});

describe('HealthAccessGrant v2', () => {
  const createGrant = (overrides: Partial<Parameters<typeof createHealthAccessGrant>[0]> = {}) =>
    createHealthAccessGrant({
      ownerUid: 'patient-1',
      scope: 'full',
      resourceIds: ['record-1', 'record-2'],
      recipientProfessionalUid: 'doctor-external-1',
      purpose: 'continuity_of_care',
      consentTextVersion: 'health-vault-v2-es-CL-1',
      consentText: 'Autorizo a la profesional seleccionada a consultar dos registros.',
      now,
      ...overrides,
    });

  it('freezes explicit resources and puts the raw secret only in the URL fragment', () => {
    const { record, secret, qrPayload } = createGrant();

    expect(record.version).toBe(2);
    expect(record.ownerUid).toBe('patient-1');
    expect(record.resourceIds).toEqual(['record-1', 'record-2']);
    expect(record.recipientProfessionalUid).toBe('doctor-external-1');
    expect(record.status).toBe('active');
    expect(record.consentTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(qrPayload).toBe(`https://praeventio.app/vault/share/${record.id}#${secret}`);
    expect(qrPayload.split('#')[0]).not.toContain(secret);
    expect(JSON.stringify(record)).not.toContain(secret);
  });

  it.each([
    { label: 'empty', resourceIds: [] },
    { label: 'duplicated', resourceIds: ['record-1', 'record-1'] },
  ])(
    'rejects an $label resource snapshot',
    ({ resourceIds }) => {
      expect(() => createGrant({ resourceIds })).toThrowError(VaultShareError);
    },
  );

  it('does not allow another verified professional to consume a bound grant', () => {
    const { record, secret } = createGrant();

    expect(() =>
      validateGrantClaim(record, secret, {
        uid: 'doctor-different-2',
        status: 'verified',
        webauthnRequired: true,
      }, { now }),
    ).toThrowError(expect.objectContaining({ code: 'recipient_mismatch' }));
  });

  it.each(['pending', 'suspended', 'revoked'] as const)(
    'rejects a professional whose verification status is %s',
    (status) => {
      const { record, secret } = createGrant();
      expect(() =>
        validateGrantClaim(record, secret, {
          uid: 'doctor-external-1',
          status,
          webauthnRequired: true,
        }, { now }),
      ).toThrowError(expect.objectContaining({ code: 'professional_not_eligible' }));
    },
  );

  it('open invitation requires owner confirmation before it becomes active', () => {
    const { record } = createGrant({ recipientProfessionalUid: undefined });
    expect(record.status).toBe('pending');

    expect(() =>
      confirmGrantRecipient(record, 'company-admin-1', 'doctor-external-1', { now }),
    ).toThrowError(expect.objectContaining({ code: 'owner_required' }));

    const confirmed = confirmGrantRecipient(record, 'patient-1', 'doctor-external-1', {
      now,
    });
    expect(confirmed.status).toBe('active');
    expect(confirmed.recipientProfessionalUid).toBe('doctor-external-1');
  });

  it('counts clinical sessions and stops at the explicit cap', () => {
    const { record } = createGrant({ maxSessions: 1 });
    const activated = activateGrantSession(record, 'doctor-external-1', 'credential-hash', {
      now,
    });
    expect(activated.sessionCount).toBe(1);
    expect(activated.sessions[0]).toEqual({
      at: FIXED_NOW,
      professionalUid: 'doctor-external-1',
      credentialIdHash: 'credential-hash',
    });
    expect(() =>
      activateGrantSession(activated, 'doctor-external-1', 'credential-hash', { now }),
    ).toThrowError(expect.objectContaining({ code: 'max_sessions_reached' }));
  });

  it('revocation is owner-only and blocks the next claim', () => {
    const { record, secret } = createGrant();
    expect(() => revokeHealthAccessGrant(record, 'company-admin-1', { now })).toThrowError(
      expect.objectContaining({ code: 'owner_required' }),
    );
    const revoked = revokeHealthAccessGrant(record, 'patient-1', { now });
    expect(revoked.status).toBe('revoked');
    expect(() =>
      validateGrantClaim(revoked, secret, {
        uid: 'doctor-external-1',
        status: 'provisional',
        webauthnRequired: true,
      }, { now }),
    ).toThrowError(expect.objectContaining({ code: 'revoked' }));
  });
});
