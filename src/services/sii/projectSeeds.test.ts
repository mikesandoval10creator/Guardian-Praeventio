// Épica Rubros SII — slice 3: pure seed builder for new projects.
//
// `buildProjectSeeds` turns the preventive profile of a rubro (slice 1:
// `getRiskProfileForSector` + `obligacionesPorDotacion`) into REAL initial
// project records:
//   - risk seeds shaped for the top-level `nodes` collection (the same
//     collection the IPER UI — src/pages/Matrix.tsx via useRiskEngine —
//     lists for the selected project), and
//   - legal-obligation seeds shaped for `projects/{pid}/legal_obligations`
//     (the calendar the LegalCalendar page subscribes to).
//
// Contract pinned here:
//   - PURE + deterministic (rule #9 style): same input → deep-equal output.
//   - IDEMPOTENT ids: `seed-risk-{sectorId}-{n}-{projectId}` /
//     `seed-obl-{sectorId}-{slug}` — re-running the creation flow overwrites
//     the same docs instead of duplicating them.
//   - Seeds are MARKED as rubro suggestions (`origin: 'sii_seed'`,
//     `seedSource: <siiCode>`) so users can distinguish them from own data.
//   - No fabricated legal classification: risk seeds carry NO probabilidad /
//     severidad; criticidad is the honest placeholder 'Por evaluar'.

import { describe, it, expect } from 'vitest';
import { CL_PACK } from '../../data/normativa/cl';
import { getRiskProfileForSector } from './industryRiskProfile';
import { buildProjectSeeds } from './projectSeeds';

const NOW = new Date('2026-06-11T12:00:00.000Z');

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'proj-1',
    siiCode: 410010,
    sectorId: 'GP-CONS-RES',
    workerCount: 30,
    pack: CL_PACK,
    now: NOW,
    ...overrides,
  } as Parameters<typeof buildProjectSeeds>[0];
}

describe('buildProjectSeeds — determinism & idempotent ids', () => {
  it('is deterministic: same input produces deep-equal output', () => {
    const a = buildProjectSeeds(baseInput());
    const b = buildProjectSeeds(baseInput());
    expect(a).toEqual(b);
  });

  it('risk seed ids are deterministic, unique and namespaced by project', () => {
    const { riskSeeds } = buildProjectSeeds(baseInput());
    expect(riskSeeds.length).toBeGreaterThan(0);
    const ids = riskSeeds.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('seed-risk-GP-CONS-RES-1-proj-1');
    // Firestore doc-id safe (isValidId in firestore.rules: [a-zA-Z0-9_-]+, ≤128)
    for (const id of ids) {
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(id.length).toBeLessThanOrEqual(128);
    }
  });

  it('obligation seed ids are deterministic (no project suffix needed — subcollection)', () => {
    const { obligationSeeds } = buildProjectSeeds(baseInput({ workerCount: 30 }));
    const ids = obligationSeeds.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^seed-obl-[a-zA-Z0-9_-]+$/);
    }
  });
});

describe('buildProjectSeeds — risk seeds (nodes shape for the IPER module)', () => {
  it('produces one node per riesgo típico of the sector profile', () => {
    const profile = getRiskProfileForSector('GP-CONS-RES');
    const { riskSeeds } = buildProjectSeeds(baseInput());
    expect(riskSeeds.length).toBe(profile.riesgosTipicos.length);
    expect(riskSeeds.map((s) => s.doc.title)).toEqual(profile.riesgosTipicos);
  });

  it('node docs satisfy the isValidNode contract of firestore.rules', () => {
    const { riskSeeds } = buildProjectSeeds(baseInput());
    for (const seed of riskSeeds) {
      const d = seed.doc;
      // hasAll: type, title, description, createdAt, updatedAt, projectId, metadata
      expect(d.type).toBe('Riesgo'); // NodeType.RISK
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.title.length).toBeLessThanOrEqual(200);
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.projectId).toBe('proj-1');
      expect(d.createdAt).toBe(NOW.toISOString());
      expect(d.updatedAt).toBe(NOW.toISOString());
      expect(Array.isArray(d.tags)).toBe(true);
      expect(d.tags.length).toBeLessThanOrEqual(50);
      expect(d.connections).toEqual([]);
      // ≤15 top-level keys (isValidNode)
      expect(Object.keys(d).length).toBeLessThanOrEqual(15);
    }
  });

  it('marks every risk seed as a rubro suggestion (origin/seedSource) without fabricating P×S', () => {
    const { riskSeeds } = buildProjectSeeds(baseInput());
    for (const seed of riskSeeds) {
      expect(seed.doc.metadata.origin).toBe('sii_seed');
      expect(seed.doc.metadata.seedSource).toBe(410010);
      expect(seed.doc.metadata.sectorId).toBe('GP-CONS-RES');
      // visible day one in the approved list of Matrix.tsx…
      expect(seed.doc.metadata.status).toBe('approved');
      // …but the LEGAL classification stays honest: nobody evaluated P×S yet.
      expect(seed.doc.metadata.criticidad).toBe('Por evaluar');
      expect('probabilidad' in seed.doc.metadata).toBe(false);
      expect('severidad' in seed.doc.metadata).toBe(false);
      expect(seed.doc.tags).toContain('SII_SEED');
    }
  });

  it('returns NO risk seeds when there is no sector (no siiCode chosen in the wizard)', () => {
    const { riskSeeds } = buildProjectSeeds(baseInput({ siiCode: null, sectorId: null }));
    expect(riskSeeds).toEqual([]);
  });

  it('a sector without curated list degrades to the universal default risks (non-empty)', () => {
    const { riskSeeds } = buildProjectSeeds(baseInput({ sectorId: 'GP-INF-TI' }));
    expect(riskSeeds.length).toBeGreaterThan(0);
    expect(riskSeeds.map((s) => s.doc.title)).toEqual(
      getRiskProfileForSector('GP-INF-TI').riesgosTipicos,
    );
  });
});

describe('buildProjectSeeds — obligation seeds by headcount (CL pack thresholds)', () => {
  function obligationsFor(workerCount: number | null) {
    return buildProjectSeeds(baseInput({ workerCount })).obligationSeeds;
  }

  it('24 workers (below comité threshold): delegado SST, no CPHS, no Depto Prevención', () => {
    const obls = obligationsFor(24);
    const labels = obls.map((o) => o.doc.label).join(' | ');
    expect(labels).toMatch(/delegado/i);
    expect(labels).not.toMatch(/Comité Paritario/i);
    expect(labels).not.toMatch(/Departamento de Prevención/i);
  });

  it('25 workers (comité threshold): CPHS + sesión mensual, no delegado, no Depto', () => {
    const obls = obligationsFor(25);
    const labels = obls.map((o) => o.doc.label).join(' | ');
    expect(labels).toMatch(/Comité Paritario/i);
    expect(labels).toMatch(/mensual/i);
    expect(labels).not.toMatch(/delegado/i);
    expect(labels).not.toMatch(/Departamento de Prevención/i);
  });

  it('99 workers: CPHS yes, Depto Prevención not yet', () => {
    const labels = obligationsFor(99).map((o) => o.doc.label).join(' | ');
    expect(labels).toMatch(/Comité Paritario/i);
    expect(labels).not.toMatch(/Departamento de Prevención/i);
  });

  it('100 workers (depto threshold): CPHS + Departamento de Prevención', () => {
    const labels = obligationsFor(100).map((o) => o.doc.label).join(' | ');
    expect(labels).toMatch(/Comité Paritario/i);
    expect(labels).toMatch(/Departamento de Prevención/i);
  });

  it('returns NO obligation seeds when workerCount is unknown', () => {
    expect(obligationsFor(null)).toEqual([]);
  });

  it('obligation docs satisfy the LegalObligation calendar contract', () => {
    const VALID_KINDS = new Set([
      'audit', 'env_measurement', 'training_renewal', 'cphs_meeting',
      'mutualidad_report', 'drill', 'medical_exam', 'document_renewal',
      'permit_renewal',
    ]);
    const VALID_RECURRENCE = new Set(['monthly', 'quarterly', 'biannual', 'annual', 'biennial']);
    for (const o of obligationsFor(120)) {
      expect(VALID_KINDS.has(o.doc.kind)).toBe(true);
      expect(VALID_RECURRENCE.has(o.doc.recurrence)).toBe(true);
      expect(o.doc.label.length).toBeGreaterThan(0);
      expect(o.doc.legalCitation.length).toBeGreaterThan(0);
      expect(o.doc.alertLeadDays).toBeGreaterThan(0);
      // First due date is computed from `now` — never from wall clock.
      expect(Number.isNaN(Date.parse(o.doc.nextDueAt))).toBe(false);
      expect(Date.parse(o.doc.nextDueAt)).toBeGreaterThan(NOW.getTime());
      expect(o.doc.id).toBe(o.id);
      // Marked as rubro seeds, like the risk nodes.
      expect(o.doc.origin).toBe('sii_seed');
      expect(o.doc.seedSource).toBe(410010);
    }
  });

  it('thresholds are read from the pack argument, never hardcoded', () => {
    const pack = {
      ...CL_PACK,
      thresholds: {
        comiteRequiredAtWorkers: 10,
        preventionDeptRequiredAtWorkers: 50,
        monthlyMeetingsRequired: false,
      },
    };
    const obls = buildProjectSeeds(baseInput({ workerCount: 10, pack })).obligationSeeds;
    const labels = obls.map((o) => o.doc.label).join(' | ');
    expect(labels).toMatch(/Comité Paritario/i);
    // monthlyMeetingsRequired=false → no recurring monthly session entry
    expect(obls.some((o) => o.doc.recurrence === 'monthly')).toBe(false);
  });
});
