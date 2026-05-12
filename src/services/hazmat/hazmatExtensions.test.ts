import { describe, it, expect, vi } from 'vitest';
import {
  substanceQrLookup,
  getSpillProtocol,
  storageCompatibilityCheck,
  checkWasteCapacity,
  type HdsRepository,
} from './hazmatExtensions.js';

function mockRepo(over: Partial<Awaited<ReturnType<HdsRepository['fetchSubstanceSummary']>>> = {}): HdsRepository {
  return {
    fetchSubstanceSummary: vi.fn().mockResolvedValue({
      substanceId: 's1',
      commonName: 'Ácido sulfúrico',
      family: 'acido_fuerte',
      pictograms: ['GHS05'],
      hStatements: ['H314'],
      pStatements: ['P280'],
      recommendedEpp: ['guantes nitrilo', 'careta facial'],
      firstAidSteps: ['lavar con agua 15min'],
      currentHdsVersion: 'v3',
      hdsPublishedAt: '2025-01-01T00:00:00Z',
      ...over,
    }),
  };
}

describe('substanceQrLookup', () => {
  it('QR vigente → hdsCurrent=true sin advisory', async () => {
    const repo = mockRepo();
    const r = await substanceQrLookup({ substanceId: 's1', hdsVersion: 'v3' }, repo, '2025-06-01T00:00:00Z');
    expect(r?.hdsCurrent).toBe(true);
    expect(r?.hdsAdvisory).toBeNull();
  });

  it('QR con versión vieja → advisory de re-imprimir', async () => {
    const repo = mockRepo();
    const r = await substanceQrLookup({ substanceId: 's1', hdsVersion: 'v2' }, repo, '2025-06-01T00:00:00Z');
    expect(r?.hdsCurrent).toBe(false);
    expect(r?.hdsAdvisory).toMatch(/Re-imprimir/);
  });

  it('HDS antigua >2 años → advisory de actualización', async () => {
    const repo = mockRepo({ hdsPublishedAt: '2020-01-01T00:00:00Z' });
    const r = await substanceQrLookup({ substanceId: 's1', hdsVersion: 'v3' }, repo, '2026-01-01T00:00:00Z');
    expect(r?.hdsCurrent).toBe(true);
    expect(r?.hdsAdvisory).toMatch(/Solicitar actualización/);
  });

  it('substanceId desconocido → null', async () => {
    const repo: HdsRepository = {
      fetchSubstanceSummary: vi.fn().mockResolvedValue(null),
    };
    const r = await substanceQrLookup({ substanceId: 'unknown', hdsVersion: 'v1' }, repo);
    expect(r).toBeNull();
  });
});

describe('getSpillProtocol', () => {
  it('inflamable activa SOS', () => {
    const p = getSpillProtocol('inflamable');
    expect(p.triggerSos).toBe(true);
    expect(p.steps[0]).toMatch(/ignición|encender|chispa/i);
  });

  it('biológico NO requiere notificación ambiental', () => {
    const p = getSpillProtocol('biologico');
    expect(p.notifyEnvironmentalAuthority).toBe(false);
  });

  it('reactivo_agua excluye uso de agua', () => {
    const p = getSpillProtocol('reactivo_agua');
    expect(p.steps[0]).toMatch(/NO usar agua/);
  });

  it('toxico requiere respirador full-face', () => {
    const p = getSpillProtocol('toxico');
    expect(p.responseEpp).toContain('respirador full-face');
  });
});

describe('storageCompatibilityCheck', () => {
  it('mismo family → compatible', () => {
    expect(storageCompatibilityCheck('acido_fuerte', 'acido_fuerte')).toBe('compatible');
  });

  it('ácido + base → never', () => {
    expect(storageCompatibilityCheck('acido_fuerte', 'base_fuerte')).toBe('never');
  });

  it('inflamable + comburente → never', () => {
    expect(storageCompatibilityCheck('inflamable', 'comburente')).toBe('never');
  });

  it('ácido + inflamable → segregate', () => {
    expect(storageCompatibilityCheck('acido_fuerte', 'inflamable')).toBe('segregate');
  });

  it('matriz simétrica (A,B = B,A)', () => {
    expect(storageCompatibilityCheck('acido_fuerte', 'inflamable')).toBe(
      storageCompatibilityCheck('inflamable', 'acido_fuerte'),
    );
  });

  it('familias sin regla específica → compatible', () => {
    expect(storageCompatibilityCheck('toxico', 'biologico')).toBe('compatible');
  });
});

describe('checkWasteCapacity', () => {
  it('<80% → ok', () => {
    const r = checkWasteCapacity({
      id: 'c1',
      capacityLiters: 200,
      currentFillLiters: 100,
      family: 'toxico',
    });
    expect(r.level).toBe('ok');
  });

  it('80-95% → warning', () => {
    const r = checkWasteCapacity({
      id: 'c1',
      capacityLiters: 200,
      currentFillLiters: 170,
      family: 'toxico',
    });
    expect(r.level).toBe('warning');
  });

  it('95-100% → critical', () => {
    const r = checkWasteCapacity({
      id: 'c1',
      capacityLiters: 200,
      currentFillLiters: 192,
      family: 'toxico',
    });
    expect(r.level).toBe('critical');
  });

  it('100%+ → full', () => {
    const r = checkWasteCapacity({
      id: 'c1',
      capacityLiters: 200,
      currentFillLiters: 200,
      family: 'toxico',
    });
    expect(r.level).toBe('full');
  });
});
