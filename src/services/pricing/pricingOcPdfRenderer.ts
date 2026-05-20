// Praeventio Guard — Bloque 8.4 (D5): Pricing OC (Orden de Compra) PDF renderer.
//
// Cierra TODO §177 "pdf_emission_pending_sprint_k_177" en `PricingCalculator.tsx`.
// Antes el botón "Generar OC" descargaba un JSON; ahora genera un PDF formal
// con header empresa + tabla items EPP + total + footer firma.
//
// Reusa el patrón de `services/suseso/diatPdfRenderer.ts` (Buffer in,
// Buffer out) para que el caller decida si base64-encode (download HTTP)
// o stream (Cloud Storage).
//
// IMPORTANT (regla producto):
//   El PDF es REFERENCIAL — sugerencia de OC para el equipo de Compras de
//   la empresa cliente. NO se envía automáticamente a proveedores. La
//   empresa firma+entrega manualmente (memoria
//   product_signing_no_blocking_directives_2026-05-06).
//
// El renderer es PURO (sin filesystem I/O, sin Storage). El caller hace
// el upload + persistencia.

import PDFDocument from 'pdfkit';

const HEADER_FONT_SIZE = 14;
const TITLE_FONT_SIZE = 20;
const TABLE_FONT_SIZE = 10;
const FOOTER_FONT_SIZE = 8;

export interface PricingOcItem {
  /** EPP kind canonical (helmet/gloves/boots/...). */
  kind: string;
  /** Display label (e.g. "Casco con barbiquejo"). */
  label: string;
  /** Cantidad necesaria. */
  qty: number;
  /** Costo unitario CLP. */
  unitCostClp: number;
  /** Cantidad ya en inventario (descuento sobre qty). */
  inStockQty?: number;
}

export interface PricingOcContext {
  /** Razón social del cliente (empresa receptora). */
  clientRazonSocial: string;
  /** RUT chileno del cliente (con DV). */
  clientRut: string;
  /** Dirección o faena de entrega. */
  clientAddress?: string;
  /** Industria seleccionada en wizard (referencia). */
  industryLabel?: string;
  /** Plan/tier recomendado (referencia). */
  recommendedTier?: string;
  /** Workers totales del proyecto (referencia). */
  workersCount?: number;
  /** Proyectos activos (referencia). */
  projectsCount?: number;
}

export interface RenderPricingOcPdfInput {
  /** Contexto del cliente + plan. */
  context: PricingOcContext;
  /** Items EPP a comprar. */
  items: PricingOcItem[];
  /** ISO 8601 timestamp de emisión (default: ahora). */
  emittedAtIso?: string;
  /** Folio referencial (Sprint K §177 — no SUSESO, solo trazabilidad interna). */
  folio?: string;
  /** Logo PNG bytes opcional. */
  logoPngBytes?: Buffer;
  /** URL verify pública (cuando exista). */
  verifyUrl?: string;
}

export interface PricingOcPdfTotals {
  subtotalClp: number;
  taxClp: number;
  totalClp: number;
}

/**
 * Calcula totales determinísticamente (sin floats, redondeo a peso).
 * IVA Chile = 19% (Ley 825/74). Aplicado sobre subtotal post-stock-discount.
 */
export function computeOcTotals(items: PricingOcItem[]): PricingOcPdfTotals {
  const subtotalClp = items.reduce((acc, item) => {
    const effectiveQty = Math.max(0, item.qty - (item.inStockQty ?? 0));
    return acc + effectiveQty * item.unitCostClp;
  }, 0);
  const taxClp = Math.round(subtotalClp * 0.19);
  const totalClp = subtotalClp + taxClp;
  return { subtotalClp, taxClp, totalClp };
}

function formatClp(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

/**
 * Render Orden de Compra PDF en Buffer.
 *
 * Caller responsabilidades:
 *   - Hacer upload a Cloud Storage si quiere persistir.
 *   - Servir como `application/pdf` con `Content-Disposition: attachment`
 *     si downloadear desde browser.
 *   - Registrar nodo DOCUMENT en Zettelkasten cuando aplique (Fase C.7).
 */
export function renderPricingOcPdf(
  input: RenderPricingOcPdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        info: {
          Title: `Orden de Compra EPP — ${input.context.clientRazonSocial}`,
          Author: 'Praeventio Guard',
          Subject: 'Orden de Compra (referencial) EPP',
          Keywords: 'EPP, Orden de Compra, DS 44/2024, Ley 16.744',
          CreationDate: input.emittedAtIso ? new Date(input.emittedAtIso) : new Date(),
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const totals = computeOcTotals(input.items);
      const emittedAt = input.emittedAtIso ?? new Date().toISOString();

      // ─── HEADER ──────────────────────────────────────────────────────
      if (input.logoPngBytes) {
        try {
          doc.image(input.logoPngBytes, 50, 50, { width: 60 });
        } catch {
          // Fallback silencioso si el logo no es PNG válido — el render
          // debe continuar (regla producto: nunca bloquear emisión OC).
        }
      }

      doc
        .fontSize(TITLE_FONT_SIZE)
        .font('Helvetica-Bold')
        .text('ORDEN DE COMPRA — EPP', 120, 60, { align: 'left' });

      doc
        .fontSize(FOOTER_FONT_SIZE)
        .font('Helvetica')
        .fillColor('#666666')
        .text('Documento referencial — Praeventio Guard', 120, 85);

      doc.fillColor('#000000');

      // ─── METADATA ─────────────────────────────────────────────────────
      doc.moveDown(2);
      const metaY = 130;
      doc.fontSize(HEADER_FONT_SIZE).font('Helvetica-Bold').text('Cliente', 50, metaY);
      doc.fontSize(10).font('Helvetica');
      doc.text(input.context.clientRazonSocial, 50, metaY + 18);
      doc.text(`RUT: ${input.context.clientRut}`, 50, metaY + 32);
      if (input.context.clientAddress) {
        doc.text(input.context.clientAddress, 50, metaY + 46);
      }

      // Right column: meta info
      const rightX = 380;
      doc.fontSize(HEADER_FONT_SIZE).font('Helvetica-Bold').text('Emisión', rightX, metaY);
      doc.fontSize(10).font('Helvetica');
      doc.text(formatDate(emittedAt), rightX, metaY + 18);
      if (input.folio) {
        doc.text(`Folio: ${input.folio}`, rightX, metaY + 32);
      }
      if (input.context.recommendedTier) {
        doc.text(`Plan: ${input.context.recommendedTier}`, rightX, metaY + 46);
      }

      // ─── ITEMS TABLE ─────────────────────────────────────────────────
      let tableY = 230;
      doc.fontSize(HEADER_FONT_SIZE).font('Helvetica-Bold').text('Items', 50, tableY);
      tableY += 20;

      const colX = { item: 50, qty: 320, unit: 380, sub: 470 };
      doc.fontSize(TABLE_FONT_SIZE).font('Helvetica-Bold');
      doc.text('Descripción', colX.item, tableY);
      doc.text('Cant.', colX.qty, tableY, { width: 50, align: 'right' });
      doc.text('Unit. (CLP)', colX.unit, tableY, { width: 80, align: 'right' });
      doc.text('Subtotal', colX.sub, tableY, { width: 80, align: 'right' });
      tableY += 5;
      doc
        .moveTo(50, tableY + 12)
        .lineTo(550, tableY + 12)
        .strokeColor('#cccccc')
        .stroke();
      tableY += 16;

      doc.font('Helvetica');
      for (const item of input.items) {
        const effectiveQty = Math.max(0, item.qty - (item.inStockQty ?? 0));
        const subtotal = effectiveQty * item.unitCostClp;

        const label =
          item.inStockQty && item.inStockQty > 0
            ? `${item.label} (req. ${item.qty}, en stock ${item.inStockQty})`
            : item.label;

        doc.text(label, colX.item, tableY, { width: 260 });
        doc.text(String(effectiveQty), colX.qty, tableY, { width: 50, align: 'right' });
        doc.text(formatClp(item.unitCostClp), colX.unit, tableY, {
          width: 80,
          align: 'right',
        });
        doc.text(formatClp(subtotal), colX.sub, tableY, { width: 80, align: 'right' });
        tableY += 18;

        if (tableY > 680) {
          doc.addPage();
          tableY = 60;
        }
      }

      // ─── TOTALS ──────────────────────────────────────────────────────
      tableY += 12;
      doc.moveTo(330, tableY).lineTo(550, tableY).strokeColor('#000000').stroke();
      tableY += 8;
      doc.font('Helvetica').fontSize(10);
      doc.text('Subtotal:', 380, tableY, { width: 80, align: 'right' });
      doc.text(formatClp(totals.subtotalClp), colX.sub, tableY, { width: 80, align: 'right' });
      tableY += 16;
      doc.text('IVA (19%):', 380, tableY, { width: 80, align: 'right' });
      doc.text(formatClp(totals.taxClp), colX.sub, tableY, { width: 80, align: 'right' });
      tableY += 18;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('TOTAL:', 380, tableY, { width: 80, align: 'right' });
      doc.text(formatClp(totals.totalClp), colX.sub, tableY, { width: 80, align: 'right' });

      // ─── FOOTER ──────────────────────────────────────────────────────
      doc
        .font('Helvetica')
        .fontSize(FOOTER_FONT_SIZE)
        .fillColor('#666666')
        .text(
          'Esta OC es REFERENCIAL — sugerencia de compra basada en plan recomendado y catálogo EPP por industria. ' +
            'No constituye orden formal hasta firma del responsable de Compras de la empresa. ' +
            'Precios indicativos según ACHS/Mutual de Seguridad 2024-2025. ' +
            'IVA 19% Ley 825/74.',
          50,
          700,
          { width: 500, align: 'justify' },
        );

      if (input.verifyUrl) {
        doc.text(`Verificar autenticidad: ${input.verifyUrl}`, 50, 740, {
          width: 500,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
