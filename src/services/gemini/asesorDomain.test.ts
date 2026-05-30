// Coach IA por dominio (#9) — unit tests for the two pure functions that make
// El Guardián specialize by module: asesorDomainFocus (the domain lens injected
// into the system prompt) and detectAsesorDomain (route -> domain). No Gemini
// call involved.

import { describe, it, expect } from 'vitest';
import { asesorDomainFocus, type AsesorDomain } from './chat';
import { detectAsesorDomain } from '../geminiService';

describe('asesorDomainFocus — lente por dominio', () => {
  it('medicina lleva el guardrail clínico ADR 0012 (NO diagnóstico)', () => {
    const f = asesorDomainFocus('medicina').toLowerCase();
    expect(f).toContain('adr 0012');
    expect(f).toContain('nunca emitas un diagnóstico');
    expect(f).toContain('deriva');
    expect(f).toContain('no atención médica'); // orientación preventiva, no atención
  });

  it('ergonomia enfoca REBA/RULA + manejo de cargas', () => {
    const f = asesorDomainFocus('ergonomia');
    expect(f).toContain('REBA/RULA');
    expect(f.toLowerCase()).toContain('20.949');
  });

  it('sst enfoca IPER + jerarquía de controles', () => {
    expect(asesorDomainFocus('sst')).toContain('IPER');
  });

  it('emergencias enfoca evacuación + recuerda que lo vital es determinístico', () => {
    const f = asesorDomainFocus('emergencias').toLowerCase();
    expect(f).toContain('evacua');
    expect(f).toContain('determinística');
  });

  it('general = prevención integral transversal', () => {
    expect(asesorDomainFocus('general')).toContain('PREVENCIÓN INTEGRAL');
  });

  it('cada dominio devuelve un texto no vacío y DISTINTO', () => {
    const domains: AsesorDomain[] = ['general', 'sst', 'ergonomia', 'medicina', 'emergencias'];
    const outs = domains.map(asesorDomainFocus);
    outs.forEach((o) => expect(o.length).toBeGreaterThan(20));
    expect(new Set(outs).size).toBe(domains.length);
  });
});

describe('detectAsesorDomain — ruta → dominio', () => {
  it.each([
    ['/medicine/aptitude', 'medicina'],
    ['/salud/vigilancia', 'medicina'],
    ['/ergonomics/reba', 'ergonomia'],
    ['/emergency/evacuation', 'emergencias'],
    ['/sos', 'emergencias'],
    ['/risks/iper', 'sst'],
    ['/permits/critical', 'sst'],
    ['/dashboard', 'general'],
    ['', 'general'],
  ])('%s → %s', (path, expected) => {
    expect(detectAsesorDomain(path)).toBe(expected);
  });

  it('es case-insensitive', () => {
    expect(detectAsesorDomain('/MEDICINE/X')).toBe('medicina');
  });
});
