import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  verifyImmutablePdf,
  formatHashForDisplay,
} from './pdfImmutableService.js';

// NOTE: `buildImmutablePdf` usa `jsPDF@4.2.1` que en runtime browser
// (donde la app realmente lo invoca) funciona perfectamente. En el
// entorno node de vitest, jsPDF carga `pako@2.x` y la resolución de
// módulos ESM no encuentra `pako/index.js` (pako@2 solo ships `dist/`).
//
// Cubrimos el contrato CRÍTICO de inmutabilidad sin depender de jsPDF:
//   - SHA-256 sobre bytes arbitrarios
//   - verifyImmutablePdf devuelve true/false correctamente
//   - formatHashForDisplay
//
// La función `buildImmutablePdf` se valida via tests e2e (PDF generation
// en browser real) — el PDF que genera la página ImmutableRender es
// observable end-to-end con descargas reales.

describe('verifyImmutablePdf — contrato de integridad', () => {
  it('hash matching: valid=true', () => {
    const bytes = new TextEncoder().encode('contenido del PDF de prueba');
    const expectedHash = bytesToHex(sha256(bytes));
    const result = verifyImmutablePdf(bytes, expectedHash);
    expect(result.valid).toBe(true);
    expect(result.actualHashHex).toBe(expectedHash);
  });

  it('hash uppercase en expected: normaliza a lowercase', () => {
    const bytes = new TextEncoder().encode('test bytes');
    const expectedHash = bytesToHex(sha256(bytes));
    const result = verifyImmutablePdf(bytes, expectedHash.toUpperCase());
    expect(result.valid).toBe(true);
  });

  it('bytes tampered: valid=false con reason hash_mismatch', () => {
    const original = new TextEncoder().encode('original content');
    const tampered = new TextEncoder().encode('TAMPERED content');
    const expectedHash = bytesToHex(sha256(original));
    const result = verifyImmutablePdf(tampered, expectedHash);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('hash_mismatch');
    expect(result.actualHashHex).not.toBe(expectedHash);
  });

  it('un solo byte modificado: detect tamper', () => {
    const bytes = new Uint8Array(100).fill(0xab);
    const expectedHash = bytesToHex(sha256(bytes));
    const tampered = new Uint8Array(bytes);
    tampered[50] = 0xff;
    const result = verifyImmutablePdf(tampered, expectedHash);
    expect(result.valid).toBe(false);
  });

  it('bytes vacíos con hash no-vacío: falla', () => {
    const result = verifyImmutablePdf(new Uint8Array(0), 'a'.repeat(64));
    expect(result.valid).toBe(false);
  });

  it('hash vacío correcto: pass (edge case — bytes vacíos tienen hash conocido)', () => {
    const emptyHash = bytesToHex(sha256(new Uint8Array(0)));
    const result = verifyImmutablePdf(new Uint8Array(0), emptyHash);
    expect(result.valid).toBe(true);
  });

  it('result expone actualHashHex + expectedHashHex para audit log', () => {
    const bytes = new TextEncoder().encode('audit content');
    const wrongHash = 'a'.repeat(64);
    const result = verifyImmutablePdf(bytes, wrongHash);
    expect(result.actualHashHex).toBeTruthy();
    expect(result.expectedHashHex).toBe(wrongHash);
  });
});

describe('formatHashForDisplay', () => {
  it('formato chunks de 4 chars separados por espacios', () => {
    expect(formatHashForDisplay('a1b2c3d4e5f60718')).toBe(
      'a1b2 c3d4 e5f6 0718',
    );
  });

  it('hash SHA-256 completo (64 chars) formateado en 16 grupos', () => {
    const hex = bytesToHex(sha256(new TextEncoder().encode('test')));
    const formatted = formatHashForDisplay(hex);
    const groups = formatted.split(' ');
    expect(groups).toHaveLength(16);
    expect(groups.every((g) => g.length === 4)).toBe(true);
  });

  it('hex vacío devuelve string vacío', () => {
    expect(formatHashForDisplay('')).toBe('');
  });

  it('hex con longitud no múltiplo de 4: último grupo más corto', () => {
    expect(formatHashForDisplay('abc')).toBe('abc');
    expect(formatHashForDisplay('abcde')).toBe('abcd e');
  });
});
