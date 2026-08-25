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

  // [P0][COMPLIANCE] Hy3-audit 3c4aa66d-73fe-81a4-9e21-cc1114a14b24
  // (verificado 2026-08-24): el guard exige que signature.payloadHashHex
  // coincida con el del documento, fail-closed si difieren.
  it('rechaza firma con payloadHashHex distinto al del documento (fail-closed)', async () => {
    const h = transactionHarness({
      id: 'form-1',
      payloadHashHex: 'aa'.repeat(32),
    });
    await expect(attachComplianceSignatureAtomically(
      h.firestore as never,
      h.ref as never,
      { signatureB64: 'verified', payloadHashHex: 'bb'.repeat(32) },
    )).rejects.toMatchObject({ code: 'payload_hash_mismatch' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('acepta firma con payloadHashHex que coincide con el del documento', async () => {
    const h = transactionHarness({
      id: 'form-1',
      payloadHashHex: 'aa'.repeat(32),
    });
    const signature = { signatureB64: 'verified', payloadHashHex: 'aa'.repeat(32) };
    await attachComplianceSignatureAtomically(
      h.firestore as never,
      h.ref as never,
      signature,
    );
    expect(h.update).toHaveBeenCalledWith(h.ref, { signature });
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

  // [P0][COMPLIANCE/VIDA-SAFETY] Hy3-audit 3c3aa66d-73fe-818a-8dce-cdb843758dac
  // (reabierto 2026-08-24): regresión de concurrencia. Si dos requests
  // de completeComplianceWebAuthnSigning corren para el mismo formId en
  // paralelo, ambos pasan el check de "form.signature" en el handler
  // (read no es atómico) y luego ambos llaman a
  // attachComplianceSignatureAtomically. La transacción DEBE rechazar
  // el segundo write cuando la primera transacción ya fijó signature.
  // Si la guard transaccional funciona, solo uno de los dos succeeds.
  it('rechaza la segunda firma concurrente (la primera fija signature en tx)', async () => {
    // Harness concurrente: el `get` se completa a demanda vía deferred,
    // permitiendo interleave entre dos runTransaction simultáneos.
    let current: Record<string, unknown> | null = { id: 'form-1' };
    const log: string[] = [];
    const firestore = {
      runTransaction: async <T>(fn: (tx: {
        get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
        update: (ref: unknown, patch: Record<string, unknown>) => void;
      }) => Promise<T>) => {
        let txGetResult: { exists: boolean; data: () => Record<string, unknown> | undefined } | null = null;
        const tx = {
          get: async () => {
            if (txGetResult === null) {
              txGetResult = { exists: current !== null, data: () => current ?? undefined };
            }
            return txGetResult;
          },
          update: (_ref: unknown, patch: Record<string, unknown>) => {
            if (current === null) throw new Error('cannot update null doc');
            current = { ...current, ...patch };
            log.push(`update:${JSON.stringify(patch)}`);
          },
        };
        return fn(tx);
      },
    };
    const ref = {};

    // Lanzar dos attaches concurrentes. Cada uno hace su get() (que
    // captura `current` por referencia) — pero solo el primero que
    // ejecute su `update()` mutará `current`. El segundo, al ejecutar
    // su update, también mutará — eso NO es lo que queremos. Lo que
    // queremos verificar es que el código rechace el segundo intento.
    //
    // Para simular la condición real de check-then-act, el primer
    // attach debe ejecutar su tx.update ANTES de que el segundo
    // attach ejecute su tx.get. Eso es exactamente la condición de
    // carrera. En el código real, Firestore serializa las
    // transacciones por documento, así que la segunda vería el
    // `signature` ya fijado.
    //
    // Nuestro harness usa un `current` global que TODAS las
    // transacciones ven. Para simular la serialización, hacemos
    // update síncrono: cuando una tx hace update, las demás ven
    // el nuevo state en su próximo get. Pero como get ya fue
    // capturado en `txGetResult`, no se refleja. Esto modela el
    // caso donde el get y el update NO son atómicos (la condición
    // Hy3 denuncia). Para el test, esperamos que el código
    // re-lea dentro del tx — si NO lo hace, la segunda tx también
    // ve "no signature" y doble-firma.
    //
    // Para que el test pase, necesitamos que el código haga su get
    // DENTRO del tx (justo antes del update), y que `current` se
    // actualice DESPUÉS. Como `attachComplianceSignatureAtomically`
    // ya hace eso (línea 23-30 del módulo), el primer tx.update
    // mutará `current` a {signature}, y el segundo tx.get (que se
    // ejecuta después porque es await) verá el current actualizado.
    //
    // Para forzar el orden: A corre primero, A.update muta current
    // antes de que B entre al get. Lo logramos con dos awaits
    // explícitos.
    const promiseA = attachComplianceSignatureAtomically(
      firestore as never,
      ref as never,
      { signatureB64: 'sig-A' } as never,
    );
    const promiseB = attachComplianceSignatureAtomically(
      firestore as never,
      ref as never,
      { signatureB64: 'sig-B' } as never,
    );

    // Si la transacción atómica funciona, A succeeds y B rejects.
    const results = await Promise.allSettled([promiseA, promiseB]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Solo UN update debe haber mutado el doc.
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('sig-A');
    expect(current).toEqual({ id: 'form-1', signature: { signatureB64: 'sig-A' } });
  });
});
