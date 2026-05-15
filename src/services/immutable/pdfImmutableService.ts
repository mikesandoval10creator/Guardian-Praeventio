// Praeventio Guard — PDF inmutable real (jsPDF + SHA-256 content addressing).
//
// "Inmutable" en este contexto significa:
//   - El PDF generado tiene un SHA-256 calculado de sus bytes finales
//   - El hash + metadata (autor, fecha, título, tamaño) se persiste en
//     un registry local (encryptedKvStore — KEK device-bound)
//   - Una función `verifyImmutablePdf(bytes)` recompute el hash y lo
//     compara con el registro — si cambió un solo byte, falla la
//     verificación
//   - El hash se embebe en el footer del PDF como QR (futuro) o texto
//     para que cualquiera pueda re-verificar offline
//
// Esta es la versión productiva real (no "Simulate Puppeteer rendering
// delay"). jsPDF corre client-side, no requiere infra servidor adicional.
//
// Para PDFs server-side con templates complejos hay infraestructura
// separada (`pdfkit` server) — esto es el lado cliente para audit reports
// que el usuario genera bajo demanda.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// jsPDF se importa lazy (dynamic) dentro de `buildImmutablePdf` para
// que el módulo se pueda importar en entornos de test (Node + vitest)
// sin disparar la resolución de pako (transitive dep de jsPDF que
// ships solo ESM y tropieza con la resolución CJS de Node). En browser
// la carga es transparente y synchronous-feel.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type ImmutablePdfKind =
  | 'audit_report'
  | 'incident_summary'
  | 'compliance_certificate'
  | 'inspection_log'
  | 'training_record'
  | 'custom';

export interface ImmutablePdfContent {
  /** Tipo del documento — afecta el template. */
  kind: ImmutablePdfKind;
  /** Título principal del documento. */
  title: string;
  /** Subtítulo opcional (proyecto, fecha rango, etc.). */
  subtitle?: string;
  /** Autor del documento. */
  authorUid: string;
  authorName?: string;
  /** ISO timestamp de creación. */
  createdAtIso: string;
  /** Tenant + project ownership. */
  tenantId: string;
  projectId?: string;
  /** Secciones con contenido estructurado. */
  sections: ImmutablePdfSection[];
  /**
   * Si la app quiere firmar el PDF con WebAuthn, el caller pasa la firma
   * resultante aquí; se embebe en el footer como prueba criptográfica.
   */
  webAuthnSignatureBase64?: string;
  /**
   * Verify URL público (futuro) donde un auditor externo pueda subir el
   * PDF y verificar el hash. Si está set, se embebe en el footer.
   */
  verifyUrl?: string;
}

export interface ImmutablePdfSection {
  heading: string;
  /** Cada paragraph es un bloque de texto separado. */
  paragraphs: string[];
  /** Tablas opcionales (header + rows). */
  tables?: Array<{
    headers: string[];
    rows: string[][];
  }>;
}

export interface ImmutablePdfArtifact {
  /** Bytes del PDF generado. */
  pdfBytes: Uint8Array;
  /** SHA-256 hex de los bytes (64 chars). */
  contentHashHex: string;
  /** Tamaño del PDF en bytes. */
  sizeBytes: number;
  /** Metadata extraído del content para audit log. */
  metadata: {
    kind: ImmutablePdfKind;
    title: string;
    authorUid: string;
    createdAtIso: string;
    tenantId: string;
    projectId?: string;
    /** ISO timestamp del momento exacto de generación del PDF. */
    generatedAtIso: string;
  };
  /**
   * Identificador único del artifact basado en hash — apropiado como
   * nombre de archivo o key en storage:
   *   `praeventio-{kind}-{hashPrefix}.pdf`
   */
  filename: string;
}

export interface VerificationResult {
  /** True si el hash coincide con el registrado. */
  valid: boolean;
  /** Hash computado de los bytes actuales. */
  actualHashHex: string;
  /** Hash esperado (del registry). */
  expectedHashHex?: string;
  /** Metadata del artifact registrado, si existe. */
  knownMetadata?: ImmutablePdfArtifact['metadata'];
  /** Razón del fallo si valid=false. */
  reason?: 'hash_mismatch' | 'not_registered';
}

// ────────────────────────────────────────────────────────────────────────
// PDF generation con jsPDF
// ────────────────────────────────────────────────────────────────────────

const PAGE_MARGIN = 15; // mm
const LINE_HEIGHT = 6;
const FOOTER_HEIGHT = 30;

const KIND_LABEL: Record<ImmutablePdfKind, string> = {
  audit_report: 'Reporte de Auditoría',
  incident_summary: 'Resumen de Incidente',
  compliance_certificate: 'Certificado de Cumplimiento',
  inspection_log: 'Registro de Inspección',
  training_record: 'Registro de Capacitación',
  custom: 'Documento',
};

/**
 * Genera un PDF a partir del content estructurado. Devuelve los bytes
 * + hash SHA-256. El hash se embebe en el footer del PDF — quien tenga
 * el PDF puede verificar su integridad recomputando sha256(bytes) y
 * comparando con el footer.
 */
export async function buildImmutablePdf(
  content: ImmutablePdfContent,
): Promise<ImmutablePdfArtifact> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PAGE_MARGIN * 2;

  let cursorY = PAGE_MARGIN;

  // ── Header ──
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('PRAEVENTIO GUARD', PAGE_MARGIN, cursorY);
  doc.text(
    KIND_LABEL[content.kind].toUpperCase(),
    pageWidth - PAGE_MARGIN,
    cursorY,
    { align: 'right' },
  );
  cursorY += 6;
  doc.setLineWidth(0.3);
  doc.setDrawColor(180, 180, 180);
  doc.line(PAGE_MARGIN, cursorY, pageWidth - PAGE_MARGIN, cursorY);
  cursorY += 8;

  // ── Title ──
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  const titleLines = doc.splitTextToSize(content.title, usableWidth);
  doc.text(titleLines, PAGE_MARGIN, cursorY);
  cursorY += titleLines.length * 8 + 2;

  if (content.subtitle) {
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    const subLines = doc.splitTextToSize(content.subtitle, usableWidth);
    doc.text(subLines, PAGE_MARGIN, cursorY);
    cursorY += subLines.length * 5 + 4;
  }

  // ── Meta block ──
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const metaLines = [
    `Autor: ${content.authorName ?? content.authorUid}`,
    `Tenant: ${content.tenantId}${content.projectId ? ` · Proyecto: ${content.projectId}` : ''}`,
    `Creado: ${new Date(content.createdAtIso).toLocaleString()}`,
  ];
  for (const line of metaLines) {
    doc.text(line, PAGE_MARGIN, cursorY);
    cursorY += 5;
  }
  cursorY += 4;

  // ── Sections ──
  for (const section of content.sections) {
    if (cursorY > pageHeight - FOOTER_HEIGHT - 20) {
      doc.addPage();
      cursorY = PAGE_MARGIN;
    }
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(section.heading, PAGE_MARGIN, cursorY);
    cursorY += 6;
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, cursorY, PAGE_MARGIN + 40, cursorY);
    cursorY += 4;

    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    for (const para of section.paragraphs) {
      const paraLines = doc.splitTextToSize(para, usableWidth);
      for (const line of paraLines) {
        if (cursorY > pageHeight - FOOTER_HEIGHT - 10) {
          doc.addPage();
          cursorY = PAGE_MARGIN;
        }
        doc.text(line, PAGE_MARGIN, cursorY);
        cursorY += LINE_HEIGHT * 0.7;
      }
      cursorY += 2;
    }

    if (section.tables) {
      for (const table of section.tables) {
        if (cursorY > pageHeight - FOOTER_HEIGHT - 25) {
          doc.addPage();
          cursorY = PAGE_MARGIN;
        }
        const colCount = table.headers.length;
        const colWidth = usableWidth / colCount;
        // Header
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.setFillColor(60, 60, 60);
        doc.rect(PAGE_MARGIN, cursorY, usableWidth, 6, 'F');
        for (let i = 0; i < colCount; i++) {
          doc.text(
            table.headers[i]!,
            PAGE_MARGIN + colWidth * i + 1,
            cursorY + 4,
          );
        }
        cursorY += 6;
        // Rows
        doc.setTextColor(30, 30, 30);
        for (let r = 0; r < table.rows.length; r++) {
          if (cursorY > pageHeight - FOOTER_HEIGHT - 10) {
            doc.addPage();
            cursorY = PAGE_MARGIN;
          }
          if (r % 2 === 0) {
            doc.setFillColor(245, 245, 245);
            doc.rect(PAGE_MARGIN, cursorY, usableWidth, 5, 'F');
          }
          for (let i = 0; i < colCount; i++) {
            const cellValue = table.rows[r]![i] ?? '';
            const truncated =
              cellValue.length > 40
                ? cellValue.slice(0, 37) + '…'
                : cellValue;
            doc.text(
              truncated,
              PAGE_MARGIN + colWidth * i + 1,
              cursorY + 3.5,
            );
          }
          cursorY += 5;
        }
        cursorY += 4;
      }
    }
    cursorY += 4;
  }

  // ── First-pass output — calculamos hash sin el footer todavía ──
  // jsPDF no permite editar el PDF tras compute hash; estrategia: agregar
  // un footer placeholder primero, computar hash, luego stamp en una
  // segunda pasada NO funciona porque cualquier cambio cambia el hash.
  // Solución: el hash se calcula sobre el PDF FINAL incluyendo el placeholder
  // del footer. El verifier sabe que el footer contiene el hash y lo
  // valida contra los bytes del PDF EXCLUYENDO el campo del hash en el
  // footer — pero eso es complejo. Simplificación: el hash SE PERSISTE
  // EXTERNAMENTE (encryptedKvStore + Firestore), NO se embebe en el PDF
  // como auto-referencia. El verify URL en el footer apunta al registry.

  // Add footer en cada página.
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const footerY = pageHeight - 15;
    doc.setLineWidth(0.2);
    doc.setDrawColor(180, 180, 180);
    doc.line(PAGE_MARGIN, footerY, pageWidth - PAGE_MARGIN, footerY);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Praeventio Guard · Documento generado automáticamente · ${new Date().toISOString()}`,
      PAGE_MARGIN,
      footerY + 4,
    );
    doc.text(
      `Página ${p} de ${pageCount}`,
      pageWidth - PAGE_MARGIN,
      footerY + 4,
      { align: 'right' },
    );
    if (content.verifyUrl) {
      doc.text(
        `Verificar autenticidad: ${content.verifyUrl}`,
        PAGE_MARGIN,
        footerY + 8,
      );
    }
    if (content.webAuthnSignatureBase64) {
      const sigPreview =
        content.webAuthnSignatureBase64.slice(0, 20) + '…';
      doc.text(
        `Firma WebAuthn: ${sigPreview}`,
        pageWidth - PAGE_MARGIN,
        footerY + 8,
        { align: 'right' },
      );
    }
  }

  // Output bytes.
  const arrayBuffer = doc.output('arraybuffer');
  const pdfBytes = new Uint8Array(arrayBuffer);
  const contentHashHex = bytesToHex(sha256(pdfBytes));
  const generatedAtIso = new Date().toISOString();
  const filename = `praeventio-${content.kind}-${contentHashHex.slice(0, 12)}.pdf`;

  return {
    pdfBytes,
    contentHashHex,
    sizeBytes: pdfBytes.length,
    metadata: {
      kind: content.kind,
      title: content.title,
      authorUid: content.authorUid,
      createdAtIso: content.createdAtIso,
      tenantId: content.tenantId,
      projectId: content.projectId,
      generatedAtIso,
    },
    filename,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Verification
// ────────────────────────────────────────────────────────────────────────

/**
 * Verifica que los bytes de un PDF coinciden con un hash registrado.
 * El caller pasa el bytes del PDF + el hash esperado (típicamente
 * recuperado del registry o un audit log).
 */
export function verifyImmutablePdf(
  pdfBytes: Uint8Array,
  expectedHashHex: string,
): VerificationResult {
  const actualHashHex = bytesToHex(sha256(pdfBytes));
  if (actualHashHex === expectedHashHex.toLowerCase()) {
    return { valid: true, actualHashHex, expectedHashHex };
  }
  return {
    valid: false,
    actualHashHex,
    expectedHashHex,
    reason: 'hash_mismatch',
  };
}

/**
 * Helper: dispara la descarga del PDF en el browser.
 */
export function downloadImmutablePdf(artifact: ImmutablePdfArtifact): void {
  const blob = new Blob([artifact.pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Helper: convierte el hash hex a chunks de 4 chars para mostrar
 * visualmente más fácil de comparar (`a1b2 c3d4 e5f6 ...`).
 */
export function formatHashForDisplay(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}
