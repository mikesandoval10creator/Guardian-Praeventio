// Praeventio Guard — verificación server-side de la evidencia fotográfica.
//
// El cliente sube los bytes a una ruta content-addressed
// (`projects/{pid}/evidence/{sha256}.{ext}`) y luego registra la metadata.
// Antes de este módulo, el servidor confiaba en el `contentHash` declarado por
// el cliente: un cliente modificado podía subir otros bytes a esa ruta y
// registrar una huella que nunca correspondió al contenido. La evidencia es
// material de auditoría/fiscalización; la huella debe demostrarse, no
// declararse.
//
// Este módulo descarga el objeto exacto desde Storage, recalcula SHA-256 y
// compara también el tamaño. Si no coincide, no se persiste metadata.

import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import {
  buildStoragePath,
  type EvidenceArtifact,
} from '../../services/photoEvidence/photoEvidenceEngine.js';

export type PhotoEvidenceStorageErrorCode =
  | 'evidence_bytes_missing'
  | 'evidence_hash_mismatch'
  | 'evidence_storage_unavailable';

export class PhotoEvidenceStorageError extends Error {
  constructor(
    readonly code: PhotoEvidenceStorageErrorCode,
    readonly httpStatus: 422 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoEvidenceStorageError';
  }
}

/** Inyectable para tests; en producción descarga el bucket por defecto. */
export type DownloadEvidenceBytes = (storagePath: string) => Promise<Buffer>;

function errorCode(err: unknown): unknown {
  return (err as { code?: unknown } | null)?.code;
}

function isStorageNotFound(err: unknown): boolean {
  const code = errorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === 404 ||
    code === '404' ||
    /not.?found|no such object|does not exist/i.test(message)
  );
}

const downloadFromStorage: DownloadEvidenceBytes = async (storagePath) => {
  try {
    const [bytes] = await getStorage().bucket().file(storagePath).download();
    return bytes;
  } catch (err) {
    if (isStorageNotFound(err)) {
      throw new PhotoEvidenceStorageError(
        'evidence_bytes_missing',
        422,
        `No object at ${storagePath}`,
      );
    }
    throw new PhotoEvidenceStorageError(
      'evidence_storage_unavailable',
      503,
      `Storage download failed for ${storagePath}`,
    );
  }
};

/**
 * Verifica que los bytes realmente subidos coincidan con el artifact declarado.
 *
 * Lanza `PhotoEvidenceStorageError` con:
 *   - 422 `evidence_bytes_missing`   → no hay objeto en la ruta esperada.
 *   - 422 `evidence_hash_mismatch`   → el contenido o el tamaño no coinciden.
 *   - 503 `evidence_storage_unavailable` → no se pudo consultar Storage.
 */
export async function verifyUploadedEvidenceBytes(
  artifact: EvidenceArtifact,
  projectId: string,
  downloadBytes: DownloadEvidenceBytes = downloadFromStorage,
): Promise<void> {
  const storagePath = buildStoragePath(artifact, projectId);
  let bytes: Buffer;
  try {
    bytes = await downloadBytes(storagePath);
  } catch (err) {
    if (err instanceof PhotoEvidenceStorageError) throw err;
    if (isStorageNotFound(err)) {
      throw new PhotoEvidenceStorageError(
        'evidence_bytes_missing',
        422,
        `No object at ${storagePath}`,
      );
    }
    throw new PhotoEvidenceStorageError(
      'evidence_storage_unavailable',
      503,
      `Storage download failed for ${storagePath}`,
    );
  }

  if (bytes.length !== artifact.byteSize) {
    throw new PhotoEvidenceStorageError(
      'evidence_hash_mismatch',
      422,
      `byteSize mismatch at ${storagePath}: expected ${artifact.byteSize}, got ${bytes.length}`,
    );
  }

  const actualHash = createHash('sha256')
    .update(bytes)
    .digest('hex')
    .toLowerCase();
  if (actualHash !== artifact.id) {
    throw new PhotoEvidenceStorageError(
      'evidence_hash_mismatch',
      422,
      `sha256 mismatch at ${storagePath}: expected ${artifact.id}, got ${actualHash}`,
    );
  }
}
