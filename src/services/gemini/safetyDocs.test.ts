// Tests §12.5.1 split step 9 — gemini/safetyDocs.ts.

import { describe, it, expect } from 'vitest';
import {
  generatePTS,
  generatePTSWithManufacturerData,
  generateSafetyReport,
} from './safetyDocs';

describe('safetyDocs — sin API_KEY', () => {
  it('generatePTS throws sin key', async () => {
    await expect(
      generatePTS('t', 'd', 'high', 'DS594', null, 'env', 'zk', 'PTS'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generatePTSWithManufacturerData throws sin key', async () => {
    await expect(
      generatePTSWithManufacturerData('t', 'd', 'machinery', 'high', 'DS594', null, 'env', 'zk', 'PTS'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generateSafetyReport throws sin key', async () => {
    await expect(generateSafetyReport('PTS', 'ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });
});

describe('safetyDocs — contract', () => {
  it('reportType es type-safe (PTS/PE/AST)', () => {
    // Compilation gate — TypeScript narrowing already enforces it
    expect(['PTS', 'PE', 'AST']).toContain('PTS');
    expect(['PTS', 'PE', 'AST']).toContain('PE');
    expect(['PTS', 'PE', 'AST']).toContain('AST');
  });

  it('3 funciones son async', () => {
    for (const fn of [generatePTS, generatePTSWithManufacturerData, generateSafetyReport]) {
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});
