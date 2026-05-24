// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §MOC — Workflow approval ISO 45001 §8.1.3.
//
// ISO 45001 §8.1.3 (Management of Change) exige que cualquier cambio
// significativo en operaciones SH&E sea revisado + aprobado por
// stakeholders relevantes ANTES de implementarse. La versión 1 del
// servicio (operationalChangeService.ts) crea changes que entran en
// efecto inmediatamente — eso NO cumple §8.1.3.
//
// Esta extensión agrega:
//   1. Una máquina de estados:
//      draft → pending_review → approved/rejected → in_effect → verified
//      con `reverted` como terminal escape valve desde cualquier estado activo.
//   2. Una array `approvals` que registra cada decisión (HSE / supervisor /
//      gerente) con comentario auditable.
//   3. Quorum rules: high/medium impact requieren al menos 1 HSE + 1
//      supervisor/gerente. Low impact: solo HSE.
//   4. Verification post-implementación: registrar si el cambio fue efectivo
//      o si se requiere acción correctiva (cierre del ciclo PDCA).

import { describe, it, expect } from 'vitest';
import {
  declareChange,
  submitForReview,
  recordApproval,
  activateChange,
  verifyEffectiveness,
  revertChange,
  meetsApprovalQuorum,
  isInLiveState,
  type DeclareChangeInput,
} from './operationalChangeService.js';

const NOW = new Date('2026-05-24T10:00:00Z');
const NOW_PLUS_1H = new Date('2026-05-24T11:00:00Z');
const NOW_PLUS_2H = new Date('2026-05-24T12:00:00Z');
const NOW_PLUS_3H = new Date('2026-05-24T13:00:00Z');
const NOW_PLUS_2D = new Date('2026-05-26T10:00:00Z');

function input(over: Partial<DeclareChangeInput> = {}): DeclareChangeInput {
  return {
    projectId: 'proj-A',
    kind: 'procedure',
    whatChanged: 'Procedimiento de izaje crítico',
    previousValue: 'PROC-IZ-001 v2',
    newValue: 'PROC-IZ-001 v3',
    rationale: 'Incorpora validación de radio de exclusión por radio operador',
    impact: 'high',
    affectedWorkerUids: ['w1', 'w2', 'w3'],
    declaredByUid: 'prev-1',
    declaredByRole: 'prevencionista',
    effectiveFrom: '2026-05-25T08:00:00Z',
    now: NOW,
    ...over,
  };
}

describe('declareChange — status inicial draft', () => {
  it('los changes nuevos arrancan en status=draft (no inmediatamente en efecto)', () => {
    const c = declareChange(input());
    expect(c.status).toBe('draft');
    expect(c.approvals).toEqual([]);
  });
});

describe('submitForReview — draft → pending_review', () => {
  it('transita un draft a pending_review', () => {
    const c = submitForReview(declareChange(input()), 'prev-1', NOW_PLUS_1H);
    expect(c.status).toBe('pending_review');
    expect(c.submittedForReviewAt).toBe(NOW_PLUS_1H.toISOString());
  });

  it('rechaza submit desde status distinto de draft', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    expect(() => submitForReview(c, 'prev-1', NOW_PLUS_2H)).toThrow(/NOT_DRAFT/);
  });
});

describe('recordApproval — pending_review → approved/rejected', () => {
  it('una sola aprobación HSE para impact=low pasa a approved', () => {
    let c = declareChange(input({ impact: 'low', affectedWorkerUids: [] }));
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'Cambio menor, evaluado contra checklist DS 76 art 14',
      now: NOW_PLUS_2H,
    });
    expect(c.status).toBe('approved');
    expect(c.approvals).toHaveLength(1);
  });

  it('impact=high necesita HSE + supervisor — solo HSE deja en pending_review', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE — controles compensatorios adecuados',
      now: NOW_PLUS_2H,
    });
    expect(c.status).toBe('pending_review');
    expect(c.approvals).toHaveLength(1);
  });

  it('impact=high con HSE + supervisor pasa a approved', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE — controles compensatorios adecuados',
      now: NOW_PLUS_2H,
    });
    c = recordApproval(c, {
      approverUid: 'sup-1',
      approverRole: 'supervisor',
      decision: 'approved',
      comment: 'OK operacionalmente — turno tarde notificado',
      now: NOW_PLUS_3H,
    });
    expect(c.status).toBe('approved');
    expect(c.approvals).toHaveLength(2);
  });

  it('un rechazo HSE marca el change como rejected (terminal)', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'rejected',
      comment: 'Riesgo residual sigue alto — requiere control adicional antes de re-someter',
      now: NOW_PLUS_2H,
    });
    expect(c.status).toBe('rejected');
  });

  it('rechaza recordApproval desde status != pending_review', () => {
    const c = declareChange(input());
    expect(() =>
      recordApproval(c, {
        approverUid: 'hse-1',
        approverRole: 'prevencionista',
        decision: 'approved',
        comment: 'Comentario suficientemente largo',
        now: NOW_PLUS_2H,
      }),
    ).toThrow(/NOT_PENDING_REVIEW/);
  });

  it('rechaza aprobación duplicada del mismo approver', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE',
      now: NOW_PLUS_2H,
    });
    expect(() =>
      recordApproval(c, {
        approverUid: 'hse-1',
        approverRole: 'prevencionista',
        decision: 'approved',
        comment: 'OK desde óptica HSE — segunda vez',
        now: NOW_PLUS_3H,
      }),
    ).toThrow(/DUPLICATE_APPROVER/);
  });

  it('rechaza role NO autorizado para approval', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    expect(() =>
      // Cast a unknown→ApproverRole para testear el guard del service.
      // En prod, este path lo bloquea TypeScript en compile time + el
      // runtime check `APPROVER_ROLE_SET.has()` lo bloquea si llega.
      recordApproval(c, {
        approverUid: 'op-1',
        approverRole: 'operador' as unknown as 'prevencionista',
        decision: 'approved',
        comment: 'Comentario suficientemente largo',
        now: NOW_PLUS_2H,
      }),
    ).toThrow(/ROLE_NOT_APPROVER/);
  });

  it('rechaza comentario corto en approval', () => {
    let c = declareChange(input());
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    expect(() =>
      recordApproval(c, {
        approverUid: 'hse-1',
        approverRole: 'prevencionista',
        decision: 'approved',
        comment: 'corto',
        now: NOW_PLUS_2H,
      }),
    ).toThrow(/COMMENT_TOO_SHORT/);
  });
});

describe('meetsApprovalQuorum', () => {
  it('low impact: 1 HSE approval basta', () => {
    let c = declareChange(input({ impact: 'low', affectedWorkerUids: [] }));
    expect(meetsApprovalQuorum(c)).toBe(false);
    c = {
      ...c,
      approvals: [
        {
          approverUid: 'hse-1',
          approverRole: 'prevencionista',
          decision: 'approved',
          decidedAt: NOW.toISOString(),
          comment: 'OK',
        },
      ],
    };
    expect(meetsApprovalQuorum(c)).toBe(true);
  });

  it('high impact: requiere HSE + supervisor o gerente', () => {
    const base = declareChange(input());
    expect(meetsApprovalQuorum(base)).toBe(false);
    const hseOnly = {
      ...base,
      approvals: [
        {
          approverUid: 'hse-1',
          approverRole: 'prevencionista' as const,
          decision: 'approved' as const,
          decidedAt: NOW.toISOString(),
          comment: 'OK',
        },
      ],
    };
    expect(meetsApprovalQuorum(hseOnly)).toBe(false);
    const both = {
      ...base,
      approvals: [
        ...hseOnly.approvals,
        {
          approverUid: 'sup-1',
          approverRole: 'supervisor' as const,
          decision: 'approved' as const,
          decidedAt: NOW.toISOString(),
          comment: 'OK',
        },
      ],
    };
    expect(meetsApprovalQuorum(both)).toBe(true);
  });
});

describe('activateChange — approved → in_effect (after effectiveFrom)', () => {
  it('transita approved → in_effect cuando effectiveFrom <= now', () => {
    let c = declareChange(input({ effectiveFrom: '2026-05-25T08:00:00Z' }));
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE',
      now: NOW_PLUS_2H,
    });
    c = recordApproval(c, {
      approverUid: 'sup-1',
      approverRole: 'supervisor',
      decision: 'approved',
      comment: 'OK operacionalmente',
      now: NOW_PLUS_3H,
    });
    // effectiveFrom es 2026-05-25, now=2026-05-26 (2 days later)
    c = activateChange(c, 'sup-1', NOW_PLUS_2D);
    expect(c.status).toBe('in_effect');
    expect(c.activatedAt).toBe(NOW_PLUS_2D.toISOString());
  });

  it('rechaza activate si effectiveFrom > now (no es hora todavía)', () => {
    let c = declareChange(input({ effectiveFrom: '2099-01-01T00:00:00Z' }));
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE — sin observaciones',
      now: NOW_PLUS_2H,
    });
    c = recordApproval(c, {
      approverUid: 'sup-1',
      approverRole: 'supervisor',
      decision: 'approved',
      comment: 'OK operacionalmente — turno notificado',
      now: NOW_PLUS_3H,
    });
    expect(() => activateChange(c, 'sup-1', NOW_PLUS_2D)).toThrow(/EFFECTIVE_FROM_FUTURE/);
  });

  it('rechaza activate desde status != approved', () => {
    const c = declareChange(input());
    expect(() => activateChange(c, 'sup-1', NOW_PLUS_2D)).toThrow(/NOT_APPROVED/);
  });
});

describe('verifyEffectiveness — in_effect → verified', () => {
  function bringToInEffect(): ReturnType<typeof declareChange> {
    let c = declareChange(input({ effectiveFrom: '2026-05-25T08:00:00Z' }));
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE — sin observaciones',
      now: NOW_PLUS_2H,
    });
    c = recordApproval(c, {
      approverUid: 'sup-1',
      approverRole: 'supervisor',
      decision: 'approved',
      comment: 'OK operacionalmente — turno notificado',
      now: NOW_PLUS_3H,
    });
    c = activateChange(c, 'sup-1', NOW_PLUS_2D);
    return c;
  }

  it('verified=true cierra el ciclo PDCA (in_effect → verified)', () => {
    let c = bringToInEffect();
    c = verifyEffectiveness(c, {
      verifierUid: 'hse-1',
      effective: true,
      observations: 'Auditoría post-implementación: ninguna observación, controles operando',
      now: NOW_PLUS_2D,
    });
    expect(c.status).toBe('verified');
    expect(c.verification?.effective).toBe(true);
    expect(c.verification?.verifierUid).toBe('hse-1');
  });

  it('verified=false mantiene status in_effect pero registra el flag corrective_action_required', () => {
    let c = bringToInEffect();
    c = verifyEffectiveness(c, {
      verifierUid: 'hse-1',
      effective: false,
      observations: 'Auditoría: 2 de 3 turnos no aplican el nuevo procedimiento — re-capacitación urgente',
      now: NOW_PLUS_2D,
    });
    expect(c.status).toBe('in_effect');
    expect(c.verification?.effective).toBe(false);
    expect(c.verification?.observations).toContain('re-capacitación');
  });

  it('rechaza verify desde status != in_effect', () => {
    const c = declareChange(input());
    expect(() =>
      verifyEffectiveness(c, {
        verifierUid: 'hse-1',
        effective: true,
        observations: 'Observación con largo suficiente para pasar validación',
        now: NOW_PLUS_2D,
      }),
    ).toThrow(/NOT_IN_EFFECT/);
  });

  it('rechaza observations cortas', () => {
    const c = bringToInEffect();
    expect(() =>
      verifyEffectiveness(c, {
        verifierUid: 'hse-1',
        effective: true,
        observations: 'ok',
        now: NOW_PLUS_2D,
      }),
    ).toThrow(/OBSERVATIONS_TOO_SHORT/);
  });
});

describe('isInLiveState — helpers de status', () => {
  it('in_effect y verified son live; draft/pending/approved/rejected/reverted no', () => {
    const base = declareChange(input());
    expect(isInLiveState(base)).toBe(false); // draft
    expect(isInLiveState({ ...base, status: 'pending_review' })).toBe(false);
    expect(isInLiveState({ ...base, status: 'approved' })).toBe(false);
    expect(isInLiveState({ ...base, status: 'rejected' })).toBe(false);
    expect(isInLiveState({ ...base, status: 'in_effect' })).toBe(true);
    expect(isInLiveState({ ...base, status: 'verified' })).toBe(true);
    expect(isInLiveState({ ...base, status: 'reverted' })).toBe(false);
  });

  it('legacy data sin status field se trata como in_effect (back-compat)', () => {
    const base = declareChange(input());
    const legacy = { ...base, status: undefined as unknown as 'in_effect' };
    expect(isInLiveState(legacy)).toBe(true);
  });
});

describe('revertChange — transition desde in_effect', () => {
  it('revertChange acepta un change in_effect y lo marca reverted', () => {
    let c = declareChange(input({ effectiveFrom: '2026-05-25T08:00:00Z' }));
    c = submitForReview(c, 'prev-1', NOW_PLUS_1H);
    c = recordApproval(c, {
      approverUid: 'hse-1',
      approverRole: 'prevencionista',
      decision: 'approved',
      comment: 'OK desde óptica HSE — sin observaciones',
      now: NOW_PLUS_2H,
    });
    c = recordApproval(c, {
      approverUid: 'sup-1',
      approverRole: 'supervisor',
      decision: 'approved',
      comment: 'OK operacionalmente — turno notificado',
      now: NOW_PLUS_3H,
    });
    c = activateChange(c, 'sup-1', NOW_PLUS_2D);
    expect(c.status).toBe('in_effect');
    const reverted = revertChange(c, 'Procedimiento generó regresión en turno tarde', NOW_PLUS_2D);
    expect(reverted.status).toBe('reverted');
    expect(reverted.revertedReason).toContain('regresión');
  });
});
