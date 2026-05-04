// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleTransition,
  getSchedulesForKind,
  MAINTENANCE_SCHEDULES,
  toRiskNodePayload,
  type MaintenanceSchedule,
} from './objectLifecycleOrchestrator';
import { NodeType } from '../../../types';
import type { PlacedObject, PlacedObjectKind, PlacedObjectLifecycle } from '../photogrammetry/types';

const obj = (
  id: string,
  kind: PlacedObjectKind,
  lifecycle: PlacedObjectLifecycle,
  position = { x: 0, y: 0, z: 0 },
  geo?: { lat: number; lng: number },
): PlacedObject => ({
  id,
  kind,
  position,
  lifecycle,
  geo,
  createdAt: 0,
  updatedAt: 0,
});

const FROZEN_NOW = 1714780800000; // 2024-05-04T00:00:00.000Z deterministic for tests
const fixedNow = () => FROZEN_NOW;

describe('getSchedulesForKind', () => {
  it('returns multiple schedules for extinguisher_pqs (visual + pressure)', () => {
    const schedules = getSchedulesForKind('extinguisher_pqs');
    expect(schedules.length).toBeGreaterThanOrEqual(2);
    const kinds = schedules.map((s) => s.activityKind);
    expect(kinds).toContain('visual_inspection');
    expect(kinds).toContain('pressure_test');
  });

  it('returns single schedule for sign_evacuation', () => {
    const schedules = getSchedulesForKind('sign_evacuation');
    expect(schedules.length).toBe(1);
    expect(schedules[0].activityKind).toBe('visual_inspection');
  });

  it('returns empty array for unsupported kinds', () => {
    expect(getSchedulesForKind('spill_kit')).toEqual([]);
    expect(getSchedulesForKind('assembly_point')).toEqual([]);
  });
});

describe('MAINTENANCE_SCHEDULES catalog integrity', () => {
  it('has at least one schedule per critical extinguisher kind', () => {
    expect(getSchedulesForKind('extinguisher_pqs').length).toBeGreaterThan(0);
    expect(getSchedulesForKind('extinguisher_co2').length).toBeGreaterThan(0);
    expect(getSchedulesForKind('extinguisher_water').length).toBeGreaterThan(0);
  });

  it('every entry has a citation pointing to a real norm', () => {
    for (const s of MAINTENANCE_SCHEDULES) {
      expect(s.citation).toMatch(/DS|NCh|ANSI|OSHA|NFPA|MINSAL|fabricante/i);
    }
  });

  it('all intervalDays are positive integers', () => {
    for (const s of MAINTENANCE_SCHEDULES) {
      expect(s.intervalDays).toBeGreaterThan(0);
      expect(Number.isInteger(s.intervalDays)).toBe(true);
    }
  });
});

describe('deriveLifecycleTransition — first-time placement', () => {
  it('first-time planning creates ZK node, NO calendar events (still virtual)', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'planning'),
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec).not.toBeNull();
    expect(result.zkNodeSpec!.metadata.lifecycle).toBe('planning');
    expect(result.zkNodeSpec!.tags).toContain('extinguisher_pqs');
    expect(result.zkNodeSpec!.tags).toContain('planning');
    expect(result.zkNodeSpec!.tags).toContain('control-material');
    expect(result.zkNodeSpec!.type).toBe(NodeType.CONTROL);
    expect(result.calendarEventSpecs).toEqual([]);
  });

  it('first-time installed creates ZK node + calendar events for each schedule', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec!.metadata.lifecycle).toBe('installed');
    expect(result.zkNodeSpec!.metadata.objectId).toBe('e1');
    expect(result.calendarEventSpecs.length).toBeGreaterThanOrEqual(2);
    for (const e of result.calendarEventSpecs) {
      expect(e.relatedObjectId).toBe('e1');
      expect(e.projectId).toBe('p1');
    }
  });

  it('ZK node spec carries normative citations from applicable schedules', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    const citations = result.zkNodeSpec!.metadata.citations as string[];
    expect(citations.some((c) => c.includes('DS 594'))).toBe(true);
  });

  it('geo-anchor is preserved in ZK node spec metadata', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed', { x: 0, y: 0, z: 0 }, {
        lat: -33.4489,
        lng: -70.6693,
      }),
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec!.metadata.geo).toEqual({ lat: -33.4489, lng: -70.6693 });
  });

  it('connections include projectId + objectId for graph traversal', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec!.connections).toContain('p1');
    expect(result.zkNodeSpec!.connections).toContain('e1');
  });
});

describe('toRiskNodePayload — server-side persistence shape', () => {
  it('maps ZkNodeSpec to RiskNodePayload with references from citations', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    const payload = toRiskNodePayload(result.zkNodeSpec!);
    expect(payload.type).toBe('safety-learning');
    expect(payload.references.some((r) => r.includes('DS 594'))).toBe(true);
    expect(payload.title).toContain('Extintor PQS');
  });

  it('severity escalates to medium for maintenance_due lifecycle', () => {
    const previous = obj('e1', 'extinguisher_pqs', 'active');
    const next = obj('e1', 'extinguisher_pqs', 'maintenance_due');
    const result = deriveLifecycleTransition({
      previous,
      next,
      projectId: 'p1',
      now: fixedNow,
    });
    const payload = toRiskNodePayload(result.zkNodeSpec!);
    expect(payload.severity).toBe('medium');
  });
});

describe('deriveLifecycleTransition — state transitions', () => {
  it('planning → installed: emits ZK + calendar', () => {
    const previous = obj('e1', 'extinguisher_pqs', 'planning');
    const next = obj('e1', 'extinguisher_pqs', 'installed');
    const result = deriveLifecycleTransition({
      previous,
      next,
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec!.metadata.lifecycle).toBe('installed');
    expect(result.calendarEventSpecs.length).toBeGreaterThan(0);
  });

  it('installed → active: emits ZK update but NO new calendar events (already scheduled)', () => {
    const previous = obj('e1', 'extinguisher_pqs', 'installed');
    const next = obj('e1', 'extinguisher_pqs', 'active');
    const result = deriveLifecycleTransition({
      previous,
      next,
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec).not.toBeNull();
    expect(result.zkNodeSpec!.metadata.lifecycle).toBe('active');
    expect(result.calendarEventSpecs).toEqual([]);
  });

  it('active → maintenance_due: emits ZK alert (no reschedule)', () => {
    const previous = obj('e1', 'extinguisher_pqs', 'active');
    const next = obj('e1', 'extinguisher_pqs', 'maintenance_due');
    const result = deriveLifecycleTransition({
      previous,
      next,
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec!.metadata.lifecycle).toBe('maintenance_due');
    expect(result.calendarEventSpecs).toEqual([]);
  });

  it('any → retired: emits user message + ZK node, no calendar', () => {
    const previous = obj('e1', 'extinguisher_pqs', 'active');
    const next = obj('e1', 'extinguisher_pqs', 'retired');
    const result = deriveLifecycleTransition({
      previous,
      next,
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec!.metadata.lifecycle).toBe('retired');
    expect(result.calendarEventSpecs).toEqual([]);
    expect(result.userMessages.some((m) => m.toLowerCase().includes('retirado'))).toBe(true);
  });

  it('no lifecycle change + no position change → no ZK node spec', () => {
    const o = obj('e1', 'extinguisher_pqs', 'active');
    const result = deriveLifecycleTransition({
      previous: o,
      next: { ...o },
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec).toBeNull();
    expect(result.calendarEventSpecs).toEqual([]);
  });

  it('position change without lifecycle change → ZK node spec emitted', () => {
    const previous = obj('e1', 'extinguisher_pqs', 'active', { x: 0, y: 0, z: 0 });
    const next = obj('e1', 'extinguisher_pqs', 'active', { x: 5, y: 0, z: 0 });
    const result = deriveLifecycleTransition({
      previous,
      next,
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.zkNodeSpec).not.toBeNull();
    expect(result.calendarEventSpecs).toEqual([]); // already installed
  });
});

describe('calendar event spec details', () => {
  it('startIso is in the future per intervalDays', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    const monthlyInsp = result.calendarEventSpecs.find(
      (e) => e.activityKind === 'visual_inspection',
    );
    expect(monthlyInsp).toBeDefined();
    const startMs = new Date(monthlyInsp!.startIso).getTime();
    expect(startMs - FROZEN_NOW).toBe(30 * 86_400_000);
  });

  it('rrule is FREQ=MONTHLY for 30-day intervals', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    const monthlyInsp = result.calendarEventSpecs.find(
      (e) => e.activityKind === 'visual_inspection',
    );
    expect(monthlyInsp!.rrule).toBe('FREQ=MONTHLY');
  });

  it('rrule is FREQ=YEARLY for 365-day intervals', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    const yearly = result.calendarEventSpecs.find(
      (e) => e.activityKind === 'pressure_test',
    );
    expect(yearly!.rrule).toBe('FREQ=YEARLY');
  });

  it('eye_wash_station has weekly rrule', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('ew1', 'eye_wash_station', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.calendarEventSpecs.length).toBeGreaterThan(0);
    expect(result.calendarEventSpecs[0].rrule).toBe('FREQ=WEEKLY');
  });

  it('assignedCrewId propagates from input', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('aed1', 'aed', 'installed'),
      projectId: 'p1',
      assignedCrewId: 'crew-123',
      now: fixedNow,
    });
    for (const e of result.calendarEventSpecs) {
      expect(e.assignedCrewId).toBe('crew-123');
    }
  });

  it('event titles use Spanish humanized labels', () => {
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('aed1', 'aed', 'installed'),
      projectId: 'p1',
      now: fixedNow,
    });
    expect(result.calendarEventSpecs[0].title).toMatch(/Desfibrilador.*Test funcional|Desfibrilador.*Chequeo/i);
  });
});

describe('custom schedules override', () => {
  it('caller can pass custom schedules to override defaults', () => {
    const customSchedule: MaintenanceSchedule = {
      kind: 'extinguisher_pqs',
      intervalDays: 14,
      activityKind: 'visual_inspection',
      citation: 'Politica interna',
      description: 'Inspección quincenal',
    };
    const result = deriveLifecycleTransition({
      previous: null,
      next: obj('e1', 'extinguisher_pqs', 'installed'),
      projectId: 'p1',
      schedules: [customSchedule],
      now: fixedNow,
    });
    expect(result.calendarEventSpecs.length).toBe(1);
    expect(result.calendarEventSpecs[0].description).toContain('quincenal');
  });
});
