// Tests para citationValidator.ts — Sprint K §158.

import { describe, it, expect } from 'vitest';
import {
  validateResponse,
  extractCitations,
  describeValidationFailure,
} from './citationValidator.ts';

const SRC_A = { id: 'node-a', label: 'Nodo A' };
const SRC_B = { id: 'node-b' };

describe('citationValidator.extractCitations', () => {
  it('extrae citations simples [1] [2]', () => {
    const cs = extractCitations('texto [1] más texto [2]');
    expect(cs.map((c) => c.index)).toEqual([1, 2]);
  });

  it('extrae citations con espacios [ 3 ]', () => {
    const cs = extractCitations('texto [ 3 ]');
    expect(cs[0]?.index).toBe(3);
  });

  it('ignora corchetes no-numéricos [abc]', () => {
    expect(extractCitations('texto [abc] foo').length).toBe(0);
  });

  it('ignora corchetes vacíos []', () => {
    expect(extractCitations('texto [] foo').length).toBe(0);
  });

  it('captura citations consecutivas [1][2]', () => {
    const cs = extractCitations('texto [1][2]');
    expect(cs.map((c) => c.index)).toEqual([1, 2]);
  });

  it('reportea position correctamente', () => {
    const cs = extractCitations('abc [1] def');
    expect(cs[0]?.position).toBe(4);
  });
});

describe('citationValidator.validateResponse — policy required', () => {
  it('respuesta con citation válida → ok', () => {
    const r = validateResponse(
      'Según [1] el DS 594 aplica.',
      [SRC_A],
      'required',
    );
    expect(r.ok).toBe(true);
    expect(r.invalidCitations).toEqual([]);
    expect(r.missingCitations).toEqual([]);
  });

  it('respuesta SIN citation → missingCitations', () => {
    const r = validateResponse(
      'El DS 594 aplica a sustancias químicas.',
      [SRC_A],
      'required',
    );
    expect(r.ok).toBe(false);
    expect(r.missingCitations.length).toBe(1);
    expect(r.missingCitations[0]!.reason).toMatch(/política requiere/i);
  });

  it('citation fuera de rango [5] cuando solo hay 2 sources → invalid', () => {
    const r = validateResponse(
      'Texto [5] inventado.',
      [SRC_A, SRC_B],
      'required',
    );
    expect(r.ok).toBe(false);
    expect(r.invalidCitations.length).toBe(1);
    expect(r.invalidCitations[0]!.index).toBe(5);
    expect(r.invalidCitations[0]!.reason).toMatch(/no existe en la lista/);
  });

  it('citation con índice 0 → invalid (debe ser ≥ 1)', () => {
    const r = validateResponse('Texto [0] malo.', [SRC_A], 'required');
    expect(r.ok).toBe(false);
    expect(r.invalidCitations[0]!.index).toBe(0);
  });

  it('múltiples invalid citations se reportan todas', () => {
    const r = validateResponse(
      'Texto [5] y [10] inventados.',
      [SRC_A],
      'required',
    );
    expect(r.invalidCitations.length).toBe(2);
  });
});

describe('citationValidator.validateResponse — policy optional', () => {
  it('respuesta sin citations → ok (porque es optional)', () => {
    const r = validateResponse('Texto sin citas.', [SRC_A], 'optional');
    expect(r.ok).toBe(true);
    expect(r.missingCitations).toEqual([]);
  });

  it('citation inválida sigue siendo invalid incluso en optional', () => {
    const r = validateResponse('Texto [99] inventado.', [SRC_A], 'optional');
    expect(r.ok).toBe(false);
    expect(r.invalidCitations.length).toBe(1);
  });
});

describe('citationValidator.describeValidationFailure', () => {
  it('ok → "ok"', () => {
    const r = validateResponse('Texto [1].', [SRC_A], 'required');
    expect(describeValidationFailure(r)).toBe('ok');
  });

  it('failure → concatena reasons', () => {
    const r = validateResponse('Texto [99].', [SRC_A], 'required');
    expect(describeValidationFailure(r)).toMatch(/no existe en la lista/);
  });
});
