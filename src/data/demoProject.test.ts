// Sprint 26 — Bucket YY.4 tests — demo project integrity.

import { describe, it, expect } from 'vitest';
import { DEMO_PROJECT, DEMO_PROJECT_ID, isDemoProject } from './demoProject';

describe('demoProject — Bucket YY.4', () => {
  it('exports a stable DEMO_PROJECT_ID matching the hook faker default', () => {
    // ADR 0011: useTwinAccess detecta este id literal en su default
    // `isDemoProject` faker. Cambiar el id silencioso rompería el skip
    // de Gate 3 — bloquear regression con assert literal.
    expect(DEMO_PROJECT_ID).toBe('demo-faena-praeventio');
    expect(DEMO_PROJECT.id).toBe(DEMO_PROJECT_ID);
    expect(DEMO_PROJECT.__demo__).toBe(true);
  });

  it('contains the geometry + objects expected by the bucket spec', () => {
    // Spec: 3-5 polígonos (warehouse + tanques + oficinas) + 6-10 objetos
    // (extintores, hidrantes, puntos de reunión).
    expect(DEMO_PROJECT.geometry.polygons.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_PROJECT.geometry.polygons.length).toBeLessThanOrEqual(5);
    expect(DEMO_PROJECT.placedObjects.length).toBeGreaterThanOrEqual(6);
    expect(DEMO_PROJECT.placedObjects.length).toBeLessThanOrEqual(10);

    const kinds = DEMO_PROJECT.placedObjects.map((o) => o.kind);
    expect(kinds).toContain('extintor');
    expect(kinds).toContain('hidrante');
    expect(kinds).toContain('puntoReunion');
  });

  it('isDemoProject only matches the canonical id', () => {
    expect(isDemoProject(DEMO_PROJECT_ID)).toBe(true);
    expect(isDemoProject('proj-real-cliente-123')).toBe(false);
    expect(isDemoProject('')).toBe(false);
    expect(isDemoProject('demo-faena')).toBe(false); // sustring no basta
  });
});
