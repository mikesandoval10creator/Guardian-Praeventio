// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  BrowserEnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  rewrapEnvelope,
  validateEnvelope,
  type BrowserEnvelope,
} from './browserEnvelope';

async function makeKek(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // no-exportable, como en prod
    ['encrypt', 'decrypt'],
  );
}

describe('browserEnvelope — encryptEnvelope', () => {
  it('round-trip básico: encrypt → decrypt produce el plaintext original', async () => {
    const kek = await makeKek();
    const plaintext = 'Información médica sensible: paciente X tiene diagnóstico Y';
    const env = await encryptEnvelope(plaintext, kek);
    const recovered = await decryptEnvelope(env, kek);
    expect(recovered).toBe(plaintext);
  });

  it('envelope contiene los campos esperados', async () => {
    const kek = await makeKek();
    const env = await encryptEnvelope('hola', kek, 'rec-123');
    expect(env.version).toBe('v1');
    expect(env.algorithm).toBe('AES-256-GCM');
    expect(env.ciphertext).toBeTypeOf('string');
    expect(env.iv).toBeTypeOf('string');
    expect(env.wrappedDek.ciphertext).toBeTypeOf('string');
    expect(env.wrappedDek.iv).toBeTypeOf('string');
    expect(env.recordId).toBe('rec-123');
    expect(env.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('cada llamada produce un DEK fresco (IV + ciphertext distintos)', async () => {
    const kek = await makeKek();
    const env1 = await encryptEnvelope('mismo texto', kek);
    const env2 = await encryptEnvelope('mismo texto', kek);
    expect(env1.iv).not.toBe(env2.iv);
    expect(env1.ciphertext).not.toBe(env2.ciphertext);
    expect(env1.wrappedDek.iv).not.toBe(env2.wrappedDek.iv);
  });

  it('plaintext vacío → round-trip OK', async () => {
    const kek = await makeKek();
    const env = await encryptEnvelope('', kek);
    const recovered = await decryptEnvelope(env, kek);
    expect(recovered).toBe('');
  });

  it('plaintext con caracteres UTF-8 (acentos, emoji) round-trip', async () => {
    const kek = await makeKek();
    const plaintext = '⚠️ DIAT: trabajador José Pérez — fractura cúbito 🦴';
    const env = await encryptEnvelope(plaintext, kek);
    const recovered = await decryptEnvelope(env, kek);
    expect(recovered).toBe(plaintext);
  });

  it('payload grande (~10 KB) round-trip', async () => {
    const kek = await makeKek();
    const plaintext = 'X'.repeat(10_000);
    const env = await encryptEnvelope(plaintext, kek);
    const recovered = await decryptEnvelope(env, kek);
    expect(recovered).toBe(plaintext);
    expect(recovered.length).toBe(10_000);
  });
});

describe('browserEnvelope — decryptEnvelope', () => {
  it('KEK incorrecta → DECRYPT_FAIL', async () => {
    const kek1 = await makeKek();
    const kek2 = await makeKek(); // KEK diferente
    const env = await encryptEnvelope('secret', kek1);
    await expect(decryptEnvelope(env, kek2)).rejects.toThrow(BrowserEnvelopeError);
    await expect(decryptEnvelope(env, kek2)).rejects.toThrow(/DECRYPT_FAIL/);
  });

  it('ciphertext tampered → DECRYPT_FAIL (auth tag verifica)', async () => {
    const kek = await makeKek();
    const env = await encryptEnvelope('hola mundo', kek);
    // Corruptamos el ciphertext (flip un bit en el base64).
    const tampered: BrowserEnvelope = {
      ...env,
      ciphertext: env.ciphertext.slice(0, -2) + 'XX',
    };
    await expect(decryptEnvelope(tampered, kek)).rejects.toThrow(/DECRYPT_FAIL/);
  });

  it('wrappedDek tampered → DECRYPT_FAIL en unwrap', async () => {
    const kek = await makeKek();
    const env = await encryptEnvelope('hola', kek);
    const tampered: BrowserEnvelope = {
      ...env,
      wrappedDek: {
        ...env.wrappedDek,
        ciphertext: env.wrappedDek.ciphertext.slice(0, -2) + 'YY',
      },
    };
    await expect(decryptEnvelope(tampered, kek)).rejects.toThrow(/DECRYPT_FAIL/);
  });

  it('IV swap (mismo ciphertext, IV cambiado) → DECRYPT_FAIL', async () => {
    const kek = await makeKek();
    const env1 = await encryptEnvelope('uno', kek);
    const env2 = await encryptEnvelope('dos', kek);
    // Construimos un envelope mezclado: ciphertext de env1, IV de env2.
    const mixed: BrowserEnvelope = { ...env1, iv: env2.iv };
    await expect(decryptEnvelope(mixed, kek)).rejects.toThrow(/DECRYPT_FAIL/);
  });
});

describe('browserEnvelope — validateEnvelope', () => {
  it('object con version v1 + AES-256-GCM + campos → no throw', async () => {
    const kek = await makeKek();
    const env = await encryptEnvelope('x', kek);
    expect(() => validateEnvelope(env)).not.toThrow();
  });

  it('null / not object → throw BAD_ENVELOPE', () => {
    expect(() => validateEnvelope(null)).toThrow(/BAD_ENVELOPE/);
    expect(() => validateEnvelope('string')).toThrow(/BAD_ENVELOPE/);
    expect(() => validateEnvelope(123)).toThrow(/BAD_ENVELOPE/);
  });

  it('version != v1 → throw', () => {
    expect(() =>
      validateEnvelope({
        version: 'v2',
        algorithm: 'AES-256-GCM',
        ciphertext: 'a',
        iv: 'b',
        wrappedDek: { ciphertext: 'c', iv: 'd' },
      }),
    ).toThrow(/unknown version/);
  });

  it('algorithm distinto → throw', () => {
    expect(() =>
      validateEnvelope({
        version: 'v1',
        algorithm: 'AES-128-GCM',
        ciphertext: 'a',
        iv: 'b',
        wrappedDek: { ciphertext: 'c', iv: 'd' },
      }),
    ).toThrow(/unknown algorithm/);
  });

  it('campos requeridos faltantes → throw', () => {
    expect(() =>
      validateEnvelope({
        version: 'v1',
        algorithm: 'AES-256-GCM',
        // sin ciphertext / iv
        wrappedDek: { ciphertext: 'c', iv: 'd' },
      }),
    ).toThrow(/missing ciphertext/);
  });

  it('wrappedDek mal formado → throw', () => {
    expect(() =>
      validateEnvelope({
        version: 'v1',
        algorithm: 'AES-256-GCM',
        ciphertext: 'a',
        iv: 'b',
        wrappedDek: { ciphertext: 'c' /* falta iv */ },
      }),
    ).toThrow(/missing wrappedDek/);
  });
});

describe('browserEnvelope — rewrapEnvelope (KEK rotation)', () => {
  it('re-wrap mantiene el plaintext recuperable con la nueva KEK', async () => {
    const oldKek = await makeKek();
    const newKek = await makeKek();
    const env = await encryptEnvelope('contenido sensible', oldKek);
    const rewrapped = await rewrapEnvelope(env, oldKek, newKek);

    // El nuevo envelope NO se desencripta con la old KEK.
    await expect(decryptEnvelope(rewrapped, oldKek)).rejects.toThrow(/DECRYPT_FAIL/);

    // SÍ se desencripta con la new KEK.
    const recovered = await decryptEnvelope(rewrapped, newKek);
    expect(recovered).toBe('contenido sensible');
  });

  it('re-wrap preserva ciphertext + iv del payload (solo cambia wrappedDek)', async () => {
    const oldKek = await makeKek();
    const newKek = await makeKek();
    const env = await encryptEnvelope('payload', oldKek);
    const rewrapped = await rewrapEnvelope(env, oldKek, newKek);

    expect(rewrapped.ciphertext).toBe(env.ciphertext);
    expect(rewrapped.iv).toBe(env.iv);
    expect(rewrapped.wrappedDek.ciphertext).not.toBe(env.wrappedDek.ciphertext);
    expect(rewrapped.wrappedDek.iv).not.toBe(env.wrappedDek.iv);
  });

  it('re-wrap con KEK incorrecta → DECRYPT_FAIL', async () => {
    const oldKek = await makeKek();
    const wrongKek = await makeKek();
    const newKek = await makeKek();
    const env = await encryptEnvelope('x', oldKek);
    await expect(rewrapEnvelope(env, wrongKek, newKek)).rejects.toThrow(
      /DECRYPT_FAIL/,
    );
  });
});

describe('BrowserEnvelopeError', () => {
  it('expone .code para discriminar', async () => {
    const kek = await makeKek();
    const env = await encryptEnvelope('x', kek);
    const tampered: BrowserEnvelope = {
      ...env,
      ciphertext: env.ciphertext.slice(0, -2) + 'ZZ',
    };
    try {
      await decryptEnvelope(tampered, kek);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BrowserEnvelopeError);
      expect((err as BrowserEnvelopeError).code).toBe('DECRYPT_FAIL');
    }
  });
});
