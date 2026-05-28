// Tests §12.5.1 split step 11 — gemini/personPlans.ts.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../ragService', () => ({
  searchRelevantContext: vi.fn(async () => 'mock-ctx'),
}));

import {
  generateActionPlan,
  generatePersonalizedSafetyPlan,
  generateTrainingRecommendations,
  generateSafetyCapsule,
  generateCompensatoryExercises,
} from './personPlans';

describe('personPlans — sin API_KEY', () => {
  it('generateActionPlan throws', async () => {
    await expect(generateActionPlan('finding')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('generatePersonalizedSafetyPlan throws', async () => {
    await expect(
      generatePersonalizedSafetyPlan('Juan', 'electricista', 'sin incidentes', 'altura'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generateTrainingRecommendations throws', async () => {
    await expect(
      generateTrainingRecommendations('Juan', 'electricista', 'ctx'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generateSafetyCapsule throws', async () => {
    await expect(
      generateSafetyCapsule('Juan', 'electricista', 'ctx'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generateCompensatoryExercises throws', async () => {
    await expect(generateCompensatoryExercises(80, 40, 60)).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });
});

describe('personPlans — contract', () => {
  it('generateActionPlan acepta defaults (severity + workerProposal opcionales)', () => {
    expect(generateActionPlan.length).toBeGreaterThanOrEqual(1);
  });

  it('5 funciones son async', () => {
    for (const fn of [
      generateActionPlan,
      generatePersonalizedSafetyPlan,
      generateTrainingRecommendations,
      generateSafetyCapsule,
      generateCompensatoryExercises,
    ]) {
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});
