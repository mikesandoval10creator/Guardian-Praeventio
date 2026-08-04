// Praeventio Guard — test contractual del AI Compliance Check.
//
// Tarea `[P1] El 'AI Compliance Check' no analiza el documento`:
//   - contrato único (Zod) entre server y UI, sin campos fantasma;
//   - extracción de texto real;
//   - nunca declara cumplimiento sin análisis.

import { describe, it, expect } from 'vitest';
import {
  documentComplianceResultSchema,
  UNANALYZED_DOCUMENT_RESULT,
  hasAnalyzableText,
  truncateDocumentText,
  buildNormativeContext,
  MAX_DOCUMENT_TEXT_CHARS,
} from './documentCompliance';

describe('documentCompliance contrato (Zod)', () => {
  it('acepta la forma real que devuelve el modelo', () => {
    const result = documentComplianceResultSchema.parse({
      isCompliant: true,
      complianceScore: 82,
      findings: ['Falta firma del supervisor'],
      recommendations: ['Agregar firma y fecha'],
    });
    expect(result.isCompliant).toBe(true);
  });

  it('RECHAZA reason/urgency (campos fantasma que rompían la UI)', () => {
    const fake = documentComplianceResultSchema.safeParse({
      reason: 'Documento cumple',
      urgency: 'baja',
    });
    expect(fake.success).toBe(false);
  });

  it('rechaza isCompliant ausente o no booleano', () => {
    expect(
      documentComplianceResultSchema.safeParse({
        complianceScore: 50,
        findings: [],
        recommendations: [],
      }).success,
    ).toBe(false);
    expect(
      documentComplianceResultSchema.safeParse({
        isCompliant: 'si',
        complianceScore: 50,
        findings: [],
        recommendations: [],
      }).success,
    ).toBe(false);
  });

  it('UNANALYZED_DOCUMENT_RESULT nunca declara cumplimiento', () => {
    expect(UNANALYZED_DOCUMENT_RESULT.isCompliant).toBe(false);
    expect(UNANALYZED_DOCUMENT_RESULT.complianceScore).toBe(0);
    expect(UNANALYZED_DOCUMENT_RESULT.findings.length).toBeGreaterThan(0);
    expect(
      documentComplianceResultSchema.safeParse(UNANALYZED_DOCUMENT_RESULT)
        .success,
    ).toBe(true);
  });
});

describe('documentCompliance extracción y umbrales', () => {
  it('texto corto o vacío no es analizable (no declarar cumplimiento)', () => {
    expect(hasAnalyzableText('')).toBe(false);
    expect(hasAnalyzableText('   ')).toBe(false);
    expect(hasAnalyzableText('corto')).toBe(false);
    expect(hasAnalyzableText('a'.repeat(20))).toBe(true);
  });

  it('trunca el texto al presupuesto del prompt', () => {
    const long = 'x'.repeat(MAX_DOCUMENT_TEXT_CHARS + 500);
    expect(truncateDocumentText(long).length).toBe(MAX_DOCUMENT_TEXT_CHARS);
  });

  it('buildNormativeContext incluye rol y normativa chilena vigente', () => {
    const ctx = buildNormativeContext('Operador de grúa');
    expect(ctx).toContain('Operador de grúa');
    expect(ctx).toContain('Ley 16.744');
    expect(ctx).toContain('DS 44/2024');
    expect(ctx).toContain('DS 594');
  });

  it('buildNormativeContext tolera rol vacío', () => {
    const ctx = buildNormativeContext('');
    expect(ctx).not.toContain('Cargo/rol');
    expect(ctx).toContain('Ley 16.744');
  });
});
