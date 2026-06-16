import { describe, it, expect, vi } from 'vitest';
import type adminNs from 'firebase-admin';
import { runUfRateRefresh } from './runUfRateRefresh.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const NOW = () => new Date('2026-06-16T05:00:00Z');
const asFirestore = (db: ReturnType<typeof createFakeFirestore>) =>
  db as unknown as adminNs.firestore.Firestore;

const validPayload = { serie: [{ fecha: '2026-06-16T04:00:00.000Z', valor: 38500 }] };

describe('runUfRateRefresh', () => {
  it('caches the fetched UF value into ufRates/current', async () => {
    const db = createFakeFirestore();
    const r = await runUfRateRefresh({
      db: asFirestore(db),
      fetchUf: async () => validPayload,
      now: NOW,
    });
    expect(r.updated).toBe(true);
    expect(r.rate).toEqual({ valueClp: 38500, date: '2026-06-16' });
    const cached = db._store.get('ufRates/current') as Record<string, unknown>;
    expect(cached.valueClp).toBe(38500);
    expect(cached.date).toBe('2026-06-16');
    expect(cached.source).toBe('mindicador.cl');
  });

  it('fail-soft on fetch error: does NOT overwrite the cached value', async () => {
    const db = createFakeFirestore();
    db._seed('ufRates/current', { valueClp: 38000, date: '2026-06-15', source: 'mindicador.cl' });
    const r = await runUfRateRefresh({
      db: asFirestore(db),
      fetchUf: async () => {
        throw new Error('network down');
      },
      now: NOW,
    });
    expect(r.updated).toBe(false);
    expect(r.reason).toBe('fetch_failed');
    // Last good value preserved.
    const cached = db._store.get('ufRates/current') as Record<string, unknown>;
    expect(cached.valueClp).toBe(38000);
    expect(cached.date).toBe('2026-06-15');
  });

  it('fail-soft on parse error: does NOT overwrite the cached value', async () => {
    const db = createFakeFirestore();
    db._seed('ufRates/current', { valueClp: 38000, date: '2026-06-15' });
    const r = await runUfRateRefresh({
      db: asFirestore(db),
      fetchUf: async () => ({ serie: [] }),
      now: NOW,
    });
    expect(r.updated).toBe(false);
    expect(r.reason).toBe('parse_failed');
    expect((db._store.get('ufRates/current') as Record<string, unknown>).valueClp).toBe(38000);
  });

  it('awaits the injected fetcher exactly once', async () => {
    const db = createFakeFirestore();
    const fetchUf = vi.fn(async () => validPayload);
    await runUfRateRefresh({ db: asFirestore(db), fetchUf, now: NOW });
    expect(fetchUf).toHaveBeenCalledTimes(1);
  });
});
