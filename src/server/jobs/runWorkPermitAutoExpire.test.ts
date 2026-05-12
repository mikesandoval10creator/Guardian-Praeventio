import { describe, it, expect, vi } from 'vitest';
import { runWorkPermitAutoExpire } from './runWorkPermitAutoExpire.js';

function buildDb(opts: {
  expiredDocs: Array<{ id: string; data: Record<string, unknown> }>;
  scanShouldFail?: boolean;
  writeShouldFailFor?: Set<string>;
}) {
  const writes: Array<{ path: string; data: unknown; merge?: boolean }> = [];

  const collection = (_name: string) => ({
    where(_field: string, _op: string, _val: unknown): any {
      return {
        where(_f2: string, _o2: string, _v2: unknown) {
          return {
            async get() {
              if (opts.scanShouldFail) throw new Error('scan boom');
              return {
                size: opts.expiredDocs.length,
                docs: opts.expiredDocs.map((d) => ({ id: d.id, data: () => d.data })),
              };
            },
          };
        },
      };
    },
    doc(id: string) {
      return {
        async set(data: unknown, options: { merge?: boolean }) {
          if (opts.writeShouldFailFor?.has(id)) throw new Error('write boom');
          writes.push({ path: `work_permits/${id}`, data, merge: options?.merge });
        },
      };
    },
  });

  return {
    db: { collection } as any,
    writes,
  };
}

const NOW = () => new Date('2026-05-12T12:00:00Z');

describe('runWorkPermitAutoExpire', () => {
  it('escribe status=expired en cada permit vencido', async () => {
    const { db, writes } = buildDb({
      expiredDocs: [
        { id: 'wp1', data: { workerUid: 'w1', kind: 'altura', validUntil: '2026-05-10T00:00:00Z' } },
        { id: 'wp2', data: { workerUid: 'w2', kind: 'caliente', validUntil: '2026-05-11T00:00:00Z' } },
      ],
    });
    const r = await runWorkPermitAutoExpire({ db, now: NOW });
    expect(r.scanned).toBe(2);
    expect(r.expired).toBe(2);
    expect(writes).toHaveLength(2);
    expect((writes[0].data as any).expiredBy).toBe('cron.runWorkPermitAutoExpire');
  });

  it('sin docs vencidos → 0', async () => {
    const { db } = buildDb({ expiredDocs: [] });
    const r = await runWorkPermitAutoExpire({ db, now: NOW });
    expect(r.expired).toBe(0);
  });

  it('scan failure → errors=1', async () => {
    const { db } = buildDb({ expiredDocs: [], scanShouldFail: true });
    const r = await runWorkPermitAutoExpire({ db, now: NOW });
    expect(r.errors).toBe(1);
  });

  it('notifica con shape worker/kind/validUntil', async () => {
    const { db } = buildDb({
      expiredDocs: [
        { id: 'wp1', data: { workerUid: 'w1', kind: 'confinado', validUntil: '2026-05-10T00:00:00Z' } },
      ],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    await runWorkPermitAutoExpire({ db, now: NOW, notifyExpired: notify });
    expect(notify).toHaveBeenCalledWith('wp1', expect.objectContaining({
      workerUid: 'w1',
      kind: 'confinado',
    }));
  });

  it('partial write failure → expired y errors separados', async () => {
    const { db, writes } = buildDb({
      expiredDocs: [
        { id: 'wp1', data: { validUntil: '2026-05-10T00:00:00Z' } },
        { id: 'wp2', data: { validUntil: '2026-05-11T00:00:00Z' } },
      ],
      writeShouldFailFor: new Set(['wp1']),
    });
    const r = await runWorkPermitAutoExpire({ db, now: NOW });
    expect(r.expired).toBe(1);
    expect(r.errors).toBe(1);
    expect(writes.map((w) => w.path)).toEqual(['work_permits/wp2']);
  });
});
