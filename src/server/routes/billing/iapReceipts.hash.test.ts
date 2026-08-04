// Praeventio Guard — redacción de secretos en logs/auditorías (tarea P1).
//
// El campo receiptIdHash contenía los primeros 16 caracteres del recibo
// (material sensible en reposo). Ahora es un hash SHA-256 real: conserva
// la correlación sin exponer el recibo.

import { describe, it, expect } from 'vitest';
import { hashReceiptId } from './iapReceipts.js';

describe('hashReceiptId', () => {
  it('produce un hash SHA-256 de 64 hex chars (hash real, no prefijo)', () => {
    const hash = hashReceiptId('GPA.3319-1234-5678-90123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NO contiene el prefijo del recibo (antes exponía los primeros 16 chars)', () => {
    const receipt = 'GPA.3319-1234-5678-90123';
    const hash = hashReceiptId(receipt);
    expect(hash).not.toContain(receipt.slice(0, 16));
    expect(hash.length).toBeGreaterThan(receipt.length);
  });

  it('es determinístico: mismo recibo → mismo hash', () => {
    const receipt = 'GPA.3319-1234-5678-90123';
    expect(hashReceiptId(receipt)).toBe(hashReceiptId(receipt));
  });

  it('recibos distintos → hashes distintos', () => {
    expect(hashReceiptId('recibo-A')).not.toBe(hashReceiptId('recibo-B'));
  });
});
