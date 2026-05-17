// Praeventio Guard — Sprint K §106-108 — Importador Excel (HTTP endpoints).
//
// Dos endpoints separados, ambos `verifyAuth + idempotencyKey`:
//
//   • POST /api/import/excel
//       body: { kind, base64, options? } — 5MB max
//       Parsea el archivo, valida con Zod por `kind`, deduplica
//       contra el lote y opcionalmente contra Firestore. Devuelve un
//       reporte {valid, invalid, duplicates, errors[], sample[]}
//       SIN escribir nada.
//
//   • POST /api/import/commit
//       body: { kind, records, projectId, idempotencyToken? }
//       Confirma la escritura del set ya validado. Idempotente por
//       `Idempotency-Key` (replay devuelve el resultado original).
//
// Directiva memoria `product_signing_no_blocking_directives_2026-05-06`:
//   estos endpoints NUNCA pushean a SUSESO/MINSAL/SII — solo
//   poblan colecciones Firestore del tenant. La directiva 3 aplica.
//
// Tamaño máximo: 5MB el body completo. SheetJS exige raw bytes, así
// que el caller envía el archivo en base64 dentro del JSON. 5MB JSON
// ≈ 3.75MB binario después de decode, más que suficiente para los
// CSVs de hasta ~50k trabajadores que vemos en empresas medianas.

import { Router } from 'express';
import express from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { logger } from '../../utils/logger.js';
import {
  parseXlsx,
  validateRows,
  dedupe,
  XlsxReaderError,
  UNIQUE_KEY_BY_KIND,
  type ImportEntityKind,
  type ValidationIssue,
} from '../../services/excelImporter/index.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────
// Body parser local — 5MB (la cota global default es 64kb).
// ────────────────────────────────────────────────────────────────────
const importBodyJson = express.json({ limit: '5mb' });

const KIND_VALUES = [
  'workers',
  'epp',
  'trainings',
  'incidents',
  'projects',
  'risks',
] as const satisfies readonly ImportEntityKind[];

const ImportRequestSchema = z.object({
  kind: z.enum(KIND_VALUES),
  base64: z.string().min(1, 'base64 vacío'),
  options: z
    .object({
      sheetName: z.string().optional(),
      checkExisting: z.boolean().optional(),
      projectId: z.string().min(1).max(128).optional(),
    })
    .optional(),
});

const CommitRequestSchema = z.object({
  kind: z.enum(KIND_VALUES),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
  projectId: z.string().min(1).max(128),
});

interface SerializableError {
  rowNumber: number;
  column: string;
  code: string;
  message: string;
}

interface ImportSummary {
  kind: ImportEntityKind;
  totalRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  duplicatesInBatch: number;
  duplicatesInExisting: number;
  sheetName: string | null;
  detectedSheets: string[];
  errors: SerializableError[];
  sample: Array<Record<string, unknown>>;
  validRecords: Array<Record<string, unknown>>;
}

function summarizeIssues(
  invalid: Array<{ rowNumber: number; issues: ValidationIssue[] }>,
): SerializableError[] {
  const out: SerializableError[] = [];
  for (const inv of invalid) {
    for (const iss of inv.issues) {
      out.push({
        rowNumber: inv.rowNumber,
        column: iss.column,
        code: iss.code,
        message: iss.message,
      });
    }
  }
  // Cap a 500 errores para no explotar el JSON. El UI verá "+N más".
  return out.slice(0, 500);
}

async function loadExistingKeys(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string | undefined,
  kind: ImportEntityKind,
): Promise<Set<string>> {
  const field = UNIQUE_KEY_BY_KIND[kind];
  if (!field) return new Set();
  const out = new Set<string>();
  try {
    // Lectura best-effort, paginada. Si la colección es enorme, sólo
    // miramos las primeras 1000 — la UI deja claro que la dedupe contra
    // base no es exhaustiva más allá de eso (issue conocido del Sprint).
    let snap: admin.firestore.QuerySnapshot;
    if (projectId) {
      snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('projects')
        .doc(projectId)
        .collection(kind)
        .limit(1000)
        .get();
    } else {
      snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection(kind)
        .limit(1000)
        .get();
    }
    snap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown> | undefined;
      const v = data?.[field];
      if (typeof v === 'string' && v.length > 0) {
        out.add(v.toLowerCase().trim());
      }
    });
  } catch (err) {
    // Una caída del Firestore no debe tumbar la validación — el UI puede
    // mostrar "dedupe contra base no disponible". Loggeamos y seguimos.
    logger.warn('import.existing_keys_load_failed', {
      err: (err as Error)?.message,
      tenantId,
      projectId,
      kind,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// POST /api/import/excel — Validate-only
// ────────────────────────────────────────────────────────────────────

router.post(
  '/import/excel',
  verifyAuth,
  importBodyJson,
  idempotencyKey(),
  async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'no_uid' });

    const parsed = ImportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_payload',
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const { kind, base64, options } = parsed.data;

    // ─── 1. Parseo del archivo Excel ──────────────────────────────────
    let parseResult;
    try {
      parseResult = await parseXlsx(base64, { preferKind: kind });
    } catch (err) {
      if (err instanceof XlsxReaderError) {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      captureRouteError(err, 'import.excel.parse', { uid, kind });
      return res
        .status(500)
        .json({ error: 'parse_failed', message: (err as Error)?.message ?? 'unknown' });
    }
    const targetSheet = options?.sheetName
      ? parseResult.sheets.find(
          (s) => s.name.toLowerCase().trim() === options.sheetName!.toLowerCase().trim(),
        ) ?? parseResult.primarySheet
      : parseResult.primarySheet;
    if (!targetSheet) {
      return res.status(400).json({
        error: 'empty_xlsx',
        message: 'El archivo no contiene hojas legibles.',
      });
    }
    const totalRows = targetSheet.rows.length;
    if (totalRows === 0) {
      return res.status(200).json({
        kind,
        totalRows: 0,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        duplicatesInBatch: 0,
        duplicatesInExisting: 0,
        sheetName: targetSheet.name,
        detectedSheets: parseResult.sheets.map((s) => s.name),
        errors: [],
        sample: [],
        validRecords: [],
      } satisfies ImportSummary);
    }

    // ─── 2. Validación Zod por kind ───────────────────────────────────
    const validation = validateRows(kind, targetSheet.rows);

    // ─── 3. Dedupe (lote + opcional contra Firestore) ─────────────────
    let existingKeys: Set<string> | undefined;
    if (options?.checkExisting) {
      try {
        existingKeys = await loadExistingKeys(
          admin.firestore(),
          uid,
          options.projectId,
          kind,
        );
      } catch (err) {
        logger.warn('import.existing_keys_failed', {
          err: (err as Error)?.message,
        });
      }
    }
    const dedupeRes = dedupe(validation.valid, {
      kind,
      existingKeys,
    });

    const duplicatesInBatch = dedupeRes.duplicates.filter(
      (d) => !d.conflictWithExisting,
    ).length;
    const duplicatesInExisting = dedupeRes.duplicates.filter(
      (d) => d.conflictWithExisting,
    ).length;

    const errors = summarizeIssues(validation.invalid);
    // Añadimos los duplicados como "errores" semánticos para que el UI
    // los pueda mostrar en la misma tabla.
    for (const dup of dedupeRes.duplicates.slice(0, 200)) {
      errors.push({
        rowNumber: dup.rowNumber,
        column: UNIQUE_KEY_BY_KIND[kind] ?? '<row>',
        code: 'duplicate',
        message: dup.conflictWithExisting
          ? `Duplicado contra registro existente (${dup.key}).`
          : `Duplicado en lote (primera ocurrencia: fila ${dup.conflictsWithRowNumber}).`,
      });
    }

    const validRecords = dedupeRes.unique.map((u) => u.record as Record<string, unknown>);
    const sample = validRecords.slice(0, 5);

    const summary: ImportSummary = {
      kind,
      totalRows,
      valid: dedupeRes.unique.length,
      invalid: validation.invalid.length,
      duplicates: dedupeRes.duplicates.length,
      duplicatesInBatch,
      duplicatesInExisting,
      sheetName: targetSheet.name,
      detectedSheets: parseResult.sheets.map((s) => s.name),
      errors,
      sample,
      validRecords,
    };

    await auditServerEvent(req, 'import.excel.validated', 'import', {
      kind,
      totalRows,
      valid: summary.valid,
      invalid: summary.invalid,
      duplicates: summary.duplicates,
    });

    return res.status(200).json(summary);
  },
);

// ────────────────────────────────────────────────────────────────────
// POST /api/import/commit — Persist a validated batch
// ────────────────────────────────────────────────────────────────────

router.post(
  '/import/commit',
  verifyAuth,
  importBodyJson,
  idempotencyKey(),
  async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'no_uid' });

    const parsed = CommitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_payload',
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const { kind, records, projectId } = parsed.data;

    const db = admin.firestore();
    const tenantId = uid;
    const colRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('projects')
      .doc(projectId)
      .collection(kind);

    // Bulk write: hasta 5000 docs por request. Firestore batch limit
    // es 500, así que partimos en chunks. Cada chunk en transacción.
    const CHUNK = 400;
    let writtenCount = 0;
    const failedRowNumbers: number[] = [];
    for (let start = 0; start < records.length; start += CHUNK) {
      const slice = records.slice(start, start + CHUNK);
      try {
        const batch = db.batch();
        for (const rec of slice) {
          const docRef = colRef.doc();
          batch.set(docRef, {
            ...rec,
            _importedAt: admin.firestore.FieldValue.serverTimestamp(),
            _importedBy: uid,
            _importSource: 'excel-importer',
          });
        }
        await batch.commit();
        writtenCount += slice.length;
      } catch (err) {
        logger.error('import.commit.batch_failed', err as Error, {
          uid,
          kind,
          batchStart: start,
          batchSize: slice.length,
        });
        // Mark every row in this chunk as failed — Firestore batches are
        // all-or-nothing so we can't tell which one was the offender.
        for (let i = 0; i < slice.length; i++) {
          failedRowNumbers.push(start + i);
        }
      }
    }

    await auditServerEvent(req, 'import.excel.committed', 'import', {
      kind,
      projectId,
      writtenCount,
      failedCount: failedRowNumbers.length,
    });

    return res.status(200).json({
      success: failedRowNumbers.length === 0,
      kind,
      projectId,
      writtenCount,
      failedRowNumbers,
    });
  },
);

export default router;
