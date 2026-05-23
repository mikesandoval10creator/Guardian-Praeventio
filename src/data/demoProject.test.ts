// Sprint 26 — Bucket YY.4 tests — demo project integrity.
// Plan 2026-05-23 §Fase D.6 — extended con seed operacional.

import { describe, it, expect } from 'vitest';
import {
  DEMO_PROJECT,
  DEMO_PROJECT_ID,
  DEMO_WORKERS,
  DEMO_INCIDENTS,
  DEMO_STOPPAGES,
  DEMO_CORRECTIVE_ACTIONS,
  isDemoProject,
  isDemoTenant,
} from './demoProject';

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

// ─────────────────────────────────────────────────────────────────────────
// Fase D.6 — seed operacional para landing sin login.
// ─────────────────────────────────────────────────────────────────────────

describe('demoProject — Fase D.6 seed operacional', () => {
  describe('tenant + readOnly gate', () => {
    it('expone tenantId = "tenant_demo" + readOnly: true', () => {
      expect(DEMO_PROJECT.tenantId).toBe('tenant_demo');
      expect(DEMO_PROJECT.readOnly).toBe(true);
    });

    it('isDemoTenant matchea solo el tenant canónico', () => {
      expect(isDemoTenant('tenant_demo')).toBe(true);
      expect(isDemoTenant('praeventio')).toBe(false);
      expect(isDemoTenant(null)).toBe(false);
      expect(isDemoTenant(undefined)).toBe(false);
      expect(isDemoTenant('')).toBe(false);
    });
  });

  describe('DEMO_WORKERS', () => {
    it('expone 5 trabajadores con ids únicos', () => {
      expect(DEMO_WORKERS).toHaveLength(5);
      const ids = DEMO_WORKERS.map((w) => w.id);
      expect(new Set(ids).size).toBe(5);
    });

    it('todos tienen RUT válido formato chileno', () => {
      const rutPattern = /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/;
      for (const w of DEMO_WORKERS) {
        expect(w.rut).toMatch(rutPattern);
      }
    });

    it('mix de roles + estados realista', () => {
      const roles = DEMO_WORKERS.map((w) => w.role);
      expect(new Set(roles).size).toBeGreaterThan(1); // no todos iguales
      const contractStatuses = DEMO_WORKERS.map((w) => w.contractStatus);
      expect(contractStatuses).toContain('Por Vencer'); // hay alertable
    });

    it('emails apuntan a dominio .demo (no real)', () => {
      for (const w of DEMO_WORKERS) {
        expect(w.email).toMatch(/@praeventio\.demo$/);
      }
    });
  });

  describe('DEMO_INCIDENTS', () => {
    it('expone 10 incidentes con ids únicos', () => {
      expect(DEMO_INCIDENTS).toHaveLength(10);
      const ids = DEMO_INCIDENTS.map((i) => i.id);
      expect(new Set(ids).size).toBe(10);
    });

    it('cubre múltiples categorías (DS 594 + Ley 16.744)', () => {
      const categories = new Set(DEMO_INCIDENTS.map((i) => i.category));
      expect(categories.size).toBeGreaterThanOrEqual(3);
      expect(categories).toContain('near_miss');
      expect(categories).toContain('first_aid');
    });

    it('ningún incidente demo tiene severity=critical', () => {
      // El demo NO debe asustar a prospects con fatalidades — todos
      // los datos son low/medium/high pero nunca critical.
      for (const inc of DEMO_INCIDENTS) {
        expect(inc.severity).not.toBe('critical');
      }
    });

    it('distribución lostDays realista (mayoría 0, máximo 5)', () => {
      const lostDays = DEMO_INCIDENTS.map((i) => i.lostDays);
      const max = Math.max(...lostDays);
      expect(max).toBeLessThanOrEqual(5);
      const zeros = lostDays.filter((d) => d === 0).length;
      expect(zeros).toBeGreaterThanOrEqual(7); // 70%+ no-lost-time
    });
  });

  describe('DEMO_STOPPAGES', () => {
    it('expone 3 paralizaciones activas con scopes distintos', () => {
      expect(DEMO_STOPPAGES).toHaveLength(3);
      const scopes = DEMO_STOPPAGES.map((s) => s.scope);
      expect(new Set(scopes).size).toBe(3); // equipment + zone + task
      expect(scopes).toContain('equipment');
      expect(scopes).toContain('zone');
      expect(scopes).toContain('task');
    });

    it('todas tienen status active', () => {
      for (const s of DEMO_STOPPAGES) {
        expect(s.status).toBe('active');
      }
    });

    it('todas referencian el DEMO_PROJECT_ID correcto', () => {
      for (const s of DEMO_STOPPAGES) {
        expect(s.projectId).toBe(DEMO_PROJECT_ID);
      }
    });

    it('cada paralización tiene al menos 1 resumption precondition', () => {
      for (const s of DEMO_STOPPAGES) {
        expect(s.resumptionPreconditions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('DEMO_CORRECTIVE_ACTIONS', () => {
    it('expone 5 acciones con ids únicos', () => {
      expect(DEMO_CORRECTIVE_ACTIONS).toHaveLength(5);
      const ids = DEMO_CORRECTIVE_ACTIONS.map((a) => a.id);
      expect(new Set(ids).size).toBe(5);
    });

    it('mix de estados (open / closed / verified)', () => {
      const statuses = new Set(DEMO_CORRECTIVE_ACTIONS.map((a) => a.status));
      expect(statuses.size).toBeGreaterThanOrEqual(2);
      expect(statuses).toContain('open');
    });

    it('al menos 1 acción systemic (multi-incidente)', () => {
      const systemic = DEMO_CORRECTIVE_ACTIONS.filter((a) => a.isSystemic);
      expect(systemic.length).toBeGreaterThanOrEqual(1);
    });

    it('todas referencian un sourceCause apuntando a un demo-inc', () => {
      for (const a of DEMO_CORRECTIVE_ACTIONS) {
        expect(a.sourceCause).toMatch(/^demo-inc-\d+/);
      }
    });
  });

  describe('integridad cruzada', () => {
    it('sourceCause de cada acción correctiva apunta a un incident existente', () => {
      // Cast a `string` para que Set.has() acepte el captured group del
      // regex (TS narrowing por `as const` lo restringe al union literal).
      const incidentIds = new Set<string>(DEMO_INCIDENTS.map((i) => i.id));
      for (const action of DEMO_CORRECTIVE_ACTIONS) {
        const refMatch = action.sourceCause?.match(/^(demo-inc-\d+)/);
        expect(refMatch).not.toBeNull();
        if (refMatch) {
          expect(incidentIds.has(refMatch[1])).toBe(true);
        }
      }
    });

    it('reportedByUid en incidentes apunta a un worker demo existente', () => {
      const workerIds = new Set<string>(DEMO_WORKERS.map((w) => w.id));
      for (const inc of DEMO_INCIDENTS) {
        expect(workerIds.has(inc.reportedByUid)).toBe(true);
      }
    });

    it('declaredByUid en stoppages apunta a un worker demo existente', () => {
      const workerIds = new Set<string>(DEMO_WORKERS.map((w) => w.id));
      for (const s of DEMO_STOPPAGES) {
        expect(workerIds.has(s.declaredByUid)).toBe(true);
      }
    });
  });
});
