/**
 * Tests for the AI adapter facade + the gemini-consumer / vertex-ai / noop
 * adapters.
 *
 * Strategy:
 *   - Mock `@google/genai` minimally so the gemini adapter can be exercised
 *     end-to-end without making a real API call (or even needing a key).
 *   - Mutate `process.env.GEMINI_API_KEY` per test, then construct a fresh
 *     `GeminiConsumerAdapter` to read the new value (the singleton caches
 *     credentials at construction time — that's correct production behaviour).
 *   - For the facade, mutate `process.env.AI_ADAPTER` and call `getAiAdapter()`
 *     directly; the facade re-reads env on every call.
 *
 * What these tests pin (per the scaffolding spec):
 *   1. geminiAdapter.isAvailable mirrors GEMINI_API_KEY presence.
 *   2. vertexAdapter.isAvailable === false until Round 2 lands.
 *   3. Facade with AI_ADAPTER=vertex-ai falls back to gemini, then noop.
 *   4. Facade with no env defaults to gemini-consumer.
 *   5. noopAdapter.generate(...) returns { text: '', provider: 'noop' }.
 *   6. vertexAdapter.generate(...) throws an actionable error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mock `@google/genai` BEFORE importing anything that pulls it in transitively.
// vitest hoists `vi.mock` calls to the top of the file regardless of textual
// position, so this is safe even though it appears below the imports above.
// -----------------------------------------------------------------------------
vi.mock('@google/genai', () => {
  // The mock records the last call args so a test can assert the adapter
  // forwarded the request shape correctly.
  const lastCall: { args?: unknown } = {};
  class GoogleGenAI {
    models = {
      generateContent: vi.fn(async (args: unknown) => {
        lastCall.args = args;
        return {
          text: 'mock-response',
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
        };
      }),
    };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { GoogleGenAI, __getLastCall: () => lastCall };
});

import {
  getAiAdapter,
  noopAdapter,
  vertexAdapter,
} from './index.ts';
import { GeminiConsumerAdapter } from './geminiAdapter.ts';

// Snapshot the env so each test starts clean. We only mutate the two keys we
// care about, but restoring everything is cheap and prevents cross-suite leaks.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Clear the two knobs we mutate; tests opt back in explicitly.
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_ADAPTER;
  delete process.env.VERTEX_REGION;
});

afterEach(() => {
  // Restore the full env so a leaked GEMINI_API_KEY in one test doesn't
  // pollute another test file's expectations.
  process.env = { ...ORIGINAL_ENV };
});

// -----------------------------------------------------------------------------
// 1. geminiAdapter.isAvailable mirrors GEMINI_API_KEY.
// -----------------------------------------------------------------------------
describe('GeminiConsumerAdapter.isAvailable', () => {
  it('is true when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key-xyz';
    const adapter = new GeminiConsumerAdapter();
    expect(adapter.isAvailable).toBe(true);
    expect(adapter.name).toBe('gemini-consumer');
    expect(adapter.region).toBe('us-central1');
  });

  it('is false when GEMINI_API_KEY is absent', () => {
    // beforeEach already cleared it
    const adapter = new GeminiConsumerAdapter();
    expect(adapter.isAvailable).toBe(false);
  });

  it('throws a helpful error when generate() is called without a key', async () => {
    const adapter = new GeminiConsumerAdapter();
    await expect(
      adapter.generate({ model: 'gemini-1.5-pro', prompt: 'hi' }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('forwards the request shape to @google/genai and returns a typed response', async () => {
    process.env.GEMINI_API_KEY = 'test-key-xyz';
    const adapter = new GeminiConsumerAdapter();
    const res = await adapter.generate({
      model: 'gemini-1.5-pro',
      prompt: 'hello world',
      temperature: 0.2,
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
      systemInstruction: 'be concise',
    });
    expect(res.text).toBe('mock-response');
    expect(res.provider).toBe('gemini-consumer');
    expect(res.finishReason).toBe('STOP');
    expect(res.usage).toEqual({ promptTokens: 7, outputTokens: 3 });
  });
});

// -----------------------------------------------------------------------------
// 2. vertexAdapter is permanently isAvailable=false this round.
// -----------------------------------------------------------------------------
describe('vertexAdapter (stub)', () => {
  it('reports isAvailable === false (until SDK install in Round 2)', () => {
    expect(vertexAdapter.isAvailable).toBe(false);
    expect(vertexAdapter.name).toBe('vertex-ai');
  });

  it('defaults the region to southamerica-west1 (Santiago)', () => {
    // The singleton was constructed at module load with whatever env was
    // present then. The default for Santiago is what the migration is for.
    expect(vertexAdapter.region).toBe('southamerica-west1');
  });

  it('generate() throws an actionable error pointing at VERTEX_MIGRATION.md', async () => {
    await expect(
      vertexAdapter.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toThrow(/VERTEX_MIGRATION\.md/);
    await expect(
      vertexAdapter.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toThrow(/@google-cloud\/aiplatform/);
  });
});

// -----------------------------------------------------------------------------
// 3 + 4. getAiAdapter() facade selection.
// -----------------------------------------------------------------------------
describe('getAiAdapter() facade', () => {
  it('defaults to gemini-consumer when AI_ADAPTER is unset and key is present', () => {
    process.env.GEMINI_API_KEY = 'k';
    const a = getAiAdapter();
    expect(a.name).toBe('gemini-consumer');
  });

  it('returns noop when AI_ADAPTER is unset AND no GEMINI_API_KEY (last-resort)', () => {
    const a = getAiAdapter();
    expect(a.name).toBe('noop');
  });

  it('AI_ADAPTER=vertex-ai with vertex unavailable falls back to gemini-consumer when key set', () => {
    process.env.AI_ADAPTER = 'vertex-ai';
    process.env.GEMINI_API_KEY = 'k';
    const a = getAiAdapter();
    // vertex stub is permanently unavailable in this round; fall through.
    expect(a.name).toBe('gemini-consumer');
  });

  it('AI_ADAPTER=vertex-ai with vertex AND gemini unavailable falls back to noop', () => {
    process.env.AI_ADAPTER = 'vertex-ai';
    // No GEMINI_API_KEY set — gemini also unavailable.
    const a = getAiAdapter();
    expect(a.name).toBe('noop');
  });

  it('AI_ADAPTER=gemini-consumer with no key falls back to noop', () => {
    process.env.AI_ADAPTER = 'gemini-consumer';
    const a = getAiAdapter();
    expect(a.name).toBe('noop');
  });

  it('AI_ADAPTER=noop returns the noop adapter explicitly', () => {
    process.env.AI_ADAPTER = 'noop';
    process.env.GEMINI_API_KEY = 'k'; // even with key available, noop wins
    const a = getAiAdapter();
    expect(a.name).toBe('noop');
  });

  it('Unknown AI_ADAPTER value is treated as gemini-consumer (safe default)', () => {
    process.env.AI_ADAPTER = 'totally-bogus-value';
    process.env.GEMINI_API_KEY = 'k';
    const a = getAiAdapter();
    expect(a.name).toBe('gemini-consumer');
  });

  it('AI_ADAPTER value matching is case-insensitive', () => {
    process.env.AI_ADAPTER = 'GEMINI-CONSUMER';
    process.env.GEMINI_API_KEY = 'k';
    const a = getAiAdapter();
    expect(a.name).toBe('gemini-consumer');
  });
});

// -----------------------------------------------------------------------------
// 5. noopAdapter behaviour.
// -----------------------------------------------------------------------------
describe('noopAdapter', () => {
  it('returns an empty completion attributed to noop, never throws', async () => {
    const res = await noopAdapter.generate({
      model: 'whatever',
      prompt: 'this goes nowhere',
    });
    expect(res).toEqual({ text: '', provider: 'noop' });
  });

  it('reports isAvailable=false and region=none (it is a fallback, not a preference)', () => {
    expect(noopAdapter.isAvailable).toBe(false);
    expect(noopAdapter.region).toBe('none');
    expect(noopAdapter.name).toBe('noop');
  });
});
