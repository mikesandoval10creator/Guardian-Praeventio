/**
 * Server analytics adapter tests (15th wave, Bucket D).
 *
 * The browser adapter (adapter.test.ts) covers the cross-runtime
 * contract; these tests assert the Node-only path:
 *   1. Track happy path — sink receives event with merged common props.
 *   2. Multi-sink fan-out.
 *   3. PII guard drops events with forbidden top-level keys.
 *   4. ANALYTICS_OPT_OUT=1 env var short-circuits track.
 *   5. In-memory queue overflow drops oldest.
 *   6. Sink fault never blocks the others (fan-out isolation).
 *   7. flush() with empty queue is cheap.
 *   8. stdoutJsonSink writes one JSON line to stderr per event.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInMemoryAnalyticsQueue,
  createServerAnalytics,
  stdoutJsonSink,
} from './serverAdapter';
import type { CommonProperties, Event, EventName, Sink } from './types';

function fakeCommonProps(
  overrides: Partial<CommonProperties> = {},
): CommonProperties {
  return {
    event_version: '1.0.0',
    app_version: '2026.05.04+server-test',
    app_env: 'dev',
    app_mode: 'normal-light',
    locale: 'es-CL',
    device_class: 'web-desktop',
    online: true,
    timestamp_iso: '2026-05-04T13:42:11.512Z',
    sample_rate: 1,
    ...overrides,
  };
}

function makeMockSink(name = 'mock'): Sink & {
  calls: Event<EventName>[];
  flushed: number;
} {
  const calls: Event<EventName>[] = [];
  let flushed = 0;
  return {
    name,
    calls,
    get flushed() {
      return flushed;
    },
    set flushed(v: number) {
      flushed = v;
    },
    async track(event) {
      calls.push(event);
    },
    async flush() {
      flushed += 1;
    },
  } as Sink & { calls: Event<EventName>[]; flushed: number };
}

describe('createServerAnalytics()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('track happy path — sink receives the event with merged common props', async () => {
    const sink = makeMockSink();
    const analytics = createServerAnalytics({
      sinks: [sink],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ app_env: 'production' }),
    });

    await analytics.track('auth.role.granted', {
      role: 'supervisor',
      granted_by_user_id_hash: 'hash_admin_1',
    });

    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0].name).toBe('auth.role.granted');
    const props = sink.calls[0].properties as unknown as {
      role: string;
      granted_by_user_id_hash: string;
      app_env: string;
      event_version: string;
    };
    expect(props.role).toBe('supervisor');
    expect(props.granted_by_user_id_hash).toBe('hash_admin_1');
    // Common props were filled in:
    expect(props.app_env).toBe('production');
    expect(props.event_version).toBe('1.0.0');
  });

  it('multi-sink fan-out — every sink receives the event', async () => {
    const a = makeMockSink('a');
    const b = makeMockSink('b');
    const c = makeMockSink('c');
    const analytics = createServerAnalytics({
      sinks: [a, b, c],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await analytics.track('auth.role.revoked', {
      role: 'worker',
      revoked_by_user_id_hash: 'hash_admin_2',
      revocation_reason: 'role_change',
    });

    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(c.calls).toHaveLength(1);
  });

  it('PII guard drops events whose props include `email`', async () => {
    const sink = makeMockSink();
    const analytics = createServerAnalytics({
      sinks: [sink],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await analytics.track('auth.role.granted', {
      role: 'supervisor',
      granted_by_user_id_hash: 'hash_admin_1',
      // @ts-expect-error — forbidden top-level prop
      email: 'leak@example.com',
    });

    expect(sink.calls).toHaveLength(0);
  });

  it('PII guard drops events whose props include `phone` or `rut`', async () => {
    const sink = makeMockSink();
    const analytics = createServerAnalytics({
      sinks: [sink],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await analytics.track('auth.role.granted', {
      role: 'supervisor',
      granted_by_user_id_hash: 'hash_admin_1',
      // @ts-expect-error — forbidden
      phone: '+56912345678',
    });
    await analytics.track('auth.role.revoked', {
      role: 'worker',
      revoked_by_user_id_hash: 'hash_admin_1',
      // @ts-expect-error — forbidden
      rut: '12.345.678-9',
    });

    expect(sink.calls).toHaveLength(0);
  });

  it('opt-out short-circuits track', async () => {
    const sink = makeMockSink();
    const analytics = createServerAnalytics({
      sinks: [sink],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => true,
      getCommonProps: () => fakeCommonProps(),
    });

    await analytics.track('auth.role.granted', {
      role: 'supervisor',
      granted_by_user_id_hash: 'hash_admin_1',
    });

    expect(sink.calls).toHaveLength(0);
  });

  it('ANALYTICS_OPT_OUT=1 env var opts the default singleton out', async () => {
    const sink = makeMockSink();
    const original = process.env.ANALYTICS_OPT_OUT;
    process.env.ANALYTICS_OPT_OUT = '1';
    try {
      // Default isOptedOut is the env-var reader.
      const analytics = createServerAnalytics({
        sinks: [sink],
        queue: createInMemoryAnalyticsQueue(),
        getCommonProps: () => fakeCommonProps(),
      });
      await analytics.track('auth.role.granted', {
        role: 'supervisor',
        granted_by_user_id_hash: 'hash_admin_1',
      });
      expect(sink.calls).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.ANALYTICS_OPT_OUT;
      else process.env.ANALYTICS_OPT_OUT = original;
    }
  });

  it('a single sink fault never blocks the others', async () => {
    const goodSink = makeMockSink('good');
    const badSink: Sink = {
      name: 'bad',
      async track() {
        throw new Error('boom');
      },
      async flush() {},
    };
    const analytics = createServerAnalytics({
      sinks: [badSink, goodSink],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await analytics.track('auth.role.granted', {
      role: 'supervisor',
      granted_by_user_id_hash: 'hash_admin_1',
    });

    expect(goodSink.calls).toHaveLength(1);
  });

  it('track() never throws even when sinks throw and queue throws', async () => {
    const explodingSink: Sink = {
      name: 'explode',
      async track() {
        throw new Error('sink boom');
      },
      async flush() {},
    };
    const explodingQueue = {
      async enqueue() {
        throw new Error('queue boom');
      },
      async listPending() {
        throw new Error('queue boom');
      },
      async clear() {
        return 0;
      },
      size: () => 0,
    };
    // Offline path: enqueue throws → adapter swallows.
    const offline = createServerAnalytics({
      sinks: [explodingSink],
      queue: explodingQueue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: false }),
    });
    await expect(
      offline.track('auth.role.granted', {
        role: 'supervisor',
        granted_by_user_id_hash: 'hash_admin_1',
      }),
    ).resolves.toBeUndefined();

    // Online path: sink throws → adapter swallows.
    const online = createServerAnalytics({
      sinks: [explodingSink],
      queue: explodingQueue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: true }),
    });
    await expect(
      online.track('auth.role.granted', {
        role: 'supervisor',
        granted_by_user_id_hash: 'hash_admin_1',
      }),
    ).resolves.toBeUndefined();
  });

  it('flush() with empty queue resolves quickly without invoking sinks', async () => {
    const sink = makeMockSink();
    const analytics = createServerAnalytics({
      sinks: [sink],
      queue: createInMemoryAnalyticsQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await analytics.flush();
    expect(sink.calls).toHaveLength(0);
    expect(sink.flushed).toBe(0);
  });

  it('offline → queued; flush replays through sinks in arrival order', async () => {
    const sink = makeMockSink();
    const queue = createInMemoryAnalyticsQueue();
    const offline = createServerAnalytics({
      sinks: [sink],
      queue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: false }),
    });

    await offline.track('auth.role.granted', {
      role: 'supervisor',
      granted_by_user_id_hash: 'hash_admin_1',
    });
    await offline.track('auth.role.revoked', {
      role: 'worker',
      revoked_by_user_id_hash: 'hash_admin_1',
      revocation_reason: 'role_change',
    });
    expect(sink.calls).toHaveLength(0);
    expect(queue.size()).toBe(2);

    // Re-instantiate online so flush goes through fan-out.
    const online = createServerAnalytics({
      sinks: [sink],
      queue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: true }),
    });
    await online.flush();

    expect(sink.calls).toHaveLength(2);
    expect(sink.calls[0].name).toBe('auth.role.granted');
    expect(sink.calls[1].name).toBe('auth.role.revoked');
    expect(queue.size()).toBe(0);
  });
});

describe('createInMemoryAnalyticsQueue()', () => {
  it('overflow drops oldest entry', async () => {
    const queue = createInMemoryAnalyticsQueue(3);

    const baseEvent = (n: number): Event<'auth.role.granted'> => ({
      name: 'auth.role.granted',
      properties: {
        ...fakeCommonProps(),
        role: 'supervisor',
        granted_by_user_id_hash: `hash_${n}`,
      },
    });

    const id1 = await queue.enqueue(baseEvent(1));
    const id2 = await queue.enqueue(baseEvent(2));
    const id3 = await queue.enqueue(baseEvent(3));
    expect(queue.size()).toBe(3);

    // 4th enqueue trips the overflow → id1 is dropped.
    await queue.enqueue(baseEvent(4));
    expect(queue.size()).toBe(3);

    const pending = await queue.listPending();
    const ids = pending.map((p) => p.id);
    expect(ids).not.toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toContain(id3);
  });

  it('clear() removes only the listed ids and is idempotent', async () => {
    const queue = createInMemoryAnalyticsQueue(10);

    const ev = (): Event<'auth.role.granted'> => ({
      name: 'auth.role.granted',
      properties: {
        ...fakeCommonProps(),
        role: 'supervisor',
        granted_by_user_id_hash: 'h',
      },
    });

    const a = await queue.enqueue(ev());
    const b = await queue.enqueue(ev());
    const c = await queue.enqueue(ev());

    expect(await queue.clear([a, c])).toBe(2);
    expect(queue.size()).toBe(1);
    const left = await queue.listPending();
    expect(left[0]?.id).toBe(b);

    // Idempotent: clearing already-removed ids returns 0.
    expect(await queue.clear([a, c])).toBe(0);
  });

  it('listPending() returns rows in insertion order', async () => {
    const queue = createInMemoryAnalyticsQueue(10);

    const ev = (n: number): Event<'auth.role.granted'> => ({
      name: 'auth.role.granted',
      properties: {
        ...fakeCommonProps(),
        role: 'supervisor',
        granted_by_user_id_hash: `h_${n}`,
      },
    });

    await queue.enqueue(ev(1));
    await queue.enqueue(ev(2));
    await queue.enqueue(ev(3));

    const pending = await queue.listPending();
    expect(pending.map((p) => (p.event.properties as { granted_by_user_id_hash: string }).granted_by_user_id_hash))
      .toEqual(['h_1', 'h_2', 'h_3']);
  });
});

describe('stdoutJsonSink', () => {
  it('writes one JSON line per event to process.stderr', async () => {
    const writes: string[] = [];
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: unknown) => {
        writes.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      });

    try {
      await stdoutJsonSink.track({
        name: 'auth.role.granted',
        properties: {
          ...fakeCommonProps(),
          role: 'supervisor',
          granted_by_user_id_hash: 'hash_admin_1',
        },
      });

      expect(writes).toHaveLength(1);
      expect(writes[0].endsWith('\n')).toBe(true);
      const parsed = JSON.parse(writes[0].trim()) as {
        ts: string;
        name: string;
        props: Record<string, unknown>;
      };
      expect(parsed.name).toBe('auth.role.granted');
      expect(parsed.props.role).toBe('supervisor');
      // ts must be ISO 8601.
      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
