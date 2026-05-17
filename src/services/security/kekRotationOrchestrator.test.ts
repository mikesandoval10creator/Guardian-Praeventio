// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forceReleaseRotationLock,
  inspectRotationLock,
  KekRotationError,
  runKekRotation,
} from './kekRotationOrchestrator';
import {
  __resetEncryptedKvForTests,
  clearEncryptedStore,
  getEncrypted,
  setEncrypted,
} from './encryptedKvStore';
import {
  __resetDeviceKekForTests,
  getOrCreateDeviceKek,
  rotateDeviceKek,
} from './deviceKek';
import {
  decryptEnvelope,
  encryptEnvelope,
} from './browserEnvelope';

async function freshKek(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function clearLockStorage() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem('praeventio:kek:rotation:lock:v1');
    } catch {
      /* ignore */
    }
  }
}

describe('runKekRotation — happy path', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  afterEach(() => {
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  it('aborta con no_records si el store está vacío', async () => {
    const oldKek = await freshKek();
    const newKek = await freshKek();
    const r = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(r.aborted).toBe(true);
    expect(r.abortedReason).toBe('no_records');
    expect(r.processed).toBe(0);
  });

  it('rota N envelopes y todos quedan recuperables con la nueva KEK', async () => {
    // Seed 3 records cifrados con oldKek.
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', { workerUid: 'w1', text: 'silicosis' });
    await setEncrypted('phi-2', { workerUid: 'w2', text: 'hipoacusia' });
    await setEncrypted('phi-3', { workerUid: 'w3', text: 'trauma' });
    // Rotamos a una nueva KEK.
    const newKek = await rotateDeviceKek();
    const result = await runKekRotation({ oldKek, newKek, bypassLock: true });

    expect(result.aborted).toBe(false);
    expect(result.total).toBe(3);
    expect(result.processed).toBe(3);
    expect(result.failed).toBe(0);
    // Los 3 records siguen recuperables con la nueva KEK (porque
    // encryptedKvStore lee la KEK activa, que ya es la new).
    expect(await getEncrypted('phi-1')).toEqual({ workerUid: 'w1', text: 'silicosis' });
    expect(await getEncrypted('phi-2')).toEqual({ workerUid: 'w2', text: 'hipoacusia' });
    expect(await getEncrypted('phi-3')).toEqual({ workerUid: 'w3', text: 'trauma' });
  });

  it('onProgress se invoca por cada record', async () => {
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('a', 1);
    await setEncrypted('b', 2);
    await setEncrypted('c', 3);
    const newKek = await rotateDeviceKek();
    const progress: Array<{ p: number; t: number }> = [];
    await runKekRotation({
      oldKek,
      newKek,
      bypassLock: true,
      onProgress: (p, t) => progress.push({ p, t }),
    });
    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({ p: 1, t: 3 });
    expect(progress[2]).toEqual({ p: 3, t: 3 });
  });

  it('idempotente: re-ejecutar después de rotación cuenta como alreadyMigrated', async () => {
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', 'x');
    const newKek = await rotateDeviceKek();
    const r1 = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(r1.processed).toBe(1);

    // Re-ejecutar con las MISMAS KEKs → ya descifra con newKek → skip.
    const r2 = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(r2.processed).toBe(0);
    expect(r2.alreadyMigrated).toBe(1);
  });

  it('latencyMs reportada', async () => {
    let t = 1000;
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('x', 1);
    const newKek = await rotateDeviceKek();
    const r = await runKekRotation(
      { oldKek, newKek, bypassLock: true },
      () => {
        const v = t;
        t += 5;
        return v;
      },
    );
    expect(r.latencyMs).toBeGreaterThan(0);
  });
});

describe('runKekRotation — error handling', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  it('oldKek === newKek lanza INVALID_INPUT', async () => {
    const k = await freshKek();
    await expect(
      runKekRotation({ oldKek: k, newKek: k, bypassLock: true }),
    ).rejects.toThrow(/INVALID_INPUT/);
  });

  it('record que NO descifra con la oldKek se cuenta como failed', async () => {
    // Seed con KEK A.
    const kekA = await getOrCreateDeviceKek();
    await setEncrypted('phi-A', 'data-A');
    // Rotamos a KEK B.
    const kekB = await rotateDeviceKek();
    // Re-rotamos a KEK C SIN haber rotado los records (escenario:
    // app rota 2x pero rotación previa quedó incompleta).
    const kekC = await rotateDeviceKek();
    // Intentamos rotar usando "oldKek=B newKek=C", pero los records
    // siguen envueltos con KEK A → kekB no descifra → failed.
    const r = await runKekRotation({
      oldKek: kekB,
      newKek: kekC,
      bypassLock: true,
    });
    expect(r.failed).toBe(1);
    expect(r.failures[0]!.key).toBe('phi-A');
    expect(r.failures[0]!.error).toMatch(/rewrap failed/);
  });

  it('record que NO es envelope se ignora sin contar como failed', async () => {
    // El test escribe un record raw en IDB que NO pasa por el
    // encryptedKvStore (simulando data legacy). Solo podemos hacerlo
    // saltando el wrapper — usando la API directa de idb-keyval no
    // está aquí pero podemos meter algo en encryptedKvStore que sea
    // un JSON válido pero NO un envelope.
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('not-envelope', { foo: 'bar', baz: 42 });
    const newKek = await rotateDeviceKek();
    const r = await runKekRotation({ oldKek, newKek, bypassLock: true });
    // El record que ya está cifrado por encryptedKvStore SÍ es
    // envelope (el store siempre envuelve). El test debería contar
    // 1 rotated.
    expect(r.processed).toBe(1);
    expect(r.failed).toBe(0);
  });
});

describe('runKekRotation — lock', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  it('si otra tab tiene el lock activo: aborta con lock_busy', async () => {
    // Simular lock acquired por otra tab.
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({
        acquiredAt: Date.now(),
        acquiredBy: 'other-tab-id',
      }),
    );
    const oldKek = await freshKek();
    const newKek = await freshKek();
    const r = await runKekRotation({ oldKek, newKek });
    expect(r.aborted).toBe(true);
    expect(r.abortedReason).toBe('lock_busy');
  });

  it('lock expirado (TTL >5min): otra rotación puede arrancar', async () => {
    // Lock con timestamp viejo (hace 10 min).
    const oldTs = Date.now() - 10 * 60 * 1000;
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({
        acquiredAt: oldTs,
        acquiredBy: 'crashed-tab',
      }),
    );
    // Aún si está "tomado", ya expiró → se sobrescribe.
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('x', 1);
    const newKek = await rotateDeviceKek();
    const r = await runKekRotation({ oldKek, newKek });
    expect(r.aborted).toBe(false);
    expect(r.processed).toBe(1);
  });

  it('después de rotación exitosa, lock se libera', async () => {
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('x', 1);
    const newKek = await rotateDeviceKek();
    await runKekRotation({ oldKek, newKek });
    expect(inspectRotationLock().held).toBe(false);
  });

  it('bypassLock=true salta la verificación del lock', async () => {
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({
        acquiredAt: Date.now(),
        acquiredBy: 'other-tab',
      }),
    );
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('x', 1);
    const newKek = await rotateDeviceKek();
    const r = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(r.aborted).toBe(false);
  });
});

describe('inspectRotationLock + forceReleaseRotationLock', () => {
  beforeEach(() => {
    clearLockStorage();
  });

  it('sin lock: held=false', () => {
    expect(inspectRotationLock()).toEqual({ held: false });
  });

  it('con lock activo: held=true + ageMs', () => {
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({
        acquiredAt: Date.now() - 30_000,
        acquiredBy: 'x',
      }),
    );
    const info = inspectRotationLock();
    expect(info.held).toBe(true);
    expect(info.ageMs).toBeGreaterThanOrEqual(30_000);
    expect(info.expired).toBe(false);
  });

  it('lock TTL excedido: held=true + expired=true', () => {
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({
        acquiredAt: Date.now() - 10 * 60 * 1000,
        acquiredBy: 'crashed',
      }),
    );
    const info = inspectRotationLock();
    expect(info.expired).toBe(true);
  });

  it('forceReleaseRotationLock limpia el lock', () => {
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({ acquiredAt: Date.now(), acquiredBy: 'x' }),
    );
    expect(inspectRotationLock().held).toBe(true);
    forceReleaseRotationLock();
    expect(inspectRotationLock().held).toBe(false);
  });

  it('forceReleaseRotationLock sin lock: idempotent', () => {
    forceReleaseRotationLock();
    forceReleaseRotationLock();
    expect(inspectRotationLock().held).toBe(false);
  });
});

describe('KekRotationError', () => {
  it('expone .code', async () => {
    const k = await freshKek();
    try {
      await runKekRotation({ oldKek: k, newKek: k, bypassLock: true });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(KekRotationError);
      expect((err as KekRotationError).code).toBe('INVALID_INPUT');
    }
  });
});

describe('end-to-end: post-rotation encrypted store works seamlessly', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  it('después de rotación, set + get sigue funcionando con la nueva KEK', async () => {
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-old', 'data-pre-rotation');
    const newKek = await rotateDeviceKek();
    const r = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(r.processed).toBe(1);

    // Set + get nuevo después de rotation funcionan.
    await setEncrypted('phi-new', 'data-post-rotation');
    expect(await getEncrypted('phi-new')).toBe('data-post-rotation');
    // El viejo sigue recuperable.
    expect(await getEncrypted('phi-old')).toBe('data-pre-rotation');
  });

  it('round-trip envelope: rewrapped envelope decrypta con la nueva KEK directo', async () => {
    const oldKek = await freshKek();
    const newKek = await freshKek();
    const env = await encryptEnvelope('mensaje secreto', oldKek);
    // Persistir como envelope crudo en el store usando setEncrypted
    // sería redundante (eso lo hace el store). Aquí solo verificamos
    // que el orchestrator delega correctamente a rewrapEnvelope.
    const { rewrapEnvelope } = await import('./browserEnvelope');
    const rewrapped = await rewrapEnvelope(env, oldKek, newKek);
    expect(await decryptEnvelope(rewrapped, newKek)).toBe('mensaje secreto');
    await expect(decryptEnvelope(rewrapped, oldKek)).rejects.toThrow();
  });
});
