import { describe, it, expect } from 'vitest';
import {
  renderPrompt,
  checkAiResponse,
  runEvalSuite,
  PromptValidationError,
  type PromptTemplate,
  type EvalCase,
} from './aiGuardrails.js';

const TEMPLATE: PromptTemplate = {
  id: 'rag.zk.query',
  version: '1.0.0',
  name: 'Zettelkasten RAG query',
  template: 'Pregunta: {{question}}\nContexto del grafo: {{context}}\nResponde citando nodeIds.',
  expectedVars: ['question', 'context'],
  category: 'rag',
  requiresCitations: true,
};

describe('renderPrompt', () => {
  it('renderiza vars correctamente', () => {
    const out = renderPrompt(TEMPLATE, { question: '¿qué EPP?', context: 'nodo X' });
    expect(out).toContain('¿qué EPP?');
    expect(out).toContain('nodo X');
  });

  it('rechaza var faltante', () => {
    expect(() => renderPrompt(TEMPLATE, { question: 'x' })).toThrowError(/missing variable 'context'/);
  });

  it('rechaza placeholders no resueltos en el template (typo)', () => {
    const malformed: PromptTemplate = {
      ...TEMPLATE,
      template: 'q: {{question}} extra: {{unknown_var}}',
    };
    expect(() => renderPrompt(malformed, { question: 'a', context: 'b' })).toThrowError(
      /unresolved placeholders/,
    );
  });
});

describe('checkAiResponse — citations', () => {
  it('falta citas cuando se requieren → violation', () => {
    const r = checkAiResponse(
      { text: 'Respuesta sin citas.' },
      { requireCitations: true },
    );
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('missing_citations_when_required');
  });

  it('citas en grounding → ok', () => {
    const r = checkAiResponse(
      { text: 'Según el nodo abc...', citations: [{ nodeId: 'abc' }] },
      { requireCitations: true, groundingNodeIds: new Set(['abc', 'xyz']) },
    );
    expect(r.ok).toBe(true);
  });

  it('cita INVENTADA (no en grounding) → violation', () => {
    const r = checkAiResponse(
      { text: 'Según el nodo abc...', citations: [{ nodeId: 'inventado-123' }] },
      { requireCitations: true, groundingNodeIds: new Set(['abc']) },
    );
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('citation_not_in_grounding');
  });
});

describe('checkAiResponse — content checks', () => {
  it('detecta diagnóstico médico (ADR 0012)', () => {
    const r = checkAiResponse(
      { text: 'El trabajador tiene una hernia discal.', citations: [{ nodeId: 'a' }] },
      { requireCitations: true, groundingNodeIds: new Set(['a']) },
    );
    expect(r.violations).toContain('contains_medical_diagnosis_phrase');
  });

  it('detecta asesoría legal vinculante', () => {
    const r = checkAiResponse(
      { text: 'Debe demandar a la empresa por daños.', citations: [{ nodeId: 'a' }] },
      { requireCitations: true, groundingNodeIds: new Set(['a']) },
    );
    expect(r.violations).toContain('contains_legal_advice_phrase');
  });

  it('detecta PII (RUT chileno)', () => {
    const r = checkAiResponse(
      { text: 'El trabajador 12.345.678-9 reportó...', citations: [{ nodeId: 'a' }] },
      { requireCitations: true, groundingNodeIds: new Set(['a']) },
    );
    expect(r.violations).toContain('contains_pii');
  });

  it('detecta PII (email)', () => {
    const r = checkAiResponse(
      { text: 'Contacto: juan@example.com', citations: [{ nodeId: 'a' }] },
      { requireCitations: true, groundingNodeIds: new Set(['a']) },
    );
    expect(r.violations).toContain('contains_pii');
  });

  it('rechaza respuestas demasiado largas', () => {
    const r = checkAiResponse(
      { text: 'x'.repeat(5000), citations: [{ nodeId: 'a' }] },
      { requireCitations: true, groundingNodeIds: new Set(['a']), maxLengthChars: 1000 },
    );
    expect(r.violations).toContain('response_too_long');
  });

  it('detecta término prohibido custom', () => {
    const r = checkAiResponse(
      { text: 'Garantizamos resultados perfectos.', citations: [{ nodeId: 'a' }] },
      {
        requireCitations: true,
        groundingNodeIds: new Set(['a']),
        forbiddenTerms: ['garantizamos'],
      },
    );
    expect(r.violations).toContain('contains_forbidden_term');
  });

  it('quality score baja por cada violation', () => {
    const r = checkAiResponse(
      { text: 'Sin citas y muy largo: ' + 'x'.repeat(5000) },
      { requireCitations: true, maxLengthChars: 1000 },
    );
    expect(r.qualityScore).toBeLessThanOrEqual(50);
  });
});

describe('runEvalSuite — regression / dataset eval', () => {
  const cases: EvalCase[] = [
    {
      id: 'epp-altura',
      input: { question: '¿qué EPP para altura?', context: 'arnés, casco' },
      expectMatches: /arnés/i,
      forbiddenMatches: [/tienes/i], // no debe usar tono diagnóstico
    },
    {
      id: 'training-quimicos',
      input: { question: '¿curso para químicos?', context: 'DS 594' },
      expectMatches: 'DS 594',
    },
  ];

  it('todos los casos pasan → passRate 1', async () => {
    const report = await runEvalSuite(TEMPLATE, cases, async (_rendered, id) => {
      if (id === 'epp-altura') return 'Necesitas arnés y casco según el nodo.';
      return 'Curso de químicos según DS 594.';
    });
    expect(report.passRate).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('un caso falla → reporta detalle', async () => {
    const report = await runEvalSuite(TEMPLATE, cases, async (_rendered, id) => {
      if (id === 'epp-altura') return 'No tengo esa info';
      return 'Curso de químicos según DS 594.';
    });
    expect(report.passRate).toBeCloseTo(0.5);
    expect(report.failed).toBe(1);
    const failing = report.results.find((r) => !r.passed);
    expect(failing?.caseId).toBe('epp-altura');
  });
});
