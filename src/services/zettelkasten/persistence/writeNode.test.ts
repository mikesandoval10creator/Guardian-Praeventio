// Praeventio Guard â€” Sprint 11 (writeNode coverage).
//
// Cubre:
//   â€¢ happy path â†’ POST con Bearer â†’ 200
//   â€¢ offline â†’ enrola en saveForSync, no llama a fetch
//   â€¢ idempotencia: mismos inputs â‡’ mismo id, distintos â‡’ distinto
//   â€¢ debounce: rebotes <2s se colapsan en una sola escritura
//
// Mockeamos `firebase` (auth.currentUser.getIdToken), `pwa-offline`
// (saveForSync), y la global `fetch`. Usamos `vi.useFakeTimers()` para
// el debounce.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RiskNodePayload } from '../types';

// â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn(async () => 'tok-test'),
    },
  },
}));

vi.mock('../../../utils/pwa-offline', () => ({
  saveForSync: vi.fn(async () => undefined),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Importes despuÃ©s de los mocks.
import {
  writeNodes,
  writeNodesDebounced,
  nodeIdFor,
  __resetDebounceForTests,
} from './writeNode';
import { saveForSync } from '../../../utils/pwa-offline';

function basePayload(overrides: Partial<RiskNodePayload> = {}): RiskNodePayload {
  return {
    title: 'Riesgo de levantamiento',
    description: 'F = 1234 N supera capacidad anclajes',
    type: 'scaffold-uplift',
    severity: 'high',
    metadata: { forceN: 1234, ratedN: 5000 },
    connections: ['surface:test', 'anchor:test'],
    references: ['NCh432'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetDebounceForTests();
  // mock fetch global por test — vi.fn pierde la firma exacta de
  // overloads de `fetch`, así que casteamos vía unknown.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ success: true }),
  })) as unknown as typeof fetch;
  // navigator online por defecto
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nodeIdFor', () => {
  it('returns the same 16-hex id for identical payload+projectId', async () => {
    const id1 = await nodeIdFor(basePayload(), 'proj-A');
    const id2 = await nodeIdFor(basePayload(), 'proj-A');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns different ids when projectId differs', async () => {
    const id1 = await nodeIdFor(basePayload(), 'proj-A');
    const id2 = await nodeIdFor(basePayload(), 'proj-B');
    expect(id1).not.toBe(id2);
  });

  it('returns different ids when metadata differs', async () => {
    const id1 = await nodeIdFor(basePayload({ metadata: { x: 1 } }), 'proj-A');
    const id2 = await nodeIdFor(basePayload({ metadata: { x: 2 } }), 'proj-A');
    expect(id1).not.toBe(id2);
  });

  it('is order-insensitive for object keys (canonicalization)', async () => {
    const a = basePayload({ metadata: { a: 1, b: 2 } });
    const b = basePayload({ metadata: { b: 2, a: 1 } });
    const id1 = await nodeIdFor(a, 'proj-A');
    const id2 = await nodeIdFor(b, 'proj-A');
    expect(id1).toBe(id2);
  });
});

describe('writeNodes â€” happy path', () => {
  it('POSTs with Bearer token and idempotencyKey on each node', async () => {
    const result = await writeNodes([basePayload()], { projectId: 'proj-A' });
    expect(result.ok).toBe(true);
    expect(result.queued).toBeUndefined();
    expect(result.ids).toHaveLength(1);
    expect(result.ids![0]).toMatch(/^[0-9a-f]{16}$/);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/zettelkasten/nodes');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-test');
    const body = JSON.parse(init.body);
    expect(body.projectId).toBe('proj-A');
    expect(body.nodes[0].idempotencyKey).toBe(result.ids![0]);
  });

  it('returns ok:false on 4xx without queuing', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'bad',
    })) as unknown as typeof fetch;
    const result = await writeNodes([basePayload()], { projectId: 'proj-A' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(saveForSync).not.toHaveBeenCalled();
  });
});

describe('writeNodes â€” offline path', () => {
  it('queues via saveForSync when navigator.onLine is false', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });
    const result = await writeNodes([basePayload()], { projectId: 'proj-A' });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(saveForSync).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const arg = (saveForSync as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.collection).toBe('zettelkasten_nodes');
    expect(arg.data.projectId).toBe('proj-A');
    expect(arg.data.nodes[0].idempotencyKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it('queues when fetch throws (network failure)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('net down');
    });
    const result = await writeNodes([basePayload()], { projectId: 'proj-A' });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(saveForSync).toHaveBeenCalledTimes(1);
  });
});

describe('writeNodes â€” guards', () => {
  it('returns ok with empty ids on empty input', async () => {
    const result = await writeNodes([], { projectId: 'proj-A' });
    expect(result.ok).toBe(true);
    expect(result.ids).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects missing projectId', async () => {
    const result = await writeNodes([basePayload()], { projectId: '' as any });
    expect(result.ok).toBe(false);
  });
});

describe('writeNodesDebounced', () => {
  it('coalesces N rapid calls into a single POST after 2 s', async () => {
    vi.useFakeTimers();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    for (let i = 0; i < 10; i++) {
      writeNodesDebounced(
        [basePayload({ metadata: { forceN: 1000 + i, ratedN: 5000 } })],
        { projectId: 'proj-A' },
      );
      vi.advanceTimersByTime(100); // <2s entre calls â†’ siguen reseteando
    }
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2100); // ahora sÃ­ dispara el flush
    // El flush dispara una promesa async; la dejamos correr.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.nodes).toHaveLength(1);
    // Solo el Ãºltimo estado (forceN 1009) debe estar.
    expect(body.nodes[0].metadata.forceN).toBe(1009);
  });

  it('separates types under the same projectId into distinct flushes', async () => {
    vi.useFakeTimers();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    writeNodesDebounced([basePayload({ type: 'scaffold-uplift' })], {
      projectId: 'proj-A',
    });
    writeNodesDebounced([basePayload({ type: 'hazmat-pipe' })], {
      projectId: 'proj-A',
    });
    vi.advanceTimersByTime(2100);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
