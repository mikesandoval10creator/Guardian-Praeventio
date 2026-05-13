import { describe, it, expect } from 'vitest';
import {
  buildInvestigationTree,
  classifyCategory,
  extractDeepestChain,
  InvestigationValidationError,
  isShallowAnswer,
  type BuildTreeInput,
} from './investigationMode.js';

function baseInput(): BuildTreeInput {
  return {
    incidentId: 'inc-7',
    rootQuestion: '¿Por qué el trabajador cayó del andamio?',
    root: {
      id: 'n1',
      question: '¿Por qué cayó?',
      answer: 'Perdió equilibrio al apoyarse en una tabla que estaba suelta del andamio.',
      children: [
        {
          id: 'n2',
          question: '¿Por qué estaba suelta la tabla?',
          answer:
            'El procedimiento de armado del andamio no exigía verificación documentada de cada tabla.',
          children: [
            {
              id: 'n3',
              question: '¿Por qué el procedimiento no exigía verificación?',
              answer:
                'El protocolo interno no se actualiza desde 2022 pese a cambios de norma.',
            },
          ],
        },
      ],
    },
  };
}

describe('isShallowAnswer', () => {
  it('detecta respuestas con términos shallow conocidos', () => {
    expect(isShallowAnswer('error humano del operador')).toBe(true);
    expect(isShallowAnswer('mala suerte la verdad')).toBe(true);
  });

  it('detecta respuestas demasiado cortas', () => {
    expect(isShallowAnswer('no')).toBe(true);
    expect(isShallowAnswer('porque sí')).toBe(true);
  });

  it('aprueba respuestas suficientemente desarrolladas', () => {
    expect(
      isShallowAnswer(
        'El supervisor no realizó la verificación previa porque estaba en otra área del proyecto',
      ),
    ).toBe(false);
  });
});

describe('classifyCategory', () => {
  it('mapea palabras clave a 6M', () => {
    expect(classifyCategory('la máquina falló por mantención atrasada')).toBe('machine');
    expect(classifyCategory('el procedimiento no estaba actualizado')).toBe('method');
    expect(classifyCategory('la lluvia hizo resbaloso el piso')).toBe('environment');
    expect(classifyCategory('el material entregado era de otro lote')).toBe('material');
    expect(classifyCategory('la medición de calibración no se hizo')).toBe('measurement');
    expect(classifyCategory('el trabajador no recibió capacitación adecuada')).toBe('man');
  });

  it('cae a "man" cuando no hay keywords', () => {
    expect(classifyCategory('algo pasó')).toBe('man');
  });
});

describe('buildInvestigationTree', () => {
  it('construye árbol con profundidades correctas', () => {
    const tree = buildInvestigationTree(baseInput());
    expect(tree.incidentId).toBe('inc-7');
    expect(tree.root.depth).toBe(0);
    expect(tree.root.children[0].depth).toBe(1);
    expect(tree.root.children[0].children[0].depth).toBe(2);
  });

  it('detecta categoría 6M en cada nodo', () => {
    const tree = buildInvestigationTree(baseInput());
    const n2 = tree.root.children[0];
    expect(n2.category).toBe('method');
  });

  it('sugiere profundizar cuando hay nodo shallow', () => {
    const tree = buildInvestigationTree({
      incidentId: 'inc-9',
      rootQuestion: '¿Por qué chocó la grúa?',
      root: {
        id: 'r1',
        question: '¿Por qué chocó?',
        answer: 'Error humano',
      },
    });
    expect(tree.nextQuestion).not.toBeNull();
    expect(tree.nextQuestion?.reason).toBe('shallow_answer');
    expect(tree.nextQuestion?.targetNodeId).toBe('r1');
  });

  it('sugiere categoría 6M no cubierta cuando todo es profundo', () => {
    const tree = buildInvestigationTree(baseInput());
    expect(tree.nextQuestion?.reason).toBe('uncovered_category');
    expect(['machine', 'material', 'measurement', 'environment']).toContain(
      tree.nextQuestion?.category,
    );
  });

  it('rechaza ids duplicados', () => {
    expect(() =>
      buildInvestigationTree({
        incidentId: 'inc-1',
        rootQuestion: 'q?',
        root: {
          id: 'dup',
          question: 'q?',
          answer: 'respuesta razonablemente larga para no ser shallow',
          children: [{ id: 'dup', question: 'q2?', answer: 'respuesta razonablemente larga' }],
        },
      }),
    ).toThrow(InvestigationValidationError);
  });

  it('rechaza profundidad excesiva (>5)', () => {
    let cursor: import('./investigationMode.js').NodeInput = {
      id: 'd0',
      question: 'q0',
      answer: 'respuesta razonablemente larga uno dos tres cuatro cinco',
    };
    const root = cursor;
    for (let i = 1; i <= 6; i++) {
      const child: import('./investigationMode.js').NodeInput = {
        id: `d${i}`,
        question: `q${i}`,
        answer: 'respuesta razonablemente larga uno dos tres cuatro cinco',
      };
      cursor.children = [child];
      cursor = child;
    }
    expect(() =>
      buildInvestigationTree({ incidentId: 'inc-x', rootQuestion: 'root?', root }),
    ).toThrow(InvestigationValidationError);
  });

  it('es determinista entre invocaciones', () => {
    const a = buildInvestigationTree(baseInput());
    const b = buildInvestigationTree(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('extractDeepestChain', () => {
  it('extrae cadena más profunda de preguntas', () => {
    const tree = buildInvestigationTree(baseInput());
    const chain = extractDeepestChain(tree);
    expect(chain).toEqual([
      '¿Por qué cayó?',
      '¿Por qué estaba suelta la tabla?',
      '¿Por qué el procedimiento no exigía verificación?',
    ]);
  });
});
