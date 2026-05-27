// Praeventio Guard — pinSignService unit tests.

import { describe, it, expect } from 'vitest';
import {
  registerPin,
  verifyPin,
  buildAcknowledgement,
  verifyAcknowledgement,
  validatePinPolicy,
  PinSignValidationError,
  MAX_CONSECUTIVE_FAILURES,
  LOCKOUT_MINUTES,
} from './pinSignService';

const TEST_SALT = 'a1b2c3d4e5f6071829fa3b4c5d6e7f80';
const TEST_SECRET = 'praeventio-test-server-secret-32b';
// Lower iteration count makes PBKDF2 fast enough for unit tests while
// preserving the validation behavior.
const FAST_ITER = 1000;

describe('pinSignService', () => {
  describe('validatePinPolicy', () => {
    it('accepts 4-6 digit PINs that are not trivial', () => {
      expect(() => validatePinPolicy('5839')).not.toThrow();
      expect(() => validatePinPolicy('92741')).not.toThrow();
      expect(() => validatePinPolicy('482917')).not.toThrow();
    });

    it('rejects format outside 4-6 digits', () => {
      expect(() => validatePinPolicy('123')).toThrow(PinSignValidationError);
      expect(() => validatePinPolicy('1234567')).toThrow(PinSignValidationError);
      expect(() => validatePinPolicy('12a4')).toThrow(PinSignValidationError);
    });

    it('rejects trivial PINs even with valid format', () => {
      for (const trivial of ['1234', '0000', '111111', '987654']) {
        expect(() => validatePinPolicy(trivial)).toThrow(/PIN_TRIVIAL/);
      }
    });
  });

  describe('registerPin', () => {
    it('stores PBKDF2 hash, never the PIN', () => {
      const cred = registerPin({
        workerUid: 'worker-1',
        pin: '4827',
        saltHex: TEST_SALT,
        iterations: FAST_ITER,
        now: new Date('2026-01-01T00:00:00Z'),
      });
      expect(cred.workerUid).toBe('worker-1');
      expect(cred.saltHex).toBe(TEST_SALT);
      expect(cred.hashHex).toHaveLength(64);
      expect(cred.hashHex).not.toContain('4827');
      expect(cred.iterations).toBe(FAST_ITER);
      expect(cred.consecutiveFailures).toBe(0);
      expect(cred.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('two different salts produce different hashes for same PIN', () => {
      const credA = registerPin({
        workerUid: 'w', pin: '4827', saltHex: TEST_SALT, iterations: FAST_ITER,
      });
      const otherSalt = 'b'.repeat(32);
      const credB = registerPin({
        workerUid: 'w', pin: '4827', saltHex: otherSalt, iterations: FAST_ITER,
      });
      expect(credA.hashHex).not.toBe(credB.hashHex);
    });

    it('rejects weak salt', () => {
      expect(() =>
        registerPin({
          workerUid: 'w', pin: '4827', saltHex: 'short',
        }),
      ).toThrow(/WEAK_SALT/);
    });
  });

  describe('verifyPin', () => {
    const cred = registerPin({
      workerUid: 'worker-1',
      pin: '4827',
      saltHex: TEST_SALT,
      iterations: FAST_ITER,
    });

    it('matches the correct PIN', () => {
      const r = verifyPin({ credential: cred, pin: '4827' });
      expect(r.ok).toBe(true);
      expect(r.credential.consecutiveFailures).toBe(0);
    });

    it('rejects the wrong PIN and increments counter', () => {
      const r = verifyPin({ credential: cred, pin: '9999' });
      expect(r.ok).toBe(false);
      expect(r.credential.consecutiveFailures).toBe(1);
      expect(r.justLockedOut).toBe(false);
    });

    it('locks out after MAX_CONSECUTIVE_FAILURES', () => {
      let current = cred;
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) {
        const r = verifyPin({ credential: current, pin: '9999' });
        current = r.credential;
      }
      const r = verifyPin({
        credential: current,
        pin: '9999',
        now: new Date('2026-01-01T00:00:00Z'),
      });
      expect(r.ok).toBe(false);
      expect(r.justLockedOut).toBe(true);
      expect(r.credential.lockedUntil).toBeTruthy();
      expect(r.remainingLockoutMinutes).toBe(LOCKOUT_MINUTES);
    });

    it('refuses even correct PIN while locked', () => {
      const locked = {
        ...cred,
        consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
        lockedUntil: '2026-01-01T01:00:00.000Z',
      };
      const r = verifyPin({
        credential: locked,
        pin: '4827',
        now: new Date('2026-01-01T00:30:00Z'),
      });
      expect(r.ok).toBe(false);
      expect(r.remainingLockoutMinutes).toBe(30);
    });

    it('lockout expires after window, accepts correct PIN again', () => {
      const locked = {
        ...cred,
        consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
        lockedUntil: '2026-01-01T00:00:00.000Z',
      };
      const r = verifyPin({
        credential: locked,
        pin: '4827',
        now: new Date('2026-01-01T00:30:00Z'),
      });
      expect(r.ok).toBe(true);
      expect(r.credential.consecutiveFailures).toBe(0);
      expect(r.credential.lockedUntil).toBeUndefined();
    });

    it('badly formatted PIN counts as a failure without revealing why', () => {
      const r = verifyPin({ credential: cred, pin: 'abcd' });
      expect(r.ok).toBe(false);
      expect(r.credential.consecutiveFailures).toBe(1);
    });
  });

  describe('buildAcknowledgement / verifyAcknowledgement', () => {
    it('round-trips with the same secret', () => {
      const ack = buildAcknowledgement(
        {
          itemId: 'permit-123',
          kind: 'permit_acknowledgement',
          projectId: 'proj-1',
          signedByUid: 'worker-1',
          now: new Date('2026-01-01T00:00:00Z'),
        },
        TEST_SECRET,
      );
      expect(ack.attestationHex).toHaveLength(64);
      expect(ack.biometricUsed).toBe(false);
      expect(verifyAcknowledgement(ack, TEST_SECRET)).toBe(true);
    });

    it('detects tampering of itemId', () => {
      const ack = buildAcknowledgement(
        {
          itemId: 'permit-123',
          kind: 'permit_acknowledgement',
          projectId: 'proj-1',
          signedByUid: 'worker-1',
        },
        TEST_SECRET,
      );
      const tampered = { ...ack, itemId: 'permit-666' };
      expect(verifyAcknowledgement(tampered, TEST_SECRET)).toBe(false);
    });

    it('refuses different server secret', () => {
      const ack = buildAcknowledgement(
        {
          itemId: 'permit-123',
          kind: 'permit_acknowledgement',
          projectId: 'proj-1',
          signedByUid: 'worker-1',
        },
        TEST_SECRET,
      );
      expect(
        verifyAcknowledgement(ack, 'wrong-secret-no-shorter-than-16'),
      ).toBe(false);
    });

    it('rejects weak server secret at build time', () => {
      expect(() =>
        buildAcknowledgement(
          {
            itemId: 'permit-123',
            kind: 'permit_acknowledgement',
            projectId: 'proj-1',
            signedByUid: 'worker-1',
          },
          'short',
        ),
      ).toThrow(/WEAK_SECRET/);
    });
  });
});
