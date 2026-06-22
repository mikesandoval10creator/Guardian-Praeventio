// Praeventio Guard — V11 security hardening.
//
// Unit tests (node environment, no jsdom) verifying that the /api/ask-guardian
// handler redacts PII from `query` BEFORE the raw string reaches the Gemini
// prompt. The production handler calls `redactPromptForVertex` from
// `src/services/gemini/pii.ts` on the extracted `query` value, producing a
// safe copy that is interpolated into the prompt instead of the raw input.
//
// Patterns under test (all defined in src/services/observability/piiRedactor.ts):
//   - Chilean RUT: 12.345.678-5  →  [RUT_REDACTED]
//   - Email:       user@example.com → [redacted-email]
//   - CL phone:    +56 9 1234 5678  → [redacted-phone-cl]
//
// This file exercises the `redactPii` function directly (the pure underlying
// helper) and `redactPromptForVertex` (the logging wrapper used by the handler).
// It does NOT spin up HTTP — the PII-stripping contract lives in a pure
// function, so a unit test is the right granularity.
//
// For the wiring proof (that the route actually calls redaction before Gemini),
// see the integration snapshot in askGuardian.test.ts + the mock on
// `src/services/gemini/pii.ts` used by gemini.router.test.ts.

import { describe, it, expect } from 'vitest';
import { redactPii } from '../../services/observability/piiRedactor.js';
import { redactPromptForVertex } from '../../services/gemini/pii.js';

describe('V11 — PII redaction: redactPii patterns', () => {
  it('redacts a Chilean RUT (XX.XXX.XXX-K) before it can reach generateContent', () => {
    const raw = 'La consulta es sobre el trabajador con RUT 12.345.678-5';
    const { redacted, count, categories } = redactPii(raw);
    expect(redacted).not.toContain('12.345.678-5');
    expect(redacted).toContain('[RUT_REDACTED]');
    expect(count).toBeGreaterThan(0);
    expect(categories).toContain('rut');
  });

  it('redacts an email address before it can reach generateContent', () => {
    const raw = 'Enviar a supervisor@empresa.cl por favor';
    const { redacted, count, categories } = redactPii(raw);
    expect(redacted).not.toContain('supervisor@empresa.cl');
    expect(count).toBeGreaterThan(0);
    expect(categories).toContain('email');
  });

  it('redacts a Chilean mobile phone (+56 9 XXXX XXXX) before it can reach generateContent', () => {
    const raw = 'Llamar al prevencionista al +56 9 1234 5678';
    const { redacted, count, categories } = redactPii(raw);
    expect(redacted).not.toContain('+56 9 1234 5678');
    expect(count).toBeGreaterThan(0);
    expect(categories).toContain('phone');
  });

  it('redacts a combined query containing RUT + email + phone simultaneously', () => {
    const raw =
      'Juan RUT 12.345.678-5, email juan@obra.cl, fono +56 9 8765 4321, qué normativa aplica?';
    const { redacted, count, categories } = redactPii(raw);
    expect(redacted).not.toContain('12.345.678-5');
    expect(redacted).not.toContain('juan@obra.cl');
    expect(redacted).not.toContain('+56 9 8765 4321');
    expect(count).toBeGreaterThanOrEqual(3);
    expect(categories).toContain('rut');
    expect(categories).toContain('email');
    expect(categories).toContain('phone');
    // Non-PII substance is preserved so the model can still reason about it
    expect(redacted).toContain('normativa');
  });

  it('leaves clean queries untouched (no false positives for DS 594 article refs)', () => {
    const clean = 'Cuáles son las obligaciones del empleador según DS 594 artículo 82?';
    const { redacted, count } = redactPii(clean);
    expect(count).toBe(0);
    expect(redacted).toBe(clean);
  });
});

describe('V11 — PII redaction: redactPromptForVertex wrapper (used by /api/ask-guardian)', () => {
  it('returns the redacted string (RUT stripped)', () => {
    const input = 'Análisis para trabajador RUT 12.345.678-5';
    const result = redactPromptForVertex(input, 'ask-guardian');
    expect(result).not.toContain('12.345.678-5');
    expect(result).toContain('[RUT_REDACTED]');
  });

  it('returns the original string unchanged when no PII is present', () => {
    const clean = 'DS 594 obligaciones del prevencionista';
    const result = redactPromptForVertex(clean, 'ask-guardian');
    expect(result).toBe(clean);
  });

  it('redacts email from query before it reaches the prompt template', () => {
    const input = 'Consulta para contacto@praeventio.cl sobre EPP';
    const result = redactPromptForVertex(input, 'ask-guardian');
    expect(result).not.toContain('contacto@praeventio.cl');
  });
});
