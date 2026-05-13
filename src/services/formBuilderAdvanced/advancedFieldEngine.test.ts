import { describe, it, expect } from 'vitest';
import {
  evaluateComputedField,
  validateCrossFieldRules,
  detectCircularDependencies,
  topologicalSortFields,
  evaluateAllComputed,
  AdvancedFieldError,
  __internals,
  type ComputedFieldFormula,
  type CrossFieldValidationRule,
  type AdvancedFormResponse,
} from './advancedFieldEngine.js';

const NOW = new Date('2026-05-13T10:00:00Z');

function formula(
  id: string,
  expression: string,
  dependencies: string[],
  resultKind: ComputedFieldFormula['resultKind'] = 'number',
): ComputedFieldFormula {
  return { fieldId: id, expression, dependencies, resultKind };
}

describe('advancedFieldEngine — tokenizer', () => {
  it('tokeniza números, strings, identifiers, operadores', () => {
    const t = __internals.tokenize("1 + 2.5 == 'hola'");
    // num, op, num, op, str
    expect(t.map((x) => x.kind)).toEqual(['num', 'op', 'num', 'op', 'str']);
  });

  it('soporta ${fieldRef} y field()', () => {
    const t = __internals.tokenize("${age} > 18 && field('hasLicense')");
    expect(t.find((x) => x.kind === 'fieldref')).toEqual({ kind: 'fieldref', value: 'age' });
  });

  it('rechaza caracter desconocido', () => {
    expect(() => __internals.tokenize('a # b')).toThrow(AdvancedFieldError);
  });

  it('rechaza string sin cerrar', () => {
    expect(() => __internals.tokenize("'sin cerrar")).toThrow(/parse_unterminated_string/);
  });

  it('rechaza ${ sin cerrar', () => {
    expect(() => __internals.tokenize('${foo')).toThrow(/parse_unterminated_fieldref/);
  });
});

describe('advancedFieldEngine — evaluateComputedField aritmética', () => {
  it('evalúa suma de dos fields numéricos', () => {
    const f = formula('total', '${a} + ${b}', ['a', 'b']);
    const r = evaluateComputedField(f, [
      { fieldId: 'a', value: 3 },
      { fieldId: 'b', value: 4 },
    ]);
    expect(r).toBe(7);
  });

  it('respeta precedencia de operadores', () => {
    const f = formula('x', '2 + 3 * 4', []);
    expect(evaluateComputedField(f, [])).toBe(14);
  });

  it('división por cero retorna null sin throw', () => {
    const f = formula('x', '${a} / 0', ['a']);
    expect(evaluateComputedField(f, [{ fieldId: 'a', value: 10 }])).toBeNull();
  });

  it('módulo funciona', () => {
    const f = formula('x', '10 % 3', []);
    expect(evaluateComputedField(f, [])).toBe(1);
  });

  it('paréntesis cambian precedencia', () => {
    const f = formula('x', '(2 + 3) * 4', []);
    expect(evaluateComputedField(f, [])).toBe(20);
  });

  it('unary minus funciona', () => {
    const f = formula('x', '-${a}', ['a']);
    expect(evaluateComputedField(f, [{ fieldId: 'a', value: 5 }])).toBe(-5);
  });
});

describe('advancedFieldEngine — coerción de tipos', () => {
  it('coerce boolean kind desde número truthy', () => {
    const f = formula('x', '${a}', ['a'], 'boolean');
    expect(evaluateComputedField(f, [{ fieldId: 'a', value: 1 }])).toBe(true);
    expect(evaluateComputedField(f, [{ fieldId: 'a', value: 0 }])).toBe(false);
  });

  it('coerce string desde número', () => {
    const f = formula('x', '${a}', ['a'], 'string');
    expect(evaluateComputedField(f, [{ fieldId: 'a', value: 42 }])).toBe('42');
  });

  it('coerce number desde string parseable', () => {
    const f = formula('x', '${a}', ['a'], 'number');
    expect(evaluateComputedField(f, [{ fieldId: 'a', value: '3.14' }])).toBe(3.14);
  });

  it('null se preserva', () => {
    const f = formula('x', '${unknown}', ['unknown'], 'number');
    expect(evaluateComputedField(f, [])).toBeNull();
  });
});

describe('advancedFieldEngine — funciones built-in', () => {
  it('now() retorna fecha inyectada como ISO', () => {
    const f = formula('t', 'now()', [], 'string');
    expect(evaluateComputedField(f, [], { now: NOW })).toBe(NOW.toISOString());
  });

  it('today() retorna fecha en YYYY-MM-DD UTC', () => {
    const f = formula('t', 'today()', [], 'string');
    expect(evaluateComputedField(f, [], { now: NOW })).toBe('2026-05-13');
  });

  it('yearsBetween — edad de nacido en 2000-01-01 a 2026-05-13 = 26', () => {
    const f = formula('age', "yearsBetween(${birth}, now())", ['birth'], 'number');
    const r = evaluateComputedField(
      f,
      [{ fieldId: 'birth', value: '2000-01-01T00:00:00Z' }],
      { now: NOW },
    );
    expect(r).toBe(26);
  });

  it('yearsBetween — cumpleaños aún no ocurrido en el año actual', () => {
    const f = formula('age', "yearsBetween(${birth}, now())", ['birth'], 'number');
    // Nacido 2000-12-31, evaluado 2026-05-13 → todavía 25.
    const r = evaluateComputedField(
      f,
      [{ fieldId: 'birth', value: '2000-12-31T00:00:00Z' }],
      { now: NOW },
    );
    expect(r).toBe(25);
  });

  it('monthsBetween', () => {
    const f = formula('m', "monthsBetween('2026-01-01', '2026-05-13')", [], 'number');
    expect(evaluateComputedField(f, [], { now: NOW })).toBe(4);
  });

  it('daysBetween', () => {
    const f = formula('d', "daysBetween('2026-05-01', '2026-05-13')", [], 'number');
    expect(evaluateComputedField(f, [], { now: NOW })).toBe(12);
  });

  it('sum([fields])', () => {
    const f = formula('total', 'sum([${a}, ${b}, ${c}])', ['a', 'b', 'c']);
    const r = evaluateComputedField(f, [
      { fieldId: 'a', value: 1 },
      { fieldId: 'b', value: 2 },
      { fieldId: 'c', value: 3 },
    ]);
    expect(r).toBe(6);
  });

  it('avg([fields]) ignora no-números', () => {
    const f = formula('a', 'avg([${a}, ${b}, ${c}])', ['a', 'b', 'c']);
    const r = evaluateComputedField(f, [
      { fieldId: 'a', value: 10 },
      { fieldId: 'b', value: 20 },
      { fieldId: 'c', value: 'x' },
    ]);
    expect(r).toBe(15);
  });

  it('countTrue cuenta truthy en array', () => {
    const f = formula('c', 'countTrue([${a}, ${b}, ${c}, ${d}])', ['a', 'b', 'c', 'd']);
    const r = evaluateComputedField(f, [
      { fieldId: 'a', value: true },
      { fieldId: 'b', value: false },
      { fieldId: 'c', value: true },
      { fieldId: 'd', value: 0 },
    ]);
    expect(r).toBe(2);
  });

  it('if() funciona como ternario', () => {
    const f = formula('label', "if(${score} >= 50, 'pass', 'fail')", ['score'], 'string');
    expect(evaluateComputedField(f, [{ fieldId: 'score', value: 75 }])).toBe('pass');
    expect(evaluateComputedField(f, [{ fieldId: 'score', value: 30 }])).toBe('fail');
  });
});

describe('advancedFieldEngine — seguridad / sandboxing', () => {
  it('rechaza funciones no permitidas', () => {
    const f = formula('x', 'fetch(${a})', ['a']);
    expect(() => evaluateComputedField(f, [{ fieldId: 'a', value: 'http://x' }])).toThrow(
      /eval_forbidden_function/,
    );
  });

  it('rechaza identificadores sueltos (sin field/${})', () => {
    const f = formula('x', 'process + 1', []);
    expect(() => evaluateComputedField(f, [])).toThrow(/parse_bare_identifier/);
  });

  it('NO ejecuta código JS arbitrario — eval() en expression es solo un function name', () => {
    const f = formula('x', "eval('1+1')", []);
    expect(() => evaluateComputedField(f, [])).toThrow(/eval_forbidden_function/);
  });

  it('expresión vacía falla limpio', () => {
    const f = formula('x', '   ', []);
    expect(() => evaluateComputedField(f, [])).toThrow(/parse_empty/);
  });
});

describe('advancedFieldEngine — validateCrossFieldRules', () => {
  it('detecta predicado satisfecho', () => {
    const rules: CrossFieldValidationRule[] = [
      {
        ruleId: 'r1',
        fields: ['start', 'end'],
        predicate: "daysBetween(${start}, ${end}) >= 0",
        errorMessage: 'end debe ser ≥ start',
      },
    ];
    const findings = validateCrossFieldRules(rules, [
      { fieldId: 'start', value: '2026-05-01' },
      { fieldId: 'end', value: '2026-05-10' },
    ]);
    expect(findings).toEqual([{ ruleId: 'r1', passed: true, errorMessage: undefined }]);
  });

  it('detecta predicado violado y emite errorMessage', () => {
    const rules: CrossFieldValidationRule[] = [
      {
        ruleId: 'r1',
        fields: ['a', 'b'],
        predicate: '${a} > ${b}',
        errorMessage: 'a debe ser mayor que b',
      },
    ];
    const findings = validateCrossFieldRules(rules, [
      { fieldId: 'a', value: 1 },
      { fieldId: 'b', value: 5 },
    ]);
    expect(findings[0]).toMatchObject({ ruleId: 'r1', passed: false, errorMessage: 'a debe ser mayor que b' });
  });

  it('captura errores de parse como passed:false', () => {
    const rules: CrossFieldValidationRule[] = [
      { ruleId: 'bad', fields: [], predicate: '$%@!', errorMessage: 'x' },
    ];
    const findings = validateCrossFieldRules(rules, []);
    expect(findings[0].passed).toBe(false);
    expect(findings[0].errorMessage).toMatch(/parse_error/);
  });

  it('AND lógico funciona con short-circuit', () => {
    const rules: CrossFieldValidationRule[] = [
      {
        ruleId: 'r',
        fields: ['a', 'b'],
        predicate: '${a} && !${b}',
        errorMessage: 'fail',
      },
    ];
    const findings = validateCrossFieldRules(rules, [
      { fieldId: 'a', value: true },
      { fieldId: 'b', value: false },
    ]);
    expect(findings[0].passed).toBe(true);
  });
});

describe('advancedFieldEngine — detectCircularDependencies', () => {
  it('grafo acíclico retorna []', () => {
    const formulas = [
      formula('a', '${b} + 1', ['b']),
      formula('b', '${c} + 1', ['c']),
      formula('c', '0', []),
    ];
    expect(detectCircularDependencies(formulas)).toEqual([]);
  });

  it('detecta ciclo directo a->b->a', () => {
    const formulas = [
      formula('a', '${b}', ['b']),
      formula('b', '${a}', ['a']),
    ];
    const cyclic = detectCircularDependencies(formulas);
    expect(cyclic).toContain('a');
    expect(cyclic).toContain('b');
  });

  it('detecta self-loop', () => {
    const formulas = [formula('x', '${x} + 1', ['x'])];
    expect(detectCircularDependencies(formulas)).toContain('x');
  });

  it('ignora dependencias a fields no computados', () => {
    // 'input' no está en formulas → no es parte del grafo
    const formulas = [formula('a', '${input} * 2', ['input'])];
    expect(detectCircularDependencies(formulas)).toEqual([]);
  });
});

describe('advancedFieldEngine — topologicalSortFields', () => {
  it('ordena fields por dependencias', () => {
    const formulas = [
      formula('total', '${subtotal} + ${tax}', ['subtotal', 'tax']),
      formula('tax', '${subtotal} * 0.19', ['subtotal']),
      formula('subtotal', '${a} + ${b}', ['a', 'b']),
    ];
    const order = topologicalSortFields(formulas, ['a', 'b']);
    expect(order.indexOf('subtotal')).toBeLessThan(order.indexOf('tax'));
    expect(order.indexOf('tax')).toBeLessThan(order.indexOf('total'));
  });

  it('lanza error si hay ciclo', () => {
    const formulas = [
      formula('a', '${b}', ['b']),
      formula('b', '${a}', ['a']),
    ];
    expect(() => topologicalSortFields(formulas)).toThrow(/topo_cycle/);
  });
});

describe('advancedFieldEngine — evaluateAllComputed', () => {
  it('propaga resultados a fields downstream', () => {
    const formulas = [
      formula('subtotal', '${a} + ${b}', ['a', 'b']),
      formula('tax', '${subtotal} * 0.19', ['subtotal']),
      formula('total', '${subtotal} + ${tax}', ['subtotal', 'tax']),
    ];
    const responses: AdvancedFormResponse[] = [
      { fieldId: 'a', value: 100 },
      { fieldId: 'b', value: 50 },
    ];
    const results = evaluateAllComputed(formulas, responses, { otherFieldIds: ['a', 'b'] });
    expect(results.subtotal).toBe(150);
    expect(results.tax).toBeCloseTo(28.5);
    expect(results.total).toBeCloseTo(178.5);
  });

  it('caso realista — auto_calculated_age desde fecha de nacimiento', () => {
    const formulas = [
      formula('worker_age', "yearsBetween(${birth_date}, now())", ['birth_date'], 'number'),
      formula(
        'requires_extra_exams',
        '${worker_age} >= 55',
        ['worker_age'],
        'boolean',
      ),
    ];
    const responses: AdvancedFormResponse[] = [
      { fieldId: 'birth_date', value: '1965-06-01T00:00:00Z' },
    ];
    const results = evaluateAllComputed(formulas, responses, {
      now: NOW,
      otherFieldIds: ['birth_date'],
    });
    expect(results.worker_age).toBe(60);
    expect(results.requires_extra_exams).toBe(true);
  });
});
