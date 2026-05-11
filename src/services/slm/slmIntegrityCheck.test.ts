import { describe, it, expect, vi } from 'vitest';
import {
  verifyModelIntegrity,
  shouldLoadModel,
  buildWeightUrl,
} from './slmIntegrityCheck.js';
import type { ModelDescriptor } from './types.js';

function descriptor(over: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: 'test-model',
    name: 'Test Model',
    size: 1024,
    url: 'https://huggingface.co/test/repo',
    weightFilename: 'onnx/model_q4.onnx',
    format: 'onnx-int4',
    license: 'MIT',
    preferredBackend: 'webgpu',
    quantization: 'int4',
    ...over,
  };
}

const KNOWN_HASH_FOR_HELLO = 'fake-known-hash-of-hello-bytes';
const fakeHasher = async (bytes: Uint8Array): Promise<string> => {
  // Determinístico para tests: hash = stringificación simple del payload.
  return Array.from(bytes).join('-');
};

describe('verifyModelIntegrity', () => {
  it('verified cuando hash coincide', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const expected = '1-2-3';
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: expected }),
      bytes,
      { hasher: fakeHasher, environment: 'production' },
    );
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.computedSha256).toBe(expected);
    }
  });

  it('mismatch cuando hash NO coincide', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: 'WRONG-HASH' }),
      bytes,
      { hasher: fakeHasher, environment: 'production' },
    );
    expect(result.status).toBe('mismatch');
    if (result.status === 'mismatch') {
      expect(result.expected).toBe('WRONG-HASH');
      expect(result.computedSha256).toBe('1-2-3');
    }
  });

  it('rejected en production cuando expectedSha256 ausente', async () => {
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: undefined }),
      new Uint8Array([1, 2, 3]),
      { hasher: fakeHasher, environment: 'production' },
    );
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('no_expected_hash_in_production');
    }
  });

  it('unverified en staging cuando expectedSha256 ausente (pasa con warning)', async () => {
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: undefined }),
      new Uint8Array([1, 2, 3]),
      { hasher: fakeHasher, environment: 'staging' },
    );
    expect(result.status).toBe('unverified');
  });

  it('unverified en development cuando expectedSha256 ausente', async () => {
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: undefined }),
      new Uint8Array([1, 2, 3]),
      { hasher: fakeHasher, environment: 'development' },
    );
    expect(result.status).toBe('unverified');
  });

  it('comparación case-insensitive del hash', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hasherUpper = async (b: Uint8Array) => Array.from(b).join('-').toUpperCase();
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: '1-2-3' }), // lowercase
      bytes,
      { hasher: hasherUpper, environment: 'production' },
    );
    expect(result.status).toBe('verified');
  });

  it('rejected si el hasher falla', async () => {
    const failingHasher = async (): Promise<string> => {
      throw new Error('crypto unavailable');
    };
    const result = await verifyModelIntegrity(
      descriptor({ expectedSha256: 'x' }),
      new Uint8Array(),
      { hasher: failingHasher, environment: 'production' },
    );
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('compute_failed');
    }
  });
});

describe('shouldLoadModel', () => {
  it('verified → true', () => {
    expect(shouldLoadModel({ status: 'verified', computedSha256: 'x' })).toBe(true);
  });

  it('unverified → true (staging)', () => {
    expect(
      shouldLoadModel({ status: 'unverified', reason: 'no_expected_hash', mode: 'staging' }),
    ).toBe(true);
  });

  it('mismatch → false', () => {
    expect(
      shouldLoadModel({
        status: 'mismatch',
        expected: 'a',
        computedSha256: 'b',
        reason: 'hash_mismatch',
      }),
    ).toBe(false);
  });

  it('rejected → false', () => {
    expect(
      shouldLoadModel({ status: 'rejected', reason: 'no_expected_hash_in_production' }),
    ).toBe(false);
  });
});

describe('buildWeightUrl', () => {
  it('concatena weightFilename al repo HF', () => {
    const url = buildWeightUrl(
      descriptor({
        url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx-web',
        weightFilename: 'onnx/model_q4.onnx',
      }),
    );
    expect(url).toBe(
      'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx-web/resolve/main/onnx/model_q4.onnx',
    );
  });

  it('omite weightFilename cuando ausente → devuelve url tal cual', () => {
    const url = buildWeightUrl(
      descriptor({ url: 'https://hf.co/repo', weightFilename: undefined }),
    );
    expect(url).toBe('https://hf.co/repo');
  });

  it('preserva trailing slash y resolve si ya está', () => {
    const url = buildWeightUrl(
      descriptor({
        url: 'https://huggingface.co/repo/resolve/main/file.onnx',
        weightFilename: 'ignore',
      }),
    );
    expect(url).toContain('/resolve/main/');
  });
});
