import { describe, expect, it, vi } from 'vitest';
import {
  attachComplianceSignatureAtomically,
  persistComplianceDigestAtomically,
} from './firestoreComplianceDocument.js';

function transactionHarness(initial: Record<string, unknown> | null) {
  let current = initial;
  const update = vi.fn((_ref: unknown, patch: Record<string, unknown>) => {
    current = { ...current, ...patch };
  });
  const firestore = {
    runTransaction: async <T>(fn: (tx: {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      update: typeof update;
    }) => Promise<T>) => fn({
      get: async () => ({ exists: current !== null, data: () => current ?? undefined }),
      update,
    }),
  };
  return { firestore, ref: {}, update, current: () => current };
}

describe('attachComplianceSignatureAtomically', () => {
  it('writes the signature in the same transaction that checks unsigned state', async () => {
    const h = transactionHarness({ id: 'form-1' });
    const signature = { signatureB64: 'verified' };

    const result = await attachComplianceSignatureAtomically(
      h.firestore as never,
      h.ref as never,
      signature,
    );

    expect(h.update).toHaveBeenCalledWith(h.ref, { signature });
    expect(result).toEqual({ id: 'form-1', signature });
  });

  it.each([
    ['not_found', null],
    ['already_signed', { id: 'form-1', signature: { signatureB64: 'first' } }],
  ])('fails closed with %s', async (code, initial) => {
    const h = transactionHarness(initial);
    await expect(attachComplianceSignatureAtomically(
      h.firestore as never,
      h.ref as never,
      { signatureB64: 'second' },
    )).rejects.toMatchObject({ code });
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('persistComplianceDigestAtomically', () => {
  it('backfills only the digest fields on an unsigned legacy form', async () => {
    const h = transactionHarness({ id: 'form-1', workerRut: '12.345.678-5' });
    await persistComplianceDigestAtomically(
      h.firestore as never,
      h.ref as never,
      'ab'.repeat(32),
      1,
    );
    expect(h.update).toHaveBeenCalledWith(h.ref, {
      payloadHashHex: 'ab'.repeat(32),
      payloadRendererVersion: 1,
    });
    expect(h.current()).toMatchObject({ workerRut: '12.345.678-5' });
  });

  it('is idempotent when the authoritative digest already matches', async () => {
    const h = transactionHarness({
      payloadHashHex: 'ab'.repeat(32),
      payloadRendererVersion: 1,
    });
    await persistComplianceDigestAtomically(
      h.firestore as never,
      h.ref as never,
      'ab'.repeat(32),
      1,
    );
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', null],
    ['already_signed', { signature: { signatureB64: 'first' } }],
    ['payload_hash_mismatch', { payloadHashHex: 'cd'.repeat(32), payloadRendererVersion: 1 }],
    ['payload_hash_mismatch', { payloadHashHex: 'ab'.repeat(32), payloadRendererVersion: 2 }],
  ])('fails closed with %s', async (code, initial) => {
    const h = transactionHarness(initial);
    await expect(persistComplianceDigestAtomically(
      h.firestore as never,
      h.ref as never,
      'ab'.repeat(32),
      1,
    )).rejects.toMatchObject({ code });
    expect(h.update).not.toHaveBeenCalled();
  });
});
