/**
 * Contract tests for the Gemini client factory.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `@google/genai` v3.0.0 flipped the default Gemini Developer API version
 * from `v1beta` to `v1`. The model registry in `src/config/aiModels.ts`
 * points at `-preview` SKUs (`gemini-3.1-pro-preview`,
 * `gemini-3-flash-preview`, `gemini-3.1-flash-preview`) that upstream
 * documents as available only on `v1beta`.
 *
 * The SDK is mocked across the whole test suite, so no existing test can
 * detect that the client targets the wrong API version. These tests pin the
 * contract at the construction boundary instead.
 *
 * See `src/services/ai/geminiClientFactory.ts` for the full rationale.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const constructorSpy = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(options: Record<string, unknown>) {
      constructorSpy(options);
    }
  },
}));

const { createGeminiClient, GEMINI_API_VERSION } = await import(
  './geminiClientFactory.ts'
);

describe('geminiClientFactory', () => {
  afterEach(() => {
    constructorSpy.mockClear();
  });

  it('pins the Gemini Developer API version to v1beta', () => {
    createGeminiClient({ apiKey: 'test-key' });

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiVersion: 'v1beta' }),
    );
  });

  it('exposes the pinned version as a named constant', () => {
    expect(GEMINI_API_VERSION).toBe('v1beta');
  });

  it('forwards the API key unchanged', () => {
    createGeminiClient({ apiKey: 'my-secret-key' });

    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'my-secret-key' }),
    );
  });

  it('never leaves apiVersion unset (which would fall back to the SDK default)', () => {
    createGeminiClient({ apiKey: 'test-key' });

    const options = constructorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.apiVersion).toBeDefined();
    expect(typeof options.apiVersion).toBe('string');
  });
});
