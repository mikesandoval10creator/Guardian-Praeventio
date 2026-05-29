// Tests §12.5.1 split step 5 — gemini/vision.ts.
//
// Cobertura: paths sin API_KEY que NO llaman al SDK. Las 3 funciones
// son thin wrappers sobre Gemini multimodal API; mockear el SDK
// completo aporta poco más que la mock de governance/parsing existente.

import { describe, it, expect } from 'vitest';
import { analyzePostureWithAI, analyzeSafetyImage, analyzeBioImage } from './vision';

describe('vision — sin API_KEY', () => {
  // En tests no hay GEMINI_API_KEY → todas las funciones throw.

  it('analyzePostureWithAI throws si no hay key', async () => {
    await expect(
      analyzePostureWithAI('base64data', 'image/jpeg'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('analyzeSafetyImage throws si no hay key', async () => {
    await expect(
      analyzeSafetyImage('base64data', 'image/jpeg', 'context'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('analyzeBioImage throws si no hay key', async () => {
    await expect(analyzeBioImage('base64data')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });
});

describe('vision — contract checks (smoke)', () => {
  it('analyzePostureWithAI es función async', () => {
    expect(typeof analyzePostureWithAI).toBe('function');
    expect(analyzePostureWithAI.constructor.name).toBe('AsyncFunction');
  });

  it('analyzeSafetyImage es función async', () => {
    expect(typeof analyzeSafetyImage).toBe('function');
    expect(analyzeSafetyImage.constructor.name).toBe('AsyncFunction');
  });

  it('analyzeBioImage es función async', () => {
    expect(typeof analyzeBioImage).toBe('function');
    expect(analyzeBioImage.constructor.name).toBe('AsyncFunction');
  });
});
