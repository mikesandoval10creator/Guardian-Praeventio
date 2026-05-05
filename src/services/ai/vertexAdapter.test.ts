/**
 * Tests for the real Vertex AI adapter (post-H4 fix).
 *
 * Strategy:
 *   - Mock `@google-cloud/vertexai` so the adapter can be exercised
 *     end-to-end without GCP credentials or network.
 *   - Toggle env vars per test, then construct a fresh `VertexAdapter`
 *     to read the new values (the singleton caches at construction time).
 *   - Cover the three error codes the contract promises: TIMEOUT, QUOTA,
 *     UPSTREAM, plus happy path + isAvailable gating + tenant-aware
 *     facade routing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spy capturing the last `generateContent` request shape so tests can
// assert the adapter forwarded prompt/system/config correctly.
const lastCall: { args?: unknown; modelOpts?: unknown } = {};

// Mock factory whose behaviour the suite mutates per-test via `mockImpl`.
let mockImpl: (args: unknown) => Promise<unknown> = async (args) => {
  lastCall.args = args;
  return {
    response: {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'mock-vertex-response' }] },
        },
      ],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5 },
    },
  };
};

vi.mock('@google-cloud/vertexai', () => {
  class VertexAI {
    project: string;
    location: string;
    constructor(opts: { project: string; location: string }) {
      this.project = opts.project;
      this.location = opts.location;
    }
    getGenerativeModel(opts: { model: string }) {
      lastCall.modelOpts = opts;
      return {
        generateContent: vi.fn((args: unknown) => mockImpl(args)),
      };
    }
    // Mirror the real SDK's `preview` namespace so the adapter's preferred
    // path is exercised.
    preview = {
      getGenerativeModel: (opts: { model: string }) => {
        lastCall.modelOpts = opts;
        return {
          generateContent: vi.fn((args: unknown) => mockImpl(args)),
        };
      },
    };
  }
  return { VertexAI };
});

import { VertexAdapter } from './vertexAdapter.ts';
import { getAiAdapterFor } from './index.ts';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.VERTEX_PROJECT_ID;
  delete process.env.VERTEX_LOCATION;
  delete process.env.VERTEX_REGION;
  delete process.env.VERTEX_TIMEOUT_MS;
  delete process.env.AI_ADAPTER;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_RESIDENCY_STRICT;
  delete process.env.AI_ROUTE_LATAM_TO_VERTEX;
  // Reset to default happy-path mock impl
  mockImpl = async (args) => {
    lastCall.args = args;
    return {
      response: {
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'mock-vertex-response' }] },
          },
        ],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5 },
      },
    };
  };
  lastCall.args = undefined;
  lastCall.modelOpts = undefined;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// 1. isAvailable / region resolution
// ---------------------------------------------------------------------------
describe('VertexAdapter availability + region', () => {
  it('isAvailable=false when VERTEX_PROJECT_ID is unset', () => {
    const a = new VertexAdapter();
    expect(a.isAvailable).toBe(false);
    expect(a.name).toBe('vertex-ai');
  });

  it('isAvailable=true when VERTEX_PROJECT_ID is set', () => {
    process.env.VERTEX_PROJECT_ID = 'my-gcp-project';
    const a = new VertexAdapter();
    expect(a.isAvailable).toBe(true);
  });

  it('defaults region to southamerica-west1 (Santiago)', () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    const a = new VertexAdapter();
    expect(a.region).toBe('southamerica-west1');
  });

  it('honours VERTEX_LOCATION override', () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    process.env.VERTEX_LOCATION = 'us-central1';
    const a = new VertexAdapter();
    expect(a.region).toBe('us-central1');
  });

  it('honours legacy VERTEX_REGION when VERTEX_LOCATION absent', () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    process.env.VERTEX_REGION = 'europe-west4';
    const a = new VertexAdapter();
    expect(a.region).toBe('europe-west4');
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path
// ---------------------------------------------------------------------------
describe('VertexAdapter.generate happy path', () => {
  it('returns text + usage + provider attribution from the SDK response', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    const a = new VertexAdapter();
    const res = await a.generate({
      model: 'gemini-1.5-pro',
      prompt: 'hola mundo',
      temperature: 0.3,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
      systemInstruction: 'sé conciso',
    });
    expect(res.text).toBe('mock-vertex-response');
    expect(res.provider).toBe('vertex-ai');
    expect(res.finishReason).toBe('STOP');
    expect(res.usage).toEqual({ promptTokens: 11, outputTokens: 5 });
  });

  it('forwards prompt, systemInstruction, and generationConfig to the SDK', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    const a = new VertexAdapter();
    await a.generate({
      model: 'gemini-1.5-pro',
      prompt: 'ping',
      temperature: 0.7,
      maxOutputTokens: 64,
      responseMimeType: 'text/plain',
      systemInstruction: 'be terse',
    });
    expect(lastCall.modelOpts).toEqual({ model: 'gemini-1.5-pro' });
    const args = lastCall.args as {
      contents: unknown;
      systemInstruction: unknown;
      generationConfig: unknown;
    };
    expect(args.contents).toEqual([
      { role: 'user', parts: [{ text: 'ping' }] },
    ]);
    expect(args.systemInstruction).toEqual({
      role: 'system',
      parts: [{ text: 'be terse' }],
    });
    expect(args.generationConfig).toEqual({
      temperature: 0.7,
      maxOutputTokens: 64,
      responseMimeType: 'text/plain',
    });
  });

  it('omits systemInstruction when caller did not provide one', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    const a = new VertexAdapter();
    await a.generate({ model: 'gemini-1.5-pro', prompt: 'no system' });
    const args = lastCall.args as { systemInstruction?: unknown };
    expect(args.systemInstruction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Error classification
// ---------------------------------------------------------------------------
describe('VertexAdapter error classification', () => {
  it('throws .code=UPSTREAM (synchronous) when project ID is missing', async () => {
    const a = new VertexAdapter();
    await expect(
      a.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
  });

  it('classifies HTTP 429 as .code=QUOTA', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    mockImpl = async () => {
      const err = new Error('Quota exceeded for requests') as Error & {
        code: number;
      };
      err.code = 429;
      throw err;
    };
    const a = new VertexAdapter();
    await expect(
      a.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'QUOTA' });
  });

  it('classifies a quota-text error as .code=QUOTA', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    mockImpl = async () => {
      throw new Error('RESOURCE_EXHAUSTED: per-day token quota');
    };
    const a = new VertexAdapter();
    await expect(
      a.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'QUOTA' });
  });

  it('classifies a slow upstream as .code=TIMEOUT (timer racing wins)', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    process.env.VERTEX_TIMEOUT_MS = '20';
    // Never resolves — timeout must win.
    mockImpl = () => new Promise(() => {});
    const a = new VertexAdapter();
    await expect(
      a.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('classifies an arbitrary upstream error as .code=UPSTREAM', async () => {
    process.env.VERTEX_PROJECT_ID = 'p';
    mockImpl = async () => {
      throw new Error('500 Internal Server Error from /v1/projects/...');
    };
    const a = new VertexAdapter();
    await expect(
      a.generate({ model: 'gemini-1.5-pro', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
  });
});

// ---------------------------------------------------------------------------
// 4. Tenant-aware facade routing (audit P1 H4 contract)
// ---------------------------------------------------------------------------
describe('getAiAdapterFor tenant-aware routing', () => {
  it('strict + LATAM + vertex unavailable: THROWS (no silent us-central1 fallback)', () => {
    // No VERTEX_PROJECT_ID — vertex unavailable. Gemini key present
    // (the silent fallback would have picked it up).
    process.env.GEMINI_API_KEY = 'k';
    expect(() =>
      getAiAdapterFor({ dataResidency: 'latam', strict: true }),
    ).toThrow(/LATAM data residency/i);
  });

  it('strict default reads AI_RESIDENCY_STRICT env var', () => {
    process.env.AI_RESIDENCY_STRICT = 'true';
    process.env.GEMINI_API_KEY = 'k';
    expect(() =>
      getAiAdapterFor({ dataResidency: 'latam' }),
    ).toThrow(/LATAM data residency/i);
  });

  it('lax + LATAM + vertex unavailable: falls through to gemini-consumer', () => {
    process.env.GEMINI_API_KEY = 'k';
    const a = getAiAdapterFor({ dataResidency: 'latam', strict: false });
    expect(a.name).toBe('gemini-consumer');
  });

  it('non-LATAM tenant takes the normal getAiAdapter() path', () => {
    process.env.GEMINI_API_KEY = 'k';
    const a = getAiAdapterFor({ dataResidency: 'global' });
    expect(a.name).toBe('gemini-consumer');
  });
});
