// SPDX-License-Identifier: MIT
//
// Sprint 26 — File Chunker (ADR 0013)
//
// Helpers puros para chunkear/reconstruir archivos en la red mesh.
// BLE típicamente tolera ~512 bytes por chunk; los callers son libres
// de pasar otro tamaño cuando el transport lo permita (Wi-Fi Direct).
//
// Función pura — no toca transport ni IndexedDB. Sirve tanto al peer
// que responde un file_request (chunkBlob) como al peer que reconstruye
// (reconstructBlob) los chunks recibidos.

/**
 * Parte un Blob en chunks de tamaño máximo `chunkSize` bytes.
 * El último chunk puede ser más pequeño que `chunkSize`. Vacío produce
 * un array vacío.
 */
export async function chunkBlob(
  blob: Blob,
  chunkSize: number,
): Promise<Uint8Array[]> {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be > 0');
  }
  if (blob.size === 0) {
    return [];
  }

  const buffer = new Uint8Array(await blob.arrayBuffer());
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, buffer.length);
    // slice() copia, no comparte el buffer subyacente — seguro para
    // mutaciones posteriores del caller.
    chunks.push(buffer.slice(offset, end));
  }
  return chunks;
}

/**
 * Reconstruye un Blob a partir de chunks Uint8Array previamente cortados
 * por `chunkBlob`. El caller es responsable de pasar los chunks en el
 * orden correcto (chunkIndex ascendente).
 */
export function reconstructBlob(
  chunks: Uint8Array[],
  mimeType: string,
): Blob {
  // Blob acepta directamente BlobPart[] que incluye Uint8Array.
  return new Blob(chunks as BlobPart[], { type: mimeType });
}

/**
 * SHA-256 hex del contenido del Blob. Usa Web Crypto cuando está
 * disponible (navegador + node 20+) y cae a node:crypto en el resto.
 */
export async function computeContentHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const subtle = (
    globalThis as { crypto?: { subtle?: SubtleCrypto } }
  ).crypto?.subtle;

  if (subtle && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', buffer);
    return bufferToHex(new Uint8Array(digest));
  }

  // Fallback Node sin Web Crypto (extremadamente raro en el target,
  // pero conservamos el camino para entornos Vitest viejos).
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

function bufferToHex(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}
