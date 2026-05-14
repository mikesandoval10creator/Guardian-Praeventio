// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetDeviceKekForTests,
  deleteDeviceKek,
  getOrCreateDeviceKek,
  inspectDeviceKek,
  rotateDeviceKek,
  tryGetDeviceKek,
} from './deviceKek';
import {
  decryptEnvelope,
  encryptEnvelope,
  rewrapEnvelope,
} from './browserEnvelope';

describe('deviceKek', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetDeviceKekForTests();
  });

  afterEach(() => {
    __resetDeviceKekForTests();
  });

  describe('getOrCreateDeviceKek', () => {
    it('primer call genera + persiste; segundo call devuelve un key FUNCIONALMENTE equivalente', async () => {
      const k1 = await getOrCreateDeviceKek();
      const k2 = await getOrCreateDeviceKek();
      // fake-indexeddb deserializa el CryptoKey en cada read → no
      // podemos comparar por referencia. Verificamos equivalencia
      // funcional: lo encriptado con k1 desencripta con k2.
      const env = await encryptEnvelope('test', k1);
      const recovered = await decryptEnvelope(env, k2);
      expect(recovered).toBe('test');
    });

    it('la KEK es AES-GCM no-exportable', async () => {
      const kek = await getOrCreateDeviceKek();
      expect(kek.algorithm.name).toBe('AES-GCM');
      expect(kek.extractable).toBe(false);
      // Intentar exportar lanza.
      await expect(globalThis.crypto.subtle.exportKey('raw', kek)).rejects.toThrow();
    });

    it('persiste createdAt en formato ISO', async () => {
      await getOrCreateDeviceKek('2026-05-14T10:00:00Z');
      const info = await inspectDeviceKek('2026-05-14T11:00:00Z');
      expect(info.exists).toBe(true);
      expect(info.createdAt).toBe('2026-05-14T10:00:00Z');
      expect(info.ageMs).toBe(60 * 60 * 1000); // 1 hora
    });

    it('después de reset (simulando refresh), recovera la MISMA key persistida', async () => {
      const k1 = await getOrCreateDeviceKek();
      const plaintext = 'medical-record-x';
      const envelope = await encryptEnvelope(plaintext, k1);

      // Simular reload del proceso: limpiar el singleton del módulo,
      // PERO mantener el IDB intacto (no llamar new FDBFactory).
      __resetDeviceKekForTests();

      const k2 = await getOrCreateDeviceKek();
      // k2 NO es la misma referencia objeto, pero debería desencriptar
      // los envelopes generados con k1.
      const recovered = await decryptEnvelope(envelope, k2);
      expect(recovered).toBe(plaintext);
    });
  });

  describe('tryGetDeviceKek', () => {
    it('sin KEK previa → null', async () => {
      const k = await tryGetDeviceKek();
      expect(k).toBeNull();
    });

    it('con KEK existente → devuelve el key', async () => {
      await getOrCreateDeviceKek();
      const k = await tryGetDeviceKek();
      expect(k).not.toBeNull();
      expect(k!.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('rotateDeviceKek', () => {
    it('genera una KEK distinta y la persiste', async () => {
      const oldKek = await getOrCreateDeviceKek();
      const newKek = await rotateDeviceKek();
      expect(newKek).not.toBe(oldKek);

      // Después del reset, la nueva queda persistida.
      __resetDeviceKekForTests();
      const fetched = await tryGetDeviceKek();
      expect(fetched).not.toBeNull();
      // Debería poder encriptar/desencriptar con la nueva.
      const env = await encryptEnvelope('post-rotation', fetched!);
      const recovered = await decryptEnvelope(env, fetched!);
      expect(recovered).toBe('post-rotation');
    });

    it('integration: rotación + rewrap mantiene los envelopes vivos', async () => {
      const oldKek = await getOrCreateDeviceKek();
      const env = await encryptEnvelope('contenido', oldKek);

      // Rotamos.
      const newKek = await rotateDeviceKek();

      // El envelope ORIGINAL ya NO desencripta con la nueva.
      await expect(decryptEnvelope(env, newKek)).rejects.toThrow();

      // Pero con rewrap (mientras oldKek aún en memoria) sobrevive.
      const rewrapped = await rewrapEnvelope(env, oldKek, newKek);
      const recovered = await decryptEnvelope(rewrapped, newKek);
      expect(recovered).toBe('contenido');
    });

    it('createdAt se actualiza al rotar', async () => {
      await getOrCreateDeviceKek('2026-05-14T10:00:00Z');
      await rotateDeviceKek('2026-05-14T15:00:00Z');
      const info = await inspectDeviceKek();
      expect(info.createdAt).toBe('2026-05-14T15:00:00Z');
    });
  });

  describe('deleteDeviceKek', () => {
    it('elimina la KEK del store', async () => {
      await getOrCreateDeviceKek();
      expect(await tryGetDeviceKek()).not.toBeNull();
      await deleteDeviceKek();
      expect(await tryGetDeviceKek()).toBeNull();
    });

    it('idempotent: borrar dos veces no falla', async () => {
      await deleteDeviceKek();
      await expect(deleteDeviceKek()).resolves.toBeUndefined();
    });

    it('después de delete + getOrCreate genera una NUEVA', async () => {
      const k1 = await getOrCreateDeviceKek();
      const env = await encryptEnvelope('x', k1);
      await deleteDeviceKek();
      const k2 = await getOrCreateDeviceKek();
      // La nueva NO desencripta los envelopes viejos (KEK distinta).
      await expect(decryptEnvelope(env, k2)).rejects.toThrow();
    });
  });

  describe('inspectDeviceKek', () => {
    it('sin KEK → exists:false', async () => {
      const info = await inspectDeviceKek();
      expect(info.exists).toBe(false);
      expect(info.createdAt).toBeUndefined();
    });

    it('con KEK → exists:true + ageMs', async () => {
      await getOrCreateDeviceKek('2026-05-14T10:00:00Z');
      const info = await inspectDeviceKek('2026-05-14T10:30:00Z');
      expect(info.exists).toBe(true);
      expect(info.createdAt).toBe('2026-05-14T10:00:00Z');
      expect(info.ageMs).toBe(30 * 60 * 1000);
    });
  });

  describe('end-to-end: PHI cache pattern realista', () => {
    it('múltiples records, cada uno con su DEK fresco, todos recuperables', async () => {
      const kek = await getOrCreateDeviceKek();
      const phi = {
        'phi-1': 'José Pérez: fractura cúbito',
        'phi-2': 'María Soto: silicosis grado II',
        'phi-3': 'Pedro Soto: hipoacusia laboral',
      };
      // Encrypt cada uno.
      const envelopes: Record<string, unknown> = {};
      for (const [id, text] of Object.entries(phi)) {
        envelopes[id] = await encryptEnvelope(text, kek, id);
      }
      // Decrypt cada uno con la misma KEK.
      for (const [id, text] of Object.entries(phi)) {
        const recovered = await decryptEnvelope(envelopes[id] as never, kek);
        expect(recovered).toBe(text);
      }
    });
  });
});
