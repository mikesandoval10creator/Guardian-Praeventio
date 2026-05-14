/**
 * Browser-side envelope encryption — AES-256-GCM con DEK aleatorio
 * per-record, wrapped via un Key Encryption Key (KEK) que vive como
 * `CryptoKey` no-exportable en IndexedDB.
 *
 * Diseñado para protección de datos sensibles que la app TIENE que
 * cachear localmente:
 *   - Respuestas SLM con contenido médico/PHI
 *   - Offline queue entries con datos personales
 *   - Cache de notas de incidente con identificadores de trabajadores
 *
 * Por qué un envelope en el browser:
 *   - IndexedDB se persiste en disco SIN encryption. Quien tenga el
 *     dispositivo en la mano lee todo en texto plano via DevTools.
 *   - SubtleCrypto AES-GCM es side-channel resistente y FIPS 140-2 en
 *     navegadores modernos.
 *   - DEK aleatorio per-record significa que un compromiso de un
 *     blob NO compromete el resto. La rotación de KEK re-envuelve
 *     SOLO los DEKs (~32 bytes c/u), no los ciphertexts grandes.
 *
 * Esto NO sustituye a `kmsEnvelope.ts` (server-side, Cloud KMS) —
 * complementa. Para flujos donde el dato cruza al server, se usa
 * `kmsEnvelope`. Para datos que viven SOLO en el dispositivo, se
 * usa este módulo.
 *
 * Threat model NO cubierto:
 *   - Compromiso del proceso JS en runtime (memoria, browser
 *     extension hostil con permisos). Eso requiere isolation a nivel
 *     OS / extensión permission model.
 *   - User entrega la passphrase a un atacante. Si el usuario
 *     filtra, no podemos protegerlo.
 */

// ────────────────────────────────────────────────────────────────────────
// Tipos del envelope
// ────────────────────────────────────────────────────────────────────────

export interface BrowserEnvelope {
  /** Pinned para evolución. Siempre 'v1' en este release. */
  version: 'v1';
  /** Pinned a AES-256-GCM. */
  algorithm: 'AES-256-GCM';
  /** Ciphertext base64. */
  ciphertext: string;
  /** IV (nonce 12 bytes) base64. */
  iv: string;
  /** DEK wrapped con la KEK del dispositivo, base64. Contiene su propio IV. */
  wrappedDek: WrappedDek;
  /** Timestamp ISO de creación (audit, no se usa en crypto). */
  createdAt: string;
  /** ID opcional del record — útil para correlación. */
  recordId?: string;
}

export interface WrappedDek {
  /** DEK encriptado base64. */
  ciphertext: string;
  /** IV del wrap (12 bytes) base64. */
  iv: string;
}

/** El error que se lanza ante cualquier falla criptográfica. */
export class BrowserEnvelopeError extends Error {
  constructor(
    public readonly code:
      | 'NO_SUBTLE'
      | 'BAD_ENVELOPE'
      | 'DECRYPT_FAIL'
      | 'KEY_GEN_FAIL',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'BrowserEnvelopeError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// SubtleCrypto helpers
// ────────────────────────────────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle || typeof subtle.encrypt !== 'function') {
    throw new BrowserEnvelopeError(
      'NO_SUBTLE',
      'globalThis.crypto.subtle unavailable. Browser too old or non-secure context (HTTP).',
    );
  }
  return subtle;
}

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new BrowserEnvelopeError('NO_SUBTLE', 'globalThis.crypto unavailable.');
  }
  return c;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const IV_BYTES = 12;
const DEK_BITS = 256;

async function generateDek(subtle: SubtleCrypto): Promise<CryptoKey> {
  return subtle.generateKey(
    { name: 'AES-GCM', length: DEK_BITS },
    true, // extractable=true (necesitamos exportar el raw DEK para envolverlo)
    ['encrypt', 'decrypt'],
  );
}

async function exportRawKey(
  subtle: SubtleCrypto,
  key: CryptoKey,
): Promise<Uint8Array> {
  const buf = await subtle.exportKey('raw', key);
  return new Uint8Array(buf);
}

async function importRawDek(
  subtle: SubtleCrypto,
  raw: Uint8Array,
): Promise<CryptoKey> {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Encripta `plaintext` (string UTF-8) con un DEK fresco. El DEK se
 * envuelve con `kek` (CryptoKey AES-GCM no-exportable). El resultado
 * es un envelope serializable que puede persistirse en IndexedDB.
 *
 * @param plaintext   Texto a encriptar (UTF-8).
 * @param kek         Device KEK (`AES-GCM`, no-exportable, persistido
 *                    en IndexedDB via `deviceKek.ts`).
 * @param recordId    ID opcional del registro para correlación.
 */
export async function encryptEnvelope(
  plaintext: string,
  kek: CryptoKey,
  recordId?: string,
): Promise<BrowserEnvelope> {
  const subtle = getSubtle();
  const crypto = getCrypto();

  // 1. Generate fresh DEK + IV for the payload.
  let dek: CryptoKey;
  try {
    dek = await generateDek(subtle);
  } catch (err) {
    throw new BrowserEnvelopeError(
      'KEY_GEN_FAIL',
      `generateKey failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  // 2. Encrypt payload with DEK.
  const payloadBytes = new TextEncoder().encode(plaintext);
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    payloadBytes,
  );

  // 3. Export raw DEK + encrypt it with KEK (wrap).
  const rawDek = await exportRawKey(subtle, dek);
  const dekIv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(dekIv);
  const wrappedDekBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: dekIv },
    kek,
    rawDek,
  );

  return {
    version: 'v1',
    algorithm: 'AES-256-GCM',
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
    wrappedDek: {
      ciphertext: bytesToBase64(new Uint8Array(wrappedDekBuf)),
      iv: bytesToBase64(dekIv),
    },
    createdAt: new Date().toISOString(),
    recordId,
  };
}

/**
 * Desencripta un envelope. La KEK debe ser exactamente la misma que
 * envolvió el DEK (la persistida en IndexedDB del dispositivo).
 *
 * Lanza `BrowserEnvelopeError` con:
 *   - `BAD_ENVELOPE` si el shape no es válido
 *   - `DECRYPT_FAIL` si el authTag GCM no verifica (tampering o
 *     KEK incorrecta)
 */
export async function decryptEnvelope(
  envelope: BrowserEnvelope,
  kek: CryptoKey,
): Promise<string> {
  validateEnvelope(envelope);
  const subtle = getSubtle();

  // 1. Unwrap DEK con KEK.
  let rawDek: Uint8Array;
  try {
    const wrappedDekBytes = base64ToBytes(envelope.wrappedDek.ciphertext);
    const dekIvBytes = base64ToBytes(envelope.wrappedDek.iv);
    const decryptedDekBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: dekIvBytes },
      kek,
      wrappedDekBytes,
    );
    rawDek = new Uint8Array(decryptedDekBuf);
  } catch (err) {
    throw new BrowserEnvelopeError(
      'DECRYPT_FAIL',
      `DEK unwrap failed (wrong KEK or tampered): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Import the raw DEK back as CryptoKey.
  const dek = await importRawDek(subtle, rawDek);

  // 3. Decrypt payload.
  try {
    const cipherBytes = base64ToBytes(envelope.ciphertext);
    const ivBytes = base64ToBytes(envelope.iv);
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      dek,
      cipherBytes,
    );
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    throw new BrowserEnvelopeError(
      'DECRYPT_FAIL',
      `payload decrypt failed (tampered ciphertext or IV): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Type guard estructural — útil cuando se lee del IndexedDB y el shape
 * podría haber drifted en una versión vieja.
 */
export function validateEnvelope(value: unknown): asserts value is BrowserEnvelope {
  if (!value || typeof value !== 'object') {
    throw new BrowserEnvelopeError('BAD_ENVELOPE', 'envelope is not an object');
  }
  const e = value as Partial<BrowserEnvelope>;
  if (e.version !== 'v1') {
    throw new BrowserEnvelopeError(
      'BAD_ENVELOPE',
      `unknown version ${String(e.version)}; only v1 supported`,
    );
  }
  if (e.algorithm !== 'AES-256-GCM') {
    throw new BrowserEnvelopeError(
      'BAD_ENVELOPE',
      `unknown algorithm ${String(e.algorithm)}`,
    );
  }
  if (typeof e.ciphertext !== 'string' || typeof e.iv !== 'string') {
    throw new BrowserEnvelopeError(
      'BAD_ENVELOPE',
      'missing ciphertext or iv',
    );
  }
  if (
    !e.wrappedDek ||
    typeof e.wrappedDek !== 'object' ||
    typeof (e.wrappedDek as WrappedDek).ciphertext !== 'string' ||
    typeof (e.wrappedDek as WrappedDek).iv !== 'string'
  ) {
    throw new BrowserEnvelopeError('BAD_ENVELOPE', 'missing wrappedDek');
  }
}

/**
 * Convenience: re-wrap el DEK de un envelope con una nueva KEK SIN
 * re-encriptar el ciphertext. Útil para rotación de KEK — solo
 * cambian ~60 bytes (wrappedDek) per record, no los KB/MB del
 * ciphertext.
 */
export async function rewrapEnvelope(
  envelope: BrowserEnvelope,
  oldKek: CryptoKey,
  newKek: CryptoKey,
): Promise<BrowserEnvelope> {
  validateEnvelope(envelope);
  const subtle = getSubtle();
  const crypto = getCrypto();

  // 1. Unwrap con old KEK.
  let rawDek: Uint8Array;
  try {
    const wrappedDekBytes = base64ToBytes(envelope.wrappedDek.ciphertext);
    const dekIvBytes = base64ToBytes(envelope.wrappedDek.iv);
    const decryptedBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: dekIvBytes },
      oldKek,
      wrappedDekBytes,
    );
    rawDek = new Uint8Array(decryptedBuf);
  } catch (err) {
    throw new BrowserEnvelopeError(
      'DECRYPT_FAIL',
      `rewrap: old KEK could not unwrap DEK: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Wrap con new KEK (nuevo IV).
  const newDekIv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(newDekIv);
  const newWrappedBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: newDekIv },
    newKek,
    rawDek,
  );

  return {
    ...envelope,
    wrappedDek: {
      ciphertext: bytesToBase64(new Uint8Array(newWrappedBuf)),
      iv: bytesToBase64(newDekIv),
    },
  };
}
