// Tests §12.7.2 — Contextual actions nodos grafo.

import { describe, it, expect } from 'vitest';
import {
  buildContextualActions,
  filterActionsByCategory,
  groupActionsByCategory,
  type NodeContext,
} from './contextualActions';

const baseCtx: NodeContext = {
  nodeId: 'n-1',
  kind: 'worker',
  projectId: 'p-1',
  tenantId: 't-1',
};

describe('buildContextualActions — worker', () => {
  it('worker incluye view_profile + give_recognition siempre', () => {
    const actions = buildContextualActions(baseCtx, 'worker');
    expect(actions.find((a) => a.id === 'worker.view_profile')).toBeDefined();
    expect(actions.find((a) => a.id === 'worker.give_recognition')).toBeDefined();
  });

  it('supervisor ve assign_training + view_medical', () => {
    const actions = buildContextualActions(baseCtx, 'supervisor');
    expect(actions.find((a) => a.id === 'worker.assign_training')).toBeDefined();
    expect(actions.find((a) => a.id === 'worker.view_medical')).toBeDefined();
  });

  it('worker NO ve assign_training (gating role)', () => {
    const actions = buildContextualActions(baseCtx, 'worker');
    expect(actions.find((a) => a.id === 'worker.assign_training')).toBeUndefined();
  });
});

describe('buildContextualActions — risk', () => {
  it('incluye generate_pts + normative + iper', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'risk' };
    const actions = buildContextualActions(ctx, 'worker');
    expect(actions.find((a) => a.id === 'risk.generate_pts')).toBeDefined();
    expect(actions.find((a) => a.id === 'risk.view_normative')).toBeDefined();
    expect(actions.find((a) => a.id === 'risk.start_iper')).toBeDefined();
  });

  it('href interpola nodeId', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'risk', nodeId: 'risk-42' };
    const actions = buildContextualActions(ctx, 'admin');
    const pts = actions.find((a) => a.id === 'risk.generate_pts');
    expect(pts?.href).toBe('/risk/risk-42/pts/new');
  });
});

describe('buildContextualActions — control', () => {
  it('worker solo ve view', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'control' };
    const actions = buildContextualActions(ctx, 'worker');
    expect(actions.find((a) => a.id === 'control.mark_implemented')).toBeUndefined();
  });

  it('admin puede mark_implemented + requiere confirm', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'control' };
    const actions = buildContextualActions(ctx, 'admin');
    const mark = actions.find((a) => a.id === 'control.mark_implemented');
    expect(mark).toBeDefined();
    expect(mark?.requiresConfirm).toBe(true);
  });
});

describe('buildContextualActions — epp', () => {
  it('worker NO puede solicitar OC', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'epp' };
    const actions = buildContextualActions(ctx, 'worker');
    expect(actions.find((a) => a.id === 'epp.request_oc')).toBeUndefined();
  });

  it('supervisor sí puede', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'epp' };
    const actions = buildContextualActions(ctx, 'supervisor');
    expect(actions.find((a) => a.id === 'epp.request_oc')).toBeDefined();
  });
});

describe('buildContextualActions — document', () => {
  it('auditor ve audit_log', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'document' };
    const actions = buildContextualActions(ctx, 'auditor');
    expect(actions.find((a) => a.id === 'document.audit_log')).toBeDefined();
  });

  it('worker NO ve audit_log', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'document' };
    const actions = buildContextualActions(ctx, 'worker');
    expect(actions.find((a) => a.id === 'document.audit_log')).toBeUndefined();
  });
});

describe('buildContextualActions — kinds not in registry', () => {
  it('kind incident incluye view + investigate', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'incident' };
    const actions = buildContextualActions(ctx, 'worker');
    expect(actions).toHaveLength(2);
  });

  it('kind project incluye dashboard', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'project' };
    const actions = buildContextualActions(ctx, 'worker');
    expect(actions[0]?.id).toBe('project.dashboard');
  });
});

describe('filterActionsByCategory', () => {
  it('filtra solo create + mutate', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'risk' };
    const actions = buildContextualActions(ctx, 'admin');
    const filtered = filterActionsByCategory(actions, ['create']);
    expect(filtered.every((a) => a.category === 'create')).toBe(true);
  });
});

describe('groupActionsByCategory', () => {
  it('agrupa correctamente', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'risk' };
    const actions = buildContextualActions(ctx, 'admin');
    const groups = groupActionsByCategory(actions);
    expect(Array.isArray(groups.view)).toBe(true);
    expect(Array.isArray(groups.create)).toBe(true);
    expect(Array.isArray(groups.mutate)).toBe(true);
    expect(Array.isArray(groups.export)).toBe(true);
    expect(Array.isArray(groups.delete)).toBe(true);
  });
});

describe('determinismo', () => {
  it('mismas entradas → misma lista', () => {
    const ctx: NodeContext = { ...baseCtx, kind: 'worker' };
    const a = buildContextualActions(ctx, 'supervisor');
    const b = buildContextualActions(ctx, 'supervisor');
    expect(a).toEqual(b);
  });
});
