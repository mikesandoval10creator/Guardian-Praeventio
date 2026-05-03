// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  createMemoryProcessStore,
  startProcess,
  pauseProcess,
  resumeProcess,
  recordAlertResponded,
  closeProcess,
  computeProcessCloseXp,
  baseXpForProcessType,
} from './processService';
import { createMemoryCrewStore, createCrew } from './crewService';

describe('processService', () => {
  it('startProcess sets status active and timestamps', async () => {
    const ps = createMemoryProcessStore();
    const p = await startProcess(ps, {
      crewId: 'c1',
      projectId: 'p1',
      type: 'concreto',
      name: 'Vaciado losa A',
    });
    expect(p.status).toBe('active');
    expect(p.startedAt).toBeTruthy();
    expect(p.endedAt).toBeNull();
    expect(p.complianceScore).toBe(100);
  });

  it('pause/resume toggles status', async () => {
    const ps = createMemoryProcessStore();
    const p = await startProcess(ps, {
      crewId: 'c1',
      projectId: 'p1',
      type: 'fachada',
      name: 'Andamio Norte',
    });
    const paused = await pauseProcess(ps, p.id);
    expect(paused.status).toBe('paused');
    const resumed = await resumeProcess(ps, p.id);
    expect(resumed.status).toBe('active');
  });

  it('records alerts responded', async () => {
    const ps = createMemoryProcessStore();
    const p = await startProcess(ps, {
      crewId: 'c1',
      projectId: 'p1',
      type: 'soldadura',
      name: 'Junta T-23',
    });
    const a = await recordAlertResponded(ps, p.id);
    expect(a.alertsResponded).toBe(1);
    const b = await recordAlertResponded(ps, p.id);
    expect(b.alertsResponded).toBe(2);
  });

  it('computeProcessCloseXp formula: positive only, alert bonus applied', () => {
    const baseFachada = baseXpForProcessType('fachada');
    expect(computeProcessCloseXp('fachada', 100, 0)).toBe(baseFachada);
    expect(computeProcessCloseXp('fachada', 80, 0)).toBe(Math.floor(baseFachada * 0.8));
    expect(computeProcessCloseXp('fachada', 100, 4)).toBe(Math.floor(baseFachada * 1.2));
    // negative compliance is clamped
    expect(computeProcessCloseXp('fachada', -10, 0)).toBe(0);
    // out-of-range compliance clamps to 100
    expect(computeProcessCloseXp('fachada', 200, 0)).toBe(baseFachada);
  });

  it('closeProcess awards XP to crew and increments counter', async () => {
    const ps = createMemoryProcessStore();
    const cs = createMemoryCrewStore();
    const crew = await createCrew(cs, 'p1', 'Alfa', ['u1']);
    const p = await startProcess(ps, {
      crewId: crew.id,
      projectId: 'p1',
      type: 'concreto',
      name: 'Vaciado',
    });
    await recordAlertResponded(ps, p.id);
    const result = await closeProcess(ps, cs, p.id, 90);
    expect(result.process.status).toBe('completed');
    expect(result.process.endedAt).toBeTruthy();
    expect(result.xpAwarded).toBeGreaterThan(0);
    const updatedCrew = await cs.get(crew.id);
    expect(updatedCrew?.totalProcessesCompleted).toBe(1);
    expect(updatedCrew?.xp).toBe(result.xpAwarded);
  });

  it('closeProcess refuses to close already-terminal process', async () => {
    const ps = createMemoryProcessStore();
    const cs = createMemoryCrewStore();
    const crew = await createCrew(cs, 'p1', 'Alfa', []);
    const p = await startProcess(ps, {
      crewId: crew.id,
      projectId: 'p1',
      type: 'pintura',
      name: 'Hall',
    });
    await closeProcess(ps, cs, p.id, 100);
    await expect(closeProcess(ps, cs, p.id, 80)).rejects.toThrow();
  });
});
