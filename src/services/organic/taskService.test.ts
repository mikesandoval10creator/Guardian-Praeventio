// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  createMemoryTaskStore,
  createTask,
  markTaskDone,
  getTasksByProcess,
} from './taskService';

describe('taskService', () => {
  it('creates a task and lists by process', async () => {
    const store = createMemoryTaskStore();
    const t = await createTask(store, {
      processId: 'pr1',
      crewId: 'c1',
      projectId: 'p1',
      date: '2026-05-02',
      description: 'Inspeccionar andamios',
      assignedUids: ['u1'],
    });
    expect(t.status).toBe('pending');
    expect(t.completedAt).toBeNull();
    const list = await getTasksByProcess(store, 'pr1');
    expect(list).toHaveLength(1);
  });

  it('markTaskDone updates status and timestamp', async () => {
    const store = createMemoryTaskStore();
    const t = await createTask(store, {
      processId: 'pr1',
      crewId: 'c1',
      projectId: 'p1',
      date: '2026-05-02',
      description: 'X',
    });
    const done = await markTaskDone(store, t.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeTruthy();
  });

  it('rejects empty processId', async () => {
    const store = createMemoryTaskStore();
    await expect(
      createTask(store, {
        processId: '',
        crewId: 'c1',
        projectId: 'p1',
        date: '2026-05-02',
        description: 'X',
      })
    ).rejects.toThrow();
  });
});
