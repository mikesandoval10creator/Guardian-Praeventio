import { describe, expect, it, vi } from 'vitest';
import { createActionPromptSpecs } from './actionPromptSpecs.js';

describe('provider-neutral action prompts', () => {
  it('builds the existing six actions with injected retrieval, without a provider', async () => {
    const retrieveLegalContext = vi.fn(async () => 'SOURCE-EXCERPT');
    const specs = createActionPromptSpecs({ retrieveLegalContext,
      loadRedactor: async () => text => text });
    expect(Object.keys(specs).sort()).toEqual(['calculateStructuralLoad', 'designHazmatStorage',
      'evaluateMinsalCompliance', 'getChatResponse', 'getSafetyAdvice', 'queryBCN'].sort());
    const request = await specs.getChatResponse.build(['consulta', 'PROJECT-CONTEXT', [], 1, 'medicina']);
    expect(request.systemInstruction).toContain('SOURCE-EXCERPT');
    expect(request.systemInstruction).toContain('PROJECT-CONTEXT');
    expect(request.systemInstruction).toContain('NUNCA emitas un diagnóstico');
    expect(request.prompt).toContain('<user_input>');
  });
});
