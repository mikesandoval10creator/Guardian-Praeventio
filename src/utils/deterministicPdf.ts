import type { jsPDF } from 'jspdf';

const CHILE_TIME_ZONE = 'America/Santiago';

function validDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('date must be a valid instant');
  return date;
}

/** Stable legal-document date/time independent of the server host timezone. */
export function formatChileDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(validDate(value));
}

/** Stable legal-document calendar date in Chile. */
export function formatChileDate(value: string | Date): string {
  // Legal effective dates are calendar values. UI date inputs are normalized
  // to UTC midnight, which must not become the previous day in Chile.
  if (typeof value === 'string') {
    const calendarDate = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
    if (calendarDate) {
      validDate(value);
      return `${calendarDate[3]}-${calendarDate[2]}-${calendarDate[1]}`;
    }
  }
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(validDate(value));
}

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
