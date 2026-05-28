// Tests §12.5.1 split step 7 — gemini/suggestions.ts.

import { describe, it, expect } from 'vitest';
import { suggestRisksWithAI, suggestNormativesWithAI } from './suggestions';

describe('suggestions — sin API_KEY', () => {
  it('suggestRisksWithAI throws sin key', async () => {
    await expect(suggestRisksWithAI('construccion', 'ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('suggestNormativesWithAI throws sin key', async () => {
    await expect(suggestNormativesWithAI('mineria')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });
});

describe('suggestions — contract', () => {
  it('ambas funciones son async', () => {
    expect(suggestRisksWithAI.constructor.name).toBe('AsyncFunction');
    expect(suggestNormativesWithAI.constructor.name).toBe('AsyncFunction');
  });
});
