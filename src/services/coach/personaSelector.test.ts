// Tests para §12.6.1 — Persona selector GeminiChat.

import { describe, it, expect } from 'vitest';
import {
  selectPersona,
  getPersonaMetric,
} from './personaSelector';

describe('selectPersona — abogado_codificado (legal)', () => {
  it('cita DS específico → abogado', () => {
    const result = selectPersona('¿Qué dice el DS 44/2024 art. 5 sobre obligaciones del empleador?');
    expect(result.persona).toBe('abogado_codificado');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('cita Ley con número → abogado', () => {
    const result = selectPersona('Necesito el texto del artículo de la Ley 16.744');
    expect(result.persona).toBe('abogado_codificado');
  });

  it('ISO 45001 + reglamento → abogado', () => {
    const result = selectPersona('¿Cómo cumplo el reglamento ISO 45001?');
    expect(result.persona).toBe('abogado_codificado');
  });

  it('múltiples keywords legales → confidence alto', () => {
    const result = selectPersona(
      '¿Qué obligaciones impone el DS 44 art. 12 según la Ley 16.744 sobre normativa de prevención?',
    );
    expect(result.persona).toBe('abogado_codificado');
    expect(result.confidence).toBeGreaterThan(0.6);
  });
});

describe('selectPersona — emergency_responder', () => {
  it('incendio → emergency', () => {
    const result = selectPersona('¿Qué hago si hay un incendio en la bodega?');
    expect(result.persona).toBe('emergency_responder');
  });

  it('paro cardiaco → emergency con alto confidence', () => {
    const result = selectPersona('Un trabajador tuvo paro cardíaco, necesito RCP');
    expect(result.persona).toBe('emergency_responder');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('sismo prioriza sobre normativa', () => {
    const result = selectPersona('Hay sismo, ¿qué dice la Ley 16.744 sobre evacuación?');
    expect(result.persona).toBe('emergency_responder');
  });
});

describe('selectPersona — medical_advisor', () => {
  it('examen pre-ocupacional → medical', () => {
    const result = selectPersona('Mi trabajador necesita examen pre-ocupacional y audiometría');
    expect(result.persona).toBe('medical_advisor');
  });

  it('lesión + tratamiento → medical', () => {
    const result = selectPersona('Tiene una lesión en el hombro, ¿qué tratamiento aplica?');
    expect(result.persona).toBe('medical_advisor');
  });
});

describe('selectPersona — ergonomist', () => {
  it('RULA + postura → ergonomist', () => {
    const result = selectPersona('Necesito hacer evaluación RULA de postura en oficina');
    expect(result.persona).toBe('ergonomist');
  });

  it('NIOSH + manejo manual → ergonomist', () => {
    const result = selectPersona('Aplicar NIOSH al manejo manual de cargas pesadas');
    expect(result.persona).toBe('ergonomist');
  });
});

describe('selectPersona — coach_general (default)', () => {
  it('query genérica → coach_general', () => {
    const result = selectPersona('¿Cómo motivar a mi equipo a usar EPP?');
    expect(result.persona).toBe('coach_general');
  });

  it('query vacía → coach_general', () => {
    const result = selectPersona('');
    expect(result.persona).toBe('coach_general');
  });

  it('saludo → coach_general', () => {
    const result = selectPersona('Hola, gracias por tu ayuda');
    expect(result.persona).toBe('coach_general');
  });
});

describe('selectPersona — robustez', () => {
  it('null/undefined safe', () => {
    expect(() => selectPersona(null as unknown as string)).not.toThrow();
    expect(() => selectPersona(undefined as unknown as string)).not.toThrow();
  });

  it('siempre retorna systemPromptTemplate no vacío', () => {
    const result = selectPersona('test query');
    expect(result.systemPromptTemplate.length).toBeGreaterThan(50);
  });

  it('reasons no vacío', () => {
    const result = selectPersona('test');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('determinístico: mismas entradas → mismas salidas', () => {
    const q = 'DS 44 art. 5 obligaciones';
    const a = selectPersona(q);
    const b = selectPersona(q);
    expect(a).toEqual(b);
  });
});

describe('selectPersona — DS 44/2024 awareness', () => {
  it('prompt incluye anotación DS 40 derogado', () => {
    const result = selectPersona('DS 40');
    expect(result.persona).toBe('abogado_codificado');
    expect(result.systemPromptTemplate).toContain('derogado por DS 44/2024');
    expect(result.systemPromptTemplate).toContain('2025-02-01');
  });
});

describe('getPersonaMetric', () => {
  it('confidence buckets', () => {
    expect(
      getPersonaMetric({
        persona: 'abogado_codificado',
        confidence: 0.9,
        reasons: [],
        systemPromptTemplate: '',
      }).confidence_bucket,
    ).toBe('high');
    expect(
      getPersonaMetric({
        persona: 'abogado_codificado',
        confidence: 0.5,
        reasons: [],
        systemPromptTemplate: '',
      }).confidence_bucket,
    ).toBe('medium');
    expect(
      getPersonaMetric({
        persona: 'coach_general',
        confidence: 0.2,
        reasons: [],
        systemPromptTemplate: '',
      }).confidence_bucket,
    ).toBe('low');
  });
});
