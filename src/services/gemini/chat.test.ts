// Tests §12.5.1 split step 10 — gemini/chat.ts.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../ragService', () => ({
  searchRelevantContext: vi.fn(async () => 'mock-legal-ctx'),
}));

import { queryBCN, getChatResponse, getSafetyAdvice } from './chat';

describe('chat — sin API_KEY', () => {
  it('queryBCN throws sin key', async () => {
    await expect(queryBCN('¿Qué dice DS 594?')).rejects.toThrow('API Key no configurada');
  });

  it('getChatResponse throws sin key', async () => {
    await expect(getChatResponse('hola', 'ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('getSafetyAdvice throws sin key', async () => {
    await expect(
      getSafetyAdvice({ temp: 30, uv: 9, airQuality: 'mala' }),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });
});

describe('chat — contract', () => {
  it('3 funciones son async', () => {
    for (const fn of [queryBCN, getChatResponse, getSafetyAdvice]) {
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });

  it('getChatResponse acepta default detailLevel + history', () => {
    // Compilation gate — TypeScript signature check
    const fn = getChatResponse;
    expect(fn.length).toBeGreaterThanOrEqual(2);
  });
});
