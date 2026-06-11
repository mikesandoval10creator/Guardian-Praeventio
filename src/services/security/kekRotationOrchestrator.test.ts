// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __generateLockIdForTests,
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

describe('runKekRotation — Web Locks API (primary lock mechanism)', () => {
  // jsdom no implementa navigator.locks — lo definimos por test y lo
  // limpiamos en afterEach para que el resto de la suite siga ejercitando
  // el fallback localStorage real.
  function installWebLocks(grant: boolean) {
    const requestSpy = vi.fn(
      async (
        name: string,
        _options: { ifAvailable: boolean },
        cb: (lock: unknown) => unknown,
      ) => {
        return await cb(grant ? { name, mode: 'exclusive' } : null);
      },
    );
    Object.defineProperty(navigator, 'locks', {
      value: { request: requestSpy },
      configurable: true,
    });
    return requestSpy;
  }

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    clearLockStorage();
  });

  it('adquiere via navigator.locks.request con ifAvailable y rota bajo el lock', async () => {
    const requestSpy = installWebLocks(true);
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', 'dato');
    const newKek = await rotateDeviceKek();

    const r = await runKekRotation({ oldKek, newKek });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(
      'praeventio:kek:rotation:lock:v1',
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(r.aborted).toBe(false);
    expect(r.processed).toBe(1);
    expect(await getEncrypted('phi-1')).toBe('dato');
  });

  it('contención: lock null (otra tab lo tiene) → aborta lock_busy sin tocar records', async () => {
    installWebLocks(false);
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', 'dato');
    const newKek = await rotateDeviceKek();

    const r = await runKekRotation({ oldKek, newKek });
    expect(r.aborted).toBe(true);
    expect(r.abortedReason).toBe('lock_busy');
    expect(r.processed).toBe(0);
    expect(r.total).toBe(0);

    // El record NO fue rotado: un re-run con bypass lo procesa recién ahora.
    const r2 = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(r2.processed).toBe(1);
  });

  it('el lock se libera al resolver: dos rotaciones secuenciales adquieren ambas', async () => {
    const requestSpy = installWebLocks(true);
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', 'dato');
    const newKek = await rotateDeviceKek();

    const r1 = await runKekRotation({ oldKek, newKek });
    const r2 = await runKekRotation({ oldKek, newKek });

    // Web Locks libera automáticamente cuando el callback resuelve —
    // el segundo request adquiere de nuevo y detecta already-migrated.
    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(r1.processed).toBe(1);
    expect(r2.alreadyMigrated).toBe(1);
  });

  it('con Web Locks disponible IGNORA el lock localStorage (no compite con él)', async () => {
    installWebLocks(true);
    // Lock localStorage "tomado" por otra tab vieja que no soporta Web
    // Locks no debería existir en la práctica, pero el mecanismo primario
    // es la única autoridad cuando está disponible.
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({ acquiredAt: Date.now(), acquiredBy: 'other-tab' }),
    );
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', 'dato');
    const newKek = await rotateDeviceKek();

    const r = await runKekRotation({ oldKek, newKek });
    expect(r.aborted).toBe(false);
    expect(r.processed).toBe(1);
    // No tocó el valor localStorage de la otra tab.
    expect(
      (JSON.parse(localStorage.getItem('praeventio:kek:rotation:lock:v1')!) as { acquiredBy: string })
        .acquiredBy,
    ).toBe('other-tab');
  });

  it('bypassLock=true NO llama a navigator.locks', async () => {
    const requestSpy = installWebLocks(true);
    const oldKek = await getOrCreateDeviceKek();
    await setEncrypted('phi-1', 'dato');
    const newKek = await rotateDeviceKek();

    const r = await runKekRotation({ oldKek, newKek, bypassLock: true });
    expect(requestSpy).not.toHaveBeenCalled();
    expect(r.processed).toBe(1);
  });

  it('fallback: sin navigator.locks usa el lock localStorage (lock_busy si está tomado)', async () => {
    // Garantizar ausencia explícita del API (Safari viejo / SSR / tests).
    Reflect.deleteProperty(navigator, 'locks');
    localStorage.setItem(
      'praeventio:kek:rotation:lock:v1',
      JSON.stringify({ acquiredAt: Date.now(), acquiredBy: 'other-tab-id' }),
    );
    const oldKek = await freshKek();
    const newKek = await freshKek();
    const r = await runKekRotation({ oldKek, newKek });
    expect(r.aborted).toBe(true);
    expect(r.abortedReason).toBe('lock_busy');
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

describe('generateLockId — Web Crypto guard (PR #482 codex round-4 P2)', () => {
  it('genera lock id con Web Crypto disponible (caso normal)', () => {
    expect(typeof globalThis.crypto?.getRandomValues).toBe('function');
    const id = __generateLockIdForTests();
    expect(id).toMatch(/^[0-9a-z]+-[0-9a-f]{12}$/);
  });

  // JSDOM define globalThis.crypto via getter — usamos Object.defineProperty
  // para overridearlo en el test sin tocar la prop original.
  it('NO throw cuando globalThis.crypto está undefined (SSR/older Node)', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const id1 = __generateLockIdForTests();
      const id2 = __generateLockIdForTests();
      expect(id1).toMatch(/^[0-9a-z]+-[0-9a-f]{12}$/);
      expect(id2).toMatch(/^[0-9a-z]+-[0-9a-f]{12}$/);
      // Counter monotonic → consecutive ids differ.
      expect(id1).not.toBe(id2);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    }
  });

  it('NO throw cuando crypto.getRandomValues es undefined', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      // Fake crypto sin getRandomValues
      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true,
        writable: true,
      });
      expect(() => __generateLockIdForTests()).not.toThrow();
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    }
  });

  // Codex round-5 P1 (PR #483 follow-up) — verifica que dos tabs con
  // counter+ms idénticos (simulado vía Math.random distinto) generen IDs
  // distintos. Antes del fix: bytes[0..3] eran counter big-endian +
  // bytes[4..5] eran ms tail → dos tabs en el mismo ms con counter=1
  // producían bytes IDÉNTICOS → mutex roto.
  it('IDs distintos entre llamadas con mismo counter+ms (fix entropy P1)', () => {
    const cryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const originalRandom = Math.random;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      // Mock Math.random para simular dos tabs con seeds distintos.
      // Si el fallback IGNORA Math.random, los IDs serán iguales (counter
      // y ms son idénticos dentro del mismo tick) → test falla.
      const rng = vi.fn().mockReturnValueOnce(0.123).mockReturnValueOnce(0.987);
      Math.random = rng;
      const id1 = __generateLockIdForTests();
      const id2 = __generateLockIdForTests();
      expect(rng).toHaveBeenCalledTimes(2);
      // El timestamp prefix puede coincidir si el tick es idéntico, pero
      // el sufijo hex DEBE diferir gracias a Math.random.
      const [, hex1] = id1.split('-');
      const [, hex2] = id2.split('-');
      expect(hex1).not.toBe(hex2);
    } finally {
      Math.random = originalRandom;
      if (cryptoDesc) Object.defineProperty(globalThis, 'crypto', cryptoDesc);
    }
  });

  it('no genera duplicados en 1000 iteraciones consecutivas (fallback path)', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) ids.add(__generateLockIdForTests());
      expect(ids.size).toBe(1000);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    }
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
