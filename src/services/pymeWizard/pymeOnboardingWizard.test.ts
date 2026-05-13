import { describe, it, expect } from 'vitest';
import {
  buildOnboardingPlan,
  type PymeOnboardingInput,
} from './pymeOnboardingWizard.js';

function input(over: Partial<PymeOnboardingInput> = {}): PymeOnboardingInput {
  return {
    industry: over.industry ?? 'services',
    workerCount: over.workerCount ?? 10,
    keyRisks: over.keyRisks ?? [],
    hasExistingRiohs: over.hasExistingRiohs,
    hasExistingCphs: over.hasExistingCphs,
  };
}

describe('pymeOnboardingWizard / buildOnboardingPlan', () => {
  it('construction with >=25 workers MUST include CPHS as required', () => {
    const plan = buildOnboardingPlan(input({ industry: 'construction', workerCount: 25 }));
    const cphs = plan.steps.find((s) => s.id === 'committee_cphs');
    expect(cphs).toBeDefined();
    expect(cphs!.required).toBe(true);
    expect(plan.criticalPath).toContain('committee_cphs');
    expect(plan.regulatoryNotes).toContain('reg.cphs.mandatory_25plus');
  });

  it('small services pyme (5 workers) skips CPHS entirely', () => {
    const plan = buildOnboardingPlan(input({ industry: 'services', workerCount: 5 }));
    expect(plan.steps.find((s) => s.id === 'committee_cphs')).toBeUndefined();
    expect(plan.criticalPath).not.toContain('committee_cphs');
  });

  it('mid pyme (12 workers) includes CPHS as recommended (not required)', () => {
    const plan = buildOnboardingPlan(input({ workerCount: 12 }));
    const cphs = plan.steps.find((s) => s.id === 'committee_cphs');
    expect(cphs).toBeDefined();
    expect(cphs!.required).toBe(false);
    expect(plan.criticalPath).not.toContain('committee_cphs');
    expect(plan.regulatoryNotes).toContain('reg.cphs.recommended_10to24');
  });

  it('reusing existing RIOHS lowers estimated minutes for that step', () => {
    const a = buildOnboardingPlan(input({ hasExistingRiohs: false }));
    const b = buildOnboardingPlan(input({ hasExistingRiohs: true }));
    const aRiohs = a.steps.find((s) => s.id === 'doc_riohs')!;
    const bRiohs = b.steps.find((s) => s.id === 'doc_riohs')!;
    expect(bRiohs.estimatedMinutes).toBeLessThan(aRiohs.estimatedMinutes);
    expect(b.totalEstimatedMinutes).toBeLessThan(a.totalEstimatedMinutes);
  });

  it('key risks become training steps in deterministic alphabetical order', () => {
    const plan = buildOnboardingPlan(
      input({ keyRisks: ['noise', 'chemical_exposure', 'falls_from_height'] }),
    );
    const trainingRisks = plan.steps
      .filter((s) => s.id.startsWith('training_risk_'))
      .map((s) => s.id);
    expect(trainingRisks).toEqual([
      'training_risk_chemical_exposure',
      'training_risk_falls_from_height',
      'training_risk_noise',
    ]);
  });

  it('mining industry adds Sernageomin note and mining modules', () => {
    const plan = buildOnboardingPlan(input({ industry: 'mining', workerCount: 30 }));
    expect(plan.regulatoryNotes).toContain('reg.sernageomin.applicable');
    expect(plan.recommendedModules).toContain('critical_controls');
    expect(plan.recommendedModules).toContain('fatigue');
  });

  it('critical path required steps stay under 30 minutes for a 10-worker baseline', () => {
    const plan = buildOnboardingPlan(input({ workerCount: 10, keyRisks: ['manual_handling'] }));
    const requiredMinutes = plan.steps
      .filter((s) => s.required)
      .reduce((acc, s) => acc + s.estimatedMinutes, 0);
    // Goal: required onboarding completable in < 30 min.
    expect(requiredMinutes).toBeLessThan(30);
  });

  it('rejects workerCount < 1', () => {
    expect(() => buildOnboardingPlan(input({ workerCount: 0 }))).toThrow();
  });
});
