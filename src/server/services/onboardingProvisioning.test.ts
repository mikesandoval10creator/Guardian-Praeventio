// SPDX-License-Identifier: MIT
// Pure unit tests for provisioning. The firestore-backed variant lives in
// onboardingProvisioning.firestore.test.ts and runs only against the
// emulator. Stryker coverage of provisioning depends on THIS file because
// vitest.stryker.config.ts excludes *.firestore.test.ts.
import { createHash } from 'node:crypto';
import admin from 'firebase-admin';
import { describe, expect, it, vi } from 'vitest';
vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: { serverTimestamp: () => '<ts>', delete: () => '<del>' },
    },
  },
}));
const _admin: any = admin;
import {
  OnboardingConflict,
  provisionOnboarding,
  type OnboardingPayload,
} from './onboardingProvisioning';

interface TxRef { __tx: true; path: string; type: 'doc' | 'col' }
interface FakeRefShape { __tx: true; path: string; id: string; type: 'doc' | 'col' }
interface FakeSetOp { ref: TxRef; data: unknown }
class FakeTransaction {
  __ops: FakeSetOp[] = [];
  __gets: Array<{ ref: TxRef; snap: { exists: boolean; data: () => Record<string, unknown> | undefined } }>;
  constructor(gets: Array<{ ref: TxRef; snap: { exists: boolean; data: () => Record<string, unknown> | undefined } }>) {
    this.__gets = [...gets];
  }
  set(ref: TxRef, data: unknown): FakeTransaction {
    this.__ops.push({ ref, data });
    return this;
  }
  create(ref: TxRef, data: unknown): FakeTransaction {
    this.__ops.push({ ref, data });
    return this;
  }
  update(ref: TxRef, data: unknown): FakeTransaction {
    this.__ops.push({ ref, data });
    return this;
  }
  async get(ref: TxRef) {
    const hit = this.__gets.shift();
    if (!hit || hit.ref.path !== ref.path) throw new Error(`unexpected get(${ref.path})`);
    return hit.snap;
  }
}
interface FakeCol { doc(id?: string): FakeRef; }
type FakeRef = FakeRefShape & { collection(name: string): FakeCol };
function makeRef(path: string, id: string): FakeRef {
  return { __tx: true, path, id, type: 'doc', collection(name: string): FakeCol {
    return { doc(id?: string): FakeRef { return makeRef(id ? `${path}/${name}/${id}` : `${path}/${name}/<auto>`, id ?? `<${name}-id>`); } };
  } };
}
function makeDb(gets: Array<{ ref: TxRef; snap: { exists: boolean; data: () => Record<string, unknown> | undefined } }>) {
  const tx = new FakeTransaction(gets);
  const db = {
    runTransaction: vi.fn(async (fn: (t: FakeTransaction) => Promise<unknown>) => fn(tx)),
    collection(name: string): FakeCol {
      return { doc(id?: string): FakeRef { return makeRef(id ? `${name}/${id}` : `${name}/<auto>`, id ?? 'auto-id'); } };
    },
  };
  return { db, tx };
}

const basePayload: OnboardingPayload = {
  industry: 'mining', countries: ['CL'], tier: 'gratis',
  inviteEmails: ['a@x.cl'], projectName: 'Faena Test',
  workersCsv: null, siiCode: null, sectorId: null, estimatedWorkers: null,
};

function receiptPathFor(uid: string): string {
  const ownerHash = createHash('sha256').update(uid).digest('hex');
  return `system_idempotency_cache/onboarding-${ownerHash}`;
}

describe('provisionOnboarding (pure unit)', () => {
  it('commits project, root mirror, invitations, user config and returns result', async () => {
    const userRef: TxRef = { __tx: true, path: 'users/u1', type: 'doc' };
    const receiptRef: TxRef = { __tx: true, path: receiptPathFor('u1'), type: 'doc' };
    const { db, tx } = makeDb([
      { ref: receiptRef, snap: { exists: false, data: () => undefined } },
      { ref: userRef, snap: { exists: true, data: () => ({ role: 'operario' }) } },
    ]);
    const result = await provisionOnboarding(db as any, 'u1', basePayload);
    expect(result.replayed).toBe(false);
    expect(result.promoted).toBe(true);
    expect(result.invitations).toHaveLength(1);
    expect(result.result.success).toBe(true);
    expect(result.result.projectId).toBeTruthy();
    expect(result.result.invitedEmails).toEqual(['a@x.cl']);
    const writePaths = tx.__ops.map((o) => o.ref.path);
    expect(writePaths.some((p) => p.startsWith('tenants/u1/projects/'))).toBe(true);
    expect(writePaths).toContain(`projects/${result.result.projectId}`);
    expect(writePaths.some((p) => p.startsWith('invitations/'))).toBe(true);
    const receiptOp = tx.__ops.find((o) => o.ref.path.startsWith('system_idempotency_cache/onboarding-'));
    expect(receiptOp).toBeDefined();
    expect((receiptOp!.data as any).fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((receiptOp!.data as any).state).toBe('completed');
  });

  it('returns the existing receipt on replay and does NOT write again', async () => {
    const userRef: TxRef = { __tx: true, path: 'users/u1', type: 'doc' };
    const receiptRef: TxRef = { __tx: true, path: receiptPathFor('u1'), type: 'doc' };
    const savedResult = { success: true as const, projectId: 'pid', invitedEmails: ['a@x.cl'],
      invitationFailures: [], pendingPayment: false, seededRisks: 0, seededObligations: 0 };
    const fingerprint = createHash('sha256').update(JSON.stringify(basePayload)).digest('hex');
    const { db, tx } = makeDb([
      { ref: receiptRef, snap: { exists: true, data: () => ({ state: 'completed', fingerprint, result: savedResult }) } },
      { ref: userRef, snap: { exists: true, data: () => ({}) } },
    ]);
    const result = await provisionOnboarding(db as any, 'u1', basePayload);
    expect(result.replayed).toBe(true);
    expect(result.result.projectId).toBe('pid');
    expect(tx.__ops).toHaveLength(0);
  });

  it('rejects payload-conflict replay when fingerprint changes', async () => {
    const userRef: TxRef = { __tx: true, path: 'users/u1', type: 'doc' };
    const receiptRef: TxRef = { __tx: true, path: receiptPathFor('u1'), type: 'doc' };
    const savedResult = { success: true as const, projectId: 'pid', invitedEmails: [],
      invitationFailures: [], pendingPayment: false, seededRisks: 0, seededObligations: 0 };
    const { db } = makeDb([
      { ref: receiptRef, snap: { exists: true, data: () => ({ state: 'completed', fingerprint: 'a'.repeat(64), result: savedResult }) } },
      { ref: userRef, snap: { exists: true, data: () => ({}) } },
    ]);
    await expect(provisionOnboarding(db as any, 'u1', basePayload))
      .rejects.toBeInstanceOf(OnboardingConflict);
  });

  it('refuses to overwrite a user that is already onboarded', async () => {
    const userRef: TxRef = { __tx: true, path: 'users/u1', type: 'doc' };
    const receiptRef: TxRef = { __tx: true, path: receiptPathFor('u1'), type: 'doc' };
    const { db } = makeDb([
      { ref: receiptRef, snap: { exists: false, data: () => undefined } },
      { ref: userRef, snap: { exists: true, data: () => ({ onboarded: true }) } },
    ]);
    await expect(provisionOnboarding(db as any, 'u1', basePayload))
      .rejects.toThrow(/onboarding_already_completed/);
  });
});
