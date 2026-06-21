import { describe, it, expect } from 'vitest';
import {
  incidentDocToWorkflowItem,
  incidentDocsToWorkflowItems,
  type RawIncidentDoc,
} from './incidentSlaMapper.js';

describe('incidentSlaMapper', () => {
  it('maps a real open incident doc with a genuine timestamp + severity', () => {
    const doc: RawIncidentDoc = {
      id: 'inc-7',
      severity: 'high',
      status: 'open',
      createdAt: '2026-05-01T08:00:00.000Z',
      description: 'Caída de roca en rampa nivel 4',
    };
    const mapped = incidentDocToWorkflowItem(doc);
    expect(mapped).not.toBeNull();
    expect(mapped!.item).toMatchObject({
      id: 'inc-7',
      kind: 'incident',
      severity: 'high',
      status: 'open',
      createdAt: '2026-05-01T08:00:00.000Z',
    });
    expect(mapped!.label).toBe('Caída de roca en rampa nivel 4');
  });

  it("normalizes the incident 'med' severity to the engine 'medium'", () => {
    const mapped = incidentDocToWorkflowItem({
      id: 'inc-med',
      severity: 'med',
      createdAt: '2026-05-01T08:00:00Z',
    });
    expect(mapped!.item.severity).toBe('medium');
  });

  it('uses ts then occurredAt as timestamp fallbacks, in that order', () => {
    const viaTs = incidentDocToWorkflowItem({
      id: 'a',
      severity: 'low',
      ts: '2026-04-10T00:00:00.000Z',
    });
    expect(viaTs!.item.createdAt).toBe('2026-04-10T00:00:00.000Z');

    const viaOccurred = incidentDocToWorkflowItem({
      id: 'b',
      severity: 'low',
      occurredAt: '2026-04-11T00:00:00.000Z',
    });
    expect(viaOccurred!.item.createdAt).toBe('2026-04-11T00:00:00.000Z');
  });

  it('parses a Firestore Timestamp-like {_seconds} value', () => {
    const mapped = incidentDocToWorkflowItem({
      id: 'c',
      severity: 'critical',
      createdAt: { _seconds: 1_700_000_000 },
    });
    expect(mapped!.item.createdAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('SKIPS a doc with NO real timestamp (never fabricates new Date)', () => {
    expect(
      incidentDocToWorkflowItem({ id: 'no-ts', severity: 'high' }),
    ).toBeNull();
  });

  it('SKIPS a doc with an unknown / missing severity', () => {
    expect(
      incidentDocToWorkflowItem({
        id: 'no-sev',
        createdAt: '2026-05-01T08:00:00Z',
      }),
    ).toBeNull();
  });

  it('SKIPS closed / rejected / resolved / verified incidents (no live clock)', () => {
    for (const status of ['closed', 'rejected', 'resolved', 'verified']) {
      expect(
        incidentDocToWorkflowItem({
          id: `s-${status}`,
          severity: 'high',
          status,
          createdAt: '2026-05-01T08:00:00Z',
        }),
      ).toBeNull();
    }
  });

  it('keeps in_progress / pending_review as live statuses', () => {
    const ip = incidentDocToWorkflowItem({
      id: 'ip',
      severity: 'high',
      status: 'in_progress',
      createdAt: '2026-05-01T08:00:00Z',
    });
    expect(ip!.item.status).toBe('in_progress');
  });

  it('falls back to the id as label when description is missing', () => {
    const mapped = incidentDocToWorkflowItem({
      id: 'inc-noLabel',
      severity: 'low',
      createdAt: '2026-05-01T08:00:00Z',
    });
    expect(mapped!.label).toBe('inc-noLabel');
  });

  it('folds an array, dropping the dishonest docs', () => {
    const docs: RawIncidentDoc[] = [
      { id: 'ok', severity: 'high', createdAt: '2026-05-01T08:00:00Z' },
      { id: 'closed', severity: 'high', status: 'closed', createdAt: '2026-05-01T08:00:00Z' },
      { id: 'no-ts', severity: 'high' },
      { severity: 'high', createdAt: '2026-05-01T08:00:00Z' }, // no id
    ];
    const items = incidentDocsToWorkflowItems(docs);
    expect(items.map((i) => i.item.id)).toEqual(['ok']);
  });
});
