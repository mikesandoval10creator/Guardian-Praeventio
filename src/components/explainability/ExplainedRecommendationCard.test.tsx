// @vitest-environment jsdom
//
// Praeventio Guard — F.28 ExplainedRecommendationCard smoke tests.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExplainedRecommendationCard } from './ExplainedRecommendationCard';
import { explainRecommendation } from '../../services/explainability/recommendationExplainer';

function buildExplained() {
  return explainRecommendation({
    recommendation: {
      id: 'rec_test_1',
      action: 'Suspender tarea en altura por viento >40 km/h',
      responsibleRole: 'Supervisor',
      validUntil: '2026-05-19T08:00:00Z',
      category: 'environmental',
    },
    evidences: [
      {
        id: 'ev1',
        kind: 'sensor_reading',
        description: 'Anemómetro registró 48 km/h sostenido',
        citation: 'sensor:windmill-3',
      },
      {
        id: 'ev2',
        kind: 'legal_rule',
        description: 'DS 594 art. 38 — viento ≥40 km/h en altura',
        citation: 'DS-594',
      },
      {
        id: 'ev3',
        kind: 'graph_node',
        description: 'Tarea actual marcada altura por GraphNode TaskHazard',
        citation: 'zk:t_altura_1',
      },
    ],
  });
}

describe('<ExplainedRecommendationCard />', () => {
  it('renders the recommendation action prominently', () => {
    render(<ExplainedRecommendationCard explained={buildExplained()} />);
    expect(screen.getByTestId('explainability.card.action')).toHaveTextContent(
      /Suspender tarea/i,
    );
  });

  it('renders responsible role + validity badges', () => {
    render(<ExplainedRecommendationCard explained={buildExplained()} />);
    expect(
      screen.getByTestId('explainability.card.responsibleRole'),
    ).toHaveTextContent(/Supervisor/i);
    expect(
      screen.getByTestId('explainability.card.validUntil'),
    ).toHaveTextContent('2026-05-19T08:00:00Z');
  });

  it('renders confidence chip with deterministic style when all evidence is deterministic', () => {
    render(<ExplainedRecommendationCard explained={buildExplained()} />);
    expect(
      screen.getByTestId('explainability.card.confidence'),
    ).toHaveTextContent(/Alta/i);
    expect(
      screen.getByTestId('explainability.card.deterministic'),
    ).toBeInTheDocument();
    // LLM share chip should NOT appear when llmShare = 0.
    expect(screen.queryByTestId('explainability.card.llmShare')).toBeNull();
  });

  it('renders LLM share chip when llm_inference evidence is present', () => {
    const explained = explainRecommendation({
      recommendation: {
        id: 'rec_2',
        action: 'Revisar EPP del trabajador',
        category: 'epp',
      },
      evidences: [
        {
          id: 'ev_llm',
          kind: 'llm_inference',
          description: 'Patrón detectado por IA en fotos previas',
          citation: 'llm:gemini-1.5',
          weight: 1,
        },
        {
          id: 'ev_graph',
          kind: 'graph_node',
          description: 'Trabajador asignado al proyecto',
          citation: 'zk:w_1',
          weight: 1,
        },
      ],
    });
    render(<ExplainedRecommendationCard explained={explained} />);
    expect(
      screen.getByTestId('explainability.card.llmShare'),
    ).toHaveTextContent('50% IA');
  });

  it('lists every evidence with kind-specific test id', () => {
    render(<ExplainedRecommendationCard explained={buildExplained()} />);
    expect(
      screen.getByTestId('explainability.card.evidence.sensor_reading'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('explainability.card.evidence.legal_rule'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('explainability.card.evidence.graph_node'),
    ).toBeInTheDocument();
  });

  it('renders deduplicated citations in the footer', () => {
    render(<ExplainedRecommendationCard explained={buildExplained()} />);
    const footer = screen.getByTestId('explainability.card.citationsFooter');
    expect(footer).toHaveTextContent('sensor:windmill-3');
    expect(footer).toHaveTextContent('DS-594');
    expect(footer).toHaveTextContent('zk:t_altura_1');
  });
});
