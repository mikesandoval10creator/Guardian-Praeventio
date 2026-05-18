// Praeventio Guard — Sprint K §106 — Lector de archivos Excel.
//
// Capa fina sobre SheetJS (`xlsx`). Recibe un buffer/base64 y devuelve
// un array de objetos por hoja, listo para alimentar al recordValidator.
//
// Diseño determinístico:
//   • No hace I/O — el caller (route handler) decide cómo viene el
//     archivo (base64 desde browser, multipart, etc).
//   • No depende de `node:fs`. Si SheetJS no está instalado, falla
//     con un mensaje claro en runtime y deja al caller la opción de
//     caer en CSV.
//   • Devuelve filas con `rowNumber` ya con offset humano (1-based,
//     contando el header como fila 1 ⇒ datos comienzan en fila 2).
//
// Soporte multi-hoja: cada hoja se parsea independientemente. El caller
// elige cuál usar según `kind` (workers, epp, …) o pide todas.
//
// Tamaño máximo: enforced por el caller (route guard 5MB) — aquí
// rechazamos buffers > 25MB defensivamente porque SheetJS puede hacer
// OOM con archivos malformados muy grandes.

import type { ImportEntityKind } from './recordValidator.js';

export const MAX_XLSX_BYTES = 25 * 1024 * 1024;

export interface SheetData {
  /** Nombre de la hoja tal como aparece en el archivo. */
  name: string;
  /** Filas como objetos {columna: valor}. */
  rows: Array<{ rowNumber: number; data: Record<string, unknown> }>;
  /** Columnas detectadas en la primera fila (header). */
  columns: string[];
}

export interface XlsxParseResult {
  sheets: SheetData[];
  /** Hoja primaria asumida (la primera o la que mejor matchea `kind`). */
  primarySheet: SheetData | null;
}

export interface XlsxParseOptions {
  /**
   * Si está presente, intentamos encontrar la hoja cuyo nombre
   * matchea (case-insensitive) el `kind` solicitado. Sirve para
   * archivos con varias hojas (workers, EPP, incidents) donde el
   * usuario indica cuál importar.
   */
  preferKind?: ImportEntityKind;
  /**
   * Si `true`, todas las llaves de columna se normalizan a camelCase
   * (espacios → _, primera letra minúscula). Por defecto `true` porque
   * los schemas Zod esperan `fullName`, `workerRut`, etc.
   */
  normalizeKeys?: boolean;
}

/**
 * Convierte un encabezado tipo "Nombre Completo" o "RUT Trabajador" a
 * un identificador canónico (`fullName`, `workerRut`).
 *
 * Heurística mínima — el usuario debe poder usar plantillas en español
 * o inglés sin friccionar.
 */
const HEADER_ALIASES: Record<string, string> = {
  nombre: 'fullName',
  'nombre completo': 'fullName',
  nombres: 'fullName',
  'full name': 'fullName',
  fullname: 'fullName',
  rut: 'rut',
  'rut trabajador': 'workerRut',
  rutTrabajador: 'workerRut',
  workerrut: 'workerRut',
  worker_rut: 'workerRut',
  cargo: 'role',
  role: 'role',
  rol: 'role',
  telefono: 'phone',
  teléfono: 'phone',
  phone: 'phone',
  email: 'email',
  correo: 'email',
  ingreso: 'hireDate',
  'fecha ingreso': 'hireDate',
  hiredate: 'hireDate',
  'hire date': 'hireDate',
  categoria: 'category',
  categoría: 'category',
  category: 'category',
  entregado: 'handedOverAt',
  'fecha entrega': 'handedOverAt',
  handedoverat: 'handedOverAt',
  marca: 'brand',
  brand: 'brand',
  vidautil: 'lifespanDays',
  'vida util': 'lifespanDays',
  'vida útil': 'lifespanDays',
  lifespandays: 'lifespanDays',
  codigo: 'code',
  código: 'code',
  code: 'code',
  completado: 'completedAt',
  'fecha completado': 'completedAt',
  completedat: 'completedAt',
  expira: 'expiresAt',
  'fecha expira': 'expiresAt',
  expiresat: 'expiresAt',
  institucion: 'institution',
  institución: 'institution',
  institution: 'institution',
  ocurrido: 'occurredAt',
  'fecha ocurrido': 'occurredAt',
  occurredat: 'occurredAt',
  descripcion: 'description',
  descripción: 'description',
  description: 'description',
  severidad: 'severity',
  severity: 'severity',
  ubicacion: 'location',
  ubicación: 'location',
  location: 'location',
  involucrado: 'involvedWorkerRut',
  'rut involucrado': 'involvedWorkerRut',
  involvedworkerrut: 'involvedWorkerRut',
  nombre_proyecto: 'name',
  name: 'name',
  industria: 'industry',
  industry: 'industry',
  inicio: 'startDate',
  'fecha inicio': 'startDate',
  startdate: 'startDate',
  direccion: 'address',
  dirección: 'address',
  address: 'address',
  serial: 'serial',
  numero_serie: 'serial',
  'número serie': 'serial',
  id: 'id',
};

export function canonicalizeHeader(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  const lower = trimmed.toLowerCase();
  if (HEADER_ALIASES[lower]) return HEADER_ALIASES[lower];
  // Fallback: camelCase del valor original
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0].toLowerCase();
  const rest = parts
    .slice(1)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
  return first + rest;
}

/**
 * Adaptador opcional sobre SheetJS para mantener este módulo
 * unit-testeable sin dep. Tests inyectan un parser fake.
 */
export interface XlsxParserAdapter {
  parseBuffer(buf: Uint8Array): {
    sheetNames: string[];
    sheetToJson(name: string): Array<Record<string, unknown>>;
  };
}

let cachedAdapter: XlsxParserAdapter | null = null;

async function getSheetJsAdapter(): Promise<XlsxParserAdapter> {
  if (cachedAdapter) return cachedAdapter;
  // Lazy import so unit tests que no usan XLSX no fuerzan el paquete.
  // SheetJS (xlsx) is intentionally not installed in node_modules — it's
  // declared as optional/peer and resolved at runtime when present.
  // 2026-05-18: package ahora está instalado (PR #351 — Excel Importer),
  // así que ya no hace falta el @ts-expect-error.
  const mod = (await import('xlsx')) as unknown as {
    read: (data: Uint8Array, opts: { type: 'array' }) => {
      SheetNames: string[];
      Sheets: Record<string, unknown>;
    };
    utils: {
      sheet_to_json: (
        sheet: unknown,
        opts: { defval: null; raw: false },
      ) => Array<Record<string, unknown>>;
    };
  };
  cachedAdapter = {
    parseBuffer(buf: Uint8Array) {
      const wb = mod.read(buf, { type: 'array' });
      return {
        sheetNames: wb.SheetNames,
        sheetToJson(name: string) {
          const sheet = wb.Sheets[name];
          if (!sheet) return [];
          return mod.utils.sheet_to_json(sheet, { defval: null, raw: false });
        },
      };
    },
  };
  return cachedAdapter;
}

/** Setter para tests — sustituye el parser real por un fake. */
export function __setXlsxAdapterForTests(adapter: XlsxParserAdapter | null): void {
  cachedAdapter = adapter;
}

function pickPrimarySheet(
  sheets: SheetData[],
  kind?: ImportEntityKind,
): SheetData | null {
  if (sheets.length === 0) return null;
  if (!kind) return sheets[0];
  const lowerKind = kind.toLowerCase();
  // Aliases simples para que "Trabajadores", "Workers", "EPP", etc matcheen.
  const kindAliases: Record<ImportEntityKind, string[]> = {
    workers: ['workers', 'trabajadores', 'personal', 'empleados'],
    epp: ['epp', 'elementos', 'proteccion personal'],
    trainings: ['trainings', 'capacitaciones', 'cursos'],
    incidents: ['incidents', 'incidentes', 'accidentes'],
    projects: ['projects', 'proyectos', 'faenas'],
    risks: ['risks', 'riesgos', 'iper'],
  };
  const wanted = new Set(kindAliases[kind] ?? [lowerKind]);
  return sheets.find((s) => wanted.has(s.name.trim().toLowerCase())) ?? sheets[0];
}

/**
 * Parseo principal. `data` puede venir como:
 *   • Uint8Array (Node Buffer extiende Uint8Array)
 *   • string base64 (browser/JSON payload)
 */
export async function parseXlsx(
  data: Uint8Array | string,
  options: XlsxParseOptions = {},
): Promise<XlsxParseResult> {
  const buf = coerceToBuffer(data);
  if (buf.byteLength > MAX_XLSX_BYTES) {
    throw new XlsxReaderError(
      `xlsx_too_large: ${buf.byteLength} bytes excede el máximo ${MAX_XLSX_BYTES}.`,
      'too_large',
    );
  }
  let parser: XlsxParserAdapter;
  try {
    parser = await getSheetJsAdapter();
  } catch (err) {
    throw new XlsxReaderError(
      'xlsx_module_missing: instala la dependencia `xlsx` o cae en CSV.',
      'missing_dep',
      err instanceof Error ? err : undefined,
    );
  }
  let workbook: ReturnType<XlsxParserAdapter['parseBuffer']>;
  try {
    workbook = parser.parseBuffer(buf);
  } catch (err) {
    throw new XlsxReaderError(
      'xlsx_parse_failed: archivo Excel no es válido o está corrupto.',
      'invalid_file',
      err instanceof Error ? err : undefined,
    );
  }
  const normalizeKeys = options.normalizeKeys !== false;
  const sheets: SheetData[] = workbook.sheetNames.map((name) => {
    const rawRows = workbook.sheetToJson(name);
    const seenCols = new Set<string>();
    const rows: SheetData['rows'] = rawRows.map((rawRow, idx) => {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawRow)) {
        const key = normalizeKeys ? canonicalizeHeader(k) : k;
        if (!key) continue;
        data[key] = v;
        seenCols.add(key);
      }
      // rowNumber = idx + 2 ⇒ header es fila 1, primera fila de datos es 2.
      return { rowNumber: idx + 2, data };
    });
    return { name, rows, columns: Array.from(seenCols) };
  });
  return {
    sheets,
    primarySheet: pickPrimarySheet(sheets, options.preferKind),
  };
}

export class XlsxReaderError extends Error {
  readonly code: 'too_large' | 'missing_dep' | 'invalid_file';
  override readonly cause?: Error;
  constructor(message: string, code: XlsxReaderError['code'], cause?: Error) {
    super(message);
    this.name = 'XlsxReaderError';
    this.code = code;
    this.cause = cause;
  }
}

function coerceToBuffer(data: Uint8Array | string): Uint8Array {
  if (typeof data === 'string') {
    // base64 (con o sin data-uri prefix)
    const clean = data.includes(',') ? data.split(',')[1] ?? '' : data;
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(clean, 'base64');
    }
    // browser path (no debería ejecutarse server-side, fallback defensivo).
    const bin = atob(clean);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  return data;
}
