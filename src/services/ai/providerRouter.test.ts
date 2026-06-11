// Unit tests for the per-action AI provider router.
//
// Contract under test:
//   • absent self-hosted config → 'gemini' for every action (today's behavior),
//   • action-list routing + precedence (gemini escape hatch > selfhosted list
//     > AI_PROVIDER_DEFAULT),
//   • dispatchSelfHostedAction: happy path, unsupported-action skip,
//     empty-response failure, breaker bookkeeping,
//   • BREAKER ISOLATION: self-hosted failures trip ONLY the 'selfhosted'
//     key — the 'gemini' key stays closed (and vice versa),
//   • per-provider metrics counters.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  resolveProvider,
  selfHostedFallsBackToGemini,
  dispatchSelfHostedAction,
  recordProviderCall,
  getAiProviderStats,
  __resetProviderStatsForTests,
  SELFHOSTED_CIRCUIT_KEY,
  hasSelfHostedActionSpec,
} from './providerRouter.js';
import { geminiCircuit } from '../../server/middleware/geminiCircuit.js';

const ENV_KEYS = [
  'AI_SELFHOSTED_BASE_URL',
  'AI_SELFHOSTED_API_KEY',
  'AI_SELFHOSTED_MODEL',
  'AI_SELFHOSTED_TIMEOUT_MS',
  'AI_PROVIDER_DEFAULT',
  'AI_PROVIDER_ACTIONS_SELFHOSTED',
  'AI_PROVIDER_ACTIONS_GEMINI',
  'AI_SELFHOSTED_FALLBACK_GEMINI',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  geminiCircuit.__resetForTests();
  __resetProviderStatsForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  geminiCircuit.__resetForTests();
});

const CONFIGURED = {
  AI_SELFHOSTED_BASE_URL: 'http://localhost:11434',
  AI_SELFHOSTED_MODEL: 'mimo-7b',
};

function okFetch(content = 'consejo seguro') {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  ) as unknown as typeof fetch;
}
function downFetch() {
  return vi.fn(async () => {
    throw new TypeError('connect ECONNREFUSED');
  }) as unknown as typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveProvider — routing semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveProvider', () => {
  it("absent config → 'gemini' for EVERY action, even if lists/default say otherwise", () => {
    const env = {
      AI_PROVIDER_DEFAULT: 'selfhosted',
      AI_PROVIDER_ACTIONS_SELFHOSTED: 'getChatResponse,queryBCN',
    };
    expect(resolveProvider('getChatResponse', env)).toBe('gemini');
    expect(resolveProvider('queryBCN', env)).toBe('gemini');
    expect(resolveProvider('whatever', env)).toBe('gemini');
  });

  it("configured but no lists/default → 'gemini' (opt-in only)", () => {
    expect(resolveProvider('getChatResponse', { ...CONFIGURED })).toBe('gemini');
  });

  it('AI_PROVIDER_ACTIONS_SELFHOSTED routes the listed actions only', () => {
    const env = { ...CONFIGURED, AI_PROVIDER_ACTIONS_SELFHOSTED: ' getChatResponse , queryBCN ' };
    expect(resolveProvider('getChatResponse', env)).toBe('selfhosted');
    expect(resolveProvider('queryBCN', env)).toBe('selfhosted');
    expect(resolveProvider('generateEmergencyPlan', env)).toBe('gemini');
  });

  it("AI_PROVIDER_DEFAULT='selfhosted' flips the unlisted default", () => {
    const env = { ...CONFIGURED, AI_PROVIDER_DEFAULT: 'selfhosted' };
    expect(resolveProvider('getChatResponse', env)).toBe('selfhosted');
  });

  it('escape hatch AI_PROVIDER_ACTIONS_GEMINI wins over both the selfhosted list and the default', () => {
    const env = {
      ...CONFIGURED,
      AI_PROVIDER_DEFAULT: 'selfhosted',
      AI_PROVIDER_ACTIONS_SELFHOSTED: 'queryBCN',
      AI_PROVIDER_ACTIONS_GEMINI: 'queryBCN,auditLegalGap',
    };
    expect(resolveProvider('queryBCN', env)).toBe('gemini');
    expect(resolveProvider('auditLegalGap', env)).toBe('gemini');
    expect(resolveProvider('getChatResponse', env)).toBe('selfhosted');
  });
});

describe('selfHostedFallsBackToGemini', () => {
  it("defaults ON; only the explicit '0' disables it", () => {
    expect(selfHostedFallsBackToGemini({})).toBe(true);
    expect(selfHostedFallsBackToGemini({ AI_SELFHOSTED_FALLBACK_GEMINI: '1' })).toBe(true);
    expect(selfHostedFallsBackToGemini({ AI_SELFHOSTED_FALLBACK_GEMINI: '0' })).toBe(false);
  });
});

describe('hasSelfHostedActionSpec', () => {
  it('covers the wired text actions and rejects unknown/prototype keys', () => {
    expect(hasSelfHostedActionSpec('getChatResponse')).toBe(true);
    expect(hasSelfHostedActionSpec('queryBCN')).toBe(true);
    expect(hasSelfHostedActionSpec('getSafetyAdvice')).toBe(true);
    expect(hasSelfHostedActionSpec('generateEmergencyPlanJSON')).toBe(false);
    expect(hasSelfHostedActionSpec('__proto__')).toBe(false);
    expect(hasSelfHostedActionSpec('toString')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dispatchSelfHostedAction
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchSelfHostedAction', () => {
  // getSafetyAdvice's builder is self-contained (no RAG / redaction imports),
  // which keeps these unit tests off heavy collaborators.
  const action = 'getSafetyAdvice';
  const args = [{ temp: 34, uv: 9, airQuality: 80 }];

  it('skips with not_configured when env is absent (feature OFF)', async () => {
    const result = await dispatchSelfHostedAction(action, args, { fetchImpl: okFetch() });
    expect(result).toEqual({ status: 'skipped', reason: 'not_configured' });
  });

  it('skips with unsupported for an action without a prompt spec (no fabricated prompt)', async () => {
    Object.assign(process.env, CONFIGURED);
    const fetchImpl = okFetch();
    const result = await dispatchSelfHostedAction('generateEmergencyPlanJSON', [], { fetchImpl });
    expect(result).toEqual({ status: 'skipped', reason: 'unsupported' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('happy path: returns the completion text + records breaker success and metrics', async () => {
    Object.assign(process.env, CONFIGURED);
    const result = await dispatchSelfHostedAction(action, args, { fetchImpl: okFetch('Hidrátate y usa bloqueador.') });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.text).toBe('Hidrátate y usa bloqueador.');
    expect(geminiCircuit.getState(SELFHOSTED_CIRCUIT_KEY)).toBe('closed');
    expect(getAiProviderStats().selfhosted.success).toBe(1);
    expect(getAiProviderStats().selfhosted.failure).toBe(0);
  });

  it('endpoint down → failed + breaker failure recorded on the selfhosted key', async () => {
    Object.assign(process.env, CONFIGURED);
    const result = await dispatchSelfHostedAction(action, args, { fetchImpl: downFetch() });
    expect(result.status).toBe('failed');
    expect(getAiProviderStats().selfhosted.failure).toBe(1);
  });

  it('empty completion → failed with reason empty_response (upstream miss, not a 200-empty)', async () => {
    Object.assign(process.env, CONFIGURED);
    const result = await dispatchSelfHostedAction(action, args, { fetchImpl: okFetch('   ') });
    expect(result).toMatchObject({ status: 'failed', reason: 'empty_response' });
  });

  it('open breaker → fast-fails with circuit_open WITHOUT calling the endpoint', async () => {
    Object.assign(process.env, CONFIGURED);
    for (let i = 0; i < geminiCircuit.THRESHOLD; i++) {
      geminiCircuit.recordFailure(SELFHOSTED_CIRCUIT_KEY);
    }
    expect(geminiCircuit.isOpen(SELFHOSTED_CIRCUIT_KEY)).toBe(true);
    const fetchImpl = okFetch();
    const result = await dispatchSelfHostedAction(action, args, { fetchImpl });
    expect(result).toEqual({ status: 'failed', reason: 'circuit_open' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('BREAKER ISOLATION: 5 self-hosted failures open ONLY the selfhosted key — gemini stays closed', async () => {
    Object.assign(process.env, CONFIGURED);
    for (let i = 0; i < geminiCircuit.THRESHOLD; i++) {
      await dispatchSelfHostedAction(action, args, { fetchImpl: downFetch() });
    }
    expect(geminiCircuit.getState(SELFHOSTED_CIRCUIT_KEY)).toBe('open');
    expect(geminiCircuit.getState('gemini')).toBe('closed');
    expect(geminiCircuit.isOpen('gemini')).toBe(false);
  });

  it('BREAKER ISOLATION (inverse): an open gemini key does NOT block self-hosted dispatch', async () => {
    Object.assign(process.env, CONFIGURED);
    for (let i = 0; i < geminiCircuit.THRESHOLD; i++) {
      geminiCircuit.recordFailure('gemini');
    }
    expect(geminiCircuit.isOpen('gemini')).toBe(true);
    const result = await dispatchSelfHostedAction(action, args, { fetchImpl: okFetch() });
    expect(result.status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('provider metrics', () => {
  it('aggregates success/failure/avgLatency per provider', () => {
    recordProviderCall('gemini', 'success', 100, 'analyzeRiskWithAI');
    recordProviderCall('gemini', 'success', 300, 'analyzeRiskWithAI');
    recordProviderCall('gemini', 'failure', 200, 'queryBCN');
    recordProviderCall('selfhosted', 'success', 50, 'getSafetyAdvice');
    const stats = getAiProviderStats();
    expect(stats.gemini).toEqual({ success: 2, failure: 1, avgLatencyMs: 200 });
    expect(stats.selfhosted).toEqual({ success: 1, failure: 0, avgLatencyMs: 50 });
  });

  it('never logs prompt content — only provider/outcome/latency/action name', async () => {
    const { logger } = await import('../../utils/logger.js');
    recordProviderCall('selfhosted', 'success', 42, 'getSafetyAdvice');
    const call = (logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(call?.[0]).toBe('[ai.provider] call');
    expect(JSON.stringify(call?.[1])).not.toMatch(/prompt|content/i);
  });
});
