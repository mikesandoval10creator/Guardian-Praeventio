// Praeventio Guard — Sprint 39 Fase B.5: DIAT/DIEP PDF renderer.
//
// Closes audit hallazgo H28 (Truth Matrix STUB confirmado): hasta Sprint 38
// `services/suseso/folioGenerator.ts` + `susesoService.ts` existían (folio
// atómico + estructura de datos), pero NO había generación PDF real. El
// BACKLOG decía "PDF + folio + firma + verify público" ✅; solo el folio
// estaba.
//
// Reusa el patrón de `services/sii/dtePdfRenderer.ts` (también con pdfkit):
// mismo enfoque "Buffer in, Buffer out" para que el caller decida si
// base64-encode (HTTP) o stream (Cloud Storage).
//
// IMPORTANT (regla de producto inviolable):
//   Praeventio NO envía DIAT/DIEP a SUSESO directamente. La empresa
//   imprime/firma/sube al portal mutualidad. Ver memoria producto
//   product_signing_no_blocking_directives_2026-05-06.
//
// El renderer es PURO (sin filesystem I/O, sin Storage). El caller hace
// el upload + persistencia del nodo DOCUMENT (Fase C.7).

import PDFDocument from 'pdfkit';
import type { SusesoForm } from './types.js';

const SUSESO_BODY_PARTS_SUMMARY_MAX_CHARS = 220;

export interface RenderSusesoPdfInput {
  form: SusesoForm;
  /**
   * Optional override of the company logo PNG bytes. When omitted, no
   * logo is rendered (only the SUSESO official header is shown).
   */
  logoPngBytes?: Buffer;
  /**
   * Public verify URL embedded as plain text (operario lee + tipea o
   * escanea en otra app). El QR canónico está en `services/suseso/qr.ts`
   * (Sprint 28); este renderer recibe la URL ya construida para no
   * acoplarse al schema del QR.
   */
  verifyUrl?: string;
}

const KIND_TITLE: Record<SusesoForm['kind'], string> = {
  DIAT: 'DECLARACIÓN INDIVIDUAL DE ACCIDENTE DEL TRABAJO',
  DIEP: 'DECLARACIÓN INDIVIDUAL DE ENFERMEDAD PROFESIONAL',
};

const MUTUALIDAD_LABEL: Record<SusesoForm['mutualidad'], string> = {
  achs: 'ACHS — Asociación Chilena de Seguridad',
  mutual_seguridad: 'Mutual de Seguridad CChC',
  ist: 'IST — Instituto de Seguridad del Trabajo',
  isl: 'ISL — Instituto de Seguridad Laboral',
};

const CLASSIFICATION_LABEL = {
  accidente_trabajo: 'Accidente del trabajo',
  enfermedad_profesional: 'Enfermedad profesional',
  accidente_trayecto: 'Accidente de trayecto',
} as const;

/**
 * Build a Buffer of the rendered DIAT/DIEP PDF.
 *
 * The PDF layout is intentionally austere — the mutualidad operator
 * needs to read every field. Avoid decorative graphics; aim for high
 * contrast on B/W printers.
 */
export async function renderSusesoPdf(
  input: RenderSusesoPdfInput,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const { form } = input;
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ──────────────────────────────────────────────────────
      doc.fontSize(16).text(KIND_TITLE[form.kind], { align: 'center' });
      doc.moveDown(0.2);
      doc
        .fontSize(9)
        .text(
          form.kind === 'DIAT'
            ? 'DS 101 — Ley 16.744 art. 76'
            : 'DS 109 + DS 110 — Calificación enfermedad profesional',
          { align: 'center' },
        );
      doc.moveDown(0.4);
      doc.fontSize(11).text(`Folio: ${form.folio}`, { align: 'center' });
      doc.fontSize(9).text(`Emitido: ${form.createdAt}`, { align: 'center' });
      doc.moveDown(0.8);

      // ── Trabajador ──────────────────────────────────────────────────
      section(doc, '1. TRABAJADOR ACCIDENTADO');
      field(doc, 'Nombre completo', form.workerFullName);
      field(doc, 'RUT', form.workerRut);
      doc.moveDown(0.4);

      // ── Empleador ───────────────────────────────────────────────────
      section(doc, '2. EMPLEADOR');
      field(doc, 'Razón social', form.companyName);
      field(doc, 'RUT empresa', form.companyRut);
      field(doc, 'Organismo administrador', MUTUALIDAD_LABEL[form.mutualidad]);
      doc.moveDown(0.4);

      // ── Incidente ───────────────────────────────────────────────────
      section(doc, '3. CIRCUNSTANCIAS DEL HECHO');
      field(doc, 'Fecha del hecho', form.incidentDate);
      field(doc, 'Lugar', form.incidentLocation);
      field(doc, 'Clasificación', CLASSIFICATION_LABEL[form.incidentClassification]);
      if (form.kind === 'DIAT' && form.ds101Causal) {
        field(doc, 'Causal DS 101', form.ds101Causal);
      }
      if (form.kind === 'DIEP' && form.ds110Causal) {
        field(doc, 'Causal DS 110', form.ds110Causal);
      }
      field(doc, 'Descripción', form.incidentDescription, { multiline: true });
      field(
        doc,
        'Partes del cuerpo afectadas',
        truncate(
          form.bodyPartsAffected.join(', '),
          SUSESO_BODY_PARTS_SUMMARY_MAX_CHARS,
        ),
        { multiline: true },
      );
      doc.moveDown(0.4);

      // ── Testigos ────────────────────────────────────────────────────
      section(doc, '4. TESTIGOS');
      if (form.witnesses.length === 0) {
        doc.fontSize(9).text('Sin testigos declarados.', { indent: 10 });
      } else {
        form.witnesses.forEach((w, i) => {
          doc
            .fontSize(9)
            .text(`${i + 1}. ${w.fullName} — RUT ${w.rut}`, { indent: 10 });
        });
      }
      doc.moveDown(0.4);

      // ── Quien reporta ───────────────────────────────────────────────
      section(doc, '5. QUIEN REPORTA');
      field(doc, 'Nombre', form.reportedBy.fullName);
      field(doc, 'RUT', form.reportedBy.rut);
      doc.moveDown(0.4);

      // ── Firma electrónica ───────────────────────────────────────────
      section(doc, '6. FIRMA ELECTRÓNICA');
      if (form.signature) {
        field(doc, 'Firmante UID', form.signature.signerUid);
        field(doc, 'Firmante RUT', form.signature.signerRut);
        field(doc, 'Fecha firma', form.signature.signedAt);
        field(doc, 'Algoritmo', form.signature.algorithm);
        field(
          doc,
          'Hash SHA-256 del cuerpo',
          form.signature.payloadHashHex.slice(0, 32) + '…',
        );
      } else {
        doc
          .fontSize(9)
          .fillColor('#aa0000')
          .text('PENDIENTE DE FIRMA — este documento no es válido aún.', {
            indent: 10,
          })
          .fillColor('black');
      }
      doc.moveDown(0.6);

      // ── Verify URL ──────────────────────────────────────────────────
      if (input.verifyUrl) {
        doc.fontSize(8).text(
          `Verificación pública: ${input.verifyUrl}`,
          { align: 'center' },
        );
      }

      // ── Disclaimer ──────────────────────────────────────────────────
      doc.moveDown(0.4);
      doc
        .fontSize(7)
        .fillColor('#555555')
        .text(
          'Documento generado por Praeventio Guard conforme a Ley 16.744. ' +
            'La empresa debe imprimir, firmar (firma simple Ley 19.799 art. 3) ' +
            'y entregar este formulario a la mutualidad indicada. Praeventio ' +
            'NO envía este formulario a SUSESO automáticamente.',
          { align: 'center' },
        )
        .fillColor('black');

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(11).fillColor('#003366').text(title, { underline: true });
  doc.fillColor('black').fontSize(9);
}

function field(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  opts: { multiline?: boolean } = {},
): void {
  doc.fontSize(9).text(`${label}: `, { continued: !opts.multiline, indent: 10 });
  if (opts.multiline) {
    doc.text(value || '—', { indent: 20 });
  } else {
    doc.text(value || '—');
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
