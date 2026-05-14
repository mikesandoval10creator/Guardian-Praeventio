import { describe, it, expect } from 'vitest';
import {
  startEnrollment,
  confirmEnrollment,
  verifyEnrolledCode,
  useRecoveryCode,
  countAvailableRecoveryCodes,
  disableEnrollment,
  TotpEnrollmentError,
} from './totpEnrollment.js';
import { base32Decode, totp } from './totp.js';

describe('startEnrollment', () => {
  it('genera draft con secret + URI + 10 recovery codes', () => {
    const draft = startEnrollment({
      userUid: 'user-1',
      accountName: 'juan@empresa.cl',
    });
    expect(draft.status).toBe('pending-verification');
    expect(draft.secretBase32).toHaveLength(32);
    expect(draft.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
    expect(draft.recoveryCodesPlaintext).toHaveLength(10);
    expect(draft.recoveryCodeHashes).toHaveLength(10);
  });

  it('expiresAtIso = now + 10min', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({
      userUid: 'u',
      accountName: 'a@b.cl',
      now,
    });
    expect(draft.expiresAtIso).toBe('2026-05-14T10:10:00.000Z');
  });
});

describe('confirmEnrollment', () => {
  it('código correcto: enrollment completo', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    // Generar el código que el authenticator app produciría
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(record.status).toBe('enrolled');
    expect(record.secretBase32Plaintext).toBe(draft.secretBase32);
    expect(record.recoveryCodeHashes).toEqual(draft.recoveryCodeHashes);
    expect(record.consumedRecoveryHashes).toEqual([]);
  });

  it('código incorrecto: throws INVALID_CODE', () => {
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl' });
    expect(() =>
      confirmEnrollment({ draft, userCode: '000000' }),
    ).toThrow(TotpEnrollmentError);
  });

  it('draft expirado: throws DRAFT_EXPIRED', () => {
    const start = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now: start });
    const tooLate = new Date('2026-05-14T11:00:00Z'); // 1h después
    expect(() =>
      confirmEnrollment({ draft, userCode: '123456', now: tooLate }),
    ).toThrow(/DRAFT_EXPIRED/);
  });

  it('código de 30s atrás (clock drift): aceptado', () => {
    const now = new Date('2026-05-14T10:00:30Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    // Code del step anterior
    const prevCode = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000) - 30,
    });
    const record = confirmEnrollment({ draft, userCode: prevCode, now });
    expect(record.status).toBe('enrolled');
  });
});

describe('verifyEnrolledCode', () => {
  it('código actual: true', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(
      verifyEnrolledCode({ record, userCode: code, now }),
    ).toBe(true);
  });

  it('código incorrecto: false', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(verifyEnrolledCode({ record, userCode: '000000', now })).toBe(false);
  });
});

describe('useRecoveryCode', () => {
  it('código válido sin consumir: ok + marca consumido', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    const result = useRecoveryCode(record, draft.recoveryCodesPlaintext[0]!);
    expect(result.ok).toBe(true);
    expect(result.updatedRecord!.consumedRecoveryHashes).toHaveLength(1);
  });

  it('mismo código dos veces: segundo intento falla (single-use)', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    let record = confirmEnrollment({ draft, userCode: code, now });
    const first = useRecoveryCode(record, draft.recoveryCodesPlaintext[0]!);
    record = first.updatedRecord!;
    const second = useRecoveryCode(record, draft.recoveryCodesPlaintext[0]!);
    expect(second.ok).toBe(false);
  });

  it('código que no pertenece: false', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(useRecoveryCode(record, 'FAKE-CODE').ok).toBe(false);
  });

  it('case-insensitive + ignora dashes', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    const original = draft.recoveryCodesPlaintext[0]!; // formato XXXX-XXXX
    const variant = original.toLowerCase().replace('-', '');
    expect(useRecoveryCode(record, variant).ok).toBe(true);
  });
});

describe('countAvailableRecoveryCodes', () => {
  it('inicial: 10', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(countAvailableRecoveryCodes(record)).toBe(10);
  });

  it('tras consumir 3: 7', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    let record = confirmEnrollment({ draft, userCode: code, now });
    for (let i = 0; i < 3; i++) {
      const r = useRecoveryCode(record, draft.recoveryCodesPlaintext[i]!);
      record = r.updatedRecord!;
    }
    expect(countAvailableRecoveryCodes(record)).toBe(7);
  });
});

describe('disableEnrollment', () => {
  it('código válido: ok', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(disableEnrollment({ record, userCode: code, now })).toBe(true);
  });

  it('código inválido: false (NO se desactiva sin segundo factor)', () => {
    const now = new Date('2026-05-14T10:00:00Z');
    const draft = startEnrollment({ userUid: 'u', accountName: 'a@b.cl', now });
    const code = totp(base32Decode(draft.secretBase32), {
      nowSec: Math.floor(now.getTime() / 1000),
    });
    const record = confirmEnrollment({ draft, userCode: code, now });
    expect(disableEnrollment({ record, userCode: '000000', now })).toBe(false);
  });
});
