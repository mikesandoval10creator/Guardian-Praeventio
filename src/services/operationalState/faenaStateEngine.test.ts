import { describe, it, expect } from 'vitest';
import { computeFaenaState, type FaenaStateInput } from './faenaStateEngine.js';

function emptyInput(over: Partial<FaenaStateInput> = {}): FaenaStateInput {
  return {
    activeEmergencyIncidents: 0,
    activeStoppages: [],
    restrictedZones: [],
    criticalEquipmentDown: [],
    openCriticalFindings: 0,
    activeWorkPermits: 0,
    ...over,
  };
}

const NOW = new Date('2026-05-11T12:00:00Z');

describe('computeFaenaState', () => {
  it('default sin issues → operativa', () => {
    const r = computeFaenaState(emptyInput(), NOW);
    expect(r.state).toBe('operativa');
    expect(r.affectedModules).toEqual([]);
  });

  it('emergencia gana sobre todo el resto', () => {
    const r = computeFaenaState(
      emptyInput({
        activeEmergencyIncidents: 1,
        activeStoppages: [{ id: 's1', reason: 'paro', sinceIso: '2026-05-11' }],
        criticalEquipmentDown: [{ id: 'eq1', label: 'grua' }],
      }),
      NOW,
    );
    expect(r.state).toBe('emergencia');
  });

  it('paralización formal → detenida', () => {
    const r = computeFaenaState(
      emptyInput({
        activeStoppages: [{ id: 's1', reason: 'falla estructural', sinceIso: '2026-05-10T08:00:00Z' }],
      }),
      NOW,
    );
    expect(r.state).toBe('detenida');
    expect(r.reason).toContain('falla estructural');
  });

  it('equipo crítico + zona restringida → parcialmente_detenida', () => {
    const r = computeFaenaState(
      emptyInput({
        criticalEquipmentDown: [{ id: 'eq1', label: 'grua' }],
        restrictedZones: [{ id: 'z1', reason: 'derrame químico' }],
      }),
      NOW,
    );
    expect(r.state).toBe('parcialmente_detenida');
    expect(r.affectedModules).toContain('maintenance');
    expect(r.affectedModules).toContain('zones');
  });

  it('solo equipo crítico → parcialmente_detenida', () => {
    const r = computeFaenaState(
      emptyInput({ criticalEquipmentDown: [{ id: 'eq1', label: 'grua' }] }),
      NOW,
    );
    expect(r.state).toBe('parcialmente_detenida');
  });

  it('solo zona restringida → restringida', () => {
    const r = computeFaenaState(
      emptyInput({ restrictedZones: [{ id: 'z1', reason: 'caliente' }] }),
      NOW,
    );
    expect(r.state).toBe('restringida');
  });

  it('2+ findings críticos sin equipo/zona → restringida', () => {
    const r = computeFaenaState(emptyInput({ openCriticalFindings: 3 }), NOW);
    expect(r.state).toBe('restringida');
  });

  it('1 finding crítico no es suficiente → operativa', () => {
    const r = computeFaenaState(emptyInput({ openCriticalFindings: 1 }), NOW);
    expect(r.state).toBe('operativa');
  });

  it('computedAt es ISO-8601', () => {
    const r = computeFaenaState(emptyInput(), NOW);
    expect(r.computedAt).toBe(NOW.toISOString());
  });
});
