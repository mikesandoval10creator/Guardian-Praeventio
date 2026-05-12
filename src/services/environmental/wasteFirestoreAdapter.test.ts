import { describe, it, expect } from 'vitest';
import { WasteAdapter } from './wasteFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { WasteRecord, WasteManifest, EnvironmentalPermit } from './environmentalCompliance.js';

function waste(over: Partial<WasteRecord> & { id: string }): WasteRecord {
  return {
    id: over.id,
    kind: over.kind ?? 'hazardous',
    description: 'd',
    quantityKg: 10,
    generatedAt: over.generatedAt ?? '2026-05-11T10:00:00Z',
    storageLocation: 'b1',
    manifestId: over.manifestId,
  };
}

describe('WasteAdapter — wastes', () => {
  it('saveWaste + getWaste', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveWaste(waste({ id: 'w1' }));
    expect((await a.getWaste('w1'))?.id).toBe('w1');
  });

  it('listInStock excluye con manifestId', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveWaste(waste({ id: 'in-stock' }));
    await a.saveWaste(waste({ id: 'dispatched', manifestId: 'm1' }));
    const list = await a.listInStock();
    expect(list.map((w) => w.id)).toEqual(['in-stock']);
  });

  it('listByKind filtra y ordena', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveWaste(waste({ id: 'haz-old', kind: 'hazardous', generatedAt: '2026-05-09T10:00:00Z' }));
    await a.saveWaste(waste({ id: 'haz-new', kind: 'hazardous', generatedAt: '2026-05-11T10:00:00Z' }));
    await a.saveWaste(waste({ id: 'rec', kind: 'recyclable' }));
    const list = await a.listByKind('hazardous');
    expect(list[0].id).toBe('haz-new');
  });

  it('linkToManifest actualiza N residuos', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveWaste(waste({ id: 'w1' }));
    await a.saveWaste(waste({ id: 'w2' }));
    await a.linkToManifest(['w1', 'w2'], 'M-1');
    expect((await a.getWaste('w1'))?.manifestId).toBe('M-1');
    expect((await a.getWaste('w2'))?.manifestId).toBe('M-1');
  });
});

describe('WasteAdapter — manifests', () => {
  function manifest(over: Partial<WasteManifest> & { id: string }): WasteManifest {
    return {
      id: over.id,
      wasteIds: ['w1'],
      transporterId: 'T1',
      receiverId: 'R1',
      dispatchedAt: '2026-05-11T10:00:00Z',
      hasDiscrepancy: false,
      receivedAt: over.receivedAt,
    };
  }

  it('saveManifest + getManifest', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveManifest(manifest({ id: 'M-1' }));
    expect((await a.getManifest('M-1'))?.id).toBe('M-1');
  });

  it('recordManifestReception persiste', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveManifest(manifest({ id: 'M-1' }));
    await a.recordManifestReception('M-1', '2026-05-13T10:00:00Z', false);
    const got = await a.getManifest('M-1');
    expect(got?.receivedAt).toBe('2026-05-13T10:00:00Z');
  });

  it('listManifestsPendingReception excluye recibidos', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    await a.saveManifest(manifest({ id: 'pending' }));
    await a.saveManifest(manifest({ id: 'received', receivedAt: '2026-05-12T10:00:00Z' }));
    const list = await a.listManifestsPendingReception();
    expect(list.map((m) => m.id)).toEqual(['pending']);
  });
});

describe('WasteAdapter — permits', () => {
  it('savePermit + listPermits ordenado por expiresAt asc', async () => {
    const db = createFakeFirestore();
    const a = new WasteAdapter(db, 't1', 'p1');
    const p1: EnvironmentalPermit = {
      id: 'p1',
      kind: 'RCA',
      issuedAt: '2024-01-01',
      expiresAt: '2027-01-01T00:00:00Z',
      reference: 'r1',
    };
    const p2: EnvironmentalPermit = {
      id: 'p2',
      kind: 'DIA',
      issuedAt: '2024-01-01',
      expiresAt: '2026-06-01T00:00:00Z',
      reference: 'r2',
    };
    await a.savePermit(p1);
    await a.savePermit(p2);
    const list = await a.listPermits();
    expect(list[0].id).toBe('p2'); // expira antes
  });
});
