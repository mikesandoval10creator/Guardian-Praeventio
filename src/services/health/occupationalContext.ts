/**
 * OccupationalContextBundle — Bucket WW (Sprint 26).
 *
 * Per ADR 0012 §"Ergonomía continua + cruce con PortableCurriculum":
 * la app entrega al MÉDICO TRATANTE un bundle informativo (historial
 * laboral + métricas ergonómicas + síntomas auto-reportados). La app
 * NUNCA califica una enfermedad como profesional o común — eso lo
 * decide el médico tratante después de leer este bundle.
 *
 * Reglas sagradas (code review checklist ADR 0012):
 *   1. Función pura. Sin I/O, sin firebase, sin random.
 *   2. JAMÁS infiere patología, diagnóstico, ni clasificación
 *      profesional/común. Solo organiza lo que ya existe.
 *   3. Todo bundle lleva el disclaimer obligatorio (string-equality test).
 *   4. Symptom.triggeredByWork = null se preserva como null. La app
 *      nunca completa esa aserción por inferencia.
 *   5. NO hay function names que sugieran diagnóstico clínico.
 *        - Permitido: build*, summarize*, *ToMarkdown, organize*, cite*.
 *        - Ver ADR-0012 para la lista completa de patrones prohibidos.
 */

// ─────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────

export interface LaborHistoryEntry {
  yearFrom: number;
  yearTo: number;
  employer: string;
  role: string;
  /** Demandas físicas declaradas: 'manual_lifting', 'overhead_work',
   *  'kneeling', 'vibration', etc. Strings libres. */
  physicalDemands: string[];
  /** Agentes de riesgo declarados: 'silica', 'noise', 'vibration',
   *  'lead', 'asbestos', etc. Strings libres. */
  riskAgents: string[];
  workplaceCountry: string;
}

export interface ErgonomicLogEntry {
  /** YYYY-MM-DD */
  date: string;
  rebaScore: number;
  rulaScore: number;
  /** Zonas afectadas: 'lumbar', 'cervical', 'shoulder', 'wrist', 'knee'. */
  affectedZones: string[];
  minutesObserved: number;
  /** ej. 'soldadura altura'. */
  taskType?: string;
}

export interface SelfReportedSymptomEntry {
  /** YYYY-MM-DD */
  date: string;
  /** 'lumbar', 'cervical', 'shoulder', etc. */
  bodyPart: string;
  severity: 1 | 2 | 3 | 4 | 5;
  description: string;
  /**
   * Aserción del trabajador sobre si cree que el síntoma se gatilla
   * por el trabajo. NULL = no asertado. La app NUNCA infiere esto —
   * solo registra lo que el trabajador dijo.
   */
  triggeredByWork: boolean | null;
}

/**
 * Disclaimer obligatorio. Es un literal type para que el compilador
 * impida modificarlo accidentalmente.
 */
export const OCCUPATIONAL_BUNDLE_DISCLAIMER =
  'Esta información fue organizada por Praeventio para ser revisada por el médico tratante. Praeventio no diagnostica. El médico decide.' as const;

export type OccupationalBundleDisclaimer = typeof OCCUPATIONAL_BUNDLE_DISCLAIMER;

export interface OccupationalContextBundle {
  workerUid: string;
  generatedAt: number;
  laborHistory: LaborHistoryEntry[];
  ergonomicMetrics: ErgonomicLogEntry[];
  selfReportedSymptoms: SelfReportedSymptomEntry[];
  /** Disclaimer obligatorio en cada bundle. */
  readonly disclaimer: OccupationalBundleDisclaimer;
}

export interface BundleSummary {
  yearsOfLaborHistory: number;
  uniquePhysicalDemands: string[];
  uniqueRiskAgents: string[];
  ergonomicHotspots: Array<{
    zone: string;
    observationCount: number;
    avgReba: number;
  }>;
  symptomBodyPartFrequency: Array<{
    bodyPart: string;
    count: number;
    avgSeverity: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Constructor (función pura)
// ─────────────────────────────────────────────────────────────────────

/**
 * Construye el bundle ocupacional. Función pura: copia las entradas
 * (shallow) para evitar aliasing externo y devuelve la estructura
 * con el disclaimer ya pegado. NO infiere absolutamente nada.
 */
export function buildOccupationalContextBundle(
  workerUid: string,
  laborHistory: LaborHistoryEntry[],
  ergonomicLogs: ErgonomicLogEntry[],
  symptoms: SelfReportedSymptomEntry[],
  options?: { now?: () => number },
): OccupationalContextBundle {
  const now = options?.now ?? Date.now;
  return {
    workerUid,
    generatedAt: now(),
    laborHistory: laborHistory.map((e) => ({
      ...e,
      physicalDemands: [...e.physicalDemands],
      riskAgents: [...e.riskAgents],
    })),
    ergonomicMetrics: ergonomicLogs.map((e) => ({
      ...e,
      affectedZones: [...e.affectedZones],
    })),
    // CRÍTICO: triggeredByWork se preserva tal cual (incluido null).
    // Nunca rellenamos por inferencia.
    selfReportedSymptoms: symptoms.map((s) => ({ ...s })),
    disclaimer: OCCUPATIONAL_BUNDLE_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Summary (estadísticas, no diagnóstico)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resumen estadístico del bundle. SIN inferir patología. Las funciones
 * de agregación solo cuentan, deduplican y promedian — no clasifican,
 * no etiquetan, no diagnostican.
 */
export function summarizeBundle(
  bundle: OccupationalContextBundle,
): BundleSummary {
  // ── yearsOfLaborHistory: suma de (yearTo − yearFrom) por entry,
  //    saneando entradas con yearTo < yearFrom (ignoradas).
  let yearsOfLaborHistory = 0;
  for (const entry of bundle.laborHistory) {
    const span = entry.yearTo - entry.yearFrom;
    if (span > 0 && Number.isFinite(span)) {
      yearsOfLaborHistory += span;
    }
  }

  // ── uniquePhysicalDemands / uniqueRiskAgents (dedupe + sort estable).
  const physicalDemandsSet = new Set<string>();
  const riskAgentsSet = new Set<string>();
  for (const entry of bundle.laborHistory) {
    for (const d of entry.physicalDemands) physicalDemandsSet.add(d);
    for (const a of entry.riskAgents) riskAgentsSet.add(a);
  }
  const uniquePhysicalDemands = Array.from(physicalDemandsSet).sort();
  const uniqueRiskAgents = Array.from(riskAgentsSet).sort();

  // ── ergonomicHotspots: agregamos por zona.
  //    observationCount = cuántas entradas mencionan la zona.
  //    avgReba          = promedio del rebaScore de esas entradas.
  const hotspotAcc = new Map<
    string,
    { count: number; rebaSum: number }
  >();
  for (const log of bundle.ergonomicMetrics) {
    for (const zone of log.affectedZones) {
      const cur = hotspotAcc.get(zone) ?? { count: 0, rebaSum: 0 };
      cur.count += 1;
      cur.rebaSum += log.rebaScore;
      hotspotAcc.set(zone, cur);
    }
  }
  const ergonomicHotspots = Array.from(hotspotAcc.entries())
    .map(([zone, v]) => ({
      zone,
      observationCount: v.count,
      avgReba: v.count > 0 ? v.rebaSum / v.count : 0,
    }))
    .sort((a, b) => b.observationCount - a.observationCount || a.zone.localeCompare(b.zone));

  // ── symptomBodyPartFrequency: count + avgSeverity por bodyPart.
  const symptomAcc = new Map<
    string,
    { count: number; severitySum: number }
  >();
  for (const sym of bundle.selfReportedSymptoms) {
    const cur = symptomAcc.get(sym.bodyPart) ?? {
      count: 0,
      severitySum: 0,
    };
    cur.count += 1;
    cur.severitySum += sym.severity;
    symptomAcc.set(sym.bodyPart, cur);
  }
  const symptomBodyPartFrequency = Array.from(symptomAcc.entries())
    .map(([bodyPart, v]) => ({
      bodyPart,
      count: v.count,
      avgSeverity: v.count > 0 ? v.severitySum / v.count : 0,
    }))
    .sort((a, b) => b.count - a.count || a.bodyPart.localeCompare(b.bodyPart));

  return {
    yearsOfLaborHistory,
    uniquePhysicalDemands,
    uniqueRiskAgents,
    ergonomicHotspots,
    symptomBodyPartFrequency,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Renderer markdown
// ─────────────────────────────────────────────────────────────────────

/**
 * Renderiza el bundle como markdown human-readable. NUNCA usa las
 * palabras "diagnóstico" o "patología" — solo describe los datos
 * recolectados y deja la decisión al médico tratante.
 *
 * Ergonomic metrics se ordenan por fecha desc (más reciente primero).
 */
export function bundleToMarkdown(bundle: OccupationalContextBundle): string {
  const summary = summarizeBundle(bundle);
  const lines: string[] = [];

  lines.push('# Bundle de contexto ocupacional');
  lines.push('');
  lines.push(`> ${bundle.disclaimer}`);
  lines.push('');
  lines.push(`**Worker UID:** ${bundle.workerUid}`);
  lines.push(`**Generado:** ${new Date(bundle.generatedAt).toISOString()}`);
  lines.push('');

  // ── Resumen estadístico.
  lines.push('## Resumen estadístico');
  lines.push('');
  lines.push(
    `- Años acumulados de historial laboral: ${summary.yearsOfLaborHistory}`,
  );
  lines.push(
    `- Demandas físicas únicas: ${
      summary.uniquePhysicalDemands.length === 0
        ? '(ninguna)'
        : summary.uniquePhysicalDemands.join(', ')
    }`,
  );
  lines.push(
    `- Agentes de riesgo únicos: ${
      summary.uniqueRiskAgents.length === 0
        ? '(ninguno)'
        : summary.uniqueRiskAgents.join(', ')
    }`,
  );
  lines.push('');

  // ── Historial laboral.
  lines.push('## Historial laboral');
  lines.push('');
  if (bundle.laborHistory.length === 0) {
    lines.push('_(sin entradas registradas)_');
  } else {
    for (const e of bundle.laborHistory) {
      lines.push(
        `- ${e.yearFrom}–${e.yearTo} · ${e.employer} · ${e.role} · ${e.workplaceCountry}`,
      );
      if (e.physicalDemands.length > 0) {
        lines.push(`  - Demandas físicas: ${e.physicalDemands.join(', ')}`);
      }
      if (e.riskAgents.length > 0) {
        lines.push(`  - Agentes de riesgo: ${e.riskAgents.join(', ')}`);
      }
    }
  }
  lines.push('');

  // ── Métricas ergonómicas (ordenadas por fecha desc).
  lines.push('## Métricas ergonómicas (REBA / RULA)');
  lines.push('');
  if (bundle.ergonomicMetrics.length === 0) {
    lines.push('_(sin observaciones registradas)_');
  } else {
    const sorted = [...bundle.ergonomicMetrics].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    for (const m of sorted) {
      const task = m.taskType ? ` · ${m.taskType}` : '';
      const zones =
        m.affectedZones.length > 0
          ? ` · zonas: ${m.affectedZones.join(', ')}`
          : '';
      lines.push(
        `- ${m.date} · REBA ${m.rebaScore} · RULA ${m.rulaScore} · ${m.minutesObserved} min${task}${zones}`,
      );
    }
  }
  lines.push('');

  // ── Síntomas auto-reportados.
  lines.push('## Síntomas auto-reportados');
  lines.push('');
  if (bundle.selfReportedSymptoms.length === 0) {
    lines.push('_(sin síntomas registrados)_');
  } else {
    for (const s of bundle.selfReportedSymptoms) {
      const triggered =
        s.triggeredByWork === null
          ? 'no asertado'
          : s.triggeredByWork
          ? 'el trabajador afirma que sí'
          : 'el trabajador afirma que no';
      lines.push(
        `- ${s.date} · ${s.bodyPart} · severidad ${s.severity}/5 · gatillado por trabajo: ${triggered}`,
      );
      lines.push(`  - "${s.description}"`);
    }
  }
  lines.push('');

  // ── Hotspots y frecuencias (estadística pura, sin clasificar).
  if (summary.ergonomicHotspots.length > 0) {
    lines.push('## Zonas con mayor observación ergonómica');
    lines.push('');
    for (const h of summary.ergonomicHotspots) {
      lines.push(
        `- ${h.zone}: ${h.observationCount} obs · REBA promedio ${h.avgReba.toFixed(2)}`,
      );
    }
    lines.push('');
  }
  if (summary.symptomBodyPartFrequency.length > 0) {
    lines.push('## Frecuencia de síntomas por zona corporal');
    lines.push('');
    for (const f of summary.symptomBodyPartFrequency) {
      lines.push(
        `- ${f.bodyPart}: ${f.count} reportes · severidad promedio ${f.avgSeverity.toFixed(2)}/5`,
      );
    }
    lines.push('');
  }

  // ── Footer disclaimer (redundante a propósito: el médico debe ver
  //    siempre que la app no diagnostica).
  lines.push('---');
  lines.push('');
  lines.push(
    '_Praeventio organiza información ocupacional pero no emite ningún juicio clínico. La calificación del origen (laboral o común) es decisión exclusiva del médico tratante._',
  );

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Export real — wire Bucket VV.
// ─────────────────────────────────────────────────────────────────────
//
// Diseño:
//   1. El caller (orquestador post-merge) consulta sus collections y
//      construye el OccupationalContextBundle puro vía
//      buildOccupationalContextBundle(). Adjunta documentos firmados
//      (PDFs, imágenes) que ya viven en Storage / IndexedDB / blobs.
//   2. exportOccupationalBundle() serializa todo a un ZIP store-mode
//      (sin compresión: el envelope cifrado no comprime), lo cifra con
//      envelope encryption (kmsEnvelope.ts), lo sube al Bucket VV en
//      `tenants/{tenantId}/vault/{workerUid}/{timestamp}-occupational.zip`,
//      registra la metadata en Firestore (`tenants/{tid}/vaultRecords`)
//      y devuelve `{ url, expiresAt, sizeBytes, sha256 }`.
//
// Dependency injection:
//   Todos los efectos (Storage, Firestore, KMS, "ahora") son inyectables.
//   El default usa firebase-admin perezosamente, igual que
//   firestoreCriticalReplicate.ts (Bucket W.5) — sin nueva dep top-level.
//
// Privacidad ADR 0012: nada del bundle se infiere ni se etiqueta. Esta
// función solo serializa, cifra y entrega. El médico tratante decide.

import { createHash } from 'node:crypto';
import { envelopeEncrypt, type EnvelopeCiphertext } from '../security/kmsEnvelope.ts';
import { getKmsAdapter, type KmsAdapter } from '../security/kmsAdapter.ts';

/**
 * Adjunto firmado que viaja dentro del ZIP junto al JSON del bundle.
 * Caller es responsable de garantizar que `bytes` no contenga PII
 * adicional fuera de la cartera médica del trabajador.
 */
export interface OccupationalAttachment {
  /** Nombre de archivo dentro del ZIP. Debe ser único + URL-safe. */
  filename: string;
  /** Mime type informativo (no participa del cifrado). */
  contentType: string;
  /** Bytes del adjunto. NO base64 — bytes crudos. */
  bytes: Uint8Array;
}

/**
 * Contrato del uploader de Storage. La implementación recibe una ruta
 * relativa al bucket y los bytes ya cifrados; devuelve una signed URL
 * con TTL deterministico (default 24h). Tests inyectan un stub.
 */
export interface VaultStorageUploader {
  /**
   * Persiste `bytes` en `path` dentro del bucket Vault y devuelve una
   * signed URL para descargar (TTL marcado por el caller).
   */
  upload(args: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
    /** TTL en milisegundos para la signed URL devuelta. */
    signedUrlTtlMs: number;
  }): Promise<{ url: string }>;
}

/**
 * Sink minimal de Firestore para la metadata del vaultRecord. Permite
 * tests sin firebase-admin (igual que firestoreCriticalReplicate.ts).
 */
export interface VaultRecordSink {
  saveVaultRecord(args: {
    path: string;
    record: OccupationalVaultRecord;
  }): Promise<void>;
}

/**
 * Shape persistido en `tenants/{tid}/vaultRecords/{recordId}` para
 * trazabilidad + auditoría. NO contiene el contenido del bundle —
 * el contenido vive cifrado en Storage; aquí solo va el handle.
 */
export interface OccupationalVaultRecord {
  /** Identificador estable del record. */
  recordId: string;
  /** Kind discriminador para futuros records (epp, training, etc). */
  kind: 'occupational';
  /** UID del trabajador dueño del bundle (ADR 0012). */
  ownerUid: string;
  /** Tenant scope. */
  tenantId: string;
  /** Path Storage del ZIP cifrado (sin bucket prefix). */
  storagePath: string;
  /** Signed URL al ZIP cifrado (vence con expiresAt). */
  signedUrl: string;
  createdAt: number;
  expiresAt: number;
  /** Tamaño del payload cifrado en bytes. */
  sizeBytes: number;
  /** SHA-256 hex del payload cifrado (integridad). */
  sha256: string;
  /**
   * Envelope DEK wrapping. El bundle se cifró con un DEK aleatorio que
   * KMS envolvió; almacenamos el envelope completo para que un futuro
   * decryptor sepa qué adapter y algoritmo usar. El ciphertext en
   * `envelope.ciphertext` está vacío — los bytes reales van en Storage,
   * solo el wrap del DEK + IV + authTag viajan aquí.
   */
  envelope: EnvelopeCiphertext;
}

export interface ExportOccupationalBundleArgs {
  /** Bundle ya construido (función pura buildOccupationalContextBundle). */
  bundle: OccupationalContextBundle;
  /** Tenant scope para el path Storage + Firestore. */
  tenantId: string;
  /** Adjuntos firmados (PDFs, imágenes). Default []. */
  attachments?: OccupationalAttachment[];
  /**
   * TTL de la signed URL devuelta. Default 24h. ADR 0012 §"Compartir QR"
   * recomienda 24h como ventana clínica razonable; el médico tratante
   * lee, anota, cierra.
   */
  signedUrlTtlMs?: number;
  /** Uploader Storage. Default: firebase-admin lazy. */
  uploader?: VaultStorageUploader;
  /** Sink Firestore para metadata. Default: firebase-admin lazy. */
  sink?: VaultRecordSink;
  /** KMS adapter para envelope wrap. Default: getKmsAdapter(). */
  kmsAdapter?: KmsAdapter;
  /** Override "ahora" para tests. Default: Date.now(). */
  now?: () => number;
  /**
   * Override del bucket Storage. Default: env `VAULT_BUCKET` o
   * 'praeventio-vault'.
   */
  bucket?: string;
}

export interface ExportOccupationalBundleResult {
  /** Signed URL para descargar el ZIP cifrado. */
  url: string;
  /** Timestamp absoluto (ms epoch) en que la signed URL expira. */
  expiresAt: number;
  /** Tamaño del payload cifrado subido a Storage. */
  sizeBytes: number;
  /** SHA-256 hex del payload cifrado. */
  sha256: string;
  /** ID del vaultRecord creado en Firestore. */
  recordId: string;
}

/** TTL por defecto: 24h (ADR 0012 §"Compartir QR"). */
const DEFAULT_SIGNED_URL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Path canonical del ZIP cifrado dentro del bucket Vault.
 * Exportado para que tests + jobs puedan reconstruirlo sin duplicar la
 * regla.
 */
export function vaultStoragePath(
  tenantId: string,
  workerUid: string,
  timestamp: number,
): string {
  return `tenants/${tenantId}/vault/${workerUid}/${timestamp}-occupational.zip`;
}

/**
 * Path canonical del vaultRecord en Firestore.
 */
export function vaultRecordDocPath(tenantId: string, recordId: string): string {
  return `tenants/${tenantId}/vaultRecords/${recordId}`;
}

// ─────────────────────────────────────────────────────────────────────
// ZIP writer (store-mode, sin dependencias)
// ─────────────────────────────────────────────────────────────────────
//
// jszip NO está en package.json y no queremos sumar deps por un caso de
// uso pequeño. El bundle ocupacional es JSON + adjuntos chicos (PDFs
// firmados, fotos). Implementamos un writer ZIP en modo STORE
// (sin compresión) de ~60 líneas:
//
//   - Method 0 (stored) → no DEFLATE. El payload se cifra después con
//     AES-GCM, que ya elimina cualquier ganancia de compresión.
//   - CRC-32 IEEE estándar (tabla precomputada en runtime).
//   - Sin atributos extra, sin extra fields, sin Unicode flag — los
//     filenames son ASCII URL-safe controlados por nosotros.
//
// El output cumple PKZIP APPNOTE §4 secciones 4.3.7 + 4.3.12 + 4.3.16,
// lo cual basta para que `unzip`, `7z`, `jszip.loadAsync()` y Finder de
// macOS lo abran sin warnings.

function crc32(bytes: Uint8Array): number {
  // Tabla precomputada por simple loop. ~70µs de cold-start; cacheada.
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let CRC32_TABLE: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (CRC32_TABLE) return CRC32_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  CRC32_TABLE = t;
  return t;
}

function writeUint16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

interface ZipEntry {
  filename: string;
  bytes: Uint8Array;
}

/**
 * Construye un ZIP store-mode (method=0) con las entradas dadas.
 * Las fechas DOS se fijan al epoch (1980-01-01 00:00:00) para que el
 * output sea byte-determinista a igual input — útil para tests con
 * `expect(...).toEqual(...)` sobre el sha256.
 */
function buildStoreZip(entries: ZipEntry[]): Uint8Array {
  const fileRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let runningOffset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.filename);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    // Local file header: 30 bytes + name + data.
    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32LE(localHeader, 0, 0x04034b50); // PK\x03\x04
    writeUint16LE(localHeader, 4, 20); // version needed
    writeUint16LE(localHeader, 6, 0); // flags
    writeUint16LE(localHeader, 8, 0); // method = store
    writeUint16LE(localHeader, 10, 0); // mod time (1980-01-01 00:00:00)
    writeUint16LE(localHeader, 12, 0x0021); // mod date (1980-01-01)
    writeUint32LE(localHeader, 14, crc);
    writeUint32LE(localHeader, 18, size); // compressed size
    writeUint32LE(localHeader, 22, size); // uncompressed size
    writeUint16LE(localHeader, 26, nameBytes.length);
    writeUint16LE(localHeader, 28, 0); // extra length
    localHeader.set(nameBytes, 30);

    fileRecords.push(localHeader, entry.bytes);

    // Central directory header: 46 bytes + name.
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32LE(centralHeader, 0, 0x02014b50); // PK\x01\x02
    writeUint16LE(centralHeader, 4, 20); // version made by
    writeUint16LE(centralHeader, 6, 20); // version needed
    writeUint16LE(centralHeader, 8, 0); // flags
    writeUint16LE(centralHeader, 10, 0); // method
    writeUint16LE(centralHeader, 12, 0); // mod time
    writeUint16LE(centralHeader, 14, 0x0021); // mod date
    writeUint32LE(centralHeader, 16, crc);
    writeUint32LE(centralHeader, 20, size);
    writeUint32LE(centralHeader, 24, size);
    writeUint16LE(centralHeader, 28, nameBytes.length);
    writeUint16LE(centralHeader, 30, 0); // extra length
    writeUint16LE(centralHeader, 32, 0); // comment length
    writeUint16LE(centralHeader, 34, 0); // disk number
    writeUint16LE(centralHeader, 36, 0); // internal attrs
    writeUint32LE(centralHeader, 38, 0); // external attrs
    writeUint32LE(centralHeader, 42, runningOffset); // local header offset
    centralHeader.set(nameBytes, 46);

    centralRecords.push(centralHeader);
    runningOffset += localHeader.length + entry.bytes.length;
  }

  const centralSize = centralRecords.reduce((s, r) => s + r.length, 0);
  const centralOffset = runningOffset;

  // End of central directory: 22 bytes.
  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, 0x06054b50); // PK\x05\x06
  writeUint16LE(eocd, 4, 0); // disk number
  writeUint16LE(eocd, 6, 0); // disk with central dir
  writeUint16LE(eocd, 8, entries.length); // entries on this disk
  writeUint16LE(eocd, 10, entries.length); // total entries
  writeUint32LE(eocd, 12, centralSize);
  writeUint32LE(eocd, 16, centralOffset);
  writeUint16LE(eocd, 20, 0); // comment length

  const totalSize =
    fileRecords.reduce((s, r) => s + r.length, 0) + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const r of fileRecords) {
    out.set(r, pos);
    pos += r.length;
  }
  for (const r of centralRecords) {
    out.set(r, pos);
    pos += r.length;
  }
  out.set(eocd, pos);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults firebase-admin (lazy import — igual que W.5)
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_VAULT_BUCKET = 'praeventio-vault';

async function defaultUploader(args: {
  path: string;
  bytes: Uint8Array;
  contentType: string;
  signedUrlTtlMs: number;
  bucket: string;
}): Promise<{ url: string }> {
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) admin.initializeApp();
  const file = admin.storage().bucket(args.bucket).file(args.path);
  await file.save(Buffer.from(args.bytes), {
    contentType: args.contentType,
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + args.signedUrlTtlMs,
  });
  return { url };
}

async function defaultSink(args: {
  path: string;
  record: OccupationalVaultRecord;
}): Promise<void> {
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) admin.initializeApp();
  await admin.firestore().doc(args.path).set(args.record);
}

// ─────────────────────────────────────────────────────────────────────
// Export real
// ─────────────────────────────────────────────────────────────────────

/**
 * Serializa, cifra, sube y registra el bundle ocupacional del trabajador.
 *
 * El bundle JSON pasa tal cual al ZIP — el caller (orquestador
 * post-merge) ya hizo la lectura de PortableCurriculum + HealthRecord
 * type='ergonomic_log' + symptoms type='self_reported_symptom' y armó
 * el OccupationalContextBundle puro. Esta función solo:
 *
 *   1. Genera ZIP store-mode con `bundle.json` + cada adjunto firmado.
 *   2. Cifra el ZIP entero con envelope encryption (DEK aleatorio,
 *      KEK = KMS).
 *   3. Sube el ciphertext crudo a
 *      `tenants/{tenantId}/vault/{workerUid}/{timestamp}-occupational.zip`.
 *   4. Persiste el `OccupationalVaultRecord` en
 *      `tenants/{tenantId}/vaultRecords/{recordId}`.
 *   5. Devuelve la signed URL + metadata.
 *
 * Retornos:
 *   - `url`        signed URL al ciphertext (24h por defecto).
 *   - `expiresAt`  timestamp absoluto de expiración (ms).
 *   - `sizeBytes`  tamaño del ciphertext subido.
 *   - `sha256`     hash hex del ciphertext (integridad).
 *   - `recordId`   ID del vaultRecord persistido.
 *
 * Errores:
 *   - `tenantId` o `bundle.workerUid` vacíos → `Error`.
 *   - KMS adapter no disponible → `envelopeEncrypt` throws.
 *   - Storage / Firestore failure → propagada al caller.
 */
export async function exportOccupationalBundle(
  args: ExportOccupationalBundleArgs,
): Promise<ExportOccupationalBundleResult> {
  const tenantId = args.tenantId;
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('exportOccupationalBundle: tenantId required');
  }
  if (!args.bundle.workerUid) {
    throw new Error('exportOccupationalBundle: bundle.workerUid required');
  }

  const now = (args.now ?? Date.now)();
  const ttl = args.signedUrlTtlMs ?? DEFAULT_SIGNED_URL_TTL_MS;
  const bucket = args.bucket ?? process.env.VAULT_BUCKET ?? DEFAULT_VAULT_BUCKET;
  const kms = args.kmsAdapter ?? getKmsAdapter();

  // 1. Armar ZIP.
  const bundleJson = JSON.stringify(args.bundle, null, 2);
  const entries: ZipEntry[] = [
    {
      filename: 'bundle.json',
      bytes: new TextEncoder().encode(bundleJson),
    },
  ];
  // Adjuntos firmados (PDFs, imágenes). Filenames van bajo `attachments/`
  // para que el lector clínico vea la separación.
  if (args.attachments) {
    for (const att of args.attachments) {
      if (!att.filename) {
        throw new Error('exportOccupationalBundle: attachment.filename required');
      }
      entries.push({
        filename: `attachments/${att.filename}`,
        bytes: att.bytes,
      });
    }
  }
  // Incluimos también el disclaimer en texto plano por redundancia
  // (ADR 0012: el médico tratante debe verlo si abre el ZIP sin pasar
  //  por la app).
  entries.push({
    filename: 'DISCLAIMER.txt',
    bytes: new TextEncoder().encode(args.bundle.disclaimer),
  });

  const zipBytes = buildStoreZip(entries);

  // 2. Envelope-encrypt. Cifra el ZIP entero como string base64 — el
  //    envelope ya maneja la conversión utf8↔buffer internamente; aquí
  //    pasamos base64 para preservar bytes binarios.
  const zipB64 = Buffer.from(zipBytes).toString('base64');
  const envelope = await envelopeEncrypt(zipB64, kms);

  // 3. Calcular el ciphertext final que va a Storage. Combinamos el
  //    ciphertext crudo del envelope + IV + authTag en un blob binario
  //    auto-contenido para que el decryptor lea el archivo y reconstruya
  //    el envelope sin tener que consultar Firestore primero. La metadata
  //    del envelope (algorithm, kmsAdapter, encryptedDek) viaja en
  //    Firestore (OccupationalVaultRecord.envelope) porque es chico.
  //
  //    Layout binario subido a Storage (todo big-endian-irrelevant — los
  //    componentes son base64 decodificados):
  //      [4 bytes magic 'PVB1']  PV(ault)B(undle) v1
  //      [4 bytes uint32 LE | iv length]
  //      [iv bytes]
  //      [4 bytes uint32 LE | authTag length]
  //      [authTag bytes]
  //      [resto: ciphertext crudo]
  const ivBytes = Buffer.from(envelope.iv, 'base64');
  const authTagBytes = Buffer.from(envelope.authTag, 'base64');
  const ciphertextBytes = Buffer.from(envelope.ciphertext, 'base64');

  const header = Buffer.alloc(4 + 4 + 4);
  header.write('PVB1', 0, 4, 'ascii');
  header.writeUInt32LE(ivBytes.length, 4);
  header.writeUInt32LE(authTagBytes.length, 8);

  // Buffer extends Uint8Array structurally, but vitest 4 / Node 22+
  // toEqual distinguishes the prototypes — VaultStorageUploader's
  // contract is Uint8Array, so normalize via Uint8Array.from to honor it.
  const finalPayload = Uint8Array.from(
    Buffer.concat([header, ivBytes, authTagBytes, ciphertextBytes]),
  );

  // 4. SHA-256 del payload cifrado (integridad post-Storage).
  const sha256 = createHash('sha256').update(finalPayload).digest('hex');
  const sizeBytes = finalPayload.length;

  // 5. Upload + signed URL.
  const path = vaultStoragePath(tenantId, args.bundle.workerUid, now);
  const uploader: VaultStorageUploader = args.uploader ?? {
    upload: (uArgs) => defaultUploader({ ...uArgs, bucket }),
  };
  const { url } = await uploader.upload({
    path,
    bytes: finalPayload,
    contentType: 'application/octet-stream',
    signedUrlTtlMs: ttl,
  });

  const expiresAt = now + ttl;
  const recordId = `occ_${args.bundle.workerUid}_${now}`;

  // 6. Persistir vaultRecord. El envelope va sin el ciphertext crudo
  //    (vive en Storage); preservamos algorithm + kmsAdapter +
  //    encryptedDek + iv/authTag (chicos) para que un futuro decryptor
  //    pueda reconstruirlo.
  const record: OccupationalVaultRecord = {
    recordId,
    kind: 'occupational',
    ownerUid: args.bundle.workerUid,
    tenantId,
    storagePath: path,
    signedUrl: url,
    createdAt: now,
    expiresAt,
    sizeBytes,
    sha256,
    envelope: {
      ...envelope,
      // El ciphertext "crudo" vive en Storage — vaciamos aquí para no
      // duplicar bytes. iv + authTag se mantienen porque son chicos y
      // viajan también en el header del archivo (redundancia barata).
      ciphertext: '',
    },
  };

  const sink: VaultRecordSink = args.sink ?? { saveVaultRecord: defaultSink };
  await sink.saveVaultRecord({
    path: vaultRecordDocPath(tenantId, recordId),
    record,
  });

  return { url, expiresAt, sizeBytes, sha256, recordId };
}
