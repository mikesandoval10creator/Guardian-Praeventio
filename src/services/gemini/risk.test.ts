// Tests §12.5.1 split step 6 — gemini/risk.ts.

import { describe, it, expect } from 'vitest';
import {
  analyzeFastCheck,
  predictGlobalIncidents,
  analyzeRiskWithAI,
  analyzeRootCauses,
} from './risk';

describe('risk — paths sin API_KEY', () => {
  // Sin GEMINI_API_KEY → todas throw eventualmente (algunas envueltas
  // en Sentry scope, igual propaga).

  it('analyzeFastCheck throws sin key', async () => {
    await expect(analyzeFastCheck('observación')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('predictGlobalIncidents throws sin key', async () => {
    await expect(
      predictGlobalIncidents('ctx', 'envCtx'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('analyzeRiskWithAI throws sin key', async () => {
    await expect(
      analyzeRiskWithAI('desc', 'nodes', 'construccion'),
    ).rejects.toThrow();
  });

  it('analyzeRootCauses throws sin key', async () => {
    await expect(
      analyzeRootCauses('titulo', 'desc', 'ctx'),
    ).rejects.toThrow('API Key no configurada');
  });
});

describe('risk — contract checks', () => {
  it('4 funciones son async', () => {
    for (const fn of [
      analyzeFastCheck,
      predictGlobalIncidents,
      analyzeRiskWithAI,
      analyzeRootCauses,
    ]) {
      expect(typeof fn).toBe('function');
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});
