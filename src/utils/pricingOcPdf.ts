// Praeventio Guard — Pricing Calculator OC PDF renderer.
//
// Cierra H21 del plan integrado (verificación 2026-05-21) +
// Sprint K §177 (TODO previo: `pdf_emission_pending_sprint_k_177`).
//
// Genera la "Orden de Compra sugerida" en PDF formal a partir del estado
// de la calculadora de precios. NO es una factura: la empresa
// (`contacto@praeventio.net`) emite el comprobante formal por separado.
//
// Visual style alineado con `ds67Certificate.ts` + `ds76MiningContractor.ts`
// para que todos los documentos Praeventio sean reconocibles como una
// familia (banda petroleum + acento teal + tipografía helvetica).
//
// Output contract: devuelve la instancia jsPDF para que el caller
// decida el filename via `.save(...)` (browser-only).
// Caller responsable del filename + tracking.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Tier } from '../services/pricing/tiers';
import type { SubscriptionPlan } from '../services/pricing/subscriptionPlan';

const W = 210;
const M = 18;

export interface PricingOcPdfInput {
  industryPrefix: string;
  /** Etiqueta legible de la industria (ej "Construcción"). Opcional — si falta usa `industryPrefix`. */
  industryLabel?: string;
  workers: number;
  projects: number;
  recommendedTier: Tier;
  recommendedPlan: SubscriptionPlan;
  /** Costo mensual CLP del tier recomendado; `null` si el tier excede capacidad. */
  monthlyCostClp: number | null;
  monthlyEppBudgetClp: number;
  /** Porcentaje ROI calculado por `computeRoi`. `null` si no fue calculable. */
  roiPercent: number | null;
  /** Payback en meses. `null` si los inputs no convergieron. */
  paybackMonths: number | null;
  baselineIncidentsPerYear: number;
  currentIncidentsPerYear: number;
  avgIncidentCostClp: number;
  /** ISO timestamp. Defaults a `new Date().toISOString()`. */
  generatedAt?: string;
  /** Folio interno. Defaults a `PRG-OC-YYYYMMDD-HHMMSS`. */
  folio?: string;
  /** Datos opcionales del cliente que firma. */
  companyName?: string;
  companyRut?: string;
  contactEmail?: string;
}

const fmtClp = (n: number): string =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

const fmtPct = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}%`;

const fmtMonths = (n: number | null): string =>
  n === null || !Number.isFinite(n)
    ? '—'
    : n < 1
      ? '< 1 mes'
      : `${n.toFixed(1)} meses`;

function defaultFolio(): string {
  const d = new Date();
  const pad = (x: number): string => String(x).padStart(2, '0');
  return (
    `PRG-OC-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function generatePricingOcPdf(input: PricingOcPdfInput): jsPDF {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const folio = input.folio ?? defaultFolio();
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const industryDisplay = input.industryLabel ?? input.industryPrefix;
  const monthly = input.monthlyCostClp;
  const annualEpp = input.monthlyEppBudgetClp * 12;
  const annualSubscription = monthly === null ? null : monthly * 12;

  drawHeader(doc);
  drawTitle(doc, folio, generatedAt);
  let y = drawClientBlock(doc, {
    industryDisplay,
    workers: input.workers,
    projects: input.projects,
    companyName: input.companyName,
    companyRut: input.companyRut,
  });

  // ── Plan recomendado ────────────────────────────────────────────────
  y = sectionHeader(doc, '1. PLAN RECOMENDADO', y);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Item', 'Detalle']],
    body: [
      ['Tier', input.recommendedTier.nombre ?? input.recommendedTier.id],
      [
        'Capacidad incluida',
        `${input.recommendedTier.trabajadoresMax} trabajadores · ${input.recommendedTier.proyectosMax} proyectos`,
      ],
      ['Plan suscripción', input.recommendedPlan],
      ['Costo mensual estimado', monthly === null ? 'A consultar' : fmtClp(monthly)],
      [
        'Costo anual estimado',
        annualSubscription === null ? 'A consultar' : fmtClp(annualSubscription),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [6, 31, 45], textColor: 255 },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' } },
  });
  // jsPDF autoTable mutates doc.lastAutoTable.finalY — we read it.
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── Presupuesto EPP ─────────────────────────────────────────────────
  y = sectionHeader(doc, '2. PRESUPUESTO EPP ESTIMADO', y);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Concepto', 'Mensual CLP', 'Anual CLP']],
    body: [
      [
        `EPP para ${industryDisplay} · ${input.workers} trabajadores`,
        fmtClp(input.monthlyEppBudgetClp),
        fmtClp(annualEpp),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [6, 31, 45], textColor: 255 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── ROI ─────────────────────────────────────────────────────────────
  y = sectionHeader(doc, '3. RETORNO DE INVERSIÓN (ROI) PROYECTADO', y);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Métrica', 'Valor']],
    body: [
      ['Incidentes/año baseline', String(input.baselineIncidentsPerYear)],
      ['Incidentes/año actual', String(input.currentIncidentsPerYear)],
      ['Costo promedio por incidente', fmtClp(input.avgIncidentCostClp)],
      ['ROI proyectado', fmtPct(input.roiPercent)],
      ['Payback estimado', fmtMonths(input.paybackMonths)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [6, 31, 45], textColor: 255 },
    columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' }, 1: { halign: 'right' } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  drawFooter(doc, input.contactEmail ?? 'contacto@praeventio.net');
  return doc;
}

// ─── Drawing helpers ────────────────────────────────────────────────────

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
  doc.text('Orden de Compra sugerida — Plan + EPP + ROI', M + 22, 25);
}

function drawTitle(doc: jsPDF, folio: string, generatedAtIso: string): void {
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('ORDEN DE COMPRA SUGERIDA', W / 2, 44, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Folio: ${folio}`, M, 51);
  doc.text(
    `Emitido: ${new Date(generatedAtIso).toLocaleString('es-CL')}`,
    W - M,
    51,
    { align: 'right' },
  );
}

function drawClientBlock(
  doc: jsPDF,
  data: {
    industryDisplay: string;
    workers: number;
    projects: number;
    companyName?: string;
    companyRut?: string;
  },
): number {
  let y = 60;
  y = sectionHeader(doc, '0. CLIENTE', y);
  const rows: Array<[string, string]> = [
    ['Industria', data.industryDisplay],
    ['Trabajadores', String(data.workers)],
    ['Proyectos activos', String(data.projects)],
  ];
  if (data.companyName) rows.push(['Razón social', data.companyName]);
  if (data.companyRut) rows.push(['RUT empresa', data.companyRut]);

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    body: rows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', textColor: [120, 120, 120] } },
  });
  return (
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  );
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

function drawFooter(doc: jsPDF, contactEmail: string): void {
  // Footer panel
  const fY = 270;
  doc.setFillColor(248, 248, 248);
  doc.rect(M, fY, W - M * 2, 22, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.rect(M, fY, W - M * 2, 22, 'S');

  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('IMPORTANTE', M + 3, fY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const note =
    'Este documento es una orden de compra SUGERIDA, generada por la calculadora ' +
    'interna de Guardian Praeventio. NO constituye factura ni cotización formal. ' +
    `Para la emisión del comprobante formal y la activación del plan, contactar a ${contactEmail}. ` +
    'Los valores EPP y ROI se basan en parámetros del catálogo industrial y supuestos del usuario; ' +
    'pueden variar según condiciones reales de operación.';
  const lines = doc.splitTextToSize(note, W - M * 2 - 6);
  doc.text(lines, M + 3, fY + 8);
}
