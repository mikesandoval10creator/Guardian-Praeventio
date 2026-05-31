// Praeventio Guard — mqttClient.ts unit tests.
//
// Two test surfaces:
//
//   1. Edge-filter presets (onlyAnomaliesFilter, sampleRateFilter,
//      thresholdFilter) — pure functions, no broker needed.
//
//   2. PraeventioMqttClient class — connect/disconnect lifecycle,
//      subscribe/unsubscribe/publish, message handler, edge-filter
//      gating, state-machine transitions, onState / onMessage listeners,
//      getMetrics snapshot.
//
// The `mqtt` package is fully mocked. No real broker connection is
// ever attempted. The fake client is an object with vi.fn() stubs for
// `on`, `subscribe`, `unsubscribe`, `publish`, `end`, and an `emit`
// helper so tests can trigger lifecycle events (connect, message, error,
// disconnect, close, reconnect) synchronously.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// Fake MQTT client factory
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Minimal fake that replicates the event-listener surface of MqttClient.
 * `on` stores handlers; `_emit` triggers them synchronously for tests.
 */
function makeFakeMqttClient() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return client; // chainable
    }),
    subscribe: vi.fn(
      (
        _topic: string,
        _optsOrCb: unknown,
        cb?: (err: Error | null) => void,
      ) => {
        // When called with 3 args (topic, opts, cb) resolve immediately.
        // When called with 2 args and second is a function, that is the cb.
        if (typeof _optsOrCb === 'function') {
          (_optsOrCb as (err: Error | null) => void)(null);
        } else if (typeof cb === 'function') {
          cb(null);
        }
        return client;
      },
    ),
    unsubscribe: vi.fn(
      (
        _topic: string,
        _opts: unknown,
        cb?: (err: Error | null) => void,
      ) => {
        if (typeof cb === 'function') cb(null);
        return client;
      },
    ),
    publish: vi.fn(
      (
        _topic: string,
        _payload: unknown,
        _opts: unknown,
        cb?: (err?: Error) => void,
      ) => {
        if (typeof cb === 'function') cb(undefined);
        return client;
      },
    ),
    end: vi.fn(
      (_force: boolean, _opts: unknown, cb?: () => void) => {
        if (typeof cb === 'function') cb();
        return client;
      },
    ),
    /** Test helper — synchronously fires all handlers registered for `event`. */
    _emit(event: string, ...args: unknown[]) {
      for (const fn of listeners[event] ?? []) {
        fn(...args);
      }
    },
    /** For connect auto-fire in tests that just want a connected client. */
    _fireConnect() {
      client._emit('connect');
    },
  };
  return client;
}

type FakeMqttClient = ReturnType<typeof makeFakeMqttClient>;

// ──────────────────────────────────────────────────────────────────────────────
// vi.mock — intercept `mqtt` before any import of mqttClient.ts.
// vi.mock() is hoisted to the top of the file by Vitest, so we cannot
// reference outer variables inside the factory. Use vi.hoisted() to create
// the mock BEFORE hoisting occurs, then reference it safely inside the factory.
// ──────────────────────────────────────────────────────────────────────────────

const { connectMock } = vi.hoisted(() => ({
  connectMock: vi.fn() as Mock<(...args: unknown[]) => FakeMqttClient>,
}));

vi.mock('mqtt', () => ({
  // The production code calls `mqtt.connect(url, opts)` via the default export.
  default: {
    connect: connectMock,
  },
}));

// Import AFTER vi.mock so the module sees the stub.
import {
  PraeventioMqttClient,
  onlyAnomaliesFilter,
  sampleRateFilter,
  thresholdFilter,
  type MqttSensorEvent,
  type ConnectionState,
  type MqttClientConfig,
} from './mqttClient.js';

// ──────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────────

function baseConfig(over: Partial<MqttClientConfig> = {}): MqttClientConfig {
  return {
    brokerUrl: 'ws://fake-broker:1883/mqtt',
    clientId: 'test-client-001',
    ...over,
  };
}

function makeEvent(over: Partial<MqttSensorEvent> = {}): MqttSensorEvent {
  return {
    topic: 'test/topic',
    payload: new Uint8Array(),
    payloadText: '',
    payloadJson: null,
    receivedAtMs: 1700000000000,
    qos: 0,
    ...over,
  };
}

/**
 * Build a client + fake underlying mqtt client, auto-fires 'connect'
 * so the returned client is in 'connected' state.
 */
async function connectedClient(over: Partial<MqttClientConfig> = {}): Promise<{
  mqttClient: PraeventioMqttClient;
  fakeClient: FakeMqttClient;
}> {
  const fakeClient = makeFakeMqttClient();
  connectMock.mockReturnValueOnce(fakeClient);
  const mqttClient = new PraeventioMqttClient(baseConfig(over));
  // connect() returns a Promise that resolves when 'connect' fires.
  const p = mqttClient.connect();
  fakeClient._fireConnect();
  await p;
  return { mqttClient, fakeClient };
}

// ──────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  connectMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Edge-filter presets (pure functions)
// ══════════════════════════════════════════════════════════════════════════════

describe('onlyAnomaliesFilter', () => {
  it('payload sin JSON: deja pasar (no podemos juzgar status)', () => {
    expect(onlyAnomaliesFilter(makeEvent({ payloadText: 'raw text' }))).toBe(true);
  });

  it('JSON con status="ok": filtrado fuera', () => {
    expect(
      onlyAnomaliesFilter(
        makeEvent({ payloadJson: { status: 'ok', value: 42 } }),
      ),
    ).toBe(false);
  });

  it('JSON con status="warning": deja pasar', () => {
    expect(
      onlyAnomaliesFilter(
        makeEvent({ payloadJson: { status: 'warning', value: 90 } }),
      ),
    ).toBe(true);
  });

  it('JSON con status="OK" mayúsculas: filtrado (case-insensitive)', () => {
    expect(
      onlyAnomaliesFilter(makeEvent({ payloadJson: { status: 'OK' } })),
    ).toBe(false);
  });

  it('JSON sin campo status: deja pasar', () => {
    expect(
      onlyAnomaliesFilter(makeEvent({ payloadJson: { value: 42 } })),
    ).toBe(true);
  });
});

describe('sampleRateFilter', () => {
  it('rate=3: deja pasar 1 de cada 3', () => {
    const filter = sampleRateFilter(3);
    expect(filter(makeEvent())).toBe(false); // 1
    expect(filter(makeEvent())).toBe(false); // 2
    expect(filter(makeEvent())).toBe(true); // 3 → mod=0
    expect(filter(makeEvent())).toBe(false); // 4
    expect(filter(makeEvent())).toBe(false); // 5
    expect(filter(makeEvent())).toBe(true); // 6 → mod=0
  });

  it('rate=1: deja pasar todos', () => {
    const filter = sampleRateFilter(1);
    expect(filter(makeEvent())).toBe(true);
    expect(filter(makeEvent())).toBe(true);
    expect(filter(makeEvent())).toBe(true);
  });

  it('rate=0: tratado como 1 (defensive)', () => {
    const filter = sampleRateFilter(0);
    expect(filter(makeEvent())).toBe(true);
  });
});

describe('thresholdFilter', () => {
  it('gte: deja pasar valor ≥ threshold', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: { value: 60 } }))).toBe(true);
    expect(filter(makeEvent({ payloadJson: { value: 50 } }))).toBe(true);
    expect(filter(makeEvent({ payloadJson: { value: 49 } }))).toBe(false);
  });

  it('lt: deja pasar valor < threshold', () => {
    const filter = thresholdFilter('value', 50, 'lt');
    expect(filter(makeEvent({ payloadJson: { value: 49 } }))).toBe(true);
    expect(filter(makeEvent({ payloadJson: { value: 50 } }))).toBe(false);
  });

  it('campo ausente: filtrado fuera', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: { other: 100 } }))).toBe(false);
  });

  it('campo no numérico: filtrado fuera', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: { value: 'high' } }))).toBe(false);
  });

  it('sin payloadJson: filtrado fuera', () => {
    const filter = thresholdFilter('value', 50, 'gte');
    expect(filter(makeEvent({ payloadJson: null }))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — PraeventioMqttClient class
// ══════════════════════════════════════════════════════════════════════════════

describe('PraeventioMqttClient — connect lifecycle', () => {
  it('calls mqtt.connect with the supplied brokerUrl and opts', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);

    const client = new PraeventioMqttClient(
      baseConfig({
        username: 'user1',
        password: 'pass1',
        reconnectPeriodMs: 2000,
        connectTimeoutMs: 10000,
      }),
    );
    const p = client.connect();
    fakeClient._fireConnect();
    await p;

    expect(connectMock).toHaveBeenCalledTimes(1);
    const [url, opts] = connectMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('ws://fake-broker:1883/mqtt');
    expect(opts.clientId).toBe('test-client-001');
    expect(opts.username).toBe('user1');
    expect(opts.password).toBe('pass1');
    expect(opts.reconnectPeriod).toBe(2000);
    expect(opts.connectTimeout).toBe(10000);
    expect(opts.clean).toBe(true);
  });

  it('state transitions: disconnected → connecting → connected', async () => {
    const states: ConnectionState[] = [];
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);

    const client = new PraeventioMqttClient(baseConfig());
    client.onState((s) => states.push(s));

    // onState fires immediately with current state before any transitions.
    expect(states).toEqual(['disconnected']);

    const p = client.connect();
    expect(states).toContain('connecting');

    fakeClient._fireConnect();
    await p;
    expect(states).toContain('connected');
  });

  it('connect() is idempotent — second call while connected does NOT call mqtt.connect again', async () => {
    const { mqttClient } = await connectedClient();
    await mqttClient.connect(); // second call
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('connect() is idempotent while state=connecting', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);
    const client = new PraeventioMqttClient(baseConfig());

    const p1 = client.connect(); // starts connecting, not yet resolved
    const p2 = client.connect(); // should be no-op
    fakeClient._fireConnect();
    await Promise.all([p1, p2]);

    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('generates a random clientId when none is supplied', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);
    const client = new PraeventioMqttClient({ brokerUrl: 'ws://x:1883' });
    const p = client.connect();
    fakeClient._fireConnect();
    await p;

    const [, opts] = connectMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(typeof opts.clientId).toBe('string');
    expect((opts.clientId as string).startsWith('praeventio-')).toBe(true);
  });

  it('sets connectedSince timestamp on connect', async () => {
    const { mqttClient } = await connectedClient();
    const metrics = mqttClient.getMetrics();
    expect(metrics.connectedSince).not.toBeNull();
    expect(() => new Date(metrics.connectedSince!)).not.toThrow();
  });
});

describe('PraeventioMqttClient — error and reconnect', () => {
  it('rejects connect() promise and sets state=error on mqtt error event', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);
    const client = new PraeventioMqttClient(baseConfig());

    const p = client.connect();
    fakeClient._emit('error', new Error('connection refused'));

    await expect(p).rejects.toThrow('connection refused');
    expect(client.getMetrics().state).toBe('error');
    expect(client.getMetrics().lastErrorMessage).toBe('connection refused');
  });

  it('increments reconnectCount and sets state=reconnecting on reconnect event', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    expect(mqttClient.getMetrics().reconnectCount).toBe(0);

    fakeClient._emit('reconnect');
    expect(mqttClient.getMetrics().state).toBe('reconnecting');
    expect(mqttClient.getMetrics().reconnectCount).toBe(1);

    fakeClient._emit('reconnect');
    expect(mqttClient.getMetrics().reconnectCount).toBe(2);
  });

  it('sets state=disconnected on disconnect event and clears connectedSince', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    fakeClient._emit('disconnect');
    const m = mqttClient.getMetrics();
    expect(m.state).toBe('disconnected');
    expect(m.connectedSince).toBeNull();
  });

  it('sets state=disconnected on close event (unless already error)', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    fakeClient._emit('close');
    expect(mqttClient.getMetrics().state).toBe('disconnected');
  });

  it('close event while in error state does NOT overwrite error state', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);
    const client = new PraeventioMqttClient(baseConfig());

    const p = client.connect();
    fakeClient._emit('error', new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    // Now fire close — should stay 'error' not downgrade to 'disconnected'.
    fakeClient._emit('close');
    expect(client.getMetrics().state).toBe('error');
  });

  it('re-subscribes to stored topics after reconnect (connect event fires again)', async () => {
    const { mqttClient, fakeClient } = await connectedClient();

    await mqttClient.subscribe('sensors/temp', 1);
    // Simulate a reconnect: 'reconnect' then 'connect' again.
    fakeClient._emit('reconnect');
    fakeClient._fireConnect(); // fires 'connect' again

    // subscribe should have been called twice: once for the original sub, once for re-sub.
    const subscribeCalls = (fakeClient.subscribe as Mock).mock.calls;
    const resubCalls = subscribeCalls.filter(
      (c) => c[0] === 'sensors/temp',
    );
    expect(resubCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PraeventioMqttClient — disconnect', () => {
  it('calls client.end and resolves, clearing internal client ref', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    await mqttClient.disconnect();

    expect(fakeClient.end).toHaveBeenCalledTimes(1);
    expect(mqttClient.getMetrics().state).toBe('disconnected');
    expect(mqttClient.getMetrics().connectedSince).toBeNull();
  });

  it('disconnect() is a no-op when client is null (not connected)', async () => {
    const client = new PraeventioMqttClient(baseConfig());
    // Should resolve without throwing.
    await expect(client.disconnect()).resolves.toBeUndefined();
  });
});

describe('PraeventioMqttClient — subscribe / unsubscribe', () => {
  it('subscribe() adds topic to subscribedTopics on success', async () => {
    const { mqttClient } = await connectedClient();
    await mqttClient.subscribe('sensors/gas', 1);

    expect(mqttClient.getMetrics().subscribedTopics).toContain('sensors/gas');
  });

  it('subscribe() passes qos to mqtt.subscribe correctly', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    await mqttClient.subscribe('sensors/gas', 2);

    const call = (fakeClient.subscribe as Mock).mock.calls.find(
      (c) => c[0] === 'sensors/gas',
    );
    expect(call).toBeDefined();
    // second arg should be opts object with qos
    expect((call as unknown[])[1]).toMatchObject({ qos: 2 });
  });

  it('subscribe() rejects when client is not connected', async () => {
    const client = new PraeventioMqttClient(baseConfig());
    await expect(client.subscribe('sensors/gas')).rejects.toThrow(
      'subscribe: client no conectado',
    );
  });

  it('subscribe() rejects and records error on broker error', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);

    // Override subscribe to call back with error
    (fakeClient.subscribe as Mock).mockImplementationOnce(
      (_t: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (typeof cb === 'function') cb(new Error('topic not allowed'));
        return fakeClient;
      },
    );

    const mqttClient = new PraeventioMqttClient(baseConfig());
    const p = mqttClient.connect();
    fakeClient._fireConnect();
    await p;

    await expect(mqttClient.subscribe('restricted/topic')).rejects.toThrow(
      'topic not allowed',
    );
    expect(mqttClient.getMetrics().lastErrorMessage).toBe('topic not allowed');
  });

  it('unsubscribe() removes topic from subscribedTopics', async () => {
    const { mqttClient } = await connectedClient();
    await mqttClient.subscribe('sensors/temp');
    await mqttClient.unsubscribe('sensors/temp');

    expect(mqttClient.getMetrics().subscribedTopics).not.toContain('sensors/temp');
  });

  it('unsubscribe() is a no-op when client is null', async () => {
    const client = new PraeventioMqttClient(baseConfig());
    await expect(client.unsubscribe('sensors/temp')).resolves.toBeUndefined();
  });

  it('unsubscribe() rejects when broker returns error', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);

    (fakeClient.unsubscribe as Mock).mockImplementationOnce(
      (_t: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (typeof cb === 'function') cb(new Error('unsubscribe failed'));
        return fakeClient;
      },
    );

    const mqttClient = new PraeventioMqttClient(baseConfig());
    const p = mqttClient.connect();
    fakeClient._fireConnect();
    await p;

    await mqttClient.subscribe('sensors/temp');
    await expect(mqttClient.unsubscribe('sensors/temp')).rejects.toThrow(
      'unsubscribe failed',
    );
  });
});

describe('PraeventioMqttClient — publish', () => {
  it('publish() calls mqtt.publish with correct topic, payload, and qos', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    await mqttClient.publish('sensors/status', 'active', 1);

    const call = (fakeClient.publish as Mock).mock.calls[0] as unknown[];
    expect(call[0]).toBe('sensors/status');
    expect(call[1]).toBe('active');
    expect((call[2] as Record<string, unknown>).qos).toBe(1);
  });

  it('publish() increments messagesPublished counter', async () => {
    const { mqttClient } = await connectedClient();
    await mqttClient.publish('sensors/status', 'ok');
    await mqttClient.publish('sensors/status', 'ok');

    expect(mqttClient.getMetrics().messagesPublished).toBe(2);
  });

  it('publish() rejects when client is not connected', async () => {
    const client = new PraeventioMqttClient(baseConfig());
    await expect(client.publish('topic', 'payload')).rejects.toThrow(
      'publish: client no conectado',
    );
  });

  it('publish() rejects and records error when broker returns error', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);

    (fakeClient.publish as Mock).mockImplementationOnce(
      (
        _t: string,
        _p: unknown,
        _opts: unknown,
        cb?: (err?: Error) => void,
      ) => {
        if (typeof cb === 'function') cb(new Error('publish refused'));
        return fakeClient;
      },
    );

    const mqttClient = new PraeventioMqttClient(baseConfig());
    const p = mqttClient.connect();
    fakeClient._fireConnect();
    await p;

    await expect(mqttClient.publish('sensors/data', 'payload')).rejects.toThrow(
      'publish refused',
    );
    expect(mqttClient.getMetrics().lastErrorMessage).toBe('publish refused');
  });
});

describe('PraeventioMqttClient — message handler', () => {
  /**
   * Fires a 'message' event on the fake client.
   * `rawPayload` is a Buffer (mqtt delivers Buffer, not Uint8Array).
   */
  function fireMessage(
    fakeClient: FakeMqttClient,
    topic: string,
    rawPayload: Buffer,
    qos: 0 | 1 | 2 = 0,
  ) {
    fakeClient._emit('message', topic, rawPayload, { qos });
  }

  it('valid JSON payload is parsed into payloadJson + increments messagesReceived', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    const payload = Buffer.from(JSON.stringify({ sensor: 'co2', ppm: 450 }));
    fireMessage(fakeClient, 'env/co2', payload);

    expect(received).toHaveLength(1);
    const e = received[0];
    expect(e.topic).toBe('env/co2');
    expect(e.payloadJson).toEqual({ sensor: 'co2', ppm: 450 });
    expect(e.payloadText).toBe('{"sensor":"co2","ppm":450}');
    expect(e.payload).toBeInstanceOf(Uint8Array);
    expect(mqttClient.getMetrics().messagesReceived).toBe(1);
  });

  it('malformed JSON payload: payloadJson=null, does NOT crash, still delivered', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    const payload = Buffer.from('{not valid json}');
    fireMessage(fakeClient, 'env/raw', payload);

    expect(received).toHaveLength(1);
    expect(received[0].payloadJson).toBeNull();
    expect(received[0].payloadText).toBe('{not valid json}');
  });

  it('non-JSON text payload (no leading { or [): payloadJson=null', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/temp', Buffer.from('plain text value'));

    expect(received).toHaveLength(1);
    expect(received[0].payloadJson).toBeNull();
    expect(received[0].payloadText).toBe('plain text value');
  });

  it('JSON array payload (starts with "[") is parsed', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    const arr = [1, 2, 3];
    fireMessage(fakeClient, 'batch/data', Buffer.from(JSON.stringify(arr)));

    expect(received).toHaveLength(1);
    // payloadJson accepts Record<string, unknown>; arrays are Objects
    expect(received[0].payloadJson).toEqual(arr);
  });

  it('binary/empty payload: delivered with empty payloadText + null payloadJson', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/bin', Buffer.alloc(0));

    expect(received).toHaveLength(1);
    expect(received[0].payloadText).toBe('');
    expect(received[0].payloadJson).toBeNull();
  });

  it('qos field is forwarded from the packet', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/gas', Buffer.from('data'), 2);

    expect(received[0].qos).toBe(2);
  });

  it('receivedAtMs is a reasonable epoch timestamp', async () => {
    const before = Date.now();
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/temp', Buffer.from('21'));
    const after = Date.now();

    expect(received[0].receivedAtMs).toBeGreaterThanOrEqual(before);
    expect(received[0].receivedAtMs).toBeLessThanOrEqual(after);
  });

  it('listener that throws does NOT crash the client or skip subsequent listeners', async () => {
    const safeReceived: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();

    mqttClient.onMessage(() => {
      throw new Error('listener boom');
    });
    mqttClient.onMessage((e) => safeReceived.push(e));

    fireMessage(fakeClient, 'sensors/temp', Buffer.from('data'));

    expect(safeReceived).toHaveLength(1);
  });

  it('onMessage returns an unsubscribe function that stops further delivery', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient();
    const unsub = mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/temp', Buffer.from('hello'));
    expect(received).toHaveLength(1);

    unsub();
    fireMessage(fakeClient, 'sensors/temp', Buffer.from('world'));
    expect(received).toHaveLength(1); // still 1, second message not received
  });
});

describe('PraeventioMqttClient — edge filter gating', () => {
  function fireMessage(
    fakeClient: FakeMqttClient,
    topic: string,
    rawPayload: Buffer,
    qos: 0 | 1 | 2 = 0,
  ) {
    fakeClient._emit('message', topic, rawPayload, { qos });
  }

  it('edge filter returning false: message is NOT delivered to listeners + increments messagesFilteredOut', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient({
      edgeFilter: () => false,
    });
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/gas', Buffer.from(JSON.stringify({ status: 'ok' })));

    expect(received).toHaveLength(0);
    expect(mqttClient.getMetrics().messagesFilteredOut).toBe(1);
    expect(mqttClient.getMetrics().messagesReceived).toBe(0);
  });

  it('edge filter returning true: message IS delivered', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient({
      edgeFilter: () => true,
    });
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(fakeClient, 'sensors/gas', Buffer.from(JSON.stringify({ status: 'warning' })));

    expect(received).toHaveLength(1);
    expect(mqttClient.getMetrics().messagesFilteredOut).toBe(0);
  });

  it('onlyAnomaliesFilter wired in config: ok status is dropped', async () => {
    const received: MqttSensorEvent[] = [];
    const { mqttClient, fakeClient } = await connectedClient({
      edgeFilter: onlyAnomaliesFilter,
    });
    mqttClient.onMessage((e) => received.push(e));

    fireMessage(
      fakeClient,
      'sensors/gas',
      Buffer.from(JSON.stringify({ status: 'ok', ppm: 5 })),
    );
    fireMessage(
      fakeClient,
      'sensors/gas',
      Buffer.from(JSON.stringify({ status: 'alarm', ppm: 80 })),
    );

    expect(received).toHaveLength(1);
    expect((received[0].payloadJson as Record<string, unknown>).status).toBe('alarm');
    const m = mqttClient.getMetrics();
    expect(m.messagesReceived).toBe(1);
    expect(m.messagesFilteredOut).toBe(1);
  });
});

describe('PraeventioMqttClient — state listeners (onState)', () => {
  it('onState fires immediately with current state on registration', () => {
    const states: ConnectionState[] = [];
    const client = new PraeventioMqttClient(baseConfig());
    client.onState((s) => states.push(s));
    expect(states).toEqual(['disconnected']);
  });

  it('onState unsubscribe function stops further state notifications', async () => {
    const states: ConnectionState[] = [];
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);
    const client = new PraeventioMqttClient(baseConfig());
    const unsub = client.onState((s) => states.push(s));
    // ['disconnected'] at this point
    unsub();

    const p = client.connect();
    fakeClient._fireConnect();
    await p;

    // No more states should have been pushed after unsub.
    expect(states).toEqual(['disconnected']);
  });

  it('state listener that throws does NOT break the state machine', async () => {
    const fakeClient = makeFakeMqttClient();
    connectMock.mockReturnValueOnce(fakeClient);
    const client = new PraeventioMqttClient(baseConfig());

    client.onState(() => {
      throw new Error('state listener boom');
    });

    const p = client.connect();
    fakeClient._fireConnect();
    // Should resolve without throwing even though state listener threw.
    await expect(p).resolves.toBeUndefined();
    expect(client.getMetrics().state).toBe('connected');
  });
});

describe('PraeventioMqttClient — getMetrics snapshot', () => {
  it('initial metrics are all-zero / null / empty before any action', () => {
    const client = new PraeventioMqttClient(baseConfig());
    const m = client.getMetrics();
    expect(m.state).toBe('disconnected');
    expect(m.messagesReceived).toBe(0);
    expect(m.messagesPublished).toBe(0);
    expect(m.messagesFilteredOut).toBe(0);
    expect(m.reconnectCount).toBe(0);
    expect(m.lastMessageAtIso).toBeNull();
    expect(m.lastErrorMessage).toBeNull();
    expect(m.subscribedTopics).toEqual([]);
    expect(m.connectedSince).toBeNull();
  });

  it('lastMessageAtIso is set after a message arrives', async () => {
    const { mqttClient, fakeClient } = await connectedClient();
    fakeClient._emit('message', 'sensors/temp', Buffer.from('42'), { qos: 0 });

    const m = mqttClient.getMetrics();
    expect(m.lastMessageAtIso).not.toBeNull();
    expect(() => new Date(m.lastMessageAtIso!)).not.toThrow();
  });

  it('subscribedTopics reflects multiple subscriptions and removals', async () => {
    const { mqttClient } = await connectedClient();
    await mqttClient.subscribe('topic/a');
    await mqttClient.subscribe('topic/b');
    expect(mqttClient.getMetrics().subscribedTopics).toContain('topic/a');
    expect(mqttClient.getMetrics().subscribedTopics).toContain('topic/b');

    await mqttClient.unsubscribe('topic/a');
    expect(mqttClient.getMetrics().subscribedTopics).not.toContain('topic/a');
    expect(mqttClient.getMetrics().subscribedTopics).toContain('topic/b');
  });
});
