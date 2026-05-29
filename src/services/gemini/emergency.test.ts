// Tests §12.5.1 split step 8 — gemini/emergency.ts.

import { describe, it, expect } from 'vitest';
import {
  generateEmergencyPlan,
  generateEmergencyScenario,
  generateEmergencyPlanJSON,
} from './emergency';

describe('emergency — sin API_KEY', () => {
  it('generateEmergencyPlan throws sin key', async () => {
    await expect(
      generateEmergencyPlan('Proyecto X', 'ctx', 'mineria'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generateEmergencyScenario throws sin key', async () => {
    await expect(generateEmergencyScenario('ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('generateEmergencyPlanJSON throws sin key', async () => {
    await expect(
      generateEmergencyPlanJSON('Sismo', 'magnitud 7', 'DS 594'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });
});

describe('emergency — contract', () => {
  it('3 funciones son async', () => {
    for (const fn of [
      generateEmergencyPlan,
      generateEmergencyScenario,
      generateEmergencyPlanJSON,
    ]) {
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});
