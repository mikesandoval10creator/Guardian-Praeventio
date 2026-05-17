// Tests para hallucinationGuard.ts — Sprint K §159.

import { describe, it, expect } from 'vitest';
import {
  guardAgainstHallucination,
  splitSentences,
} from './hallucinationGuard.ts';

describe('hallucinationGuard.splitSentences', () => {
  it('separa oraciones por punto + mayúscula', () => {
    const s = splitSentences('Primera oración. Segunda oración. Tercera.');
    expect(s.length).toBe(3);
    expect(s[0]).toMatch(/Primera/);
  });

  it('respeta abreviaciones (Art. no es fin de oración)', () => {
    const s = splitSentences('Según el Art. 184 del Código. Otra oración.');
    expect(s.length).toBe(2);
    expect(s[0]).toMatch(/Art\. 184/);
  });

  it('respeta decimales (3.5 no es fin de oración)', () => {
    const s = splitSentences('La concentración es 3.5 mg/m3. Es elevada.');
    expect(s.length).toBe(2);
  });

  it('maneja interrogación + exclamación', () => {
    const s = splitSentences('¿Qué EPP? Necesitas casco. ¡Importante!');
    expect(s.length).toBe(3);
  });

  it('texto vacío → []', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('una sola oración sin punto final → 1 elemento', () => {
    const s = splitSentences('Oración sin punto final');
    expect(s.length).toBe(1);
    expect(s[0]).toBe('Oración sin punto final');
  });
});

describe('hallucinationGuard.guardAgainstHallucination — allow', () => {
  it('respuesta vacía → allow (nada que validar)', () => {
    const r = guardAgainstHallucination('');
    expect(r.allow).toBe(true);
  });

  it('respuesta sin números/fechas/leyes → allow', () => {
    const r = guardAgainstHallucination(
      'Recomendamos usar arnés y casco. Verifica la integridad del equipo.',
    );
    expect(r.allow).toBe(true);
  });

  it('respuesta con números pero CON citation → allow', () => {
    const r = guardAgainstHallucination(
      'La concentración máxima es 50 ppm según [1].',
    );
    expect(r.allow).toBe(true);
  });

  it('ley referenciada con citation → allow', () => {
    const r = guardAgainstHallucination(
      'El DS 594 establece límites [1] para sustancias químicas [1].',
    );
    expect(r.allow).toBe(true);
  });
});

describe('hallucinationGuard.guardAgainstHallucination — block', () => {
  it('número específico sin citation → block', () => {
    const r = guardAgainstHallucination('La concentración máxima es 50 ppm.');
    expect(r.allow).toBe(false);
    expect(r.suspiciousSentences[0]!.trigger).toBe('number_without_citation');
  });

  it('porcentaje sin citation → block', () => {
    const r = guardAgainstHallucination(
      'El riesgo aumenta 25% sin protección adecuada.',
    );
    expect(r.allow).toBe(false);
    expect(r.suspiciousSentences[0]!.trigger).toBe(
      'percentage_without_citation',
    );
  });

  it('fecha sin citation → block', () => {
    const r = guardAgainstHallucination('La norma se publicó en 2024.');
    expect(r.allow).toBe(false);
    expect(r.suspiciousSentences[0]!.trigger).toBe('date_without_citation');
  });

  it('referencia a ley sin citation → block (DS 594)', () => {
    const r = guardAgainstHallucination(
      'El DS 594 establece los límites de exposición.',
    );
    expect(r.allow).toBe(false);
    expect(r.suspiciousSentences[0]!.trigger).toBe('law_ref_without_citation');
  });

  it('referencia a Ley 16.744 sin citation → block', () => {
    const r = guardAgainstHallucination(
      'Según la Ley 16.744 hay obligaciones para el empleador.',
    );
    expect(r.allow).toBe(false);
    expect(r.suspiciousSentences[0]!.trigger).toBe('law_ref_without_citation');
  });

  it('múltiples oraciones sospechosas se reportan todas', () => {
    const r = guardAgainstHallucination(
      'El DS 594 aplica. El límite es 50 ppm. La concentración aumenta 25%.',
    );
    expect(r.allow).toBe(false);
    expect(r.suspiciousSentences.length).toBeGreaterThanOrEqual(2);
  });

  it('reason describe el trigger y la oración', () => {
    const r = guardAgainstHallucination('El límite es 100 mg/m3.');
    expect(r.reason).toMatch(/number_without_citation/);
  });

  it('oración mixta: una con citation, otra sin → block solo la mala', () => {
    const r = guardAgainstHallucination(
      'El DS 594 establece límites [1]. La concentración es 75 ppm.',
    );
    expect(r.allow).toBe(false);
    // La oración con citation NO debe estar en suspicious
    expect(r.suspiciousSentences.length).toBe(1);
    expect(r.suspiciousSentences[0]!.text).toMatch(/75 ppm/);
  });
});
