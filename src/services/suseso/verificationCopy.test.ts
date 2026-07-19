// The verdict a government inspector reads. Two failure modes matter here and
// both are damaging in opposite directions:
//   • calling a document VALID when the signature was not actually verified
//   • calling a document FAKE when we merely cannot check it
// These tests pin that the copy never does either, and never leaks a machine code.

import { describe, it, expect } from 'vitest';

import { verificationCopy } from './verificationCopy';
import type { SusesoVerificationResult } from './types';

const r = (o: Partial<SusesoVerificationResult>): SusesoVerificationResult =>
  ({ valid: false, ...o }) as SusesoVerificationResult;

/** Nothing on screen may be machine-facing. */
function expectHuman(c: ReturnType<typeof verificationCopy>) {
  for (const text of [c.title, c.detail, c.guidance]) {
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toMatch(/[a-z]+_[a-z]+/); // no snake_case codes
    expect(text).not.toMatch(/\b\d{3}\b/); // no bare status numbers
  }
}

describe('verificationCopy', () => {
  it('confirms a verified document without hedging', () => {
    const c = verificationCopy(r({ valid: true, verificationStatus: 'verified' }));
    expect(c.tone).toBe('verified');
    expect(c.title).toMatch(/verificado/i);
    expect(c.detail).toMatch(/no ha sido alterado/i);
    expectHuman(c);
  });

  it('NEVER says "válido" when the signature did not verify', () => {
    for (const res of [
      r({ verificationStatus: 'unverifiable', reason: 'legacy_unverifiable' }),
      r({ verificationStatus: 'unverifiable', reason: 'relying_party_mismatch' }),
      r({ verificationStatus: 'invalid', reason: 'signature_invalid' }),
    ]) {
      const c = verificationCopy(res);
      expect(c.tone).not.toBe('verified');
      expect(c.title).not.toMatch(/^documento verificado/i);
    }
  });

  it('NEVER calls an unverifiable document fake — and says so explicitly', () => {
    const c = verificationCopy(
      r({ verificationStatus: 'unverifiable', reason: 'legacy_unverifiable' }),
    );
    expect(c.tone).toBe('unverifiable');
    expect(c.title).toMatch(/no podemos comprobar/i);
    // The distinction an inspector must not get wrong.
    expect(c.guidance).toMatch(/no significa que el documento sea falso/i);
    expect(c.detail).not.toMatch(/falso|inválid/i);
    expectHuman(c);
  });

  it('explains the new relying-party mismatch in plain language', () => {
    const c = verificationCopy(
      r({ verificationStatus: 'unverifiable', reason: 'relying_party_mismatch' }),
    );
    expect(c.tone).toBe('unverifiable');
    expect(c.detail).toMatch(/dominio distinto/i);
    expectHuman(c);
  });

  it('is unambiguous when the content was altered after signing', () => {
    const c = verificationCopy(
      r({ verificationStatus: 'invalid', reason: 'payload_hash_mismatch' }),
    );
    expect(c.tone).toBe('invalid');
    expect(c.detail).toMatch(/modificado después de la firma/i);
    expect(c.guidance).toMatch(/no consideres este documento como firmado/i);
    expectHuman(c);
  });

  it('separates "folio does not exist" from "signature problem"', () => {
    for (const reason of ['unknown_folio', 'malformed_folio']) {
      const c = verificationCopy(r({ reason }));
      expect(c.tone).toBe('unknown');
      expect(c.title).toMatch(/no encontramos este folio/i);
      expectHuman(c);
    }
  });

  it('does not blame the document when the folio is duplicated on our side', () => {
    const c = verificationCopy(
      r({ verificationStatus: 'unverifiable', reason: 'ambiguous_folio' }),
    );
    expect(c.tone).toBe('unverifiable');
    expect(c.detail).toMatch(/más de un documento/i);
    expect(c.guidance).toMatch(/no significa que el documento sea falso/i);
    expectHuman(c);
  });

  it('handles an unsigned but registered document', () => {
    const c = verificationCopy(r({ verificationStatus: 'unverifiable', reason: 'unsigned' }));
    expect(c.tone).toBe('unverifiable');
    expect(c.title).toMatch(/sin firma/i);
    expectHuman(c);
  });

  it('degrades honestly when there is no response at all', () => {
    const c = verificationCopy(null);
    expect(c.tone).toBe('unknown');
    expect(c.guidance).toMatch(/conexión/i);
    expectHuman(c);
  });

  it('never leaks an unmapped machine reason to the screen', () => {
    for (const status of ['unverifiable', 'invalid'] as const) {
      const c = verificationCopy(r({ verificationStatus: status, reason: 'brand_new_code_v9' }));
      expect(JSON.stringify(c)).not.toMatch(/brand_new_code_v9/);
      expectHuman(c);
    }
  });
});
