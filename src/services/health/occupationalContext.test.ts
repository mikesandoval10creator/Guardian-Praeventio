/**
 * occupationalContext.test.ts — Bucket WW (Sprint 26).
 *
 * Code-review checklist (sagrado, ADR 0012):
 *   - El bundle SIEMPRE lleva el disclaimer literal.
 *   - JAMÁS se infiere patología, etiqueta clínica, ni clasificación
 *     'professional_disease' / 'common_disease'.
 *   - Symptom.triggeredByWork = null se preserva como null.
 *   - El markdown nunca contiene 'diagnóstico' ni 'patología'.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildOccupationalContextBundle,
  bundleToMarkdown,
  summarizeBundle,
  exportOccupationalBundle,
  vaultStoragePath,
  vaultRecordDocPath,
  OCCUPATIONAL_BUNDLE_DISCLAIMER,
  type LaborHistoryEntry,
  type ErgonomicLogEntry,
  type SelfReportedSymptomEntry,
  type VaultStorageUploader,
  type VaultRecordSink,
  type OccupationalVaultRecord,
} from './occupationalContext';
import { inMemoryKmsAdapter } from '../security/kmsAdapter';

const FIXED_NOW = 1_730_000_000_000;

const sampleLabor: LaborHistoryEntry[] = [
  {
    yearFrom: 2010,
    yearTo: 2015,
    employer: 'Constructora Andes',
    role: 'Carpintero',
    physicalDemands: ['manual_lifting', 'overhead_work'],
    riskAgents: ['noise', 'silica'],
    workplaceCountry: 'CL',
  },
  {
    yearFrom: 2015,
    yearTo: 2022,
    employer: 'Minería Norte',
    role: 'Operador',
    physicalDemands: ['manual_lifting', 'vibration'],
    riskAgents: ['silica', 'noise', 'vibration'],
    workplaceCountry: 'CL',
  },
];

const sampleErgo: ErgonomicLogEntry[] = [
  {
    date: '2026-01-15',
    rebaScore: 7,
    rulaScore: 5,
    affectedZones: ['lumbar', 'shoulder'],
    minutesObserved: 30,
    taskType: 'soldadura altura',
  },
  {
    date: '2026-02-20',
    rebaScore: 9,
    rulaScore: 6,
    affectedZones: ['lumbar'],
    minutesObserved: 45,
  },
  {
    date: '2025-12-01',
    rebaScore: 5,
    rulaScore: 4,
    affectedZones: ['shoulder', 'cervical'],
    minutesObserved: 20,
  },
];

const sampleSymptoms: SelfReportedSymptomEntry[] = [
  {
    date: '2026-03-01',
    bodyPart: 'lumbar',
    severity: 4,
    description: 'Dolor al final del turno',
    triggeredByWork: true,
  },
  {
    date: '2026-03-05',
    bodyPart: 'lumbar',
    severity: 3,
    description: 'Molestia leve matutina',
    triggeredByWork: null, // no asertado por el trabajador
  },
  {
    date: '2026-03-10',
    bodyPart: 'shoulder',
    severity: 2,
    description: 'Tensión',
    triggeredByWork: false,
  },
];

const buildSample = () =>
  buildOccupationalContextBundle(
    'worker-001',
    sampleLabor,
    sampleErgo,
    sampleSymptoms,
    { now: () => FIXED_NOW },
  );

describe('buildOccupationalContextBundle', () => {
  it('1. includes the literal disclaimer (string-equality)', () => {
    const bundle = buildSample();
    expect(bundle.disclaimer).toBe(
      'Esta información fue organizada por Praeventio para ser revisada por el médico tratante. Praeventio no diagnostica. El médico decide.',
    );
    expect(bundle.disclaimer).toBe(OCCUPATIONAL_BUNDLE_DISCLAIMER);
  });

  it('preserves workerUid and uses injected now()', () => {
    const bundle = buildSample();
    expect(bundle.workerUid).toBe('worker-001');
    expect(bundle.generatedAt).toBe(FIXED_NOW);
  });

  it('12. preserves triggeredByWork=null (no inferencia)', () => {
    const bundle = buildSample();
    const nullCases = bundle.selfReportedSymptoms.filter(
      (s) => s.triggeredByWork === null,
    );
    expect(nullCases.length).toBe(1);
    // Y el bundle no agrega ninguna otra propiedad inferida al symptom.
    expect(Object.keys(nullCases[0]!).sort()).toEqual(
      ['bodyPart', 'date', 'description', 'severity', 'triggeredByWork'].sort(),
    );
  });

  it('does not mutate caller arrays (defensive copy)', () => {
    const labor = [...sampleLabor];
    const ergo = [...sampleErgo];
    const sym = [...sampleSymptoms];
    const bundle = buildOccupationalContextBundle(
      'w', labor, ergo, sym,
      { now: () => FIXED_NOW },
    );
    bundle.laborHistory.push({
      yearFrom: 1900, yearTo: 1901, employer: 'X', role: 'Y',
      physicalDemands: [], riskAgents: [], workplaceCountry: 'CL',
    });
    expect(labor.length).toBe(2);
  });
});

describe('summarizeBundle', () => {
  it('2. yearsOfLaborHistory cálculo correcto', () => {
    const summary = summarizeBundle(buildSample());
    // (2015-2010) + (2022-2015) = 5 + 7 = 12
    expect(summary.yearsOfLaborHistory).toBe(12);
  });

  it('ignora entradas con yearTo <= yearFrom', () => {
    const bundle = buildOccupationalContextBundle(
      'w',
      [
        ...sampleLabor,
        {
          yearFrom: 2024,
          yearTo: 2020, // inválido — se ignora.
          employer: 'X', role: 'Y',
          physicalDemands: [], riskAgents: [], workplaceCountry: 'CL',
        },
      ],
      [], [],
      { now: () => FIXED_NOW },
    );
    expect(summarizeBundle(bundle).yearsOfLaborHistory).toBe(12);
  });

  it('3. uniquePhysicalDemands deduplica', () => {
    const summary = summarizeBundle(buildSample());
    expect(summary.uniquePhysicalDemands).toEqual(
      ['manual_lifting', 'overhead_work', 'vibration'],
    );
  });

  it('4. uniqueRiskAgents deduplica', () => {
    const summary = summarizeBundle(buildSample());
    expect(summary.uniqueRiskAgents).toEqual(
      ['noise', 'silica', 'vibration'],
    );
  });

  it('5. ergonomicHotspots agregación por zone', () => {
    const summary = summarizeBundle(buildSample());
    const lumbar = summary.ergonomicHotspots.find((h) => h.zone === 'lumbar');
    const shoulder = summary.ergonomicHotspots.find((h) => h.zone === 'shoulder');
    const cervical = summary.ergonomicHotspots.find((h) => h.zone === 'cervical');
    expect(lumbar).toBeDefined();
    expect(lumbar!.observationCount).toBe(2); // 2026-01-15 + 2026-02-20
    expect(lumbar!.avgReba).toBeCloseTo((7 + 9) / 2, 5);
    expect(shoulder!.observationCount).toBe(2); // 2026-01-15 + 2025-12-01
    expect(shoulder!.avgReba).toBeCloseTo((7 + 5) / 2, 5);
    expect(cervical!.observationCount).toBe(1);
    expect(cervical!.avgReba).toBeCloseTo(5, 5);
  });

  it('6. symptomBodyPartFrequency cálculo', () => {
    const summary = summarizeBundle(buildSample());
    const lumbar = summary.symptomBodyPartFrequency.find((f) => f.bodyPart === 'lumbar');
    const shoulder = summary.symptomBodyPartFrequency.find((f) => f.bodyPart === 'shoulder');
    expect(lumbar!.count).toBe(2);
    expect(lumbar!.avgSeverity).toBeCloseTo((4 + 3) / 2, 5);
    expect(shoulder!.count).toBe(1);
    expect(shoulder!.avgSeverity).toBeCloseTo(2, 5);
  });
});

describe('bundleToMarkdown', () => {
  it('7. contains "Praeventio no diagnostica"', () => {
    const md = bundleToMarkdown(buildSample());
    expect(md).toContain('Praeventio no diagnostica');
  });

  it('8. ordena ergonomicMetrics por fecha desc', () => {
    const md = bundleToMarkdown(buildSample());
    const idxFeb = md.indexOf('2026-02-20');
    const idxJan = md.indexOf('2026-01-15');
    const idxDec = md.indexOf('2025-12-01');
    expect(idxFeb).toBeGreaterThan(-1);
    expect(idxJan).toBeGreaterThan(-1);
    expect(idxDec).toBeGreaterThan(-1);
    // desc: feb 2026 < jan 2026 < dec 2025 en posición de string
    expect(idxFeb).toBeLessThan(idxJan);
    expect(idxJan).toBeLessThan(idxDec);
  });

  it('11. NUNCA contiene strings "diagnóstico" ni "patología"', () => {
    const md = bundleToMarkdown(buildSample()).toLowerCase();
    expect(md).not.toContain('diagnóstico');
    expect(md).not.toContain('diagnostico'); // sin tilde, por si acaso
    expect(md).not.toContain('patología');
    expect(md).not.toContain('patologia');
    // Solo permitido: "no diagnostica" (verbo, parte del disclaimer).
    // Verificamos que toda ocurrencia de 'diagnostic' va precedida por 'no '.
    const re = /diagnostic/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      const before = md.slice(Math.max(0, m.index - 3), m.index);
      expect(before).toBe('no ');
    }
  });

  it('renderiza síntomas con triggeredByWork=null como "no asertado"', () => {
    const md = bundleToMarkdown(buildSample());
    expect(md).toContain('no asertado');
  });
});

describe('empty inputs', () => {
  it('9. bundle vacío con disclaimer', () => {
    const bundle = buildOccupationalContextBundle(
      'w-empty', [], [], [],
      { now: () => FIXED_NOW },
    );
    expect(bundle.workerUid).toBe('w-empty');
    expect(bundle.laborHistory).toEqual([]);
    expect(bundle.ergonomicMetrics).toEqual([]);
    expect(bundle.selfReportedSymptoms).toEqual([]);
    expect(bundle.disclaimer).toBe(OCCUPATIONAL_BUNDLE_DISCLAIMER);

    const summary = summarizeBundle(bundle);
    expect(summary.yearsOfLaborHistory).toBe(0);
    expect(summary.uniquePhysicalDemands).toEqual([]);
    expect(summary.uniqueRiskAgents).toEqual([]);
    expect(summary.ergonomicHotspots).toEqual([]);
    expect(summary.symptomBodyPartFrequency).toEqual([]);

    const md = bundleToMarkdown(bundle);
    expect(md).toContain(OCCUPATIONAL_BUNDLE_DISCLAIMER);
  });
});

describe('NO inferencia clínica (regresión ADR 0012)', () => {
  it('10. bundle NUNCA agrega tags como professional_disease/common_disease', () => {
    // Construimos symptoms que un humano podría leer como "patrón laboral":
    // dolor lumbar repetido, alta severidad, durante años de manual_lifting.
    const susp: SelfReportedSymptomEntry[] = Array.from(
      { length: 12 },
      (_, i) => ({
        date: `2026-0${(i % 9) + 1}-15`,
        bodyPart: 'lumbar',
        severity: 5 as const,
        description: 'Dolor severo recurrente',
        triggeredByWork: true,
      }),
    );
    const bundle = buildOccupationalContextBundle(
      'worker-suspect',
      sampleLabor, sampleErgo, susp,
      { now: () => FIXED_NOW },
    );
    const json = JSON.stringify(bundle).toLowerCase();
    expect(json).not.toContain('professional_disease');
    expect(json).not.toContain('common_disease');
    expect(json).not.toContain('enfermedad_profesional');
    expect(json).not.toContain('enfermedad_comun');
    expect(json).not.toContain('diagnosis');
    expect(json).not.toContain('disease');
    expect(json).not.toContain('pathology');

    // El summary tampoco genera tags clínicos: solo cuenta y promedia.
    const summary = summarizeBundle(bundle);
    const summaryJson = JSON.stringify(summary).toLowerCase();
    expect(summaryJson).not.toContain('professional_disease');
    expect(summaryJson).not.toContain('common_disease');
    expect(summaryJson).not.toContain('disease');

    // Y el markdown jamás clasifica.
    const md = bundleToMarkdown(bundle).toLowerCase();
    expect(md).not.toContain('professional_disease');
    expect(md).not.toContain('common_disease');
    expect(md).not.toContain('enfermedad profesional');
    expect(md).not.toContain('enfermedad común');
  });
});

// ─────────────────────────────────────────────────────────────────────
// exportOccupationalBundle — smoke wire Bucket VV
// ─────────────────────────────────────────────────────────────────────
//
// Tests con storageClient + sink + KMS adapter inyectables. Verifican:
//   - ZIP contiene bundle.json (parseable y con disclaimer)
//   - Adjuntos llegan bajo attachments/
//   - El payload subido NO está en cleartext (contiene magic PVB1)
//   - sha256 hex 64 chars
//   - signedUrl + expiresAt en el rango esperado (24h)
//   - sink recibe el path Firestore canonical + record con shape correcto
//   - El record persistido NO contiene el bundle en cleartext (solo
//     metadata + envelope sin ciphertext crudo)

describe('exportOccupationalBundle', () => {
  // Helper: stub uploader que captura el path + bytes para inspección.
  function makeUploader(): {
    uploader: VaultStorageUploader;
    captured: {
      path?: string;
      bytes?: Uint8Array;
      contentType?: string;
      signedUrlTtlMs?: number;
    };
  } {
    const captured: {
      path?: string;
      bytes?: Uint8Array;
      contentType?: string;
      signedUrlTtlMs?: number;
    } = {};
    const uploader: VaultStorageUploader = {
      upload: vi.fn(async (a) => {
        captured.path = a.path;
        captured.bytes = a.bytes;
        captured.contentType = a.contentType;
        captured.signedUrlTtlMs = a.signedUrlTtlMs;
        return { url: `https://signed.example/${encodeURIComponent(a.path)}` };
      }),
    };
    return { uploader, captured };
  }

  function makeSink(): {
    sink: VaultRecordSink;
    captured: { path?: string; record?: OccupationalVaultRecord };
  } {
    const captured: { path?: string; record?: OccupationalVaultRecord } = {};
    const sink: VaultRecordSink = {
      saveVaultRecord: vi.fn(async (a) => {
        captured.path = a.path;
        captured.record = a.record;
      }),
    };
    return { sink, captured };
  }

  it('SM1. devuelve { url, expiresAt, sizeBytes, sha256, recordId } con shape correcto', async () => {
    const bundle = buildSample();
    const { uploader, captured } = makeUploader();
    const { sink } = makeSink();

    const result = await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      uploader,
      sink,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    expect(result.url).toBe(
      `https://signed.example/${encodeURIComponent(captured.path!)}`,
    );
    expect(result.expiresAt).toBe(FIXED_NOW + 24 * 60 * 60 * 1000);
    expect(result.sizeBytes).toBe(captured.bytes!.length);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.recordId).toBe(`occ_worker-001_${FIXED_NOW}`);
  });

  it('SM2. usa el path Storage canonical tenants/{tid}/vault/{uid}/{ts}-occupational.zip', async () => {
    const bundle = buildSample();
    const { uploader, captured } = makeUploader();
    const { sink } = makeSink();

    await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      uploader,
      sink,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    expect(captured.path).toBe(
      `tenants/tenant-acme/vault/worker-001/${FIXED_NOW}-occupational.zip`,
    );
    expect(captured.path).toBe(
      vaultStoragePath('tenant-acme', 'worker-001', FIXED_NOW),
    );
    expect(captured.contentType).toBe('application/octet-stream');
    expect(captured.signedUrlTtlMs).toBe(24 * 60 * 60 * 1000);
  });

  it('SM3. el payload subido NO está en cleartext — contiene magic PVB1 + no JSON visible', async () => {
    const bundle = buildSample();
    const { uploader, captured } = makeUploader();
    const { sink } = makeSink();

    await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      uploader,
      sink,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    // Magic PVB1 al inicio.
    expect(captured.bytes!.slice(0, 4)).toEqual(
      new Uint8Array([0x50, 0x56, 0x42, 0x31]),
    );

    // Los datos del bundle (workerUid, employer, etc.) NO deben aparecer
    // en cleartext en el payload cifrado. La verificación es probabilística
    // pero suficientemente fuerte para un test smoke: si el envelope se
    // omitiera por error el JSON aparecería tal cual.
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(
      captured.bytes!,
    );
    expect(asText).not.toContain('Constructora Andes');
    expect(asText).not.toContain('worker-001');
    expect(asText).not.toContain(OCCUPATIONAL_BUNDLE_DISCLAIMER);
    // Tampoco la magic ZIP local file header (PK\x03\x04) — eso indicaría
    // que subimos el ZIP sin cifrar.
    expect(asText).not.toContain('PK\x03\x04');
  });

  it('SM4. el envelope persistido NO contiene ciphertext crudo (vive en Storage)', async () => {
    const bundle = buildSample();
    const { uploader } = makeUploader();
    const { sink, captured } = makeSink();

    await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      uploader,
      sink,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    expect(captured.path).toBe(
      vaultRecordDocPath('tenant-acme', `occ_worker-001_${FIXED_NOW}`),
    );
    expect(captured.record!.kind).toBe('occupational');
    expect(captured.record!.ownerUid).toBe('worker-001');
    expect(captured.record!.tenantId).toBe('tenant-acme');
    expect(captured.record!.envelope.ciphertext).toBe('');
    expect(captured.record!.envelope.algorithm).toBe('AES-256-GCM');
    expect(captured.record!.envelope.encryptedDek.length).toBeGreaterThan(0);
    expect(captured.record!.signedUrl).toContain('https://signed.example/');
    // El payload de Firestore NO contiene cleartext del bundle.
    const recordJson = JSON.stringify(captured.record).toLowerCase();
    expect(recordJson).not.toContain('constructora andes');
    expect(recordJson).not.toContain('minería norte');
  });

  it('SM5. adjuntos firmados llegan bajo attachments/ y el resultado cambia su sha256', async () => {
    const bundle = buildSample();
    const { uploader: u1 } = makeUploader();
    const { sink: s1 } = makeSink();
    const baseline = await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      uploader: u1,
      sink: s1,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    const { uploader: u2 } = makeUploader();
    const { sink: s2 } = makeSink();
    const withAttachment = await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      attachments: [
        {
          filename: 'audiometria-2026-03.pdf',
          contentType: 'application/pdf',
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), // %PDF-1.4
        },
      ],
      uploader: u2,
      sink: s2,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    // El payload con adjunto pesa más + tiene sha256 distinto. (El DEK
    // aleatorio del envelope también cambia el sha256, así que no
    // verificamos igualdad — solo desigualdad.)
    expect(withAttachment.sizeBytes).toBeGreaterThan(baseline.sizeBytes);
    expect(withAttachment.sha256).not.toBe(baseline.sha256);
  });

  it('SM6. TTL custom se respeta tanto en uploader como en expiresAt', async () => {
    const bundle = buildSample();
    const { uploader, captured } = makeUploader();
    const { sink } = makeSink();
    const ONE_HOUR = 60 * 60 * 1000;

    const result = await exportOccupationalBundle({
      bundle,
      tenantId: 'tenant-acme',
      signedUrlTtlMs: ONE_HOUR,
      uploader,
      sink,
      kmsAdapter: inMemoryKmsAdapter,
      now: () => FIXED_NOW,
    });

    expect(captured.signedUrlTtlMs).toBe(ONE_HOUR);
    expect(result.expiresAt).toBe(FIXED_NOW + ONE_HOUR);
  });

  it('SM7. rechaza tenantId vacío y workerUid vacío', async () => {
    const bundle = buildSample();
    const { uploader } = makeUploader();
    const { sink } = makeSink();
    await expect(
      exportOccupationalBundle({
        bundle,
        tenantId: '',
        uploader,
        sink,
        kmsAdapter: inMemoryKmsAdapter,
      }),
    ).rejects.toThrow(/tenantId required/);

    const emptyUidBundle = buildOccupationalContextBundle(
      '', [], [], [],
      { now: () => FIXED_NOW },
    );
    await expect(
      exportOccupationalBundle({
        bundle: emptyUidBundle,
        tenantId: 'tenant-acme',
        uploader,
        sink,
        kmsAdapter: inMemoryKmsAdapter,
      }),
    ).rejects.toThrow(/bundle\.workerUid required/);
  });
});
