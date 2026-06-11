// Tests para runWithGuardrails.ts — Sprint K §155 (integration).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
} from '../ai/aiAdapter.ts';
import {
  runWithGuardrails,
  renderPromptBody,
  findUnresolvedPlaceholders,
  GUARDRAIL_FALLBACK_TEXT,
} from './runWithGuardrails.ts';
import { AI_MODEL_FAST } from '../../config/aiModels.ts';

// ────────────────────────────────────────────────────────────────────────
// Fake adapter — inyectable, controla la respuesta del "LLM"
// ────────────────────────────────────────────────────────────────────────

function makeFakeAdapter(response: string): AiAdapter & {
  calls: AiGenerateRequest[];
} {
  const calls: AiGenerateRequest[] = [];
  const adapter: AiAdapter = {
    name: 'noop',
    region: 'test',
    isAvailable: true,
    async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
      calls.push(req);
      return { text: response, provider: 'noop' };
    },
  };
  return Object.assign(adapter, { calls });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// renderPromptBody — unit tests
// ────────────────────────────────────────────────────────────────────────

describe('renderPromptBody', () => {
  it('reemplaza placeholders simples', () => {
    expect(renderPromptBody('Hola {{name}}', { name: 'Daho' })).toBe('Hola Daho');
  });

  it('reemplaza múltiples ocurrencias del mismo placeholder', () => {
    expect(
      renderPromptBody('{{x}} y {{x}}', { x: 'a' }),
    ).toBe('a y a');
  });

  it('conserva placeholders no provistos como literal', () => {
    expect(renderPromptBody('{{a}} {{b}}', { a: 'A' })).toBe('A {{b}}');
  });

  it('convierte números a string', () => {
    expect(renderPromptBody('count={{n}}', { n: 42 })).toBe('count=42');
  });
});

describe('findUnresolvedPlaceholders', () => {
  it('detecta placeholders sin resolver', () => {
    expect(findUnresolvedPlaceholders('{{a}} y {{b}}')).toEqual(['{{a}}', '{{b}}']);
  });

  it('texto resuelto → []', () => {
    expect(findUnresolvedPlaceholders('todo resuelto')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// runWithGuardrails — integration tests
// ────────────────────────────────────────────────────────────────────────

describe('runWithGuardrails — happy path', () => {
  it('respuesta válida con citation → ok=true', async () => {
    const adapter = makeFakeAdapter('Según [1], necesitas arnés y casco.');
    const r = await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: '¿qué EPP?', context: 'arnés, casco' },
      sources: [{ id: 'node-a' }],
      adapter,
    });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/arnés/);
    expect(r.prompt.id).toBe('rag.zk.query');
    expect(r.prompt.version).toBe('2.0.0');
  });

  it('forwarda el prompt renderizado al adapter', async () => {
    const adapter = makeFakeAdapter('Texto [1].');
    await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(adapter.calls.length).toBe(1);
    expect(adapter.calls[0]!.prompt).toContain('X');
    expect(adapter.calls[0]!.prompt).toContain('Y');
  });

  it('forwarda el maxTokens del prompt al adapter', async () => {
    const adapter = makeFakeAdapter('Texto [1].');
    await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(adapter.calls[0]!.maxOutputTokens).toBe(1024);
  });
});

describe('runWithGuardrails — citation enforcement', () => {
  it('respuesta SIN citation cuando policy=required → block + fallback', async () => {
    const adapter = makeFakeAdapter('Texto sin citation.');
    const r = await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(r.ok).toBe(false);
    expect(r.text).toBe(GUARDRAIL_FALLBACK_TEXT);
    expect(r.blockedReason).toMatch(/citation/);
  });

  it('citation inventada [99] → block + fallback', async () => {
    const adapter = makeFakeAdapter('Texto [99] inventado.');
    const r = await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/no existe en la lista/);
  });

  it('policy=optional + sin citation → ok', async () => {
    const adapter = makeFakeAdapter('Resumen del incidente.');
    const r = await runWithGuardrails({
      promptId: 'incidents.summarize',
      version: '1.0.0',
      inputs: { description: 'caída desde altura' },
      sources: [],
      adapter,
    });
    expect(r.ok).toBe(true);
  });
});

describe('runWithGuardrails — hallucination guard', () => {
  it('número específico sin citation cuando policy=required → block', async () => {
    const adapter = makeFakeAdapter(
      'Necesitas arnés [1]. La concentración máxima es 50 ppm.',
    );
    const r = await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/hallucination/);
    expect(r.blockedReason).toMatch(/number_without_citation/);
  });

  it('referencia legal sin citation → block', async () => {
    const adapter = makeFakeAdapter(
      'Necesitas arnés [1]. El DS 594 establece límites.',
    );
    const r = await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/hallucination/);
  });

  it('NO aplica hallucination guard cuando policy=optional', async () => {
    // incidents.summarize@1.0.0 es optional. Si llega un número sin
    // citation NO debe bloquear (citation no era exigida).
    const adapter = makeFakeAdapter(
      'El incidente ocurrió a las 14:30. La caída fue desde 5 metros.',
    );
    const r = await runWithGuardrails({
      promptId: 'incidents.summarize',
      version: '1.0.0',
      inputs: { description: 'caída' },
      sources: [],
      adapter,
    });
    expect(r.ok).toBe(true);
  });
});

describe('runWithGuardrails — errores', () => {
  it('prompt id desconocido → throw', async () => {
    const adapter = makeFakeAdapter('x');
    await expect(
      runWithGuardrails({
        promptId: 'inexistente',
        version: '1.0.0',
        inputs: {},
        sources: [],
        adapter,
      }),
    ).rejects.toThrowError(/unknown prompt/);
  });

  it('placeholders sin resolver → throw (no mandar prompt malformado)', async () => {
    const adapter = makeFakeAdapter('x');
    await expect(
      runWithGuardrails({
        promptId: 'rag.zk.query',
        version: '2.0.0',
        // Falta `context` → quedará {{context}} sin resolver.
        inputs: { question: 'X' },
        sources: [{ id: 'a' }],
        adapter,
      }),
    ).rejects.toThrowError(/placeholders sin resolver/);
  });

  it('adapter.generate() arroja → propaga error', async () => {
    const adapter: AiAdapter = {
      name: 'noop',
      region: 'test',
      isAvailable: true,
      async generate(): Promise<AiGenerateResponse> {
        throw new Error('provider down');
      },
    };
    await expect(
      runWithGuardrails({
        promptId: 'rag.zk.query',
        version: '2.0.0',
        inputs: { question: 'X', context: 'Y' },
        sources: [{ id: 'a' }],
        adapter,
      }),
    ).rejects.toThrowError(/provider down/);
  });
});

describe('runWithGuardrails — log event ai_guardrail_blocked', () => {
  it('emite log estructurado cuando bloquea por citation', async () => {
    // Spy sobre console.warn (el logger usa console.warn fuera de
    // NODE_ENV=production).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeFakeAdapter('Texto sin citation.');
    await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls;
    const found = calls.some((c) =>
      c.some((arg) => {
        if (typeof arg === 'string') return arg.includes('ai_guardrail_blocked');
        if (arg && typeof arg === 'object') {
          return JSON.stringify(arg).includes('ai_guardrail_blocked');
        }
        return false;
      }),
    );
    expect(found).toBe(true);
    warnSpy.mockRestore();
  });

  it('emite log con stage=hallucination cuando bloquea por hallucination', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeFakeAdapter(
      'Cita ok [1]. Y aquí 50 ppm sin citation.',
    );
    await runWithGuardrails({
      promptId: 'rag.zk.query',
      version: '2.0.0',
      inputs: { question: 'X', context: 'Y' },
      sources: [{ id: 'a' }],
      adapter,
    });
    const calls = warnSpy.mock.calls;
    const found = calls.some((c) =>
      c.some((arg) => {
        if (arg && typeof arg === 'object') {
          const s = JSON.stringify(arg);
          return s.includes('hallucination');
        }
        return false;
      }),
    );
    expect(found).toBe(true);
    warnSpy.mockRestore();
  });
});

describe('runWithGuardrails — backwards compatibility', () => {
  it('el wrapper NO se inyecta como middleware obligatorio; los callers existentes a adapter.generate siguen funcionando', async () => {
    // Demo: usar adapter.generate directamente sin pasar por
    // runWithGuardrails. Debe seguir funcionando sin modificación.
    const adapter = makeFakeAdapter('respuesta cruda del LLM');
    const r = await adapter.generate({
      model: AI_MODEL_FAST,
      prompt: 'cualquier prompt',
    });
    expect(r.text).toBe('respuesta cruda del LLM');
    expect(r.provider).toBe('noop');
  });
});
