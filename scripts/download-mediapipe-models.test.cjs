/**
 * download-mediapipe-models.test.cjs — Bucket PP.7.
 *
 * Corre con: node --test scripts/download-mediapipe-models.test.cjs
 *
 * Tres escenarios:
 *   1. Skip si el archivo ya existe (sin hash pinneado, no re-descarga).
 *   2. Re-download si el SHA-256 pinneado no matchea.
 *   3. Fallo gracioso ante network error (lanza para non-optional).
 *
 * Usamos `node:test` (built-in en Node 18+) para evitar agregar deps al
 * runtime de scripts/. El script real expone `downloadIfMissing` y
 * `sha256File` para testabilidad.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');

let mod;
test.before(async () => {
  mod = await import('./download-mediapipe-models.mjs');
});

function tmpRepoLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-'));
  fs.mkdirSync(path.join(root, 'public', 'models', 'mediapipe'), {
    recursive: true,
  });
  return root;
}

/**
 * Construye un fake Response compatible con la interfaz que usa el
 * script (`ok`, `status`, `headers.get`, `body.getReader()`).
 */
function fakeResponse(bytes, { ok = true, status = 200 } = {}) {
  let consumed = false;
  const reader = {
    async read() {
      if (consumed) return { done: true, value: undefined };
      consumed = true;
      return { done: false, value: bytes };
    },
  };
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Err',
    headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null) },
    body: { getReader: () => reader },
  };
}

test('1) skip si el archivo destino ya existe (sin hash pinneado)', async () => {
  const root = tmpRepoLayout();
  const target = path.join(root, 'public', 'models', 'mediapipe', 'fake.task');
  fs.writeFileSync(target, 'EXISTING');

  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return fakeResponse(Buffer.from('NEW'));
  };

  const result = await mod.downloadIfMissing(
    {
      name: 'fake.task',
      url: 'https://example.com/fake.task',
      sha256: null,
      target,
    },
    { fetchImpl },
  );

  assert.equal(result.skipped, true);
  assert.equal(fetched, false, 'no debió hacer fetch');
  assert.equal(fs.readFileSync(target, 'utf8'), 'EXISTING');
});

test('2) re-download si el SHA-256 pinneado no matchea', async () => {
  const root = tmpRepoLayout();
  const target = path.join(root, 'public', 'models', 'mediapipe', 'fake2.task');
  fs.writeFileSync(target, 'STALE');

  const newPayload = Buffer.from('FRESH');
  const expected = createHash('sha256').update(newPayload).digest('hex');

  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return fakeResponse(newPayload);
  };

  const result = await mod.downloadIfMissing(
    {
      name: 'fake2.task',
      url: 'https://example.com/fake2.task',
      sha256: expected,
      target,
    },
    { fetchImpl },
  );

  assert.equal(result.skipped, false);
  assert.equal(result.sha256, expected);
  assert.equal(fetched, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'FRESH');
});

test('3) network error en non-optional → throw', async () => {
  const root = tmpRepoLayout();
  const target = path.join(root, 'public', 'models', 'mediapipe', 'missing.task');

  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };

  await assert.rejects(
    mod.downloadIfMissing(
      {
        name: 'missing.task',
        url: 'https://example.com/missing.task',
        sha256: null,
        target,
      },
      { fetchImpl },
    ),
    /ECONNREFUSED/,
  );
});

test('4) network error en optional → skipped, no throw', async () => {
  const root = tmpRepoLayout();
  const target = path.join(root, 'public', 'models', 'mediapipe', 'optional.wasm');

  const fetchImpl = async () => {
    throw new Error('ETIMEDOUT');
  };

  const result = await mod.downloadIfMissing(
    {
      name: 'optional.wasm',
      url: 'https://example.com/optional.wasm',
      sha256: null,
      target,
      optional: true,
    },
    { fetchImpl },
  );

  assert.equal(result.skipped, true);
  assert.equal(result.optional, true);
});
