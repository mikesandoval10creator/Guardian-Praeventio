import { describe, it, expect, vi } from 'vitest';
import { runExceptionAutoExpire } from './runExceptionAutoExpire.js';

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
                docs: opts.expiredDocs.map((d) => ({
                  id: d.id,
                  data: () => d.data,
                })),
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
          writes.push({ path: `exceptions/${id}`, data, merge: options?.merge });
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

describe('runExceptionAutoExpire', () => {
  it('escribe status=expired en cada doc match', async () => {
    const { db, writes } = buildDb({
      expiredDocs: [
        { id: 'e1', data: { validUntil: '2026-05-10T00:00:00Z' } },
        { id: 'e2', data: { validUntil: '2026-05-11T00:00:00Z' } },
      ],
    });

    const r = await runExceptionAutoExpire({ db, now: NOW });
    expect(r.scanned).toBe(2);
    expect(r.expired).toBe(2);
    expect(r.errors).toBe(0);
    expect(writes).toHaveLength(2);
    expect((writes[0].data as Record<string, unknown>).status).toBe('expired');
    expect(writes[0].merge).toBe(true);
  });

  it('sin docs activos vencidos → expired=0', async () => {
    const { db } = buildDb({ expiredDocs: [] });
    const r = await runExceptionAutoExpire({ db, now: NOW });
    expect(r.scanned).toBe(0);
    expect(r.expired).toBe(0);
  });

  it('falla de scan no rompe — devuelve error count', async () => {
    const { db } = buildDb({ expiredDocs: [], scanShouldFail: true });
    const r = await runExceptionAutoExpire({ db, now: NOW });
    expect(r.errors).toBe(1);
    expect(r.expired).toBe(0);
  });

  it('escribe partial — algunos OK, otros fallan', async () => {
    const { db, writes } = buildDb({
      expiredDocs: [
        { id: 'e1', data: { validUntil: '2026-05-10T00:00:00Z' } },
        { id: 'e2', data: { validUntil: '2026-05-11T00:00:00Z' } },
        { id: 'e3', data: { validUntil: '2026-05-09T00:00:00Z' } },
      ],
      writeShouldFailFor: new Set(['e2']),
    });
    const r = await runExceptionAutoExpire({ db, now: NOW });
    expect(r.scanned).toBe(3);
    expect(r.expired).toBe(2);
    expect(r.errors).toBe(1);
    expect(writes.map((w) => w.path).sort()).toEqual(['exceptions/e1', 'exceptions/e3']);
  });

  it('notifica al hook si está provisto', async () => {
    const { db } = buildDb({
      expiredDocs: [
        {
          id: 'e1',
          data: { validUntil: '2026-05-10T00:00:00Z', subjectRef: { kind: 'WORKER', id: 'w1' } },
        },
      ],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    await runExceptionAutoExpire({ db, now: NOW, notifyExpired: notify });
    expect(notify).toHaveBeenCalledWith('e1', expect.objectContaining({
      subjectRef: expect.objectContaining({ id: 'w1' }),
    }));
  });

  it('errores de notify NO incrementan errors (solo write fails lo hacen)', async () => {
    const { db } = buildDb({
      expiredDocs: [{ id: 'e1', data: { validUntil: '2026-05-10T00:00:00Z' } }],
    });
    const notify = vi.fn().mockRejectedValue(new Error('FCM down'));
    const r = await runExceptionAutoExpire({ db, now: NOW, notifyExpired: notify });
    expect(r.expired).toBe(1);
    expect(r.errors).toBe(0);
  });
});
