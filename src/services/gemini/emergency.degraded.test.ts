// Tests — generateEmergencyPlanJSON degrades a failed upstream request into a
// breaker-visible GeminiDegradedError that still carries a usable baseline plan.
//
// Lives in its own file because emergency.ts captures GEMINI_API_KEY at import
// time: here we set the key and mock @google/genai BEFORE importing the module,
// so we exercise the real network path (and its rejection) rather than the
// "no key → throw" contract covered in emergency.test.ts.

import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';

// generateContent rejects → simulates a transient 503 / network outage.
const generateContentReject = vi.fn(async () => {
  throw Object.assign(new Error('upstream 503'), { status: 503 });
});

vi.mock('@google/genai', () => {
  function GoogleGenAI() {
    return { models: { generateContent: generateContentReject } };
  }
  return {
    GoogleGenAI,
    Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  };
});

let generateEmergencyPlanJSON: typeof import('./emergency').generateEmergencyPlanJSON;
let isGeminiDegradedError: typeof import('./degraded').isGeminiDegradedError;
let isUsableShape: (v: unknown) => boolean;

beforeAll(async () => {
  ({ generateEmergencyPlanJSON } = await import('./emergency'));
  ({ isGeminiDegradedError } = await import('./degraded'));
  // Minimal local re-check of the plan shape (the guard is private).
  isUsableShape = (v: unknown) => {
    const p = v as Record<string, unknown>;
    return (
      !!p &&
      typeof p.objetivo === 'string' &&
      Array.isArray(p.marcoLegal) &&
      Array.isArray(p.accionesInmediatas)
    );
  };
});

describe('generateEmergencyPlanJSON — request rejection', () => {
  it('throws GeminiDegradedError so the breaker records a failure', async () => {
    await expect(
      generateEmergencyPlanJSON('Incendio', 'fuego en bodega', 'DS 594'),
    ).rejects.toSatisfy(isGeminiDegradedError);
  });

  it('the error carries a usable, normative baseline plan flagged generadoSinIA', async () => {
    let caught: unknown;
    try {
      await generateEmergencyPlanJSON('Incendio', 'fuego en bodega', 'DS 594', 'mineria');
    } catch (err) {
      caught = err;
    }
    expect(isGeminiDegradedError(caught)).toBe(true);
    const plan = (caught as { degradedResult: Record<string, unknown> }).degradedResult;
    expect(isUsableShape(plan)).toBe(true);
    expect(plan.generadoSinIA).toBe(true);
    expect((plan.marcoLegal as string[]).join(' ')).toContain('16.744');
    expect((plan.accionesInmediatas as string[]).join(' ')).toContain('131'); // SAMU
  });
});
