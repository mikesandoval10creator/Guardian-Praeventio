// Praeventio Guard — PII redactor tests.
//
// Sprint 20 ninth wave (Bucket A). Closes STRIDE finding TM-I03.
//
// We exercise each redaction category individually plus the cross-cutting
// invariants the wiring layer relies on:
//   - idempotency (running twice yields count=0 on the second pass)
//   - unicode safety (Spanish accents around the redacted token)
//   - counter accuracy across multiple categories in one prompt
//   - categories Set is deduped
//
// No SDK is mocked; the module is pure regex.

import { describe, expect, it } from 'vitest';
import { redactPii } from './piiRedactor';

describe('redactPii', () => {
  it('returns the empty string unchanged with count 0', () => {
    const r = redactPii('');
    expect(r.redacted).toBe('');
    expect(r.count).toBe(0);
    expect(r.categories).toEqual([]);
  });

  it('passes through text with no PII', () => {
    const input = 'El trabajador reporta dolor lumbar tras turno largo en faena minera.';
    const r = redactPii(input);
    expect(r.redacted).toBe(input);
    expect(r.count).toBe(0);
    expect(r.categories).toEqual([]);
  });

  it('redacts a Chilean RUT with dots', () => {
    const r = redactPii('El RUT del trabajador es 12.345.678-9 según ficha.');
    expect(r.redacted).toContain('[RUT_REDACTED]');
    expect(r.redacted).not.toContain('12.345.678-9');
    expect(r.count).toBe(1);
    expect(r.categories).toContain('rut');
  });

  it('redacts a Chilean RUT without dots and with K verifier', () => {
    const r = redactPii('Contacto admin RUT 9876543-K para emergencias.');
    expect(r.redacted).toContain('[RUT_REDACTED]');
    expect(r.redacted).not.toContain('9876543-K');
    expect(r.count).toBe(1);
    expect(r.categories).toContain('rut');
  });

  it('redacts an email address', () => {
    const r = redactPii('Reporte enviado por supervisor.terreno@example.cl ayer.');
    expect(r.redacted).toContain('[EMAIL_REDACTED]');
    expect(r.redacted).not.toContain('supervisor.terreno@example.cl');
    expect(r.count).toBe(1);
    expect(r.categories).toContain('email');
  });

  it('redacts a Chilean mobile phone with country code and spaces', () => {
    const r = redactPii('Llamar al +56 9 1234 5678 si urge.');
    expect(r.redacted).toContain('[PHONE_REDACTED]');
    expect(r.redacted).not.toContain('1234 5678');
    expect(r.count).toBe(1);
    expect(r.categories).toContain('phone');
  });

  it('redacts a Chilean mobile phone without country code', () => {
    const r = redactPii('Móvil de cuadrilla 987654321 disponible 24/7.');
    expect(r.redacted).toContain('[PHONE_REDACTED]');
    expect(r.count).toBe(1);
    expect(r.categories).toContain('phone');
  });

  it('redacts a credit-card-like 16-digit sequence', () => {
    const r = redactPii('Tarjeta corporativa 4111 1111 1111 1111 vence en marzo.');
    expect(r.redacted).toContain('[CARD_REDACTED]');
    expect(r.redacted).not.toContain('4111 1111 1111 1111');
    expect(r.count).toBe(1);
    expect(r.categories).toContain('card');
  });

  it('redacts API key prefixes (sk-, AIza)', () => {
    const r = redactPii('Token sk-ABCDEFGHIJKLMNOPQRSTUVWX y AIzaSyA1B2C3D4E5F6G7H8I9J0K en config.');
    expect(r.redacted).toContain('[APIKEY_REDACTED]');
    expect(r.redacted).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUVWX');
    expect(r.redacted).not.toContain('AIzaSyA1B2C3D4E5F6G7H8I9J0K');
    expect(r.count).toBe(2);
    expect(r.categories).toContain('apikey');
  });

  it('redacts multiple categories in one prompt and counts each', () => {
    const r = redactPii(
      'Trabajador 12.345.678-9, contacto juan@example.cl, móvil +56 9 8765 4321. Token AIzaSyA1B2C3D4E5F6G7H8I9J0KLM.',
    );
    expect(r.redacted).toContain('[RUT_REDACTED]');
    expect(r.redacted).toContain('[EMAIL_REDACTED]');
    expect(r.redacted).toContain('[PHONE_REDACTED]');
    expect(r.redacted).toContain('[APIKEY_REDACTED]');
    expect(r.count).toBe(4);
    expect(r.categories.sort()).toEqual(['apikey', 'email', 'phone', 'rut']);
  });

  it('is idempotent — running on already-redacted text yields count 0', () => {
    const first = redactPii('RUT 12.345.678-9 y email a@b.cl.');
    expect(first.count).toBeGreaterThan(0);
    const second = redactPii(first.redacted);
    expect(second.redacted).toBe(first.redacted);
    expect(second.count).toBe(0);
    expect(second.categories).toEqual([]);
  });

  it('is unicode safe — preserves Spanish accents around the redacted token', () => {
    const r = redactPii('José Pérez 12.345.678-9 reportó la incidencia.');
    expect(r.redacted).toContain('José Pérez');
    expect(r.redacted).toContain('reportó');
    expect(r.redacted).toContain('[RUT_REDACTED]');
    expect(r.count).toBe(1);
  });

  it('counts duplicate matches in the same prompt', () => {
    const r = redactPii('Cuadrilla A: 11.111.111-1 y 22.222.222-2 ambos asignados al turno noche.');
    expect(r.count).toBe(2);
    expect(r.categories).toEqual(['rut']);
  });

  it('deduplicates categories when the same category appears multiple times', () => {
    const r = redactPii('Emails de ejemplo: a@b.cl, c@d.cl, e@f.cl.');
    expect(r.count).toBe(3);
    // Only one 'email' tag despite three matches.
    expect(r.categories.filter((c) => c === 'email')).toHaveLength(1);
  });

  it('does not redact short numeric IDs that are not RUT/phone/card-shaped', () => {
    const r = redactPii('Folio 12345 entregado al jefe de obra. Norma DS 594 aplica.');
    expect(r.redacted).toBe('Folio 12345 entregado al jefe de obra. Norma DS 594 aplica.');
    expect(r.count).toBe(0);
  });
});
