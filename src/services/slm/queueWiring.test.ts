/**
 * [P1][privacidad] Regression guard for the offline-queue wiring.
 *
 * The public SLM barrel (`index.ts`) MUST re-export the ENCRYPTED queue, not
 * the legacy plaintext `offlineQueue`. A worker's prompt (an emergency query
 * or a medical description) would otherwise land in IndexedDB as plaintext.
 * This pins the exact regression the wiring task guards against: reverting the
 * barrel back to `./offlineQueue` flips these identities and fails the gate.
 *
 * Reference-identity checks only — no crypto/IDB harness needed. If the barrel
 * and the encrypted module export the same function object, the barrel is
 * wired to the encrypted queue.
 */

import { describe, it, expect } from 'vitest';

import * as barrel from './index';
import * as encrypted from './encryptedOfflineQueue';
import * as plaintext from './offlineQueue';

describe('SLM offline-queue wiring (privacy)', () => {
  it('barrel enqueueSession/listPending come from the ENCRYPTED queue', () => {
    expect(barrel.enqueueSession).toBe(encrypted.enqueueSession);
    expect(barrel.listPending).toBe(encrypted.listPending);
    expect(barrel.markReconciled).toBe(encrypted.markReconciled);
    expect(barrel.clearReconciled).toBe(encrypted.clearReconciled);
  });

  it('barrel does NOT re-export the legacy plaintext queue', () => {
    // Distinct module instances → distinct function objects. If these ever
    // match, the barrel regressed to the plaintext queue.
    expect(barrel.enqueueSession).not.toBe(plaintext.enqueueSession);
    expect(barrel.listPending).not.toBe(plaintext.listPending);
  });
});
