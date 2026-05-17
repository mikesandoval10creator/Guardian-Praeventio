import { describe, it, expect } from 'vitest';
import {
  issuePermit,
  cancelPermit,
  fulfillPermit,
  deriveStatus,
  edgesForPermit,
  createPendingPermit,
  attestAndIssuePermit,
  REQUIRED_CHECKLIST_BY_KIND,
  WorkPermitValidationError,
  type WorkPermitInput,
} from './workPermitEngine.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function validInput(over: Partial<WorkPermitInput> = {}): WorkPermitInput {
  return {
    id: 'wp-1',
    kind: 'altura',
    workerUid: 'worker-juan',
    approverUid: 'sup-1',
    approverRole: 'supervisor',
    taskDescription: 'Instalación luminaria piso 8',
    preconditions: {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checklist: {
        items: REQUIRED_CHECKLIST_BY_KIND.altura.map((label, i) => ({
          id: `c${i}`,
          label,
          checked: true,
        })),
      },
    },
    durationHours: 8,
    now: NOW,
    ...over,
  };
}

describe('issuePermit', () => {
  it('emite permit con status active cuando todo OK', () => {
    const p = issuePermit(validInput());
    expect(p.status).toBe('active');
    expect(p.validUntil > p.validFrom).toBe(true);
  });

  it('rechaza approverRole inválido', () => {
    expect(() => issuePermit(validInput({ approverRole: 'operador' }))).toThrow(
      /INVALID_APPROVER_ROLE/,
    );
  });

  it('rechaza durationHours > 24', () => {
    expect(() => issuePermit(validInput({ durationHours: 48 }))).toThrow(
      /DURATION_OUT_OF_RANGE/,
    );
  });

  it('rechaza workerHasTraining=false', () => {
    expect(() =>
      issuePermit(
        validInput({
          preconditions: { ...validInput().preconditions, workerHasTraining: false },
        }),
      ),
    ).toThrow(/WORKER_MISSING_TRAINING/);
  });

  it('rechaza workerHasEpp=false', () => {
    expect(() =>
      issuePermit(
        validInput({
          preconditions: { ...validInput().preconditions, workerHasEpp: false },
        }),
      ),
    ).toThrow(/WORKER_MISSING_EPP/);
  });

  it('rechaza workerMedicallyFit=false', () => {
    expect(() =>
      issuePermit(
        validInput({
          preconditions: { ...validInput().preconditions, workerMedicallyFit: false },
        }),
      ),
    ).toThrow(/WORKER_NOT_FIT/);
  });

  it('rechaza checklist incompleto', () => {
    const input = validInput();
    input.preconditions.checklist.items[0].checked = false;
    expect(() => issuePermit(input)).toThrow(/CHECKLIST_INCOMPLETE/);
  });

  it('cubre los 6 kinds canónicos', () => {
    for (const kind of [
      'altura',
      'caliente',
      'confinado',
      'loto',
      'excavacion',
      'izaje_critico',
    ] as const) {
      const input = validInput({
        id: `wp-${kind}`,
        kind,
        preconditions: {
          ...validInput().preconditions,
          checklist: {
            items: REQUIRED_CHECKLIST_BY_KIND[kind].map((label, i) => ({
              id: `c${i}`,
              label,
              checked: true,
            })),
          },
        },
      });
      const p = issuePermit(input);
      expect(p.kind).toBe(kind);
    }
  });
});

describe('cancelPermit', () => {
  it('cancela activo con razón válida', () => {
    const p = issuePermit(validInput());
    const c = cancelPermit(p, 'Condición climática cambió', NOW);
    expect(c.status).toBe('cancelled');
    expect(c.cancelledReason).toContain('climática');
  });

  it('rechaza cancelar dos veces', () => {
    const p = issuePermit(validInput());
    const c = cancelPermit(p, 'Condición climática', NOW);
    expect(() => cancelPermit(c, 'segundo intento', NOW)).toThrow(/NOT_ACTIVE/);
  });

  it('rechaza razón < 10 chars', () => {
    const p = issuePermit(validInput());
    expect(() => cancelPermit(p, 'corto', NOW)).toThrow(/REASON_TOO_SHORT/);
  });
});

describe('fulfillPermit + deriveStatus', () => {
  it('fulfilled cierra el permit', () => {
    const p = issuePermit(validInput());
    const f = fulfillPermit(p, NOW);
    expect(f.status).toBe('fulfilled');
  });

  it('deriveStatus expired cuando pasa validUntil', () => {
    const p = issuePermit(validInput({ durationHours: 1 }));
    const future = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(deriveStatus(p, future)).toBe('expired');
  });
});

describe('createPendingPermit (Codex P1 #1 — no auto-attest at create)', () => {
  it('produces a pending_approval permit regardless of the body checklist', () => {
    const input = validInput();
    // Even if the caller pre-attested everything, createPendingPermit
    // ignores it and emits the canonical unchecked template.
    const p = createPendingPermit(input);
    expect(p.status).toBe('pending_approval');
    expect(p.approvedAt).toBeUndefined();
    expect(p.preconditions.workerHasTraining).toBe(false);
    expect(p.preconditions.workerHasEpp).toBe(false);
    expect(p.preconditions.workerMedicallyFit).toBe(false);
    // Every required item is present, but explicitly unchecked.
    expect(p.preconditions.checklist.items).toHaveLength(
      REQUIRED_CHECKLIST_BY_KIND.altura.length,
    );
    for (const item of p.preconditions.checklist.items) {
      expect(item.checked).toBe(false);
    }
  });

  it('still validates approver role and duration before persisting', () => {
    expect(() =>
      createPendingPermit(validInput({ approverRole: 'operador' })),
    ).toThrow(/INVALID_APPROVER_ROLE/);
    expect(() =>
      createPendingPermit(validInput({ durationHours: 99 })),
    ).toThrow(/DURATION_OUT_OF_RANGE/);
  });
});

describe('attestAndIssuePermit (Codex P1 #1 — supervisor attests at sign)', () => {
  it('flips a pending_approval permit to active when fully attested', () => {
    const pending = createPendingPermit(validInput());
    const issued = attestAndIssuePermit(pending, {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checkedLabels: REQUIRED_CHECKLIST_BY_KIND.altura,
      now: NOW,
    });
    expect(issued.status).toBe('active');
    expect(issued.approvedAt).toBe(NOW.toISOString());
    // Every required item is now checked, with verifiedAt set.
    for (const item of issued.preconditions.checklist.items) {
      expect(item.checked).toBe(true);
      expect(item.verifiedAt).toBe(NOW.toISOString());
    }
  });

  it('rejects attestation when a required check is missing', () => {
    const pending = createPendingPermit(validInput());
    const partial = REQUIRED_CHECKLIST_BY_KIND.altura.slice(0, 2);
    expect(() =>
      attestAndIssuePermit(pending, {
        workerHasTraining: true,
        workerHasEpp: true,
        workerMedicallyFit: true,
        checkedLabels: partial,
      }),
    ).toThrow(/CHECKLIST_INCOMPLETE/);
  });

  it('rejects attestation when a meta-precondition is false', () => {
    const pending = createPendingPermit(validInput());
    expect(() =>
      attestAndIssuePermit(pending, {
        workerHasTraining: false,
        workerHasEpp: true,
        workerMedicallyFit: true,
        checkedLabels: REQUIRED_CHECKLIST_BY_KIND.altura,
      }),
    ).toThrow(/WORKER_MISSING_TRAINING/);
  });

  it('refuses to attest a permit that is not pending_approval / draft', () => {
    const active = issuePermit(validInput());
    expect(() =>
      attestAndIssuePermit(active, {
        workerHasTraining: true,
        workerHasEpp: true,
        workerMedicallyFit: true,
        checkedLabels: REQUIRED_CHECKLIST_BY_KIND.altura,
      }),
    ).toThrow(/NOT_PENDING/);
  });
});

describe('edgesForPermit', () => {
  it('produce edge assigned_to worker + regulates zone', () => {
    const p = issuePermit(validInput({ zoneId: 'zone-A' }));
    const edges = edgesForPermit(p, 'zone-A');
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.type === 'assigned_to')?.toNodeId).toBe('worker-juan');
    expect(edges.find((e) => e.type === 'regulates')?.toNodeId).toBe('zone-A');
  });

  it('omite edge zone si no se pasa', () => {
    const p = issuePermit(validInput());
    const edges = edgesForPermit(p);
    expect(edges).toHaveLength(1);
  });
});
