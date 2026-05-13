import { describe, it, expect } from 'vitest';
import {
  buildRaciMatrix,
  validateRaci,
  detectRoleOverload,
  findCriticalGaps,
  listUidsInMatrices,
  summarizeRaciHealth,
  ACCOUNTABLE_OVERLOAD_THRESHOLD,
  INFORMED_NOISE_THRESHOLD,
  TOTAL_ROLES_OVERLOAD_THRESHOLD,
  type RaciMatrix,
  type TaskRoleAssignment,
  type RaciRole,
} from './raciMatrixEngine.js';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function a(taskId: string, uid: string, role: RaciRole): TaskRoleAssignment {
  return { taskId, uid, role };
}

function fullMatrix(taskId: string): TaskRoleAssignment[] {
  return [
    a(taskId, 'u-accountable', 'accountable'),
    a(taskId, 'u-responsible', 'responsible'),
    a(taskId, 'u-consulted', 'consulted'),
    a(taskId, 'u-informed', 'informed'),
  ];
}

// ────────────────────────────────────────────────────────────────────────
// buildRaciMatrix
// ────────────────────────────────────────────────────────────────────────

describe('buildRaciMatrix', () => {
  it('construye matriz válida con 1 accountable + 1 responsible + opcionales', () => {
    const m = buildRaciMatrix('t1', 'Inspección de andamios', fullMatrix('t1'));
    expect(m.taskId).toBe('t1');
    expect(m.taskTitle).toBe('Inspección de andamios');
    expect(m.valid).toBe(true);
    expect(m.violations).toEqual([]);
    expect(m.assignments).toHaveLength(4);
  });

  it('filtra asignaciones de otros taskId (no contamina)', () => {
    const m = buildRaciMatrix('t1', 'A', [
      a('t1', 'u1', 'accountable'),
      a('t1', 'u2', 'responsible'),
      a('t2', 'u3', 'consulted'), // ← foránea, debe filtrarse
    ]);
    expect(m.assignments).toHaveLength(2);
    expect(m.assignments.every((x) => x.taskId === 't1')).toBe(true);
  });

  it('deduplica pares (uid, role) repetidos', () => {
    const m = buildRaciMatrix('t1', 'A', [
      a('t1', 'u1', 'accountable'),
      a('t1', 'u1', 'accountable'), // ← duplicado exacto
      a('t1', 'u2', 'responsible'),
    ]);
    expect(m.assignments).toHaveLength(2);
  });

  it('marca matriz como crítica si se pasa option', () => {
    const m = buildRaciMatrix('t1', 'A', fullMatrix('t1'), { critical: true });
    expect(m.critical).toBe(true);
  });

  it('matriz crítica sin consulted dispara violación consulted_missing_for_critical', () => {
    const m = buildRaciMatrix(
      't1',
      'Tarea crítica sin consulted',
      [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u2', 'responsible'),
        a('t1', 'u3', 'informed'),
      ],
      { critical: true },
    );
    expect(m.valid).toBe(false);
    expect(m.violations.map((v) => v.kind)).toContain(
      'consulted_missing_for_critical',
    );
  });

  it('matriz NO crítica sin consulted sigue siendo válida', () => {
    const m = buildRaciMatrix('t1', 'A', [
      a('t1', 'u1', 'accountable'),
      a('t1', 'u2', 'responsible'),
    ]);
    expect(m.valid).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// validateRaci — reglas individuales
// ────────────────────────────────────────────────────────────────────────

describe('validateRaci — accountable rules', () => {
  it('flagea no_accountable cuando falta accountable', () => {
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments: [a('t1', 'u1', 'responsible')],
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.kind)).toContain('no_accountable');
  });

  it('flagea multiple_accountable cuando hay 2+', () => {
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments: [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u2', 'accountable'),
        a('t1', 'u3', 'responsible'),
      ],
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.kind)).toContain('multiple_accountable');
  });
});

describe('validateRaci — responsible rule', () => {
  it('flagea no_responsible cuando falta responsible', () => {
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments: [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u2', 'consulted'),
      ],
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.kind)).toContain('no_responsible');
  });

  it('permite múltiples responsibles', () => {
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments: [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u2', 'responsible'),
        a('t1', 'u3', 'responsible'),
        a('t1', 'u4', 'responsible'),
      ],
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.valid).toBe(true);
  });
});

describe('validateRaci — single role per uid', () => {
  it('flagea role_overload_single_uid si mismo uid tiene 2 roles', () => {
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments: [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u1', 'responsible'), // ← mismo uid, 2 roles
      ],
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.valid).toBe(false);
    const v = r.violations.find((x) => x.kind === 'role_overload_single_uid');
    expect(v).toBeDefined();
    expect(v?.detail).toContain('u1');
  });

  it('no flagea overload si uids son diferentes', () => {
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments: [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u2', 'responsible'),
        a('t1', 'u3', 'consulted'),
      ],
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(
      r.violations.some((v) => v.kind === 'role_overload_single_uid'),
    ).toBe(false);
  });
});

describe('validateRaci — informed_too_many', () => {
  it(`no flagea con ≤${INFORMED_NOISE_THRESHOLD} informed`, () => {
    const assignments = [
      a('t1', 'u-acc', 'accountable'),
      a('t1', 'u-resp', 'responsible'),
    ];
    for (let i = 0; i < INFORMED_NOISE_THRESHOLD; i++) {
      assignments.push(a('t1', `u-i-${i}`, 'informed'));
    }
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments,
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.violations.some((v) => v.kind === 'informed_too_many')).toBe(
      false,
    );
  });

  it(`flagea informed_too_many con >${INFORMED_NOISE_THRESHOLD} informed`, () => {
    const assignments = [
      a('t1', 'u-acc', 'accountable'),
      a('t1', 'u-resp', 'responsible'),
    ];
    for (let i = 0; i < INFORMED_NOISE_THRESHOLD + 5; i++) {
      assignments.push(a('t1', `u-i-${i}`, 'informed'));
    }
    const m: RaciMatrix = {
      taskId: 't1',
      taskTitle: 'A',
      assignments,
      valid: true,
      violations: [],
    };
    const r = validateRaci(m);
    expect(r.violations.some((v) => v.kind === 'informed_too_many')).toBe(
      true,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// detectRoleOverload
// ────────────────────────────────────────────────────────────────────────

describe('detectRoleOverload', () => {
  it('cuenta correctamente roles por tipo para un uid', () => {
    const matrices: RaciMatrix[] = [
      buildRaciMatrix('t1', 'A', [
        a('t1', 'capataz-1', 'accountable'),
        a('t1', 'u2', 'responsible'),
      ]),
      buildRaciMatrix('t2', 'B', [
        a('t2', 'capataz-1', 'responsible'),
        a('t2', 'u3', 'accountable'),
      ]),
      buildRaciMatrix('t3', 'C', [
        a('t3', 'capataz-1', 'consulted'),
        a('t3', 'u4', 'accountable'),
        a('t3', 'u5', 'responsible'),
      ]),
    ];
    const r = detectRoleOverload(matrices, 'capataz-1');
    expect(r.uid).toBe('capataz-1');
    expect(r.byRole.accountable).toBe(1);
    expect(r.byRole.responsible).toBe(1);
    expect(r.byRole.consulted).toBe(1);
    expect(r.byRole.informed).toBe(0);
    expect(r.totalRoles).toBe(3);
    expect(r.criticalRoleCount).toBe(2);
    expect(r.overloaded).toBe(false);
  });

  it(`marca overloaded si >${ACCOUNTABLE_OVERLOAD_THRESHOLD} accountable`, () => {
    const matrices: RaciMatrix[] = [];
    for (let i = 0; i < ACCOUNTABLE_OVERLOAD_THRESHOLD + 1; i++) {
      matrices.push(
        buildRaciMatrix(`t${i}`, `Task ${i}`, [
          a(`t${i}`, 'super-jefe', 'accountable'),
          a(`t${i}`, `u-r-${i}`, 'responsible'),
        ]),
      );
    }
    const r = detectRoleOverload(matrices, 'super-jefe');
    expect(r.byRole.accountable).toBe(ACCOUNTABLE_OVERLOAD_THRESHOLD + 1);
    expect(r.overloaded).toBe(true);
  });

  it(`marca overloaded si totalRoles >${TOTAL_ROLES_OVERLOAD_THRESHOLD}`, () => {
    const matrices: RaciMatrix[] = [];
    // 30 tasks donde 'spammer' es informed → 30 totalRoles, sin accountable spike.
    for (let i = 0; i < TOTAL_ROLES_OVERLOAD_THRESHOLD + 5; i++) {
      matrices.push(
        buildRaciMatrix(`t${i}`, `Task ${i}`, [
          a(`t${i}`, `u-acc-${i}`, 'accountable'),
          a(`t${i}`, `u-resp-${i}`, 'responsible'),
          a(`t${i}`, 'spammer', 'informed'),
        ]),
      );
    }
    const r = detectRoleOverload(matrices, 'spammer');
    expect(r.byRole.informed).toBe(TOTAL_ROLES_OVERLOAD_THRESHOLD + 5);
    expect(r.byRole.accountable).toBe(0);
    expect(r.overloaded).toBe(true);
  });

  it('devuelve ceros para uid inexistente', () => {
    const matrices = [
      buildRaciMatrix('t1', 'A', [
        a('t1', 'u1', 'accountable'),
        a('t1', 'u2', 'responsible'),
      ]),
    ];
    const r = detectRoleOverload(matrices, 'ghost');
    expect(r.totalRoles).toBe(0);
    expect(r.criticalRoleCount).toBe(0);
    expect(r.overloaded).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// findCriticalGaps
// ────────────────────────────────────────────────────────────────────────

describe('findCriticalGaps', () => {
  it('detecta task sin accountable', () => {
    const matrices = [
      buildRaciMatrix('t1', 'A', [a('t1', 'u1', 'responsible')]),
    ];
    const gaps = findCriticalGaps(matrices);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.taskId).toBe('t1');
    expect(gaps[0]?.missingRoles).toContain('accountable');
  });

  it('detecta task sin responsible', () => {
    const matrices = [
      buildRaciMatrix('t1', 'A', [a('t1', 'u1', 'accountable')]),
    ];
    const gaps = findCriticalGaps(matrices);
    expect(gaps[0]?.missingRoles).toContain('responsible');
  });

  it('detecta consulted faltante en tarea crítica', () => {
    const matrices = [
      buildRaciMatrix(
        't1',
        'Tarea crítica',
        [
          a('t1', 'u1', 'accountable'),
          a('t1', 'u2', 'responsible'),
        ],
        { critical: true },
      ),
    ];
    const gaps = findCriticalGaps(matrices);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.missingRoles).toContain('consulted');
  });

  it('no reporta gap para matriz completa válida', () => {
    const matrices = [buildRaciMatrix('t1', 'A', fullMatrix('t1'))];
    const gaps = findCriticalGaps(matrices);
    expect(gaps).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// listUidsInMatrices + summarizeRaciHealth
// ────────────────────────────────────────────────────────────────────────

describe('listUidsInMatrices', () => {
  it('devuelve uids únicos ordenados', () => {
    const matrices = [
      buildRaciMatrix('t1', 'A', [
        a('t1', 'beta', 'accountable'),
        a('t1', 'alfa', 'responsible'),
      ]),
      buildRaciMatrix('t2', 'B', [
        a('t2', 'alfa', 'accountable'),
        a('t2', 'gamma', 'responsible'),
      ]),
    ];
    expect(listUidsInMatrices(matrices)).toEqual(['alfa', 'beta', 'gamma']);
  });
});

describe('summarizeRaciHealth', () => {
  it('cuenta matrices válidas, gaps y uids overloaded', () => {
    const matrices: RaciMatrix[] = [];
    // 3 matrices válidas.
    for (let i = 0; i < 3; i++) {
      matrices.push(buildRaciMatrix(`good-${i}`, 'OK', fullMatrix(`good-${i}`)));
    }
    // 1 matriz con gap (sin accountable).
    matrices.push(
      buildRaciMatrix('bad-1', 'Sin accountable', [
        a('bad-1', 'u1', 'responsible'),
      ]),
    );
    // 1 matriz donde 'overlord' es accountable >threshold veces.
    for (let i = 0; i < ACCOUNTABLE_OVERLOAD_THRESHOLD + 1; i++) {
      matrices.push(
        buildRaciMatrix(`load-${i}`, `Load ${i}`, [
          a(`load-${i}`, 'overlord', 'accountable'),
          a(`load-${i}`, `u-r-${i}`, 'responsible'),
        ]),
      );
    }

    const sum = summarizeRaciHealth(matrices);
    expect(sum.totalMatrices).toBe(matrices.length);
    expect(sum.validMatrices).toBe(
      matrices.length - 1, // sólo 'bad-1' es inválida
    );
    expect(sum.criticalGapCount).toBe(1);
    expect(sum.overloadedUids).toContain('overlord');
  });

  it('matriz vacía devuelve totales en cero', () => {
    const sum = summarizeRaciHealth([]);
    expect(sum.totalMatrices).toBe(0);
    expect(sum.validMatrices).toBe(0);
    expect(sum.criticalGapCount).toBe(0);
    expect(sum.overloadedUids).toEqual([]);
  });
});
