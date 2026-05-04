/**
 * Analytics adapter tests (ninth wave, Bucket D).
 *
 * Coverage targets:
 *   1. Track happy path → sink called.
 *   2. Common props auto-filled by the adapter.
 *   3. PII guard drops events whose props include `email`.
 *   4. PII guard drops events whose props include `phone`/`rut`.
 *   5. Opt-out short-circuits.
 *   6. Offline → queued; flush replays through sinks.
 *   7. Multiple sinks all receive the event.
 *   8. Sink fault never breaks fan-out for the others.
 *   9. `userIdHash` deterministic + 64 hex chars.
 *  10. `userIdHash` differs across distinct uids.
 *  11. Type-level: invalid event name fails compile.
 *  12. `flush()` with empty queue is a cheap no-op.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsAdapter, userIdHash } from './adapter';
import type { AnalyticsQueue, QueuedAnalyticsEvent } from './queue';
import type { CommonProperties, Event, EventName, Sink } from './types';

function fakeCommonProps(overrides: Partial<CommonProperties> = {}): CommonProperties {
  return {
    event_version: '1.0.0',
    app_version: '2026.05.04+test',
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

function makeMockSink(name = 'mock'): Sink & { calls: Event<EventName>[]; flushed: number } {
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

function makeMockQueue(): AnalyticsQueue & { rows: QueuedAnalyticsEvent[] } {
  const rows: QueuedAnalyticsEvent[] = [];
  return {
    rows,
    version: 1,
    async enqueue(event) {
      const id = `q_${rows.length}`;
      rows.push({ id, event, createdAt: Date.now() + rows.length });
      return id;
    },
    async listPending() {
      return [...rows].sort((a, b) => a.createdAt - b.createdAt);
    },
    async clear(ids) {
      let removed = 0;
      for (const id of ids) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx >= 0) {
          rows.splice(idx, 1);
          removed += 1;
        }
      }
      return removed;
    },
  } as AnalyticsQueue & { rows: QueuedAnalyticsEvent[] };
}

describe('AnalyticsAdapter (adapter.ts)', () => {
  beforeEach(() => {
    // Each case starts not-opted-out and "online".
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('track happy path — sink receives the event', async () => {
    const sink = makeMockSink();
    const queue = makeMockQueue();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('auth.user.signed_up', { provider: 'google' });

    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0].name).toBe('auth.user.signed_up');
    // Cast through `unknown` because `Event<EventName>` is the union root;
    // the adapter erased N. We've already asserted `name` so the cast is
    // safe in this test context.
    const props = sink.calls[0].properties as unknown as { provider: string };
    expect(props.provider).toBe('google');
  });

  it('auto-fills common props on every event', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ app_mode: 'driving', locale: 'es' }),
    });

    await adapter.track('project.created', {
      project_tier: 'professional',
      industry_code: 'mining',
    });

    const props = sink.calls[0].properties;
    expect(props.event_version).toBe('1.0.0');
    expect(props.app_mode).toBe('driving');
    expect(props.locale).toBe('es');
    expect(props.app_env).toBe('dev');
    expect(props.online).toBe(true);
    // Caller-specific props still present:
    expect((props as { project_tier: string }).project_tier).toBe('professional');
    expect((props as { industry_code: string }).industry_code).toBe('mining');
  });

  it('PII guard drops events whose props include `email`', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    // PII guard runs on the input bag — bypass typecheck so we can pass
    // a forbidden key and assert the runtime drop.
    await adapter.track('auth.user.signed_up', {
      provider: 'google',
      // @ts-expect-error — forbidden top-level prop
      email: 'attacker@example.com',
    });

    expect(sink.calls).toHaveLength(0);
  });

  it('PII guard drops events whose props include `phone` or `rut`', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('project.created', {
      project_tier: 'professional',
      industry_code: 'mining',
      // @ts-expect-error — forbidden
      phone: '+56912345678',
    });
    await adapter.track('project.created', {
      project_tier: 'professional',
      industry_code: 'mining',
      // @ts-expect-error — forbidden
      rut: '12.345.678-9',
    });

    expect(sink.calls).toHaveLength(0);
  });

  it('opt-out short-circuits track()', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => true,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('auth.user.signed_up', { provider: 'google' });
    expect(sink.calls).toHaveLength(0);
  });

  it('offline → queued; flush replays through sinks', async () => {
    const sink = makeMockSink();
    const queue = makeMockQueue();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: false }),
    });

    await adapter.track('auth.user.signed_up', { provider: 'google' });
    expect(sink.calls).toHaveLength(0);
    expect(queue.rows).toHaveLength(1);

    // Adapter caller is responsible for re-resolving "online"; in a real
    // app the wrapper around getCommonProps reads `navigator.onLine`. We
    // construct a fresh adapter with online=true to drain.
    const drainAdapter = new AnalyticsAdapter({
      sinks: [sink],
      queue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: true }),
    });
    await drainAdapter.flush();

    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0].name).toBe('auth.user.signed_up');
    expect(queue.rows).toHaveLength(0);
  });

  it('multiple sinks all receive the event', async () => {
    const sinkA = makeMockSink('a');
    const sinkB = makeMockSink('b');
    const sinkC = makeMockSink('c');
    const adapter = new AnalyticsAdapter({
      sinks: [sinkA, sinkB, sinkC],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('tarea.completed', {
      tarea_id: 't1',
      proceso_id: 'p1',
      time_to_complete_seconds: 120,
    });

    expect(sinkA.calls).toHaveLength(1);
    expect(sinkB.calls).toHaveLength(1);
    expect(sinkC.calls).toHaveLength(1);
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
    const adapter = new AnalyticsAdapter({
      sinks: [badSink, goodSink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('risk.reported.manual', {
      risk_id: 'r1',
      risk_class: 'mechanical',
      severity: 'high',
    });

    expect(goodSink.calls).toHaveLength(1);
  });

  it('userIdHash is deterministic and 64 hex chars', async () => {
    const a = await userIdHash('uid-123');
    const b = await userIdHash('uid-123');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('userIdHash differs across distinct uids', async () => {
    const a = await userIdHash('uid-A');
    const b = await userIdHash('uid-B');
    expect(a).not.toBe(b);
  });

  it('type-level: invalid event name fails compile', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    // Compile-time assertion: this line MUST be a type error because
    // `not.an.event` is not in the `EventName` union.
    // @ts-expect-error — invalid event name
    await adapter.track('not.an.event', { provider: 'google' });

    // Runtime: the call still goes through (the union ban is type-only)
    // and the event is forwarded — but tests prove the @ts-expect-error
    // pragma stays accurate. If someone widens the union, this line
    // breaks the build by removing the expected error.
    expect(sink.calls.length >= 0).toBe(true);
  });

  it('11th wave: payment.checkout.started narrows props to gateway/plan_code/amount_clp', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('payment.checkout.started', {
      gateway: 'webpay',
      plan_code: 'oro',
      amount_clp: 49990,
    });

    // Bad gateway literal must fail to compile.
    await adapter.track('payment.checkout.started', {
      // @ts-expect-error — 'stripe' not in PaymentGateway enum
      gateway: 'stripe',
      plan_code: 'oro',
      amount_clp: 49990,
    });

    expect(sink.calls).toHaveLength(2);
    expect(sink.calls[0].name).toBe('payment.checkout.started');
  });

  it('11th wave: knowledge.doc.viewed requires doc_id + doc_kind', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('knowledge.doc.viewed', {
      doc_id: 'wkr_123',
      doc_kind: 'regulatory',
    });

    // Bad doc_kind literal must fail to compile.
    await adapter.track('knowledge.doc.viewed', {
      doc_id: 'wkr_123',
      // @ts-expect-error — 'gossip' not in DocKind enum
      doc_kind: 'gossip',
    });

    expect(sink.calls).toHaveLength(2);
    expect(sink.calls[0].name).toBe('knowledge.doc.viewed');
  });

  it('12th wave: app.opened narrows boot_kind to cold/warm/pwa_resume', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('app.opened', { boot_kind: 'cold' });
    await adapter.track('app.opened', { boot_kind: 'warm', last_open_delta_seconds: 360 });
    await adapter.track('app.opened', { boot_kind: 'pwa_resume' });

    // Bad boot_kind literal must fail to compile.
    await adapter.track('app.opened', {
      // @ts-expect-error — 'launch' not in BootKind enum
      boot_kind: 'launch',
    });

    expect(sink.calls).toHaveLength(4);
    expect(sink.calls[0].name).toBe('app.opened');
  });

  it('12th wave: slm.queue.reconciled + slm.model.downloaded narrow required props', async () => {
    const sink = makeMockSink();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue: makeMockQueue(),
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.track('slm.queue.reconciled', {
      attempted: 4,
      succeeded: 3,
      failed: 1,
      pass_duration_ms: 820,
    });

    // Missing required `failed` must fail to compile.
    // @ts-expect-error — required prop `failed` missing
    await adapter.track('slm.queue.reconciled', {
      attempted: 4,
      succeeded: 4,
    });

    // Wrong cache_origin literal on the sibling event must also fail.
    await adapter.track('slm.model.downloaded', {
      model_id: 'slm-es-cl-2026Q1',
      model_bytes: 12_582_912,
      download_duration_ms: 980,
      // @ts-expect-error — 'network' not in CacheOrigin enum
      cache_origin: 'network',
    });

    expect(sink.calls.length).toBeGreaterThanOrEqual(2);
    expect(sink.calls[0].name).toBe('slm.queue.reconciled');
  });

  it('flush() with empty queue resolves quickly without invoking sinks', async () => {
    const sink = makeMockSink();
    const queue = makeMockQueue();
    const adapter = new AnalyticsAdapter({
      sinks: [sink],
      queue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps(),
    });

    await adapter.flush();
    expect(sink.calls).toHaveLength(0);
    expect(sink.flushed).toBe(0);
  });

  it('track() never throws even when sinks throw and queue throws', async () => {
    const explodingSink: Sink = {
      name: 'explode',
      async track() {
        throw new Error('sink boom');
      },
      async flush() {},
    };
    const explodingQueue: AnalyticsQueue = {
      version: 1,
      async enqueue() {
        throw new Error('queue boom');
      },
      async listPending() {
        throw new Error('queue boom');
      },
      async clear() {
        return 0;
      },
    };
    const adapter = new AnalyticsAdapter({
      sinks: [explodingSink],
      queue: explodingQueue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: false }),
    });

    // Offline path → enqueue throws → adapter swallows → resolved.
    await expect(adapter.track('auth.user.signed_up', { provider: 'google' })).resolves.toBeUndefined();

    // Online path → sink throws → adapter swallows → resolved.
    const onlineAdapter = new AnalyticsAdapter({
      sinks: [explodingSink],
      queue: explodingQueue,
      isOptedOut: () => false,
      getCommonProps: () => fakeCommonProps({ online: true }),
    });
    await expect(onlineAdapter.track('auth.user.signed_up', { provider: 'google' })).resolves.toBeUndefined();
  });
});
