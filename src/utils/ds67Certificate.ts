// Praeventio Guard — Sprint 31 Bucket PP.
//
// PDF generator for DS 67 — Reglamento Interno de Higiene y Seguridad.
// Visual style mirrors `susesoCertificate.ts` so all Praeventio-issued
// regulatory documents look like one family.
//
// Output contract: `generateDs67Pdf` returns the binary PDF bytes
// (Uint8Array) so the caller can hash them for the signature payload.
// We do NOT call `doc.save()` here.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  configureDeterministicPdf,
  formatChileDate,
  formatChileDateTime,
} from './deterministicPdf.js';
import type { Ds67Form } from '../services/compliance/ds67/types.js';

const W = 210;
const H = 297;
const M = 18;

/** Build the PDF and return raw bytes. */
export function generateDs67Pdf(form: Ds67Form): Uint8Array {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  configureDeterministicPdf(doc, form.folio, form.createdAt);
  drawHeader(doc);
  drawTitle(doc, form);
  let y = drawCompanyBlock(doc, form);
  y = drawScopeBlock(doc, form, y);
  y = drawObligationsBlock(doc, form, y);
  y = drawProhibitionsBlock(doc, form, y);
  y = drawSanctionsBlock(doc, form, y);
  y = drawComplaintBlock(doc, form, y);
  y = drawValidityBlock(doc, form, y);
  drawSignatureBlock(doc, form, y);
  drawFooter(doc, form);

  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}

// ─── Drawing helpers ────────────────────────────────────────────────────────

function drawHeader(doc: jsPDF): void {
  // Petroleum band
  doc.setFillColor(6, 31, 45);
  doc.rect(0, 0, W, 32, 'F');
  // Teal accent
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
  doc.text('GUARDIAN PRAEVENTIO', M + 22, 16);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(212, 175, 55);
  doc.text('SISTEMA DE PREVENCIÓN DE RIESGOS LABORALES', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.text('DS 67/1999 MINSAL  ·  Reglamento Interno', M + 22, 25);
}

function drawTitle(doc: jsPDF, form: Ds67Form): void {
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(
    'REGLAMENTO INTERNO DE HIGIENE Y SEGURIDAD',
    W / 2,
    44,
    { align: 'center' },
  );
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Folio: ${form.folio}`, M, 51);
  doc.text(`Emitido: ${formatChileDateTime(form.createdAt)}`, W - M, 51, {
    align: 'right',
  });
}

function labelize(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
): void {
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  doc.text(value || '—', x, y + 4);
}

function sectionHeader(doc: jsPDF, title: string, y: number): number {
  doc.setFillColor(6, 31, 45);
  doc.rect(M, y, W - M * 2, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(title, M + 3, y + 4);
  return y + 8;
}

function paragraph(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(text || '—', W - M * 2);
  doc.text(lines, M, y);
  return y + lines.length * 4 + 3;
}

function pageBreakIfNeeded(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > H - 30) {
    doc.addPage();
    return 22;
  }
  return y;
}

function drawCompanyBlock(doc: jsPDF, form: Ds67Form): number {
  let y = 60;
  y = sectionHeader(doc, 'IDENTIFICACIÓN DE LA EMPRESA', y);
  labelize(doc, 'RAZÓN SOCIAL', form.companyName, M, y);
  labelize(doc, 'RUT', form.companyRut, M + 110, y);
  y += 10;
  labelize(doc, 'DOMICILIO', form.companyAddress, M, y);
  return y + 10;
}

function drawScopeBlock(doc: jsPDF, form: Ds67Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'I. ÁMBITO DE APLICACIÓN', y);
  return paragraph(doc, form.scopeOfApplication, y);
}

function drawObligationsBlock(doc: jsPDF, form: Ds67Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 40);
  y = sectionHeader(doc, 'II. OBLIGACIONES DEL TRABAJADOR', y);
  if (!form.workerObligations.length) {
    return paragraph(doc, '—', y);
  }
  autoTable(doc, {
    startY: y,
    body: form.workerObligations.map((o, i) => [String(i + 1), o]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 12, halign: 'center' } },
    margin: { left: M, right: M },
  });
  return y + form.workerObligations.length * 7 + 6;
}

function drawProhibitionsBlock(doc: jsPDF, form: Ds67Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 40);
  y = sectionHeader(doc, 'III. PROHIBICIONES DEL TRABAJADOR', y);
  if (!form.workerProhibitions.length) {
    return paragraph(doc, '—', y);
  }
  autoTable(doc, {
    startY: y,
    body: form.workerProhibitions.map((o, i) => [String(i + 1), o]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 12, halign: 'center' } },
    margin: { left: M, right: M },
  });
  return y + form.workerProhibitions.length * 7 + 6;
}

function drawSanctionsBlock(doc: jsPDF, form: Ds67Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'IV. SANCIONES POR INCUMPLIMIENTO', y);
  return paragraph(doc, form.sanctions, y);
}

function drawComplaintBlock(doc: jsPDF, form: Ds67Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'V. PROCEDIMIENTO DE RECLAMO', y);
  return paragraph(doc, form.complaintProcedure, y);
}

function drawValidityBlock(doc: jsPDF, form: Ds67Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 18);
  y = sectionHeader(doc, 'VI. VIGENCIA', y);
  labelize(
    doc,
    'DESDE',
    form.effectiveFrom ? formatChileDate(form.effectiveFrom) : '—',
    M,
    y + 2,
  );
  labelize(
    doc,
    'HASTA',
    form.effectiveUntil
      ? formatChileDate(form.effectiveUntil)
      : 'Indefinida',
    M + 110,
    y + 2,
  );
  return y + 14;
}

function drawSignatureBlock(doc: jsPDF, form: Ds67Form, yIn: number): void {
  const y = Math.max(yIn, H - 50);
  doc.setDrawColor(180, 180, 180);
  doc.line(M, y, W - M, y);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('FIRMA REPRESENTANTE LEGAL', M, y + 6);

  if (form.signature) {
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`RUT firmante: ${form.signature.signerRut}`, M, y + 12);
    doc.text(`Algoritmo: ${form.signature.algorithm}`, M, y + 17);
    doc.text(
      `Firmado: ${formatChileDateTime(form.signature.signedAt)}`,
      M,
      y + 22,
    );
    doc.text(
      `Hash: ${form.signature.payloadHashHex.slice(0, 24)}…`,
      M,
      y + 27,
    );
  } else {
    doc.setTextColor(180, 70, 70);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PENDIENTE DE FIRMA', M, y + 12);
  }
}

function drawFooter(doc: jsPDF, form: Ds67Form): void {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(6, 31, 45);
    doc.rect(0, H - 14, W, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text(
      `Folio ${form.folio}  ·  Reglamento Interno DS 67/1999 MINSAL  ·  Página ${i} de ${pages}`,
      W / 2,
      H - 6,
      { align: 'center' },
    );
    doc.setTextColor(212, 175, 55);
    doc.setFontSize(6);
    doc.text(
      'Verificable en /api/compliance/ds67/verify/{folio}  ·  Firma electrónica simple Ley 19.799',
      W / 2,
      H - 2,
      { align: 'center' },
    );
  }
}
