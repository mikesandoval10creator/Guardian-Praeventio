// Real-router supertest for src/server/routes/bcn.ts
// (GET /api/bcn/snapshot — BCN = Biblioteca del Congreso Nacional law corpus).
//
// The router has ONE public endpoint (no verifyAuth, no Firestore). Its data
// source is the EXTERNAL BCN HTTP API (https://www.leychile.cl/...), reached
// through src/services/bcnService.ts:fetchLawFromBCN(). We therefore mock the
// whole bcnService module (the repo's established convention — see
// src/services/ragService.test.ts) so every test is deterministic and never
// hits the network. CRITICAL_LAWS is mocked to a small, fixed list so the
// route fans out a known number of fetches.
//
// The router keeps a MODULE-LEVEL in-memory cache (cachedSnapshot / cachedAt,
// 1h TTL). To isolate tests we vi.resetModules() in beforeEach and dynamically
// re-import a FRESH copy of the router (empty cache) per test. The hoisted
// spies survive the reset, so each test can reconfigure fetchLawFromBCN before
// mounting. One dedicated test re-imports the router ONCE and hits it twice to
// assert the cache is actually used (no refetch within TTL).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { BCNLaw } from '../../services/bcnService.js';

// ─── Hoisted spies (available before vi.mock hoisting + survive resetModules) ──
const H = vi.hoisted(() => ({
  fetchLawFromBCN: vi.fn(),
  // The route only reads CRITICAL_LAWS.length and law.id, so a 2-entry list
  // is enough to exercise the fan-out, partial-failure and all-failure paths.
  CRITICAL_LAWS: [
    { id: '28650', name: 'Ley 16.744 (Accidentes del Trabajo)' },
    { id: '14305', name: 'DS 594 (Condiciones Sanitarias y Ambientales)' },
  ],
}));

vi.mock('../../services/bcnService.js', () => ({
  fetchLawFromBCN: H.fetchLawFromBCN,
  CRITICAL_LAWS: H.CRITICAL_LAWS,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLaw(overrides: Partial<BCNLaw> = {}): BCNLaw {
  return {
    idNorma: '28650',
    titulo: 'Ley 16.744',
    fechaPublicacion: '1968-02-01',
    organismo: 'Ministerio del Trabajo y Previsión Social',
    texto: 'Texto íntegro de la Ley 16.744 sobre accidentes del trabajo.',
    ...overrides,
  };
}

/**
 * Reset module state (clears the in-memory snapshot cache) and mount a FRESH
 * router on a new express app. Returns the app ready for supertest.
 */
async function buildApp() {
  vi.resetModules();
  const { default: bcnRouter } = await import('../../server/routes/bcn.js');
  const app = express();
  app.use(express.json());
  app.use('/api/bcn', bcnRouter);
  return app;
}

beforeEach(() => {
  H.fetchLawFromBCN.mockReset();
});

// ─── GET /api/bcn/snapshot — happy path ────────────────────────────────────────

describe('GET /api/bcn/snapshot', () => {
  it('200 returns the snapshot envelope with mapped law fields when all laws fetch', async () => {
    H.fetchLawFromBCN
      .mockResolvedValueOnce(makeLaw({ idNorma: '28650', titulo: 'Ley 16.744', texto: 'AAA' }))
      .mockResolvedValueOnce(makeLaw({ idNorma: '14305', titulo: 'DS 594', texto: 'BBBBB' }));

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(200);
    const body = res.body as {
      version: string;
      fetchedAt: string;
      content: {
        laws: Array<Record<string, unknown>>;
        totalSizeBytes: number;
        citationsCount: number;
      };
    };

    // Envelope shape.
    expect(typeof body.version).toBe('string');
    expect(typeof body.fetchedAt).toBe('string');
    expect(new Date(body.version).toString()).not.toBe('Invalid Date');

    // Both laws present, citationsCount matches.
    expect(body.content.laws).toHaveLength(2);
    expect(body.content.citationsCount).toBe(2);

    // Each law is the mapped public shape (idNorma/titulo/fechaPublicacion/organismo/texto).
    const ids = body.content.laws.map((l) => l.idNorma);
    expect(ids).toContain('28650');
    expect(ids).toContain('14305');
    for (const law of body.content.laws) {
      expect(law).toHaveProperty('idNorma');
      expect(law).toHaveProperty('titulo');
      expect(law).toHaveProperty('fechaPublicacion');
      expect(law).toHaveProperty('organismo');
      expect(law).toHaveProperty('texto');
    }

    // totalSizeBytes is the sum of texto lengths ('AAA'=3 + 'BBBBB'=5 = 8).
    expect(body.content.totalSizeBytes).toBe(8);

    // One fetch per critical law.
    expect(H.fetchLawFromBCN).toHaveBeenCalledTimes(2);
    expect(H.fetchLawFromBCN).toHaveBeenCalledWith('28650');
    expect(H.fetchLawFromBCN).toHaveBeenCalledWith('14305');
  });

  it('200 serves the partial set (and correct count) when some laws fail to fetch', async () => {
    // First resolves, second rejects → only one law survives.
    H.fetchLawFromBCN
      .mockResolvedValueOnce(makeLaw({ idNorma: '28650', texto: 'X'.repeat(10) }))
      .mockRejectedValueOnce(new Error('BCN 500 for 14305'));

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(200);
    const body = res.body as {
      content: { laws: Array<Record<string, unknown>>; citationsCount: number; totalSizeBytes: number };
    };
    expect(body.content.laws).toHaveLength(1);
    expect(body.content.citationsCount).toBe(1);
    expect(body.content.laws[0].idNorma).toBe('28650');
    expect(body.content.totalSizeBytes).toBe(10);
  });

  it('200 treats a null fetch result as a failed law (allSettled-fulfilled-but-null)', async () => {
    // fetchLawFromBCN resolves null on its own internal error path; the route
    // only pushes truthy values, so a null+a real law yields one law.
    H.fetchLawFromBCN
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeLaw({ idNorma: '14305', texto: 'YY' }));

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(200);
    const body = res.body as { content: { laws: unknown[]; citationsCount: number } };
    expect(body.content.laws).toHaveLength(1);
    expect(body.content.citationsCount).toBe(1);
  });

  it('200 computes totalSizeBytes as 0 when a fetched law has no texto', async () => {
    // texto undefined → law.texto?.length ?? 0 contributes 0.
    H.fetchLawFromBCN
      .mockResolvedValueOnce(makeLaw({ idNorma: '28650', texto: undefined as unknown as string }))
      .mockResolvedValueOnce(null);

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(200);
    const body = res.body as { content: { totalSizeBytes: number; laws: unknown[] } };
    expect(body.content.laws).toHaveLength(1);
    expect(body.content.totalSizeBytes).toBe(0);
  });
});

// ─── 502 — BCN down, no cache ──────────────────────────────────────────────────

describe('GET /api/bcn/snapshot — BCN unavailable', () => {
  it('502 bcn_unavailable when ALL laws fail and there is no cached snapshot', async () => {
    H.fetchLawFromBCN.mockResolvedValue(null); // every law fails

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(502);
    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('bcn_unavailable');
    expect(typeof body.message).toBe('string');
    expect(body.message).toMatch(/Biblioteca del Congreso Nacional/);
    // Honesty directive: never fabricate data.
    expect(body.message).toMatch(/No servimos datos fabricados/);
  });

  it('502 also when all fetches reject (not just return null)', async () => {
    H.fetchLawFromBCN.mockRejectedValue(new Error('network down'));

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe('bcn_unavailable');
  });
});

// ─── 500 — unexpected error in the handler ─────────────────────────────────────

describe('GET /api/bcn/snapshot — unexpected error', () => {
  it('500 bcn_snapshot_error when the fan-out throws synchronously', async () => {
    // A synchronous throw inside CRITICAL_LAWS.map(...) escapes Promise.allSettled
    // and lands in the outer try/catch → 500 (not 502).
    H.fetchLawFromBCN.mockImplementation(() => {
      throw new Error('boom-sync');
    });

    const app = await buildApp();
    const res = await request(app).get('/api/bcn/snapshot');

    expect(res.status).toBe(500);
    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('bcn_snapshot_error');
    expect(body.message).toBe('boom-sync');
  });
});

// ─── Caching behaviour (module-level cache, single router instance) ────────────

describe('GET /api/bcn/snapshot — 1h in-memory cache', () => {
  it('serves the second request from cache without re-fetching BCN', async () => {
    // Build ONCE and reuse the same router instance across both requests so the
    // module-level cache persists between them.
    H.fetchLawFromBCN
      .mockResolvedValueOnce(makeLaw({ idNorma: '28650', texto: 'AAA' }))
      .mockResolvedValueOnce(makeLaw({ idNorma: '14305', texto: 'BBB' }));

    const app = await buildApp();

    const first = await request(app).get('/api/bcn/snapshot');
    expect(first.status).toBe(200);
    expect(H.fetchLawFromBCN).toHaveBeenCalledTimes(2);

    const firstBody = first.body as { version: string };

    // Second request: cache is warm (now - cachedAt < TTL) → no new fetches.
    const second = await request(app).get('/api/bcn/snapshot');
    expect(second.status).toBe(200);
    // Still exactly 2 calls total — the cache short-circuited the refetch.
    expect(H.fetchLawFromBCN).toHaveBeenCalledTimes(2);

    // Cached payload is identical (same version timestamp).
    expect((second.body as { version: string }).version).toBe(firstBody.version);
  });
});
