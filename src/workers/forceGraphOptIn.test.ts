import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOptInForceGraphClient } from './forceGraphOptIn';

const digest = 'a'.repeat(64);
const payload = { nodes: [{ id: 'a' }], links: [] };

afterEach(() => vi.unstubAllGlobals());

describe('Risk Network WASM opt-in', () => {
  it.each([undefined, '', 'false', 'a'.repeat(63), 'https://example.test/x.wasm', `${digest}\n`])(
    'does not construct a WASM client for %s', (value) => {
      expect(createOptInForceGraphClient(value)).toBeUndefined();
    },
  );

  it('loads only the pinned same-origin artifact, lazily and without redirects', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const client = createOptInForceGraphClient(digest)!;
    expect(client.engineInfo()).toMatchObject({ wasmEnabled: true, versions: { wasm: digest } });
    expect(fetch).not.toHaveBeenCalled();
    // No Worker in this Node harness; only the error/fallback path is exercised here.
    await expect(client.simulate(payload, { signal: new AbortController().signal })).rejects.toThrow('layout_worker_unavailable');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/assets/force-graph-layout-${digest}.wasm`, expect.objectContaining({
      redirect: 'error', credentials: 'omit', integrity: expect.stringMatching(/^sha256-/), signal: expect.any(AbortSignal),
    }));
  });
});
