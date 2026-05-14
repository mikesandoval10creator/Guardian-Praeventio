// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetEncryptedKvForTests,
  clearEncryptedStore,
  deleteEncrypted,
  getEncrypted,
  getEncryptedMeta,
  hasEncrypted,
  listEncryptedKeys,
  setEncrypted,
} from './encryptedKvStore';
import { __resetDeviceKekForTests, deleteDeviceKek } from './deviceKek';

describe('encryptedKvStore', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  afterEach(() => {
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  describe('setEncrypted / getEncrypted round-trip', () => {
    it('string simple', async () => {
      await setEncrypted('k1', 'hola');
      const r = await getEncrypted<string>('k1');
      expect(r).toBe('hola');
    });

    it('objeto complejo', async () => {
      const phi = {
        workerUid: 'u-123',
        diagnosis: 'silicosis grado II',
        history: ['2024-01', '2025-03'],
        sensitive: true,
      };
      await setEncrypted('worker-u-123', phi);
      const r = await getEncrypted<typeof phi>('worker-u-123');
      expect(r).toEqual(phi);
    });

    it('array', async () => {
      const list = ['n1', 'n2', 'n3'];
      await setEncrypted('queue', list);
      const r = await getEncrypted<string[]>('queue');
      expect(r).toEqual(list);
    });

    it('número y boolean', async () => {
      await setEncrypted('n', 42);
      await setEncrypted('b', true);
      expect(await getEncrypted<number>('n')).toBe(42);
      expect(await getEncrypted<boolean>('b')).toBe(true);
    });

    it('UTF-8 con acentos y emojis', async () => {
      const text = '⚠️ DIAT: José Pérez 🦴';
      await setEncrypted('alert', text);
      expect(await getEncrypted<string>('alert')).toBe(text);
    });

    it('value grande (~5 KB) round-trip', async () => {
      const big = { content: 'X'.repeat(5000) };
      await setEncrypted('big', big);
      const r = await getEncrypted<typeof big>('big');
      expect(r!.content.length).toBe(5000);
    });

    it('key inexistente → null', async () => {
      expect(await getEncrypted('does-not-exist')).toBeNull();
    });

    it('sobrescribir valor existente', async () => {
      await setEncrypted('k', 'v1');
      await setEncrypted('k', 'v2');
      expect(await getEncrypted<string>('k')).toBe('v2');
    });
  });

  describe('persistence across module reload', () => {
    it('después de reset del módulo, los datos siguen recuperables', async () => {
      await setEncrypted('persist', { secret: 'value' });
      __resetEncryptedKvForTests();
      __resetDeviceKekForTests();
      const r = await getEncrypted<{ secret: string }>('persist');
      expect(r).toEqual({ secret: 'value' });
    });
  });

  describe('listEncryptedKeys', () => {
    it('devuelve solo keys, ordenadas, sin desencriptar', async () => {
      await setEncrypted('charlie', 'c');
      await setEncrypted('alpha', 'a');
      await setEncrypted('bravo', 'b');
      const keys = await listEncryptedKeys();
      expect(keys).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('store vacío → array vacío', async () => {
      const keys = await listEncryptedKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('hasEncrypted', () => {
    it('true cuando existe; false cuando no', async () => {
      await setEncrypted('k1', 'v');
      expect(await hasEncrypted('k1')).toBe(true);
      expect(await hasEncrypted('k2')).toBe(false);
    });
  });

  describe('deleteEncrypted', () => {
    it('borra el record bajo el key', async () => {
      await setEncrypted('k', 'v');
      await deleteEncrypted('k');
      expect(await getEncrypted('k')).toBeNull();
    });

    it('idempotent', async () => {
      await expect(deleteEncrypted('nunca-existió')).resolves.toBeUndefined();
    });
  });

  describe('clearEncryptedStore', () => {
    it('vacía todos los records', async () => {
      await setEncrypted('a', 'x');
      await setEncrypted('b', 'y');
      await setEncrypted('c', 'z');
      await clearEncryptedStore();
      expect(await listEncryptedKeys()).toEqual([]);
    });
  });

  describe('getEncryptedMeta', () => {
    it('devuelve metadata sin desencriptar', async () => {
      await setEncrypted('meta-test', { big: 'X'.repeat(100) });
      const meta = await getEncryptedMeta('meta-test');
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe('meta-test');
      expect(meta!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(meta!.ciphertextLength).toBeGreaterThan(0);
    });

    it('key inexistente → null', async () => {
      expect(await getEncryptedMeta('x')).toBeNull();
    });
  });

  describe('threat model: KEK eliminada hace los datos irrecuperables', () => {
    it('después de deleteDeviceKek, getEncrypted falla con DECRYPT_FAIL', async () => {
      await setEncrypted('phi', 'datos sensibles');
      // El user hace logout total y se borra la KEK.
      await deleteDeviceKek();
      // La función intenta crear una KEK nueva (sin querer), entonces
      // el envelope queda con la KEK vieja y la nueva no lo descifra.
      await expect(getEncrypted('phi')).rejects.toThrow(/DECRYPT_FAIL/);
    });
  });

  describe('end-to-end: SLM response cache pattern', () => {
    it('cachear respuestas IA con prompts como key y JSON como value', async () => {
      const cache = {
        prompt: '¿Cómo declaro DIAT?',
        response: {
          text: 'Debes presentar DIAT a la mutualidad...',
          tier: 'slm',
          confidence: 0.85,
          citations: ['DS-101'],
        },
        timestamp: '2026-05-14T10:00:00Z',
      };
      await setEncrypted(`ai:${cache.prompt}`, cache);
      const recovered = await getEncrypted<typeof cache>(`ai:${cache.prompt}`);
      expect(recovered).toEqual(cache);
    });

    it('múltiples PHI records independientes', async () => {
      const records = [
        { id: 'phi-1', text: 'A' },
        { id: 'phi-2', text: 'B' },
        { id: 'phi-3', text: 'C' },
      ];
      for (const r of records) {
        await setEncrypted(r.id, r);
      }
      for (const r of records) {
        const got = await getEncrypted<typeof r>(r.id);
        expect(got).toEqual(r);
      }
      expect(await listEncryptedKeys()).toEqual(['phi-1', 'phi-2', 'phi-3']);
    });
  });
});
