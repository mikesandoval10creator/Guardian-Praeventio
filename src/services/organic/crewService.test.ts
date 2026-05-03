// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  createMemoryCrewStore,
  createCrew,
  getCrews,
  addMemberToCrew,
  removeMember,
  awardCrewXp,
  getOrCreateDefaultCrew,
} from './crewService';

describe('crewService', () => {
  it('creates a crew and lists it by project', async () => {
    const store = createMemoryCrewStore();
    const c = await createCrew(store, 'p1', 'Alfa', ['u1', 'u2']);
    expect(c.name).toBe('Alfa');
    expect(c.memberUids).toEqual(['u1', 'u2']);
    expect(c.xp).toBe(0);
    const list = await getCrews(store, 'p1');
    expect(list).toHaveLength(1);
  });

  it('rejects empty name and missing projectId', async () => {
    const store = createMemoryCrewStore();
    await expect(createCrew(store, '', 'Alfa', [])).rejects.toThrow();
    await expect(createCrew(store, 'p1', '   ', [])).rejects.toThrow();
  });

  it('adds and removes members idempotently', async () => {
    const store = createMemoryCrewStore();
    const c = await createCrew(store, 'p1', 'Alfa', ['u1']);
    const added = await addMemberToCrew(store, c.id, 'u2');
    expect(added.memberUids).toEqual(['u1', 'u2']);
    const addedAgain = await addMemberToCrew(store, c.id, 'u2');
    expect(addedAgain.memberUids).toEqual(['u1', 'u2']);
    const removed = await removeMember(store, c.id, 'u1');
    expect(removed.memberUids).toEqual(['u2']);
  });

  it('awards positive XP and ignores non-positive amounts', async () => {
    const store = createMemoryCrewStore();
    const c = await createCrew(store, 'p1', 'Alfa', []);
    const a = await awardCrewXp(store, c.id, 10, 'reportar_nearmiss');
    expect(a.xp).toBe(10);
    const b = await awardCrewXp(store, c.id, -5, 'days_no_incident');
    expect(b.xp).toBe(10); // unchanged
    const z = await awardCrewXp(store, c.id, 0, 'task_done');
    expect(z.xp).toBe(10); // unchanged
  });

  it('getOrCreateDefaultCrew returns existing or creates default', async () => {
    const store = createMemoryCrewStore();
    const created = await getOrCreateDefaultCrew(store, 'p1', ['u1', 'u2']);
    expect(created.name).toBe('Cuadrilla principal');
    const again = await getOrCreateDefaultCrew(store, 'p1', ['u3']);
    expect(again.id).toBe(created.id); // doesn't recreate
  });
});
