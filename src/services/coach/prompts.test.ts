import { describe, it, expect } from 'vitest';
import {
  CHEMICAL_PROMPT,
  MEDICINE_PROMPT,
  LEGAL_PROMPT,
  ERGONOMICS_PROMPT,
  STRUCTURAL_PROMPT,
  DOMAIN_PROMPTS,
  type DomainPrompt,
} from './prompts';

/**
 * Bucket HH + Fase 3.B — schema integrity tests for the 5 coach personas.
 * These tests catch regressions like accidentally emptying citations,
 * removing the few-shot examples, or swapping the persona definitions.
 */

const allPrompts: Array<[string, DomainPrompt]> = [
  ['CHEMICAL', CHEMICAL_PROMPT],
  ['MEDICINE', MEDICINE_PROMPT],
  ['LEGAL', LEGAL_PROMPT],
  ['ERGONOMICS', ERGONOMICS_PROMPT],
  ['STRUCTURAL', STRUCTURAL_PROMPT],
];

describe('coach domain prompts', () => {
  it('every persona has non-empty system prompt + rule + ≥2 examples + ≥3 citations', () => {
    for (const [name, p] of allPrompts) {
      expect(p.systemPrompt.length, `${name} systemPrompt`).toBeGreaterThan(80);
      expect(p.rule.length, `${name} rule`).toBeGreaterThan(20);
      expect(p.examples.length, `${name} examples`).toBeGreaterThanOrEqual(2);
      expect(p.citations.length, `${name} citations`).toBeGreaterThanOrEqual(3);
      for (const ex of p.examples) {
        expect(ex.input.length, `${name} example.input`).toBeGreaterThan(10);
        expect(ex.output.length, `${name} example.output`).toBeGreaterThan(40);
      }
    }
  });

  it('persona system prompts cite their canonical CL norms', () => {
    expect(CHEMICAL_PROMPT.systemPrompt).toMatch(/DS\s*594/);
    expect(CHEMICAL_PROMPT.systemPrompt).toMatch(/DS\s*148/);
    expect(MEDICINE_PROMPT.systemPrompt).toMatch(/Ley\s*16\.?744/);
    expect(MEDICINE_PROMPT.systemPrompt).toMatch(/PREXOR/);
    expect(LEGAL_PROMPT.systemPrompt).toMatch(/Ley\s*21\.?643/);
    expect(LEGAL_PROMPT.systemPrompt).toMatch(/Ley\s*20\.?123/);
    expect(ERGONOMICS_PROMPT.systemPrompt).toMatch(/TMERT/);
    expect(ERGONOMICS_PROMPT.systemPrompt).toMatch(/Ley\s*20\.?001/);
    expect(STRUCTURAL_PROMPT.systemPrompt).toMatch(/NCh\s*2369/);
    expect(STRUCTURAL_PROMPT.systemPrompt).toMatch(/OGUC/);
  });

  it('citations array references the same norms named in systemPrompt', () => {
    // Sanity: citations must overlap with the persona description.
    const chemicalCitationsHit = CHEMICAL_PROMPT.citations.some((c) =>
      c.includes('DS 594'),
    );
    expect(chemicalCitationsHit).toBe(true);

    const medicineCitationsHit = MEDICINE_PROMPT.citations.some((c) =>
      c.includes('16.744'),
    );
    expect(medicineCitationsHit).toBe(true);

    const legalCitationsHit = LEGAL_PROMPT.citations.some((c) =>
      c.includes('21.643'),
    );
    expect(legalCitationsHit).toBe(true);

    const ergonomicsCitationsHit = ERGONOMICS_PROMPT.citations.some((c) =>
      c.includes('TMERT'),
    );
    expect(ergonomicsCitationsHit).toBe(true);

    const structuralCitationsHit = STRUCTURAL_PROMPT.citations.some((c) =>
      c.includes('NCh 2369'),
    );
    expect(structuralCitationsHit).toBe(true);
  });

  it('DOMAIN_PROMPTS lookup map exposes the 5 canonical domains', () => {
    expect(Object.keys(DOMAIN_PROMPTS).sort()).toEqual([
      'chemical',
      'ergonomics',
      'legal',
      'medicine',
      'structural',
    ]);
    expect(DOMAIN_PROMPTS.chemical).toBe(CHEMICAL_PROMPT);
    expect(DOMAIN_PROMPTS.medicine).toBe(MEDICINE_PROMPT);
    expect(DOMAIN_PROMPTS.legal).toBe(LEGAL_PROMPT);
    expect(DOMAIN_PROMPTS.ergonomics).toBe(ERGONOMICS_PROMPT);
    expect(DOMAIN_PROMPTS.structural).toBe(STRUCTURAL_PROMPT);
  });
});
