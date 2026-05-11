import { describe, it, expect } from 'vitest';
import {
  runConsistencyAudit,
  summarizeConsistencyAudit,
  type ConsistencyState,
} from './consistencyAuditor.js';

function baseState(over: Partial<ConsistencyState> = {}): ConsistencyState {
  return {
    workers: [],
    taskAssignments: [],
    documents: [],
    correctiveActions: [],
    workPermits: [],
    trainings: [],
    validRoles: ['operador', 'supervisor', 'prevencionista', 'gerente'],
    eppByRole: undefined,
    activeApproverUids: [],
    ...over,
  };
}

describe('runConsistencyAudit', () => {
  it('estado vacío → 0 issues', () => {
    expect(runConsistencyAudit(baseState())).toHaveLength(0);
  });

  it('R01: worker en tarea de altura sin training altura → critical', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [{ uid: 'w1', role: 'operador', activeTrainings: [], activeEppLabels: [], isActive: true }],
        taskAssignments: [
          { taskId: 't1', workerUid: 'w1', riskType: 'altura', requiredTrainings: ['trabajo_altura_r1'], requiredEpp: [] },
        ],
      }),
    );
    const r01 = issues.filter((i) => i.ruleId === 'R01_task_missing_training');
    expect(r01).toHaveLength(1);
    expect(r01[0].severity).toBe('critical');
  });

  it('R02: worker en tarea sin EPP requerido → critical', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [{ uid: 'w1', role: 'operador', activeTrainings: [], activeEppLabels: ['Casco'], isActive: true }],
        taskAssignments: [
          { taskId: 't1', workerUid: 'w1', riskType: 'altura', requiredTrainings: [], requiredEpp: ['Arnés seguridad'] },
        ],
      }),
    );
    const r02 = issues.filter((i) => i.ruleId === 'R02_task_missing_epp');
    expect(r02).toHaveLength(1);
  });

  it('R03: documento approved sin signedBy → warning', () => {
    const issues = runConsistencyAudit(
      baseState({
        documents: [{ id: 'd1', status: 'approved', signedBy: null, approvedAt: '2026-01-01' }],
      }),
    );
    const r03 = issues.filter((i) => i.ruleId === 'R03_doc_approved_unsigned');
    expect(r03).toHaveLength(1);
    expect(r03[0].severity).toBe('warning');
  });

  it('R04: corrective action closed sin evidencia requerida → critical', () => {
    const issues = runConsistencyAudit(
      baseState({
        correctiveActions: [
          { id: 'a1', status: 'closed', evidenceRequired: true, evidenceUrls: [] },
        ],
      }),
    );
    const r04 = issues.filter((i) => i.ruleId === 'R04_action_closed_no_evidence');
    expect(r04).toHaveLength(1);
  });

  it('R04: corrective action con evidence → no issue', () => {
    const issues = runConsistencyAudit(
      baseState({
        correctiveActions: [
          { id: 'a1', status: 'closed', evidenceRequired: true, evidenceUrls: ['gs://photo.jpg'] },
        ],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R04_action_closed_no_evidence')).toHaveLength(0);
  });

  it('R05: training completado sin asistencia → warning', () => {
    const issues = runConsistencyAudit(
      baseState({
        trainings: [
          {
            id: 'tr1',
            workerUid: 'w1',
            course: 'altura',
            completedAt: '2026-05-01',
            attendanceRegistered: false,
          },
        ],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R05_training_no_attendance')).toHaveLength(1);
  });

  it('R06: permit con aprobador NO en activeApproverUids → critical', () => {
    const issues = runConsistencyAudit(
      baseState({
        workPermits: [{ id: 'p1', approverUid: 'sup-ausente', status: 'active' }],
        activeApproverUids: ['sup-vigente'],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R06_permit_orphan_approver')).toHaveLength(1);
  });

  it('R07: worker con role no válido → warning', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [
          { uid: 'w1', role: 'rol-inventado', activeTrainings: [], activeEppLabels: [], isActive: true },
        ],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R07_worker_invalid_role')).toHaveLength(1);
  });

  it('R08: worker sin EPP base de su cargo → warning', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [
          { uid: 'w1', role: 'operador', activeTrainings: [], activeEppLabels: [], isActive: true },
        ],
        eppByRole: { operador: ['Casco', 'Guantes', 'Botas'] },
      }),
    );
    const r08 = issues.filter((i) => i.ruleId === 'R08_role_epp_mismatch');
    expect(r08).toHaveLength(1);
    expect(r08[0].description).toContain('Casco');
  });

  it('R09: permit active expirado → critical', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const issues = runConsistencyAudit(
      baseState({
        workPermits: [{ id: 'p1', approverUid: 'sup', status: 'active', expiresAt: past }],
        activeApproverUids: ['sup'],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R09_permit_expired_active')).toHaveLength(1);
  });

  it('R11: task asignada a worker que no existe → critical', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [],
        taskAssignments: [
          { taskId: 't1', workerUid: 'w-fantasma', riskType: 'altura', requiredTrainings: [], requiredEpp: [] },
        ],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R11_orphan_task')).toHaveLength(1);
  });

  it('R12: task asignada a worker inactivo → critical', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [{ uid: 'w1', role: 'operador', activeTrainings: [], activeEppLabels: [], isActive: false }],
        taskAssignments: [
          { taskId: 't1', workerUid: 'w1', riskType: 'altura', requiredTrainings: [], requiredEpp: [] },
        ],
      }),
    );
    expect(issues.filter((i) => i.ruleId === 'R12_inactive_worker_active_task')).toHaveLength(1);
  });

  it('summarizeConsistencyAudit cuenta por categoría y severity', () => {
    const issues = runConsistencyAudit(
      baseState({
        workers: [
          { uid: 'w1', role: 'rol-inventado', activeTrainings: [], activeEppLabels: [], isActive: true },
        ],
        documents: [{ id: 'd1', status: 'approved', signedBy: null, approvedAt: null }],
      }),
    );
    const summary = summarizeConsistencyAudit(issues);
    expect(summary.totalIssues).toBeGreaterThanOrEqual(2);
    expect(summary.byCategory['data_quality']).toBeGreaterThanOrEqual(1);
    expect(summary.byCategory['documentation']).toBeGreaterThanOrEqual(1);
  });
});
