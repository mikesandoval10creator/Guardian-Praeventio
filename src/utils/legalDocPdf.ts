// Praeventio Guard — Legal document PDF generator.
//
// Renders a legal document (RIOHS / DDR / ODI / PTS / Acta CPHS) produced by
// `services/documents/legalDocTemplates` into a REAL, downloadable PDF.
//
// The template service is 100% deterministic — it substitutes user data into a
// markdown body and cites the Chilean norm that backs each template (Ley
// 16.744, DS 44/2024, DS 54/1969, etc.). This util is the rendering half: it
// takes that rendered markdown + the document title + the legal references and
// produces a paginated A4 PDF in the same visual family as the rest of the
// certificates Praeventio emits (dark header band + teal accent + footer).
//
// Visual style mirrors `ds67Notification.ts` / `susesoCertificate.ts` so every
// document Praeventio emits looks like one family. No LLM, no fabricated data:
// the PDF only contains what the user typed, run through the cited template.

import { jsPDF } from 'jspdf';

const W = 210; // A4 width (mm)
const H = 297; // A4 height (mm)
const M = 18; // page margin (mm)
const CONTENT_TOP = 44; // first text baseline below the header band
const CONTENT_BOTTOM = H - 18; // last usable baseline above the footer band
const LINE_HEIGHT = 5.2; // mm per body line

export interface LegalDocPdfInput {
  /** Document title shown in the header band (e.g. "Reglamento Interno…"). */
  title: string;
  /** Rendered markdown body from `renderLegalDoc`. */
  markdown: string;
  /** Legal references that back the template (cited in the header + footer). */
  references: string[];
}

function drawHeader(doc: jsPDF, title: string, references: string[]): void {
  doc.setFillColor(6, 31, 45);
  doc.rect(0, 0, W, 32, 'F');
  doc.setFillColor(77, 182, 172);
  doc.rect(0, 32, W, 1.2, 'F');

  doc.setFillColor(77, 182, 172);
  doc.roundedRect(M, 8, 16, 16, 3, 3, 'F');
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('P', M + 8, 19, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('GUARDIAN PRAEVENTIO', M + 22, 14);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(212, 175, 55);
  // Title can be long — keep it on one trimmed line in the band.
  const bandTitle = title.length > 70 ? `${title.slice(0, 67)}…` : title;
  doc.text(bandTitle.toUpperCase(), M + 22, 19);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6);
  const refLine = references.join(' · ');
  const bandRefs = refLine.length > 95 ? `${refLine.slice(0, 92)}…` : refLine;
  doc.text(bandRefs, M + 22, 24);
}

function drawFooter(doc: jsPDF, pageNumber: number, totalPages: number): void {
  doc.setFillColor(6, 31, 45);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(
    `Documento generado por Guardian Praeventio  ·  ${new Date().toLocaleString('es-CL')}`,
    W / 2,
    H - 8,
    { align: 'center' },
  );
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(6);
  doc.text(`Página ${pageNumber} / ${totalPages}`, W / 2, H - 3.5, {
    align: 'center',
  });
}

/**
 * Style a single markdown line into the jsPDF font/size and return the text to
 * render (markdown markers stripped). Headings get larger/bold fonts; list
 * items keep their bullet; bold inline `**x**` markers are stripped.
 */
function styleLine(doc: jsPDF, raw: string): string {
  const line = raw.replace(/\*\*(.+?)\*\*/g, '$1');
  if (line.startsWith('# ')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(6, 31, 45);
    return line.slice(2);
  }
  if (line.startsWith('## ')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 70, 90);
    return line.slice(3);
  }
  if (line.startsWith('### ')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    return line.slice(4);
  }
  if (line.startsWith('---')) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    return '────────────────────────';
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(25, 25, 25);
  return line;
}

/**
 * Build the legal-document PDF and return the jsPDF instance (does NOT save).
 * Lays out the rendered markdown body across as many A4 pages as needed.
 */
export function generateLegalDocPdf(input: LegalDocPdfInput): jsPDF {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const rawLines = (input.markdown || '').replace(/\r\n/g, '\n').split('\n');

  // First pass: wrap every source line at the content width so we know the
  // total wrapped-line count (→ page count) before drawing footers.
  type Wrapped = { text: string; font: 'normal' | 'bold'; size: number; color: [number, number, number] };
  const wrapped: Wrapped[] = [];
  for (const raw of rawLines) {
    const styled = styleLine(doc, raw);
    // styleLine mutates the doc font state; capture it for the wrap width.
    const size = doc.getFontSize();
    const isBold = raw.startsWith('#');
    if (styled.trim().length === 0) {
      wrapped.push({ text: '', font: 'normal', size: 9.5, color: [25, 25, 25] });
      continue;
    }
    const parts: string[] = doc.splitTextToSize(styled, W - M * 2);
    const color = raw.startsWith('# ')
      ? ([6, 31, 45] as [number, number, number])
      : raw.startsWith('## ')
        ? ([20, 70, 90] as [number, number, number])
        : raw.startsWith('### ')
          ? ([40, 40, 40] as [number, number, number])
          : raw.startsWith('---')
            ? ([150, 150, 150] as [number, number, number])
            : ([25, 25, 25] as [number, number, number]);
    for (const p of parts) {
      wrapped.push({ text: p, font: isBold ? 'bold' : 'normal', size, color });
    }
  }

  const linesPerPage = Math.floor((CONTENT_BOTTOM - CONTENT_TOP) / LINE_HEIGHT);
  const totalPages = Math.max(1, Math.ceil(wrapped.length / linesPerPage));

  let page = 1;
  let y = CONTENT_TOP;
  drawHeader(doc, input.title, input.references);

  for (const w of wrapped) {
    if (y > CONTENT_BOTTOM) {
      drawFooter(doc, page, totalPages);
      doc.addPage();
      page += 1;
      drawHeader(doc, input.title, input.references);
      y = CONTENT_TOP;
    }
    if (w.text.length > 0) {
      doc.setFont('helvetica', w.font);
      doc.setFontSize(w.size);
      doc.setTextColor(...w.color);
      doc.text(w.text, M, y);
    }
    y += LINE_HEIGHT;
  }

  drawFooter(doc, page, totalPages);
  return doc;
}

/** Slugify a string into a filename-safe token. */
function slug(s: string): string {
  return (s || 'documento')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'documento';
}

/**
 * Build the legal-document PDF and trigger a browser download with a
 * deterministic filename derived from the document kind + title + date.
 */
export function downloadLegalDocPdf(
  input: LegalDocPdfInput,
  kind: string,
  filename?: string,
): void {
  const pdf = generateLegalDocPdf(input);
  const date = new Date().toISOString().slice(0, 10);
  const fname = filename ?? `${slug(kind)}_${slug(input.title)}_${date}.pdf`;
  pdf.save(fname);
}
