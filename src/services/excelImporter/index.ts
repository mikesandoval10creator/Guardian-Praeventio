// Praeventio Guard — Sprint K §106-108 — Excel importer (barrel).
//
// API pública del módulo Sprint K v2 (xlsx + Zod + dedupe separados).
// El legacy `src/services/excelImport/excelImporter.ts` permanece
// intacto para no romper consumers viejos.

export {
  parseXlsx,
  canonicalizeHeader,
  MAX_XLSX_BYTES,
  XlsxReaderError,
  __setXlsxAdapterForTests,
  type SheetData,
  type XlsxParseOptions,
  type XlsxParseResult,
  type XlsxParserAdapter,
} from './xlsxReader.js';

export {
  validateRows,
  isValidRut,
  normalizeRut,
  isValidIso,
  SCHEMAS_BY_KIND,
  UNIQUE_KEY_BY_KIND,
  WorkerSchema,
  EppSchema,
  TrainingSchema,
  IncidentSchema,
  ProjectSchema,
  RiskSchema,
  type ImportEntityKind,
  type ValidationIssue,
  type ValidationResult,
  type ValidatedRow,
  type RawRow,
  type WorkerRecord,
  type EppRecord,
  type TrainingRecord,
  type IncidentRecord,
  type ProjectRecord,
  type RiskRecord,
} from './recordValidator.js';

export {
  dedupe,
  type DedupeInput,
  type DedupeOptions,
  type DedupeResult,
  type DuplicateReport,
} from './deduplicator.js';
