import { describe, it, expect } from 'vitest';
import {
  INDUSTRY_DEMOS,
  getDemoByIndustry,
  listAvailableIndustries,
  type DemoIndustryId,
} from './industryDemos.js';

const ALL_IDS: DemoIndustryId[] = [
  'mining',
  'construction',
  'agriculture',
  'transport',
  'hospital',
];

describe('industryDemos catalog', () => {
  it('expone exactamente 5 industrias', () => {
    expect(Object.keys(INDUSTRY_DEMOS)).toHaveLength(5);
  });

  it.each(ALL_IDS)('demo %s tiene shape mínimo válido', (id) => {
    const demo = getDemoByIndustry(id);
    expect(demo.id).toBe(id);
    expect(demo.projectSlug).toMatch(/^demo-/);
    expect(demo.projectName).toMatch(/^Demo:/);
    expect(demo.industryPrefix).toMatch(/^GP-/);
    expect(demo.workers.length).toBeGreaterThan(0);
    expect(demo.risks.length).toBeGreaterThan(0);
    expect(demo.eppAssignments.length).toBeGreaterThan(0);
  });

  it('cada worker tiene uid único dentro del demo', () => {
    for (const id of ALL_IDS) {
      const demo = INDUSTRY_DEMOS[id];
      const uids = demo.workers.map((w) => w.uid);
      const unique = new Set(uids);
      expect(unique.size).toBe(uids.length);
    }
  });

  it('todo affectedWorkerUid de un risk apunta a un worker existente', () => {
    for (const id of ALL_IDS) {
      const demo = INDUSTRY_DEMOS[id];
      const validUids = new Set(demo.workers.map((w) => w.uid));
      for (const risk of demo.risks) {
        for (const uid of risk.affectedWorkerUids) {
          expect(validUids.has(uid)).toBe(true);
        }
      }
    }
  });

  it('todo training.workerUid apunta a un worker del demo', () => {
    for (const id of ALL_IDS) {
      const demo = INDUSTRY_DEMOS[id];
      const validUids = new Set(demo.workers.map((w) => w.uid));
      for (const t of demo.trainings) {
        expect(validUids.has(t.workerUid)).toBe(true);
      }
    }
  });

  it('todo eppAssignment.workerUid apunta a un worker del demo', () => {
    for (const id of ALL_IDS) {
      const demo = INDUSTRY_DEMOS[id];
      const validUids = new Set(demo.workers.map((w) => w.uid));
      for (const epp of demo.eppAssignments) {
        expect(validUids.has(epp.workerUid)).toBe(true);
      }
    }
  });

  it('demo de minería tiene combinación de riesgos clásicos del sector', () => {
    const demo = INDUSTRY_DEMOS.mining;
    const riskTypes = demo.risks.map((r) => r.riskType.toLowerCase()).join(' ');
    expect(riskTypes).toMatch(/silice/);
    expect(riskTypes).toMatch(/confinado/);
    expect(riskTypes).toMatch(/maquinaria/);
  });

  it('demo de construcción tiene altura + subcontratos eléctricos', () => {
    const demo = INDUSTRY_DEMOS.construction;
    const riskTypes = demo.risks
      .map((r) => r.riskType.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
      .join(' ');
    expect(riskTypes).toMatch(/altura/);
    expect(riskTypes).toMatch(/electric/);
  });

  it('demo de transporte tiene jornada nocturna + fatiga', () => {
    const demo = INDUSTRY_DEMOS.transport;
    const riskTypes = demo.risks.map((r) => r.riskType.toLowerCase()).join(' ');
    expect(riskTypes).toMatch(/fatiga/);
  });

  it('demo de hospital tiene riesgo biológico', () => {
    const demo = INDUSTRY_DEMOS.hospital;
    const riskTypes = demo.risks.map((r) => r.riskType.toLowerCase()).join(' ');
    expect(riskTypes).toMatch(/biologic/);
  });

  it('listAvailableIndustries devuelve 5 items con shape para LandingPage', () => {
    const list = listAvailableIndustries();
    expect(list).toHaveLength(5);
    for (const entry of list) {
      expect(entry.id).toBeTruthy();
      expect(entry.projectName).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it('al menos un EPP de minería ya vencido (para mostrar semáforo rojo)', () => {
    const demo = INDUSTRY_DEMOS.mining;
    const hasExpired = demo.eppAssignments.some(
      (e) => e.expiresAt && new Date(e.expiresAt).getTime() < Date.now(),
    );
    expect(hasExpired).toBe(true);
  });

  it('al menos un training de construcción ya vencido', () => {
    const demo = INDUSTRY_DEMOS.construction;
    const hasExpired = demo.trainings.some((t) => t.status === 'vencido');
    expect(hasExpired).toBe(true);
  });
});
