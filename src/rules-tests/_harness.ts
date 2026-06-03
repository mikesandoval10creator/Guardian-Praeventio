// SPDX-License-Identifier: MIT
//
// Shared harness for Firestore Security Rules tests (Phase 5 · F1).
//
// THE CONTRACT — fail-closed. A rules suite that silently passes (or skips)
// when the emulator is down provides ZERO security coverage. The previous
// `projectScopedStores.rules.test.ts` swallowed the connect error
// (`testEnv = null`) and every test early-returned (`if (!testEnv) return`),
// so with no emulator it reported 78 "passing" tests that asserted NOTHING
// (proven: ~280ms with no emulator vs ~10s with it). `createRulesTestEnv()`
// THROWS when the emulator is unreachable, so a missing emulator REJECTS the
// `beforeAll` hook and FAILS the suite instead of faking green. This matches
// the fail-closed intent already present in `dirtyDozen` /
// `firestore.rules.test` ("FAILED TO START EMULATOR. Tests cannot be skipped").
//
// Rules of engagement:
//   • Use `authenticatedContext` for the assertions under test — NEVER the
//     firebase-admin SDK (it bypasses security rules). `withSecurityRulesDisabled`
//     (from @firebase/rules-unit-testing) is allowed ONLY to seed preconditions,
//     never to satisfy the assertion itself.
//   • Run via `npm run test:rules`, which boots the Firestore emulator with
//     `firebase emulators:exec` (requires JDK 21).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';

/** Emulator project id shared by every rules suite. */
export const RULES_PROJECT_ID = 'praeventio-rules-test';

const RULES_PATH = resolve(__dirname, '../../firestore.rules');

/**
 * Create a Firestore rules test environment loading the real `firestore.rules`.
 *
 * THROWS if the emulator is unreachable — callers MUST NOT catch-and-skip.
 * Use it directly in `beforeAll` so a missing emulator rejects the hook and
 * fails every test in the file:
 *
 *   let testEnv: RulesTestEnvironment | null = null;
 *   beforeAll(async () => { testEnv = await createRulesTestEnv(); });
 *   afterAll(async () => { if (testEnv) await testEnv.cleanup(); });
 *   beforeEach(async () => { await requireEnv().clearFirestore(); });
 */
export async function createRulesTestEnv(): Promise<RulesTestEnvironment> {
  // Silence the noisy "WebChannel transport errored" logs emitted while the
  // client SDK probes the emulator.
  setLogLevel('silent');
  try {
    return await initializeTestEnvironment({
      projectId: RULES_PROJECT_ID,
      firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
    });
  } catch (err) {
    throw new Error(
      'Firestore emulator unreachable — rules tests cannot run without it and ' +
        'MUST NOT be skipped. Run via `npm run test:rules` (boots the emulator; ' +
        `requires JDK 21). Original error: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

/**
 * Standard verified-email custom token for `authenticatedContext`.
 * `email_verified: true` because most write rules gate on it; pass a `role`
 * for RBAC checks (`isAdmin()`, `isSupervisor()`, `isDoctor()`, …).
 */
export function verifiedToken(role: string, email = 'user@example.com') {
  return { email, email_verified: true, role };
}
