// Praeventio Guard — Phase 5 · F2: dispatcher error→status classification.
//
// Exercises the REAL predicate the /api/gemini dispatcher uses inline to pick
// 502 (bad upstream Gemini response) vs 500 (internal bug) — not a
// reimplementation. The 12 *Backend.ts now parse via `parseGeminiJson`, which
// throws `gemini_empty_response` on empty and SyntaxError on malformed bodies;
// both must surface as 502.

import { describe, it, expect } from 'vitest';
import { isUpstreamGeminiParseError } from './_geminiErrors.js';

describe('isUpstreamGeminiParseError — 502 (bad gateway) vs 500 (internal)', () => {
  it('SyntaxError (malformed Gemini JSON) → 502', () => {
    expect(isUpstreamGeminiParseError(new SyntaxError('Unexpected token <'))).toBe(true);
  });

  it('a genuine JSON.parse failure (real SyntaxError) → 502', () => {
    let caught: unknown;
    try {
      JSON.parse('<!doctype html> not json');
    } catch (e) {
      caught = e;
    }
    expect(isUpstreamGeminiParseError(caught)).toBe(true);
  });

  it("Error('gemini_empty_response') from parseGeminiJson → 502", () => {
    expect(isUpstreamGeminiParseError(new Error('gemini_empty_response'))).toBe(true);
  });

  it('an error-shaped object with that message (prototype stripped across boundaries) → 502', () => {
    expect(isUpstreamGeminiParseError({ message: 'gemini_empty_response' })).toBe(true);
  });

  it('a generic backend failure (e.g. Firestore down) → NOT 502 (stays 500)', () => {
    expect(isUpstreamGeminiParseError(new Error('firestore unavailable'))).toBe(false);
  });

  it('circuit/quota signals are not parse errors', () => {
    expect(isUpstreamGeminiParseError(new Error('gemini_circuit_open'))).toBe(false);
    expect(isUpstreamGeminiParseError(new Error('gemini_quota_exceeded'))).toBe(false);
  });

  it('null / undefined / bare string → false (no spurious 502)', () => {
    expect(isUpstreamGeminiParseError(null)).toBe(false);
    expect(isUpstreamGeminiParseError(undefined)).toBe(false);
    // A bare string is not an error object — has no `.message`.
    expect(isUpstreamGeminiParseError('gemini_empty_response')).toBe(false);
  });
});
