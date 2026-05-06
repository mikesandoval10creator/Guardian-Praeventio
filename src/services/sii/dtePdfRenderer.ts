// Praeventio Guard — Sprint 34: DTE PDF renderer.
//
// IMPORTANT (regla de producto inviolable):
//   Praeventio NO push a SII. La empresa cliente imprime/firma/envía.
//   Ver memoria producto product_signing_no_blocking_directives_2026-05-06.
//
// Render visual de la factura/boleta para impresión presencial. Embebe el
// QR canónico SII-style con los campos clave (TipoDTE / Folio / RUTEmisor /
// RUTRecep / FechaEmis / MntTotal / TED hash) que un verificador puede
// usar para checkear el DTE en cuentaverde / SII portal.

import PDFDocument from 'pdfkit';
import type { GeneratedDte } from './dteGenerator';

export interface RenderDtePdfInput {
  dte: GeneratedDte;
  signedAt?: string | null;
  /** Optional override of the line-by-line description rendering. */
  items?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    exemptFromIva?: boolean;
  }>;
  emisorRazonSocial?: string;
  emisorRut?: string;
  emisorGiro?: string;
  receptorRazonSocial?: string;
}

/**
 * Build a Buffer of the rendered PDF. Caller decides whether to base64-
 * encode it (HTTP response) or stream it (Cloud Storage upload).
 */
export async function renderDtePdf(input: RenderDtePdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { dte } = input;
      const tipoLabel =
        dte.summary.type === 33 ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA';

      doc.fontSize(18).text(tipoLabel, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`Folio N° ${dte.summary.folio}`, { align: 'center' });
      doc.fontSize(9).text(`Tipo DTE SII: ${dte.summary.type}`, { align: 'center' });
      doc.moveDown(0.8);

      doc.fontSize(11).text('Emisor:', { underline: true });
      doc.fontSize(10).text(input.emisorRazonSocial ?? 'Praeventio Guard SpA');
      doc.text(`RUT: ${input.emisorRut ?? dte.summary.emisorRut}`);
      if (input.emisorGiro) doc.text(`Giro: ${input.emisorGiro}`);
      doc.moveDown(0.5);

      doc.fontSize(11).text('Receptor:', { underline: true });
      doc.fontSize(10).text(input.receptorRazonSocial ?? '');
      doc.text(`RUT: ${dte.summary.receptorRut}`);
      doc.moveDown(0.5);

      doc.text(`Fecha de emisión: ${dte.summary.fecha}`);
      if (input.signedAt) doc.text(`Firmado: ${input.signedAt}`);
      doc.moveDown(0.6);

      doc.fontSize(11).text('Detalle:', { underline: true });
      doc.fontSize(9);
      const items = input.items ?? [];
      if (items.length === 0) {
        doc.text(`(${dte.summary.itemCount} ítem(s) — ver XML)`);
      } else {
        items.forEach((it, i) => {
          const lineTotal = it.quantity * it.unitPrice;
          doc.text(
            `${i + 1}. ${it.description}  —  ${it.quantity} x $${it.unitPrice.toLocaleString('es-CL')} = $${lineTotal.toLocaleString('es-CL')} CLP${it.exemptFromIva ? ' (exento)' : ''}`,
          );
        });
      }
      doc.moveDown(0.8);

      doc.fontSize(10).text(`Neto:  $${dte.summary.netAmount.toLocaleString('es-CL')} CLP`);
      doc.text(`IVA 19%: $${dte.summary.iva.toLocaleString('es-CL')} CLP`);
      doc.fontSize(12).text(`TOTAL: $${dte.summary.total.toLocaleString('es-CL')} CLP`, { underline: true });

      doc.moveDown(1);
      doc.fontSize(8).fillColor('#555555');
      doc.text(
        'Documento Tributario Electrónico generado por Praeventio Guard. ' +
          'Praeventio NO transmite documentos a SII; la empresa emisora debe imprimir, ' +
          'firmar en persona y entregar este DTE por su canal habitual con SII.',
      );

      // QR canónico SII-style — string codificado con los campos mínimos
      // de verificación. NO es un PNG real (pdfkit no embebe QR sin lib
      // adicional); imprimimos el string base que un generador externo o
      // app móvil puede transformar en QR.
      doc.moveDown(0.8);
      doc.fillColor('#000000').fontSize(7);
      const qrPayload = [
        `TipoDTE=${dte.summary.type}`,
        `Folio=${dte.summary.folio}`,
        `RUTEmisor=${dte.summary.emisorRut}`,
        `RUTRecep=${dte.summary.receptorRut}`,
        `FchEmis=${dte.summary.fecha}`,
        `MntTotal=${dte.summary.total}`,
        `TED=${dte.hash.slice(0, 32)}`,
      ].join(';');
      doc.text(`QR-payload: ${qrPayload}`);

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
