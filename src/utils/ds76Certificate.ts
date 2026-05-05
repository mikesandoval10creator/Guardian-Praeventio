// Praeventio Guard — Sprint 31 Bucket PP.
//
// PDF generator for DS 76 — Reglamento Especial Subcontratación (Mining).
// Same visual family as `susesoCertificate.ts` and `ds67Certificate.ts`.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Ds76Form } from '../services/compliance/ds76/types.js';

const W = 210;
const H = 297;
const M = 18;

export function generateDs76Pdf(form: Ds76Form): Uint8Array {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  drawHeader(doc);
  drawTitle(doc, form);
  let y = drawPartiesBlock(doc, form);
  y = drawWorksiteBlock(doc, form, y);
  y = drawSstPlanBlock(doc, form, y);
  y = drawManagementSystemBlock(doc, form, y);
  y = drawSupervisionBlock(doc, form, y);
  y = drawTrainingBlock(doc, form, y);
  y = drawFiscalizationBlock(doc, form, y);
  drawSignatureBlock(doc, form, y);
  drawFooter(doc, form);

  return new Uint8Array(doc.output('arraybuffer'));
}

function drawHeader(doc: jsPDF): void {
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
  doc.text('GUARDIAN PRAEVENTIO', M + 22, 16);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(212, 175, 55);
  doc.text('SISTEMA DE PREVENCIÓN DE RIESGOS LABORALES', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.text('DS 76/2007 MINTRAB  ·  Reglamento Subcontratación', M + 22, 25);
}

function drawTitle(doc: jsPDF, form: Ds76Form): void {
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(
    'REGLAMENTO ESPECIAL PARA EMPRESAS CONTRATISTAS Y SUBCONTRATISTAS',
    W / 2,
    44,
    { align: 'center' },
  );
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Folio: ${form.folio}`, M, 51);
  doc.text(`Emitido: ${new Date(form.createdAt).toLocaleString('es-CL')}`, W - M, 51, {
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

function drawPartiesBlock(doc: jsPDF, form: Ds76Form): number {
  let y = 60;
  y = sectionHeader(doc, 'IDENTIFICACIÓN DE LAS PARTES', y);
  labelize(doc, 'EMPRESA PRINCIPAL (MANDANTE)', form.principalCompanyName, M, y);
  labelize(doc, 'RUT MANDANTE', form.principalCompanyRut, M + 110, y);
  y += 10;
  labelize(doc, 'EMPRESA CONTRATISTA / SUB.', form.contractorCompanyName, M, y);
  labelize(doc, 'RUT CONTRATISTA', form.contractorCompanyRut, M + 110, y);
  return y + 10;
}

function drawWorksiteBlock(doc: jsPDF, form: Ds76Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 18);
  y = sectionHeader(doc, 'FAENA', y);
  labelize(doc, 'NOMBRE FAENA', form.worksiteName, M, y);
  labelize(doc, 'DIRECCIÓN', form.worksiteAddress, M + 110, y);
  return y + 10;
}

function drawSstPlanBlock(doc: jsPDF, form: Ds76Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'I. PLAN DE GESTIÓN SST', y);
  return paragraph(doc, form.sstManagementPlan, y);
}

function drawManagementSystemBlock(doc: jsPDF, form: Ds76Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'II. SISTEMA DE GESTIÓN', y);
  return paragraph(doc, form.managementSystemDescription, y);
}

function drawSupervisionBlock(doc: jsPDF, form: Ds76Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'III. SUPERVISIÓN', y);
  return paragraph(doc, form.supervisionScheme, y);
}

function drawTrainingBlock(doc: jsPDF, form: Ds76Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'IV. CAPACITACIÓN', y);
  if (!form.trainingItems.length) {
    return paragraph(doc, '—', y);
  }
  autoTable(doc, {
    startY: y,
    head: [['Tema', 'Horas']],
    body: form.trainingItems.map((t) => [t.topic, String(t.hours)]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 1.5 },
    headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255] },
    columnStyles: { 1: { halign: 'right', cellWidth: 25 } },
    margin: { left: M, right: M },
  });
  return y + 10 + form.trainingItems.length * 7 + 4;
}

function drawFiscalizationBlock(doc: jsPDF, form: Ds76Form, yIn: number): number {
  let y = pageBreakIfNeeded(doc, yIn, 30);
  y = sectionHeader(doc, 'V. REGISTRO DE FISCALIZACIÓN SUSESO', y);
  return paragraph(doc, form.susesoFiscalizationRecord, y);
}

function drawSignatureBlock(doc: jsPDF, form: Ds76Form, yIn: number): void {
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
      `Firmado: ${new Date(form.signature.signedAt).toLocaleString('es-CL')}`,
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

function drawFooter(doc: jsPDF, form: Ds76Form): void {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(6, 31, 45);
    doc.rect(0, H - 14, W, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text(
      `Folio ${form.folio}  ·  DS 76/2007 MINTRAB  ·  Página ${i} de ${pages}`,
      W / 2,
      H - 6,
      { align: 'center' },
    );
    doc.setTextColor(212, 175, 55);
    doc.setFontSize(6);
    doc.text(
      'Verificable en /api/compliance/ds76/verify/{folio}  ·  Firma electrónica simple Ley 19.799',
      W / 2,
      H - 2,
      { align: 'center' },
    );
  }
}
