import { describe, it, expect } from 'vitest';
import {
  validateRagResponse,
  extractCitedNodeIds,
} from './zkRagResponseValidator.js';

describe('extractCitedNodeIds', () => {
  it('extracts simple [id] citations', () => {
    const out = extractCitedNodeIds('Hola [abc1234] mundo [def5678].');
    expect(out).toEqual(['abc1234', 'def5678']);
  });

  it('dedupes repeated citations', () => {
    const out = extractCitedNodeIds('[abc1234] y otra vez [abc1234].');
    expect(out).toEqual(['abc1234']);
  });

  it('ignores short brackets like [ok] or [N]', () => {
    const out = extractCitedNodeIds('algo [ok] y [N] y [valid-id-1].');
    expect(out).toEqual(['valid-id-1']);
  });

  it('returns empty for text without citations', () => {
    expect(extractCitedNodeIds('Sin citas aquí.')).toEqual([]);
  });
});

describe('validateRagResponse', () => {
  const grounding = new Set(['a1b2c3d4', 'e5f6g7h8', 'i9j0k1l2']);

  it('passes when citations are inline and all match grounding', () => {
    const res = validateRagResponse(
      {
        text: 'El soldador requiere máscara clase E [a1b2c3d4] y casco [e5f6g7h8].',
      },
      { groundingNodeIds: grounding },
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
    expect(res.citedNodeIdsInText).toEqual(['a1b2c3d4', 'e5f6g7h8']);
  });

  it('flags invented inline citations', () => {
    const res = validateRagResponse(
      {
        text: 'Trabajador asignado a tarea [a1b2c3d4] con riesgo [ZZZZZZZZ].',
      },
      { groundingNodeIds: grounding },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toContain('inline_citation_not_in_grounding');
    expect(res.invalidCitedNodeIds).toEqual(['ZZZZZZZZ']);
  });

  it('flags missing inline citations when not a fallback response', () => {
    const res = validateRagResponse(
      { text: 'El trabajador requiere casco clase E sin ninguna cita.' },
      { groundingNodeIds: grounding },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toContain('no_inline_citations_in_text');
  });

  it('accepts the canonical fallback phrase without citations', () => {
    const res = validateRagResponse(
      { text: 'no tengo info en el grafo del tenant' },
      { groundingNodeIds: grounding },
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it('rejects fallback response that also includes citations', () => {
    const res = validateRagResponse(
      {
        text: 'no tengo info en el grafo del tenant pero igual [a1b2c3d4].',
      },
      { groundingNodeIds: grounding },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toContain('fallback_response_with_citations');
  });

  it('flags responses that exceed maxLengthChars', () => {
    const longText = 'a'.repeat(5000) + ' [a1b2c3d4]';
    const res = validateRagResponse(
      { text: longText },
      { groundingNodeIds: grounding, maxLengthChars: 4000 },
    );
    expect(res.violations).toContain('response_too_long');
  });

  it('flags PII in the response (RUT chileno)', () => {
    const res = validateRagResponse(
      { text: 'El trabajador 12.345.678-9 está en la cuadrilla [a1b2c3d4].' },
      { groundingNodeIds: grounding },
    );
    expect(res.violations).toContain('contains_pii');
  });

  it('flags medical diagnosis phrases', () => {
    const res = validateRagResponse(
      {
        text: 'El trabajador tiene neumoconiosis [a1b2c3d4].',
      },
      { groundingNodeIds: grounding },
    );
    expect(res.violations).toContain('contains_medical_diagnosis_phrase');
  });

  it('cross-checks structured citations against grounding even if inline are ok', () => {
    const res = validateRagResponse(
      {
        text: 'EPP recomendado [a1b2c3d4].',
        citations: [{ nodeId: 'a1b2c3d4' }, { nodeId: 'INVENTADO123' }],
      },
      { groundingNodeIds: grounding },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toContain('citation_not_in_grounding');
  });

  it('qualityScore decreases per violation', () => {
    const okRes = validateRagResponse(
      { text: 'EPP recomendado [a1b2c3d4].' },
      { groundingNodeIds: grounding },
    );
    const badRes = validateRagResponse(
      { text: 'Sin citas.' },
      { groundingNodeIds: grounding },
    );
    expect(okRes.qualityScore).toBe(100);
    expect(badRes.qualityScore).toBeLessThan(100);
  });

  it('empty grounding set + no fallback → flags missing citations', () => {
    const res = validateRagResponse(
      { text: 'respuesta sin citas y sin fallback' },
      { groundingNodeIds: new Set() },
    );
    expect(res.ok).toBe(false);
    expect(res.violations).toContain('no_inline_citations_in_text');
  });

  it('empty grounding + fallback phrase → passes', () => {
    const res = validateRagResponse(
      { text: 'no tengo info en el grafo del tenant' },
      { groundingNodeIds: new Set() },
    );
    expect(res.ok).toBe(true);
  });
});
