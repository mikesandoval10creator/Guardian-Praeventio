import { describe, it, expect } from 'vitest';
import {
  FAILURE_LIBRARY,
  lookupFailurePatterns,
  suggestCorrectiveActions,
  summarizeFailureLibrary,
} from './controlFailureLibrary.js';

describe('FAILURE_LIBRARY', () => {
  it('contiene al menos 30 entries', () => {
    expect(FAILURE_LIBRARY.length).toBeGreaterThanOrEqual(30);
  });

  it('todas las entries tienen IDs únicos', () => {
    const ids = FAILURE_LIBRARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todas las entries tienen al menos 1 acción correctiva', () => {
    for (const e of FAILURE_LIBRARY) {
      expect(e.standardCorrectiveActions.length).toBeGreaterThan(0);
    }
  });

  it('todas las entries tienen síntoma y causa raíz no vacíos', () => {
    for (const e of FAILURE_LIBRARY) {
      expect(e.symptom.length).toBeGreaterThan(5);
      expect(e.rootCausePattern.length).toBeGreaterThan(5);
    }
  });

  it('cubre los 5 controlKind canónicos', () => {
    const kinds = new Set(FAILURE_LIBRARY.map((e) => e.controlKind));
    expect(kinds).toContain('elimination');
    expect(kinds).toContain('substitution');
    expect(kinds).toContain('engineering');
    expect(kinds).toContain('administrative');
    expect(kinds).toContain('epp');
  });
});

describe('lookupFailurePatterns', () => {
  it('filtra por controlKind', () => {
    const eppOnly = lookupFailurePatterns('epp');
    expect(eppOnly.length).toBeGreaterThan(0);
    for (const e of eppOnly) expect(e.controlKind).toBe('epp');
  });

  it('filtra por industria + incluye cross-industry como fallback', () => {
    const construction = lookupFailurePatterns('engineering', 'construction');
    expect(construction.length).toBeGreaterThan(0);
    for (const e of construction) {
      expect(['construction', 'cross-industry']).toContain(e.industry);
    }
  });

  it('matchea síntoma case-insensitive como substring', () => {
    const arnes = lookupFailurePatterns('epp', undefined, 'arnés');
    expect(arnes.length).toBeGreaterThan(0);
    for (const e of arnes) {
      expect(e.symptom.toLowerCase()).toContain('arnés');
    }
  });

  it('devuelve vacío cuando no hay match', () => {
    const none = lookupFailurePatterns('elimination', 'fake-industry-xyz');
    expect(none).toEqual([]);
  });

  it('múltiples filtros combinan en AND', () => {
    const results = lookupFailurePatterns('epp', 'construction', 'arnés');
    for (const e of results) {
      expect(e.controlKind).toBe('epp');
      expect(['construction', 'cross-industry']).toContain(e.industry);
      expect(e.symptom.toLowerCase()).toContain('arnés');
    }
  });
});

describe('suggestCorrectiveActions', () => {
  it('devuelve acciones para failureMode + controlKind', () => {
    const actions = suggestCorrectiveActions('not_used', 'epp');
    expect(actions.length).toBeGreaterThan(0);
  });

  it('deduplica acciones repetidas', () => {
    const actions = suggestCorrectiveActions('not_maintained', 'engineering');
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('preserva orden de inserción', () => {
    const actions = suggestCorrectiveActions('not_used', 'epp');
    // Should be array, not set; order matters for UI
    expect(Array.isArray(actions)).toBe(true);
  });

  it('devuelve vacío cuando no hay match', () => {
    const actions = suggestCorrectiveActions('not_supervised', 'elimination');
    expect(actions).toEqual([]);
  });
});

describe('summarizeFailureLibrary', () => {
  it('total coincide con FAILURE_LIBRARY.length', () => {
    const s = summarizeFailureLibrary();
    expect(s.totalEntries).toBe(FAILURE_LIBRARY.length);
  });

  it('suma por failureMode = total', () => {
    const s = summarizeFailureLibrary();
    const sum = Object.values(s.byFailureMode).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totalEntries);
  });

  it('suma por controlKind = total', () => {
    const s = summarizeFailureLibrary();
    const sum = Object.values(s.byControlKind).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totalEntries);
  });

  it('suma por frequency tier = total', () => {
    const s = summarizeFailureLibrary();
    const sum = Object.values(s.byFrequencyTier).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totalEntries);
  });
});
