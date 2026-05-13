import { describe, it, expect } from 'vitest';
import {
  explainRecommendation,
  explainBatch,
  partitionByActionability,
  type Evidence,
  type Recommendation,
} from './recommendationExplainer.js';

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1',
    action: 'Suspender trabajo en altura hasta instalar línea de vida',
    category: 'safety',
    responsibleRole: 'supervisor',
    ...over,
  };
}

function ev(kind: Evidence['kind'], id: string, description = 'evidence'): Evidence {
  return { id, kind, description, citation: `(${kind}:${id})` };
}

describe('explainRecommendation', () => {
  it('confianza HIGH con 3+ determinísticas y sin LLM', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [
        ev('graph_node', 'risk-altura'),
        ev('legal_rule', 'DS-594'),
        ev('historical_pattern', 'caidas-trim-2'),
      ],
    });
    expect(r.confidence).toBe('high');
    expect(r.isFullyDeterministic).toBe(true);
  });

  it('confianza MEDIUM con 2 determinísticas + algo de LLM', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [
        ev('graph_node', 'a'),
        ev('legal_rule', 'b'),
        ev('llm_inference', 'c'),
      ],
    });
    expect(r.confidence).toBe('medium');
  });

  it('confianza LOW con mucha LLM', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [
        ev('llm_inference', 'a'),
        ev('llm_inference', 'b'),
        ev('llm_inference', 'c'),
      ],
    });
    expect(r.confidence).toBe('low');
    expect(r.llmInferenceShare).toBe(1);
  });

  it('sin evidencias → confidence low', () => {
    const r = explainRecommendation({ recommendation: rec(), evidences: [] });
    expect(r.confidence).toBe('low');
  });

  it('rationaleMarkdown incluye action + responsable + confianza', () => {
    const r = explainRecommendation({
      recommendation: rec({ action: 'Test', responsibleRole: 'prevencionista' }),
      evidences: [ev('graph_node', 'n1')],
    });
    expect(r.rationaleMarkdown).toMatch(/Test/);
    expect(r.rationaleMarkdown).toMatch(/prevencionista/);
    expect(r.rationaleMarkdown).toMatch(/Confianza/);
  });

  it('citations dedupe preservando orden', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [
        { id: '1', kind: 'graph_node', description: 'a', citation: '(zk:abc)' },
        { id: '2', kind: 'graph_node', description: 'b', citation: '(zk:abc)' }, // duplicado
        { id: '3', kind: 'legal_rule', description: 'c', citation: '(DS-594)' },
      ],
    });
    expect(r.citations).toEqual(['(zk:abc)', '(DS-594)']);
  });

  it('llmInferenceShare 0.5 con mix 50/50', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [
        ev('graph_node', 'a'),
        ev('graph_node', 'b'),
        ev('llm_inference', 'c'),
        ev('llm_inference', 'd'),
      ],
    });
    expect(r.llmInferenceShare).toBe(0.5);
  });

  it('isFullyDeterministic false si hay LLM', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [ev('llm_inference', 'a'), ev('graph_node', 'b')],
    });
    expect(r.isFullyDeterministic).toBe(false);
  });

  it('rationaleMarkdown distingue determinístico (✓) vs LLM (🤖)', () => {
    const r = explainRecommendation({
      recommendation: rec(),
      evidences: [ev('graph_node', 'a'), ev('llm_inference', 'b')],
    });
    expect(r.rationaleMarkdown).toMatch(/✓.*Nodo del grafo/);
    expect(r.rationaleMarkdown).toMatch(/🤖.*Inferencia IA/);
  });
});

describe('partitionByActionability', () => {
  it('actionable contiene HIGH y MEDIUM con poca LLM; needsReview el resto', () => {
    const inputs = [
      // actionable HIGH
      { recommendation: rec({ id: 'r1' }), evidences: [ev('graph_node', 'a'), ev('legal_rule', 'b'), ev('expert_input', 'c')] },
      // actionable MEDIUM
      { recommendation: rec({ id: 'r2' }), evidences: [ev('graph_node', 'a'), ev('legal_rule', 'b')] },
      // needsReview LOW
      { recommendation: rec({ id: 'r3' }), evidences: [ev('llm_inference', 'a'), ev('llm_inference', 'b')] },
    ];
    const explained = explainBatch(inputs);
    const partition = partitionByActionability(explained);
    expect(partition.actionable.map((e) => e.recommendation.id)).toEqual(['r1', 'r2']);
    expect(partition.needsReview.map((e) => e.recommendation.id)).toEqual(['r3']);
  });
});

describe('explainBatch', () => {
  it('procesa N inputs en una llamada', () => {
    const r = explainBatch([
      { recommendation: rec({ id: 'a' }), evidences: [ev('graph_node', '1')] },
      { recommendation: rec({ id: 'b' }), evidences: [ev('legal_rule', '2')] },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].recommendation.id).toBe('a');
  });
});
