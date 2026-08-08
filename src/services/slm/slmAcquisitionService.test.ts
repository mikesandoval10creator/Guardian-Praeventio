// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCacheForTests,
  cacheModel,
} from './cache/modelCache';
import {
  DEFAULT_POSTPONE_HOURS,
  detectNetworkAdvisory,
  formatBytesHuman,
  getAcquisitionStatus,
  probePrePackagedAsset,
  recordAccepted,
  recordDeclined,
  recordPostponed,
  resetAcquisitionDecision,
} from './slmAcquisitionService';
import { MODEL_REGISTRY } from './registry';

// B14: ids by name (registry order changed — Qwen is now first/default).
const QWEN_ID = 'qwen-2.5-0.5b'; // pre-packaged
const PHI_ID = 'phi-3-mini';
const GEMMA_ID = 'gemma-2-2b'; // gated, no pre-pack

// Helper: stub fetch with a deterministic response builder so we can
// verify the new pre-pack probe (HEAD) works without burning real
// network. Sprint 50 E.11 P1 H7 added `probePrePackagedAsset` to
// verify the file is physically present.
function stubFetch(responses: Record<string, { ok: boolean; contentLength?: number | null }>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: unknown): Promise<Response> => {
      const candidate =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request)?.url ?? '';
      const key = Object.keys(responses).find((k) => candidate.endsWith(k)) ?? candidate;
      const spec = responses[key] ?? { ok: false };
      const headers = new Headers();
      if (spec.contentLength !== null && spec.contentLength !== undefined) {
        headers.set('content-length', String(spec.contentLength));
      }
      return new Response(null, { status: spec.ok ? 200 : 404, headers });
    },
  );
}

// Helper: clear localStorage. fake-indexeddb leaves global storage intact.
function clearStorage() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem('praeventio:slm:acquisition:v1');
    } catch {
      /* ignore */
    }
  }
}

describe('slmAcquisitionService', () => {
  beforeEach(() => {
    // Fresh IDB + localStorage every test.
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetCacheForTests();
    clearStorage();
  });

  afterEach(() => {
    resetAcquisitionDecision();
  });

  describe('getAcquisitionStatus', () => {
    it('Qwen (pre-packaged en registry + asset presente): ready', async () => {
      // Sprint 50 E.11 P1 H7 — now requires the file to be physically
      // present (HEAD probe). Stub fetch to return 200 with a real
      // content-length so the probe resolves to true.
      stubFetch({ 'model_q4f16.onnx': { ok: true, contentLength: 483003582 } });
      const s = await getAcquisitionStatus({ modelId: QWEN_ID });
      expect(s.state).toBe('ready');
      expect(s.isPrePackaged).toBe(true);
    });

    it('Qwen con prePackagedPath declarado pero asset 404: needs_prompt', async () => {
      // Ticket 39aaa66d-73fe-81db-9d7f-d5b82570f334 — the original bug:
      // trust the descriptor string and claim 'ready' even though the
      // file is missing in the bundle. Now the HEAD probe forces the
      // user to see the download prompt.
      stubFetch({ 'model_q4f16.onnx': { ok: false } });
      const s = await getAcquisitionStatus({ modelId: QWEN_ID });
      expect(s.state).toBe('needs_prompt');
      expect(s.isPrePackaged).toBe(true); // still flagged for context
    });

    it('Qwen con prePackagedPath declarado pero content-length 0: needs_prompt', async () => {
      // A zero-length file at the pre-pack URL is treated as missing
      // (real SLM weights are >100MB).
      stubFetch({ 'model_q4f16.onnx': { ok: true, contentLength: 0 } });
      const s = await getAcquisitionStatus({ modelId: QWEN_ID });
      expect(s.state).toBe('needs_prompt');
    });

    it('probePrePackagedAsset returns true on 200 OK with content-length', async () => {
      stubFetch({ '/models/test.onnx': { ok: true, contentLength: 100 } });
      const present = await probePrePackagedAsset('/models/test.onnx');
      expect(present).toBe(true);
    });

    it('probePrePackagedAsset returns false on 404', async () => {
      stubFetch({ '/models/missing.onnx': { ok: false } });
      const present = await probePrePackagedAsset('/models/missing.onnx');
      expect(present).toBe(false);
    });

    it('probePrePackagedAsset returns false on content-length=0', async () => {
      stubFetch({ '/models/empty.onnx': { ok: true, contentLength: 0 } });
      const present = await probePrePackagedAsset('/models/empty.onnx');
      expect(present).toBe(false);
    });

    it('probePrePackagedAsset returns false on fetch throw (network error)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
      const present = await probePrePackagedAsset('/models/whatever.onnx');
      expect(present).toBe(false);
    });

    it('Phi-3 (no pre-packaged) + cache vacío + sin decisión previa: needs_prompt', async () => {
      const s = await getAcquisitionStatus({ modelId: PHI_ID });
      expect(s.state).toBe('needs_prompt');
      expect(s.isPrePackaged).toBe(false);
      expect(s.cachedBytes).toBe(0);
      // ~2.72 GB total (principal + companion).
      expect(s.totalBytes).toBeGreaterThan(2_500_000_000);
    });

    it('Phi-3 con bytes en cache: ready (skip prompt)', async () => {
      await cacheModel(PHI_ID, new Uint8Array([1, 2, 3, 4, 5]).buffer);
      const s = await getAcquisitionStatus({ modelId: PHI_ID });
      expect(s.state).toBe('ready');
      expect(s.cachedBytes).toBe(5);
    });

    it('Phi-3 + usuario rechazó previamente: declined', async () => {
      recordDeclined(PHI_ID);
      const s = await getAcquisitionStatus({ modelId: PHI_ID });
      expect(s.state).toBe('declined');
      expect(s.lastDecision?.kind).toBe('declined');
    });

    it('Phi-3 + postpone dentro del cooldown: postponed', async () => {
      const baseNow = new Date('2026-05-13T10:00:00Z');
      recordPostponed(PHI_ID, 24, baseNow);
      // Re-consultar 12h después: aún dentro del cooldown.
      const s = await getAcquisitionStatus({
        modelId: PHI_ID,
        now: new Date('2026-05-13T22:00:00Z'),
      });
      expect(s.state).toBe('postponed');
      expect(s.remindAt).toBe('2026-05-14T10:00:00.000Z');
    });

    it('Phi-3 + postpone después del cooldown: vuelve a needs_prompt', async () => {
      const baseNow = new Date('2026-05-13T10:00:00Z');
      recordPostponed(PHI_ID, 24, baseNow);
      // 48h después: cooldown expirado.
      const s = await getAcquisitionStatus({
        modelId: PHI_ID,
        now: new Date('2026-05-15T11:00:00Z'),
      });
      expect(s.state).toBe('needs_prompt');
    });

    it('decisión sobre OTRO modelo no afecta este modelo', async () => {
      recordDeclined(QWEN_ID); // decisión sobre Qwen
      const s = await getAcquisitionStatus({ modelId: PHI_ID });
      // Phi-3 sigue needing prompt.
      expect(s.state).toBe('needs_prompt');
    });

    it('accepted previo pero cache vacío: re-prompt (eviction recovery)', async () => {
      recordAccepted(PHI_ID);
      // Cache sigue vacío (simulamos eviction).
      const s = await getAcquisitionStatus({ modelId: PHI_ID });
      expect(s.state).toBe('needs_prompt');
    });

    it('Gemma (gated, no pre-pack): needs_prompt', async () => {
      const s = await getAcquisitionStatus({ modelId: GEMMA_ID });
      expect(s.state).toBe('needs_prompt');
      expect(s.isPrePackaged).toBe(false);
    });

    it('modelId desconocido: throws', async () => {
      await expect(
        getAcquisitionStatus({ modelId: 'does-not-exist' }),
      ).rejects.toThrow(/unknown model id/);
    });

    it('totalMb es entero redondeado', async () => {
      const s = await getAcquisitionStatus({ modelId: PHI_ID });
      expect(Number.isInteger(s.totalMb)).toBe(true);
      expect(s.totalMb).toBeGreaterThan(2000); // ~2700 MB
    });
  });

  describe('recordPostponed', () => {
    it('persiste decisión con postponedUntil correcto', () => {
      const now = new Date('2026-05-13T10:00:00Z');
      const d = recordPostponed(PHI_ID, 6, now);
      expect(d.kind).toBe('postponed');
      expect(d.modelId).toBe(PHI_ID);
      expect(d.postponedUntil).toBe('2026-05-13T16:00:00.000Z');
    });

    it('default cooldown 24h', () => {
      const now = new Date('2026-05-13T10:00:00Z');
      const d = recordPostponed(PHI_ID, undefined, now);
      const hoursDiff =
        (Date.parse(d.postponedUntil!) - now.getTime()) / (60 * 60 * 1000);
      expect(hoursDiff).toBe(DEFAULT_POSTPONE_HOURS);
    });
  });

  describe('recordAccepted / recordDeclined', () => {
    it('accepted incluye completedAt', () => {
      const now = new Date('2026-05-13T10:00:00Z');
      const d = recordAccepted(PHI_ID, now);
      expect(d.kind).toBe('accepted');
      expect(d.completedAt).toBe('2026-05-13T10:00:00.000Z');
    });

    it('declined no incluye postponedUntil ni completedAt', () => {
      const d = recordDeclined(PHI_ID);
      expect(d.kind).toBe('declined');
      expect(d.postponedUntil).toBeUndefined();
      expect(d.completedAt).toBeUndefined();
    });
  });

  describe('resetAcquisitionDecision', () => {
    it('después de reset → needs_prompt como si fuera primer launch', async () => {
      recordDeclined(PHI_ID);
      expect((await getAcquisitionStatus({ modelId: PHI_ID })).state).toBe(
        'declined',
      );
      resetAcquisitionDecision();
      expect((await getAcquisitionStatus({ modelId: PHI_ID })).state).toBe(
        'needs_prompt',
      );
    });
  });

  describe('formatBytesHuman', () => {
    it('< 1 GB → MB', () => {
      expect(formatBytesHuman(483_000_000)).toBe('461 MB');
    });

    it('>= 1 GB → GB con 2 decimales', () => {
      expect(formatBytesHuman(2_720_000_000)).toBe('2.53 GB');
    });
  });

  describe('detectNetworkAdvisory', () => {
    it('returns a valid value (depends on jsdom navigator)', () => {
      const result = detectNetworkAdvisory();
      expect(['wifi', 'cellular', 'metered_unknown', 'offline', 'unknown']).toContain(
        result,
      );
    });
  });
});
