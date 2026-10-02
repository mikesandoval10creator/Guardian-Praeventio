import { describe, expect, it } from 'vitest';
import { buildMaintenanceTask, scheduleMaintenanceTask, type MaintenanceTask, type MaintenanceTaskStore } from './maintenanceScheduler';

const task = () => buildMaintenanceTask({
  projectId: 'project-a', equipmentId: 'eq-a', equipmentType: 'compresor',
  cross: { cycleHours: 250, multiplier: 1, triggeredAtHours: 250, severity: 'low' },
  triggeredAtIso: '2026-10-01T10:00:00.000Z',
});

function storeFor(existing?: MaintenanceTask) {
  let persisted = existing;
  const store: MaintenanceTaskStore & { createTaskIfAbsent(task: MaintenanceTask): Promise<MaintenanceTask> } = {
    async createTaskIfAbsent(candidate) {
      persisted ??= candidate;
      return persisted;
    },
    async saveTask(candidate) { persisted = candidate; },
    async getTaskById() { return persisted ?? null; },
    async listActiveByProject() { return []; },
  };
  return { store, read: () => persisted };
}

describe('maintenance scheduling preserves lifecycle state', () => {
  it.each(['cancelled', 'completed', 'scheduled', 'in_progress'] as const)(
    'replaying the same threshold preserves %s and its original metadata', async (status) => {
      const original = { ...task(), status, notes: 'Keep the operator decision', completion: status === 'completed' ? { completedByUid: 'technician', completedAt: '2026-10-01T11:00:00.000Z', notes: 'Signed closure' } : undefined };
      const fake = storeFor(original);
      const result = await scheduleMaintenanceTask({ tenantId: 'tenant-a', task: task() }, fake.store);
      expect(result).toEqual(original);
      expect(fake.read()).toEqual(original);
    },
  );

  it('creates an open task for a new threshold', async () => {
    const fake = storeFor();
    const result = await scheduleMaintenanceTask({ tenantId: 'tenant-a', task: task() }, fake.store);
    expect(result.status).toBe('open');
    expect(fake.read()).toEqual(result);
  });
});
