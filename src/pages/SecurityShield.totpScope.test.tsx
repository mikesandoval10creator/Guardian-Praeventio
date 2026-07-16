// @vitest-environment jsdom
//
// Two users on one shared device (a faena kiosk, a borrowed phone) must never
// see each other's MFA enrollment. Regression test for the fixed storage key
// `mfa:totp:record:v1`: it was not scoped to a uid, and the mount effect that
// read it had `[]` deps — so whoever logged in second saw the first user's
// TOTP as active, recovery codes included.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { TotpEnrolledRecord } from '../services/auth/totpEnrollment';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

vi.mock('qrcode.react', () => ({
  QRCodeCanvas: () => React.createElement('div', { 'data-testid': 'qr' }),
}));

// In-memory stand-in for the KEK-encrypted IndexedDB store. The KEYS are what
// this suite is about; values are opaque to the assertions.
const kv = new Map<string, unknown>();
vi.mock('../services/security/encryptedKvStore', () => ({
  getEncrypted: vi.fn(async (k: string) => (kv.has(k) ? kv.get(k) : null)),
  setEncrypted: vi.fn(async (k: string, v: unknown) => {
    kv.set(k, v);
  }),
  deleteEncrypted: vi.fn(async (k: string) => {
    kv.delete(k);
  }),
}));

let userRef: { uid: string; email: string } | null = null;
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: userRef }),
}));

import { SecurityShield } from './SecurityShield';

const LEGACY_KEY = 'mfa:totp:record:v1';

/** Shaped like a real enrolled TOTP (totpEnrollment.ts:56-71), owned by `userUid`. */
function enrolledRecord(userUid: string): TotpEnrolledRecord {
  return {
    status: 'enrolled',
    // RFC 4648 test vector, not a live secret.
    secretBase32Plaintext: 'JBSWY3DPEHPK3PXP',
    recoveryCodeHashes: ['a'.repeat(64)],
    consumedRecoveryHashes: [],
    enrolledAtIso: '2026-07-16T00:00:00.000Z',
    userUid,
  };
}

const ALICE = { uid: 'uid-alice', email: 'alice@faena.cl' };
const BOB = { uid: 'uid-bob', email: 'bob@faena.cl' };

/** The enrolled view is the one that reveals recovery codes + the disable button. */
async function expectNotEnrolled() {
  await waitFor(() =>
    expect(screen.getByTestId('mfa-start-enrollment')).toBeInTheDocument(),
  );
  expect(screen.queryByTestId('mfa-disable')).toBeNull();
  expect(screen.getByTestId('mfa-status-badge')).toHaveTextContent(/Inactiva/i);
}

describe('SecurityShield — TOTP enrollment is scoped per user', () => {
  beforeEach(() => {
    kv.clear();
    userRef = ALICE;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('el dueño ve su propio enrolamiento', async () => {
    kv.set(`${LEGACY_KEY}:${ALICE.uid}`, enrolledRecord(ALICE.uid));

    render(<SecurityShield />);

    await waitFor(() =>
      expect(screen.getByTestId('mfa-disable')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('mfa-status-badge')).toHaveTextContent(/Activa/i);
  });

  it('otro usuario en el mismo dispositivo NO ve el TOTP ajeno', async () => {
    kv.set(`${LEGACY_KEY}:${ALICE.uid}`, enrolledRecord(ALICE.uid));

    userRef = BOB;
    render(<SecurityShield />);

    await expectNotEnrolled();
  });

  it('un record legacy sin scope no se le atribuye a nadie y se purga', async () => {
    // Pre-fix records sit under the unscoped key and belong to whoever enrolled
    // last. They must never be adopted by the user who happens to mount next.
    kv.set(LEGACY_KEY, enrolledRecord(ALICE.uid));

    userRef = BOB;
    render(<SecurityShield />);

    await expectNotEnrolled();
    await waitFor(() => expect(kv.has(LEGACY_KEY)).toBe(false));
  });

  it('un record cuyo userUid no coincide se rechaza aunque esté bajo la clave correcta', async () => {
    // Defense in depth: the embedded userUid is the authority, not the key.
    kv.set(`${LEGACY_KEY}:${BOB.uid}`, enrolledRecord(ALICE.uid));

    userRef = BOB;
    render(<SecurityShield />);

    await expectNotEnrolled();
  });

  it('sin sesión no se lee ningún record', async () => {
    kv.set(`${LEGACY_KEY}:${ALICE.uid}`, enrolledRecord(ALICE.uid));

    userRef = null;
    render(<SecurityShield />);

    await expectNotEnrolled();
  });
});
