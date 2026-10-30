import { describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ legacy: vi.fn(async () => 'LEGACY-MUST-NOT-BE-USED'),
  native: vi.fn(async (_query: string) => ({ method: 'lexical' as const, scanLimited: false,
    matches: [{ id: 'law-1234-chunk-0', lawId: '1234', title: 'NATIVE-CORPUS-FIXTURE', excerpt: 'Texto de prueba sobre ruido.',
      sourceUrl: 'https://www.bcn.cl/leychile/navegar?idNorma=1234', matchedTerms: ['ruido'] }] })) }));
vi.mock('../ragService.js', () => ({ searchRelevantContext: H.legacy }));
vi.mock('../../server/rag/publicLawReader.js', () => ({ retrieveNativeNormative: H.native }));
import { SELF_HOSTED_ACTION_SPECS } from './selfHostedActions.js';

describe('selfhosted primary retrieval has no Google embedding dependency', () => {
  it.each([
    { action: 'getChatResponse', args: ['ruido ocupacional', 'contexto'] },
    { action: 'queryBCN', args: ['ruido ocupacional'] },
    { action: 'evaluateMinsalCompliance', args: ['PREXOR', 'contexto', 'minería'] },
  ])('uses only native corpus retrieval for $action', async ({ action, args }) => {
    H.legacy.mockClear(); H.native.mockClear();
    const result = await SELF_HOSTED_ACTION_SPECS[action].build(args);
    expect(JSON.stringify(result)).toContain('NATIVE-CORPUS-FIXTURE');
    expect(H.native).toHaveBeenCalledOnce(); expect(H.legacy).not.toHaveBeenCalled();
  });
});
