// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate generator.
//
// CRITICAL POLICY (read before editing):
//   * Praeventio NO push a MUTUAL/SUSESO/IST.
//   * Empresa cliente entrega por su canal: imprime, firma en persona, entrega.
//   * Esta es la cara *server-side* del certificado: produce PDF + JSON + SHA-256.
//   * NO valida contra base externa. NO emite a ninguna mutualidad. NO bloquea
//     maquinaria. Solo genera artefacto que la empresa puede acompañar de la
//     firma manual del médico cuando la mutualidad lo exija separadamente.
//
// Patrón: replica el shape de Sprint 31 ds67Service / Sprint 23 dte para que
// el flujo de firma WebAuthn (aptitudeCertSigner) embeba `payloadHashHex`
// igual que DS-67/DS-76. Usa `pdfkit` (ya en deps) — el form cliente seguirá
// usando jsPDF para el PDF de borrador local; este service produce el PDF
// canónico que se firma biométricamente.
//
// Mountaje:
//   * src/server/routes/medicalAptitude.ts → POST /api/medical/aptitude-cert/generate
//   * Audit: medical.aptitude_cert.generated  (no hay emisión externa, solo log).

import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ─── Schema ─────────────────────────────────────────────────────────────────

const RUT_RE = /^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/;

export const aptitudeCertInputSchema = z.object({
  workerUid: z.string().min(1).max(128),
  workerRut: z.string().regex(RUT_RE, 'invalid_worker_rut'),
  workerName: z.string().min(1).max(200),
  workerOccupation: z.string().min(1).max(200),
  doctorUid: z.string().min(1).max(128),
  doctorRut: z.string().regex(RUT_RE, 'invalid_doctor_rut'),
  doctorName: z.string().min(1).max(200),
  doctorRsm: z.string().min(1).max(64), // Registro SuperSalud
  examType: z.enum(['pre_empleo', 'periodico', 'reintegro', 'egreso', 'otro']),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_exam_date'),
  fitnessVerdict: z.enum(['apto', 'apto_con_restricciones', 'no_apto']),
  restrictions: z.array(z.string().max(500)).default([]),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employerRut: z.string().regex(RUT_RE, 'invalid_employer_rut'),
  projectId: z.string().min(1).max(128),
  observations: z.string().max(2000).optional(),
});

export type AptitudeCertInput = z.infer<typeof aptitudeCertInputSchema>;

export interface AptitudeCertJson {
  certId: string;
  schemaVersion: '2026-05-aptitude-v1';
  worker: { uid: string; rut: string; name: string; occupation: string };
  doctor: { uid: string; rut: string; name: string; rsm: string };
  exam: { type: AptitudeCertInput['examType']; date: string };
  verdict: {
    fitness: AptitudeCertInput['fitnessVerdict'];
    restrictions: string[];
  };
  validity: { validUntil?: string };
  employer: { rut: string; projectId: string };
  observations?: string;
  generatedAt: string;
  legal: {
    framework: 'CL/Ley 16.744 + DS 109';
    distribution: 'praeventio-internal-only';
    pushedToMutual: false;
  };
}

export interface AptitudeCertResult {
  pdf: Buffer;
  json: AptitudeCertJson;
  certHash: string; // SHA-256 hex of canonical JSON
  certId: string;
}

const EXAM_LABELS: Record<AptitudeCertInput['examType'], string> = {
  pre_empleo: 'PRE-EMPLEO',
  periodico: 'PERIODICO',
  reintegro: 'REINTEGRO LABORAL',
  egreso: 'EGRESO',
  otro: 'OTRO',
};

const VERDICT_LABELS: Record<AptitudeCertInput['fitnessVerdict'], string> = {
  apto: 'APTO',
  apto_con_restricciones: 'APTO CON RESTRICCIONES',
  no_apto: 'NO APTO',
};

const VERDICT_COLORS: Record<AptitudeCertInput['fitnessVerdict'], string> = {
  apto: '#4db6ac',
  apto_con_restricciones: '#fbbf24',
  no_apto: '#ef4444',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function canonicalJson(json: AptitudeCertJson): string {
  // Stable key ordering for deterministic hash.
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortDeep((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortDeep(json));
}

function buildCertId(input: AptitudeCertInput, generatedAtMs: number): string {
  // Format: APT-${year}-${workerRutDigits}-${epochMs36}
  const year = new Date(generatedAtMs).getUTCFullYear();
  const rutDigits = input.workerRut.replace(/[^0-9kK]/g, '').toUpperCase();
  return `APT-${year}-${rutDigits}-${generatedAtMs.toString(36)}`;
}

async function renderPdf(json: AptitudeCertJson): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      // pdfkit defaults to Helvetica which has WinAnsi (CP1252) coverage —
      // suficiente para ñ + acentos en chileno. Si en el futuro se incluyen
      // glifos no-WinAnsi, reemplazar `font('Helvetica')` por una fuente
      // TTF embebida UTF-8 (e.g. NotoSans-Regular.ttf bajo assets/fonts).
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Certificado Aptitud — ${json.certId}`,
          Author: 'Guardian Praeventio',
          Subject: 'Certificado de Aptitud Médica Ocupacional (DS 109 / Ley 16.744)',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fillColor('#061f2d').rect(0, 0, 595, 80).fill();
      doc.fillColor('#4db6ac').rect(0, 80, 595, 3).fill();
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('GUARDIAN PRAEVENTIO', 50, 28);
      doc
        .fillColor('#d4af37')
        .font('Helvetica')
        .fontSize(8)
        .text('SISTEMA DE PREVENCIÓN DE RIESGOS LABORALES', 50, 46);
      doc
        .fillColor('#ffffff')
        .fontSize(7)
        .text('Ley 16.744 · DS 109 · DS 594 · MINSAL', 50, 60);

      // Title
      doc.moveDown(3);
      doc
        .fillColor('#061f2d')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('CERTIFICADO DE APTITUD MÉDICA OCUPACIONAL', 50, 110, {
          align: 'center',
          width: 495,
        });
      doc
        .fillColor('#666666')
        .font('Helvetica')
        .fontSize(9)
        .text(
          `EXAMEN ${EXAM_LABELS[json.exam.type]}  ·  Conforme DS 109 Reglamento Ley 16.744`,
          50,
          135,
          { align: 'center', width: 495 },
        );

      // Worker block
      let y = 165;
      doc.fillColor('#061f2d').font('Helvetica-Bold').fontSize(9).text('TRABAJADOR', 50, y);
      y += 14;
      doc.fillColor('#222222').font('Helvetica').fontSize(10);
      doc.text(`Nombre: ${json.worker.name}`, 50, y);
      doc.text(`RUT: ${json.worker.rut}`, 320, y);
      y += 14;
      doc.text(`Ocupación: ${json.worker.occupation}`, 50, y);
      doc.text(`Empresa RUT: ${json.employer.rut}`, 320, y);
      y += 14;
      doc.text(`Fecha examen: ${json.exam.date}`, 50, y);
      if (json.validity.validUntil) {
        doc.text(`Vigencia hasta: ${json.validity.validUntil}`, 320, y);
      }

      // Verdict block
      y += 28;
      const color = VERDICT_COLORS[json.verdict.fitness];
      doc.fillColor(color).rect(50, y, 495, 50).fill();
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('RESULTADO DICTAMEN MÉDICO', 50, y + 10, { align: 'center', width: 495 });
      doc
        .fontSize(20)
        .text(VERDICT_LABELS[json.verdict.fitness], 50, y + 22, {
          align: 'center',
          width: 495,
        });
      y += 64;

      // Restrictions
      if (json.verdict.restrictions.length > 0) {
        doc
          .fillColor('#b45309')
          .font('Helvetica-Bold')
          .fontSize(9)
          .text('RESTRICCIONES LABORALES', 50, y);
        y += 12;
        doc.fillColor('#222222').font('Helvetica').fontSize(10);
        for (const r of json.verdict.restrictions) {
          doc.text(`• ${r}`, 56, y);
          y += 12;
        }
        y += 6;
      }

      // Observations
      if (json.observations) {
        doc.fillColor('#666666').font('Helvetica-Bold').fontSize(9).text('OBSERVACIONES', 50, y);
        y += 12;
        doc.fillColor('#222222').font('Helvetica').fontSize(10).text(json.observations, 50, y, {
          width: 495,
        });
        y = doc.y + 6;
      }

      // Doctor signature block
      y = Math.max(y + 30, 680);
      doc.strokeColor('#aaaaaa').moveTo(50, y).lineTo(545, y).stroke();
      doc.fillColor('#666666').fontSize(8).text('MÉDICO RESPONSABLE', 50, y + 6);
      doc.text('REGISTRO PROFESIONAL', 320, y + 6);
      doc
        .fillColor('#222222')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(json.doctor.name, 50, y + 18);
      doc.font('Helvetica').fontSize(9).text(`RUT: ${json.doctor.rut}`, 50, y + 33);
      doc.font('Helvetica-Bold').fontSize(11).text(json.doctor.rsm, 320, y + 18);
      doc.font('Helvetica').fontSize(9).text('Reg. Superintendencia de Salud', 320, y + 33);

      // Footer
      doc.fillColor('#061f2d').rect(0, 770, 595, 72).fill();
      doc
        .fillColor('#ffffff')
        .fontSize(7)
        .text(
          `Documento generado por Guardian Praeventio · ${json.generatedAt}`,
          50,
          786,
          { align: 'center', width: 495 },
        );
      doc
        .fillColor('#d4af37')
        .fontSize(6)
        .text(
          'Praeventio NO emite a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.',
          50,
          800,
          { align: 'center', width: 495 },
        );
      doc
        .fillColor('#ffffff')
        .fontSize(6)
        .text(`certId: ${json.certId}`, 50, 814, { align: 'center', width: 495 });

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Generate the aptitude certificate artifact:
 *   - validates input shape (Zod)
 *   - renders a deterministic JSON payload
 *   - renders the PDF via pdfkit
 *   - computes SHA-256 of the canonical JSON
 *
 * NEVER pushes to MUTUAL/SUSESO/IST. The PDF + JSON are the artifact;
 * delivery is the company's responsibility.
 */
export async function generateAptitudeCert(
  rawInput: unknown,
  options: GenerateOptions = {},
): Promise<AptitudeCertResult> {
  const parsed = aptitudeCertInputSchema.parse(rawInput);
  const now = (options.now ?? (() => new Date()))();
  const generatedAtMs = now.getTime();
  const certId = buildCertId(parsed, generatedAtMs);

  const json: AptitudeCertJson = {
    certId,
    schemaVersion: '2026-05-aptitude-v1',
    worker: {
      uid: parsed.workerUid,
      rut: parsed.workerRut,
      name: parsed.workerName,
      occupation: parsed.workerOccupation,
    },
    doctor: {
      uid: parsed.doctorUid,
      rut: parsed.doctorRut,
      name: parsed.doctorName,
      rsm: parsed.doctorRsm,
    },
    exam: { type: parsed.examType, date: parsed.examDate },
    verdict: {
      fitness: parsed.fitnessVerdict,
      restrictions: parsed.restrictions,
    },
    validity: { validUntil: parsed.validUntil },
    employer: { rut: parsed.employerRut, projectId: parsed.projectId },
    observations: parsed.observations,
    generatedAt: now.toISOString(),
    legal: {
      framework: 'CL/Ley 16.744 + DS 109',
      distribution: 'praeventio-internal-only',
      pushedToMutual: false,
    },
  };

  const certHash = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(json))));
  const pdf = await renderPdf(json);

  return { pdf, json, certHash, certId };
}

/** Re-export for tests / signer that want to recompute the hash. */
export function hashAptitudeCertJson(json: AptitudeCertJson): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(json))));
}
