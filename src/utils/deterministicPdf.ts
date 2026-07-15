import type { jsPDF } from 'jspdf';

/**
 * jsPDF otherwise injects a random file ID and the current wall-clock time,
 * making a byte-identical legal document impossible to render twice.
 */
export function configureDeterministicPdf(
  doc: jsPDF,
  documentId: string,
  createdAt: string,
): void {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    throw new TypeError('createdAt must be a valid ISO date for deterministic PDF rendering');
  }
  doc.setCreationDate(created);
  doc.setFileId(stablePdfFileId(documentId));
}

/** Deterministic 128-bit identifier for the PDF trailer; not a security hash. */
export function stablePdfFileId(value: string): string {
  if (!value) throw new TypeError('documentId is required for deterministic PDF rendering');
  const bytes = new TextEncoder().encode(value);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds
    .map((seed) => {
      let hash = seed >>> 0;
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    })
    .join('')
    .toUpperCase();
}
