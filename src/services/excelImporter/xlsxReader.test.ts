// Praeventio Guard — Sprint K §106 — xlsxReader tests.
//
// Inyectamos un parser fake (sin tocar SheetJS) para verificar:
//   • Multi-hoja: cada hoja queda como SheetData
//   • Canonicalización de headers (alias en español)
//   • Row numbering 1-based con header como fila 1 → datos desde 2
//   • Selección de hoja por `preferKind`
//   • Errores: archivo demasiado grande, parser ausente.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseXlsx,
  canonicalizeHeader,
  __setXlsxAdapterForTests,
  XlsxReaderError,
  MAX_XLSX_BYTES,
  type XlsxParserAdapter,
} from './xlsxReader.js';

const makeAdapter = (
  sheets: Record<string, Array<Record<string, unknown>>>,
): XlsxParserAdapter => ({
  parseBuffer() {
    return {
      sheetNames: Object.keys(sheets),
      sheetToJson(name: string) {
        return sheets[name] ?? [];
      },
    };
  },
});

beforeEach(() => {
  __setXlsxAdapterForTests(null);
});

describe('canonicalizeHeader', () => {
  it('mapea alias en español al campo canónico', () => {
    expect(canonicalizeHeader('Nombre Completo')).toBe('fullName');
    expect(canonicalizeHeader('RUT Trabajador')).toBe('workerRut');
    expect(canonicalizeHeader('Fecha Entrega')).toBe('handedOverAt');
  });

  it('camelCase del fallback cuando no hay alias', () => {
    expect(canonicalizeHeader('Custom Field Name')).toBe('customFieldName');
  });

  it('devuelve string vacío para input vacío', () => {
    expect(canonicalizeHeader('')).toBe('');
    expect(canonicalizeHeader('   ')).toBe('');
  });
});

describe('parseXlsx', () => {
  it('parsea una hoja simple con headers canónicos', async () => {
    __setXlsxAdapterForTests(
      makeAdapter({
        Trabajadores: [
          { 'Nombre Completo': 'Juan Pérez', RUT: '11.111.111-1' },
          { 'Nombre Completo': 'María López', RUT: '12345670-K' },
        ],
      }),
    );
    const result = await parseXlsx(new Uint8Array([1, 2, 3]), {
      preferKind: 'workers',
    });
    expect(result.sheets).toHaveLength(1);
    expect(result.primarySheet?.name).toBe('Trabajadores');
    expect(result.primarySheet?.rows[0]).toEqual({
      rowNumber: 2,
      data: { fullName: 'Juan Pérez', rut: '11.111.111-1' },
    });
    expect(result.primarySheet?.rows[1]?.rowNumber).toBe(3);
  });

  it('multi-hoja: detecta todas y elige primarySheet por preferKind', async () => {
    __setXlsxAdapterForTests(
      makeAdapter({
        EPP: [{ Categoría: 'casco' }],
        Trabajadores: [{ RUT: '11.111.111-1' }],
        Incidentes: [{ Descripción: 'caída' }],
      }),
    );
    const result = await parseXlsx(new Uint8Array([1]), { preferKind: 'workers' });
    expect(result.sheets).toHaveLength(3);
    expect(result.primarySheet?.name).toBe('Trabajadores');
  });

  it('cae al primer sheet si preferKind no matchea ninguna hoja', async () => {
    __setXlsxAdapterForTests(makeAdapter({ Sheet1: [{ a: 1 }] }));
    const result = await parseXlsx(new Uint8Array([1]), { preferKind: 'risks' });
    expect(result.primarySheet?.name).toBe('Sheet1');
  });

  it('acepta base64 string como entrada', async () => {
    __setXlsxAdapterForTests(makeAdapter({ Sheet1: [{ a: 1 }] }));
    const base64 = Buffer.from('hello').toString('base64');
    const result = await parseXlsx(base64);
    expect(result.sheets).toHaveLength(1);
  });

  it('rechaza buffer > MAX_XLSX_BYTES', async () => {
    __setXlsxAdapterForTests(makeAdapter({ Sheet1: [] }));
    const huge = new Uint8Array(MAX_XLSX_BYTES + 1);
    await expect(parseXlsx(huge)).rejects.toThrow(XlsxReaderError);
    await expect(parseXlsx(huge)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('devuelve XlsxReaderError(invalid_file) si el parser lanza', async () => {
    __setXlsxAdapterForTests({
      parseBuffer() {
        throw new Error('corrupted zip');
      },
    });
    await expect(parseXlsx(new Uint8Array([1]))).rejects.toMatchObject({
      code: 'invalid_file',
    });
  });

  it('columnas detectadas son las efectivamente vistas en las filas', async () => {
    __setXlsxAdapterForTests(
      makeAdapter({
        Sheet1: [
          { Nombre: 'A', RUT: '1' },
          { Nombre: 'B', Cargo: 'jefe' },
        ],
      }),
    );
    const result = await parseXlsx(new Uint8Array([1]));
    expect(result.primarySheet?.columns).toContain('fullName');
    expect(result.primarySheet?.columns).toContain('rut');
    expect(result.primarySheet?.columns).toContain('role');
  });
});
