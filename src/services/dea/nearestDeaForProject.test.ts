// OLA 1 C5 (2026-06-14) — nearestDeaForProject. Pins the read-only listAll +
// nearestDea join the lone-worker escalation cron uses to route a responder to
// the closest defibrillator.

import { describe, it, expect } from 'vitest';
import { nearestDeaForProject } from './nearestDeaForProject';
import type { Dea } from './deaService';
import type { DeaFirestoreDb } from './deaFirestoreAdapter';

function fakeDb(deas: Dea[]): DeaFirestoreDb {
  return {
    collection: () => ({
      limit: () => ({ get: async () => ({ docs: deas.map((d) => ({ data: () => d })) }) }),
    }),
  };
}

const dea = (id: string, lat: number, lng: number): Dea => ({
  id,
  location: `DEA ${id}`,
  description: '',
  batteryExpiry: '',
  padsExpiry: '',
  lastCheck: '',
  assignedToUid: '',
  assignedToName: '',
  createdAt: '',
  createdBy: '',
  coordinates: { lat, lng },
});

const FROM = { lat: -33.45, lng: -70.66 };

describe('nearestDeaForProject', () => {
  it('returns the DEA closest to the location with its distance + coords', async () => {
    const db = fakeDb([dea('far', -33.5, -70.7), dea('near', -33.451, -70.661)]);
    const r = await nearestDeaForProject(db, 't1', 'p1', FROM);
    expect(r?.location).toBe('DEA near');
    expect(r?.coords).toEqual({ lat: -33.451, lng: -70.661 });
    expect(r?.distanceM).toBeGreaterThan(0);
  });

  it('returns null when the project has no DEAs', async () => {
    expect(await nearestDeaForProject(fakeDb([]), 't1', 'p1', FROM)).toBeNull();
  });

  it('skips DEAs without coordinates (cannot be located)', async () => {
    const noCoord = { ...dea('x', 0, 0), coordinates: undefined } as Dea;
    const db = fakeDb([noCoord, dea('located', -33.451, -70.661)]);
    const r = await nearestDeaForProject(db, 't1', 'p1', FROM);
    expect(r?.location).toBe('DEA located');
  });
});
