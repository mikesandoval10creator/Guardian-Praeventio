import { describe, it, expect } from 'vitest';
import {
  declareStoppage,
  markPreconditionFulfilled,
  resume,
  cancelStoppage,
  summarize,
  StoppageValidationError,
  type DeclareStoppageInput,
} from './stoppageEngine.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function input(over: Partial<DeclareStoppageInput> = {}): DeclareStoppageInput {
  return {
    id: 's1',
    projectId: 'p1',
    category: 'hallazgo_critico',
    scope: 'zone',
    scopeTargetId: 'zone-soldadura',
    reason: 'Detectado riesgo eléctrico en panel principal',
    declaredByUid: 'prev-1',
    declaredByRole: 'prevencionista',
    resumptionPreconditions: [
      { id: 'pc1', label: 'Electricista valida aislación' },
      { id: 'pc2', label: 'Foto de check final' },
    ],
    now: NOW,
    ...over,
  };
}

describe('declareStoppage', () => {
  it('crea con status active + preconditions todas pending', () => {
    const s = declareStoppage(input());
    expect(s.status).toBe('active');
    expect(s.resumptionPreconditions).toHaveLength(2);
    expect(s.resumptionPreconditions.every((p) => !p.fulfilled)).toBe(true);
  });

  it('rechaza reason corto', () => {
    expect(() => declareStoppage(input({ reason: 'corto' }))).toThrow(
      /REASON_TOO_SHORT/,
    );
  });

  it('rechaza role no autorizado para non-detencion_voluntaria', () => {
    expect(() =>
      declareStoppage(input({ declaredByRole: 'operador' })),
    ).toThrow(/ROLE_NOT_ALLOWED/);
  });

  it('permite detencion_voluntaria con cualquier role (stop-work authority)', () => {
    const s = declareStoppage(
      input({ category: 'detencion_voluntaria', declaredByRole: 'operador' }),
    );
    expect(s.status).toBe('active');
  });

  it('rechaza sin preconditions', () => {
    expect(() =>
      declareStoppage(input({ resumptionPreconditions: [] })),
    ).toThrow(/NO_PRECONDITIONS/);
  });
});

describe('markPreconditionFulfilled', () => {
  it('marca una precondition como fulfilled', () => {
    const s = markPreconditionFulfilled(
      declareStoppage(input()),
      'pc1',
      'elec-1',
      'gs://foto.jpg',
      NOW,
    );
    const pc = s.resumptionPreconditions.find((p) => p.id === 'pc1');
    expect(pc?.fulfilled).toBe(true);
    expect(pc?.evidenceUrl).toBe('gs://foto.jpg');
    expect(s.status).toBe('active'); // todavía falta pc2
  });

  it('todas fulfilled → status=pending_resumption', () => {
    let s = declareStoppage(input());
    s = markPreconditionFulfilled(s, 'pc1', 'u1', undefined, NOW);
    s = markPreconditionFulfilled(s, 'pc2', 'u2', undefined, NOW);
    expect(s.status).toBe('pending_resumption');
  });

  it('rechaza modificar stoppage resumed', () => {
    let s = declareStoppage(input());
    s = markPreconditionFulfilled(s, 'pc1', 'u', undefined, NOW);
    s = markPreconditionFulfilled(s, 'pc2', 'u', undefined, NOW);
    s = resume(s, 'sup-1', 'supervisor', NOW);
    expect(() => markPreconditionFulfilled(s, 'pc1', 'u', undefined, NOW)).toThrow(
      /NOT_OPEN/,
    );
  });
});

describe('resume', () => {
  it('reanuda cuando preconditions todas fulfilled', () => {
    let s = declareStoppage(input());
    s = markPreconditionFulfilled(s, 'pc1', 'u', undefined, NOW);
    s = markPreconditionFulfilled(s, 'pc2', 'u', undefined, NOW);
    const r = resume(s, 'sup-1', 'supervisor', NOW);
    expect(r.status).toBe('resumed');
    expect(r.resumedAt).toBe(NOW.toISOString());
  });

  it('rechaza reanudar si preconditions no completas', () => {
    let s = declareStoppage(input());
    s = markPreconditionFulfilled(s, 'pc1', 'u', undefined, NOW);
    expect(() => resume(s, 'sup-1', 'supervisor', NOW)).toThrow(
      /NOT_PENDING_RESUMPTION/,
    );
  });

  it('rechaza role no autorizado', () => {
    let s = declareStoppage(input());
    s = markPreconditionFulfilled(s, 'pc1', 'u', undefined, NOW);
    s = markPreconditionFulfilled(s, 'pc2', 'u', undefined, NOW);
    expect(() => resume(s, 'op-1', 'operador', NOW)).toThrow(/ROLE_NOT_ALLOWED/);
  });
});

describe('cancelStoppage', () => {
  it('cancela active', () => {
    const c = cancelStoppage(
      declareStoppage(input()),
      'admin',
      'duplicada con otra ya activa',
      NOW,
    );
    expect(c.status).toBe('cancelled');
  });

  it('rechaza cancelar resumed', () => {
    let s = declareStoppage(input());
    s = markPreconditionFulfilled(s, 'pc1', 'u', undefined, NOW);
    s = markPreconditionFulfilled(s, 'pc2', 'u', undefined, NOW);
    s = resume(s, 'sup', 'supervisor', NOW);
    expect(() => cancelStoppage(s, 'admin', 'razón válida xxx', NOW)).toThrow(
      /INVALID_TRANSITION/,
    );
  });
});

describe('summarize', () => {
  it('cuenta por status + longestActiveHours', () => {
    const s1 = declareStoppage(
      input({
        id: 'a',
        // declared 5h atrás
        now: new Date(NOW.getTime() - 5 * 3_600_000),
      }),
    );
    const s2 = cancelStoppage(declareStoppage(input({ id: 'b' })), 'admin', 'duplicada por error de operador', NOW);
    const summary = summarize([s1, s2], NOW);
    expect(summary.total).toBe(2);
    expect(summary.active).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.longestActiveHours).toBe(5);
  });
});
