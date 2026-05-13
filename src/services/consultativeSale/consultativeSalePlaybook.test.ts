import { describe, it, expect } from 'vitest';
import {
  buildSalePlaybook,
  type ProspectContext,
} from './consultativeSalePlaybook.js';

function prospect(over: Partial<ProspectContext> = {}): ProspectContext {
  return {
    companyName: 'Minera Test SpA',
    industry: 'mining',
    size: 'medium',
    workersCount: 80,
    jurisdiction: 'CL',
    declaredPains: ['high_incident_rate', 'difficult_audit_prep'],
    stage: 'discovery',
    ...over,
  };
}

describe('buildSalePlaybook — tier recommendation', () => {
  it('enterprise size → enterprise tier', () => {
    const p = buildSalePlaybook(prospect({ size: 'enterprise' }));
    expect(p.recommendedTier).toBe('enterprise');
    expect(p.tierJustification).toMatch(/enterprise|500/i);
  });

  it('mining + >50 workers → pro tier', () => {
    const p = buildSalePlaybook(prospect({ industry: 'mining', workersCount: 100, size: 'large' }));
    expect(p.recommendedTier).toBe('pro');
  });

  it('500+ workers → enterprise', () => {
    const p = buildSalePlaybook(prospect({ workersCount: 600, size: 'medium' }));
    expect(p.recommendedTier).toBe('enterprise');
  });

  it('advanced pains (vendor_management) → pro', () => {
    const p = buildSalePlaybook(
      prospect({
        industry: 'services',
        size: 'medium',
        workersCount: 30,
        declaredPains: ['contractor_management'],
      }),
    );
    expect(p.recommendedTier).toBe('pro');
  });

  it('servicios chicos sin pains avanzados → starter', () => {
    const p = buildSalePlaybook(
      prospect({
        industry: 'services',
        size: 'medium',
        workersCount: 25,
        declaredPains: ['manual_paperwork_heavy', 'difficult_audit_prep', 'unclear_compliance_status'],
      }),
    );
    expect(p.recommendedTier).toBe('starter');
  });

  it('micro empresa con 1 pain → free para prueba', () => {
    const p = buildSalePlaybook(
      prospect({
        industry: 'services',
        size: 'micro',
        workersCount: 5,
        declaredPains: ['manual_paperwork_heavy'],
      }),
    );
    expect(p.recommendedTier).toBe('free');
  });
});

describe('buildSalePlaybook — priority modules', () => {
  it('hit pains primero, máximo 5', () => {
    const p = buildSalePlaybook(
      prospect({
        declaredPains: [
          'high_incident_rate',
          'difficult_audit_prep',
          'unclear_compliance_status',
          'lack_visibility_field',
          'lone_worker_safety',
          'mutual_reporting_burden',
          'training_compliance_gaps',
        ],
      }),
    );
    expect(p.priorityModules.length).toBeLessThanOrEqual(5);
    // El primero debe tener al menos 1 pain resuelto
    expect(p.priorityModules[0]?.resolvesPainsCount).toBeGreaterThanOrEqual(1);
  });

  it('no incluye módulos pro si tier=starter', () => {
    const p = buildSalePlaybook(
      prospect({
        size: 'medium',
        workersCount: 25,
        industry: 'services',
        declaredPains: ['high_incident_rate'],
      }),
    );
    expect(p.recommendedTier).toBe('starter');
    // skill_gap_analyzer es minTier pro
    expect(p.priorityModules.map((m) => m.module.id)).not.toContain('skill_gap_analyzer');
  });

  it('incluye módulos pro si tier=pro', () => {
    const p = buildSalePlaybook(
      prospect({
        industry: 'mining',
        size: 'large',
        workersCount: 200,
        declaredPains: ['training_compliance_gaps'],
      }),
    );
    expect(p.recommendedTier).toBe('pro');
    expect(p.priorityModules.map((m) => m.module.id)).toContain('skill_gap_analyzer');
  });
});

describe('buildSalePlaybook — discovery questions by stage', () => {
  it('discovery → preguntas de descubrimiento', () => {
    const p = buildSalePlaybook(prospect({ stage: 'discovery' }));
    expect(p.nextStageQuestions[0]).toMatch(/inspecciones|reporte|auditoría|capacitan|visibilidad/i);
  });

  it('closing → preguntas de cierre', () => {
    const p = buildSalePlaybook(prospect({ stage: 'closing' }));
    expect(p.nextStageQuestions[0]).toMatch(/tema pendiente|firmar|kickoff|necesitas/i);
  });

  it('renewal → preguntas wins + churn', () => {
    const p = buildSalePlaybook(prospect({ stage: 'renewal' }));
    expect(p.nextStageQuestions[0]).toMatch(/wins|nuevos pains|módulos.*usaron/i);
  });

  it('cap 4 preguntas', () => {
    const p = buildSalePlaybook(prospect({ stage: 'discovery' }));
    expect(p.nextStageQuestions.length).toBeLessThanOrEqual(4);
  });
});

describe('buildSalePlaybook — objections', () => {
  it('siempre incluye objections universales (caro, Excel, otra herramienta)', () => {
    const p = buildSalePlaybook(prospect());
    expect(p.anticipatedObjections.length).toBeGreaterThanOrEqual(3);
    expect(p.anticipatedObjections.some((o) => /caro/i.test(o.objection))).toBe(true);
    expect(p.anticipatedObjections.some((o) => /Excel/i.test(o.objection))).toBe(true);
  });

  it('cada objection tiene response + evidencias', () => {
    const p = buildSalePlaybook(prospect());
    for (const obj of p.anticipatedObjections) {
      expect(obj.response.length).toBeGreaterThan(10);
      expect(obj.evidencePoints?.length).toBeGreaterThan(0);
    }
  });
});

describe('buildSalePlaybook — close probability', () => {
  it('paper + closing stage → close prob alta', () => {
    const p = buildSalePlaybook(
      prospect({
        currentSolution: 'paper',
        stage: 'closing',
        declaredPains: ['manual_paperwork_heavy', 'difficult_audit_prep', 'high_incident_rate'],
      }),
    );
    expect(p.estimatedCloseProb).toBeGreaterThanOrEqual(80);
  });

  it('micro + discovery + free tier → close prob baja', () => {
    const p = buildSalePlaybook(
      prospect({
        size: 'micro',
        workersCount: 3,
        stage: 'discovery',
        declaredPains: [],
      }),
    );
    expect(p.estimatedCloseProb).toBeLessThan(50);
  });
});

describe('buildSalePlaybook — case study hints', () => {
  it('mining → cita caso minero', () => {
    const p = buildSalePlaybook(prospect({ industry: 'mining' }));
    expect(p.caseStudyHints.some((c) => /Mining|Codelco/i.test(c))).toBe(true);
  });

  it('construction → cita caso construcción', () => {
    const p = buildSalePlaybook(prospect({ industry: 'construction' }));
    expect(p.caseStudyHints.some((c) => /Construcción|Echeverría/i.test(c))).toBe(true);
  });

  it('200+ workers → cita caso similar', () => {
    const p = buildSalePlaybook(prospect({ workersCount: 250 }));
    expect(p.caseStudyHints.some((c) => /200/i.test(c))).toBe(true);
  });
});
