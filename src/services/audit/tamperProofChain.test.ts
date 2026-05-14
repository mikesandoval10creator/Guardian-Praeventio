import { describe, it, expect } from 'vitest';
import {
  AuditChainError,
  appendEvent,
  buildChain,
  canonicalize,
  chainAnchor,
  computeEventHash,
  findFirstGap,
  GENESIS_HASH,
  verifyChain,
  type AuditEvent,
} from './tamperProofChain';

const t1 = '2026-05-14T10:00:00.000Z';
const t2 = '2026-05-14T10:00:01.000Z';
const t3 = '2026-05-14T10:00:02.000Z';
const t4 = '2026-05-14T10:00:03.000Z';

describe('canonicalize', () => {
  it('null / boolean / number / string', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(3.14)).toBe('3.14');
    expect(canonicalize('hola')).toBe('"hola"');
  });

  it('NaN / Infinity → null (defensivo)', () => {
    expect(canonicalize(NaN)).toBe('null');
    expect(canonicalize(Infinity)).toBe('null');
    expect(canonicalize(-Infinity)).toBe('null');
  });

  it('undefined → null', () => {
    expect(canonicalize(undefined)).toBe('null');
  });

  it('strings con caracteres especiales escapadas como JSON', () => {
    expect(canonicalize('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalize('línea\nfin')).toBe('"línea\\nfin"');
  });

  it('arrays preservan orden', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize(['a', 'b'])).toBe('["a","b"]');
  });

  it('objects: keys ordenadas alfabéticamente', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 0, a: 0, m: 0 })).toBe('{"a":0,"m":0,"z":0}');
  });

  it('objects anidados: sorting recursivo', () => {
    expect(
      canonicalize({ outer: { z: 1, a: 2 }, alpha: { y: 3, x: 4 } }),
    ).toBe('{"alpha":{"x":4,"y":3},"outer":{"a":2,"z":1}}');
  });

  it('determinismo: orden de inserción NO afecta output', () => {
    const a = { foo: 'bar', baz: [1, 2], nested: { z: 1, a: 2 } };
    const b: Record<string, unknown> = {};
    b.nested = { a: 2, z: 1 };
    b.baz = [1, 2];
    b.foo = 'bar';
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe('computeEventHash', () => {
  it('produce hash hex 64 chars', async () => {
    const h = await computeEventHash({
      seq: 0,
      timestamp: t1,
      prevHash: GENESIS_HASH,
      actor: 'user-1',
      action: 'test',
      payload: {},
    });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('mismo input → mismo hash (determinístico)', async () => {
    const h1 = await computeEventHash({
      seq: 0,
      timestamp: t1,
      prevHash: GENESIS_HASH,
      actor: 'a',
      action: 'x',
      payload: { foo: 'bar' },
    });
    const h2 = await computeEventHash({
      seq: 0,
      timestamp: t1,
      prevHash: GENESIS_HASH,
      actor: 'a',
      action: 'x',
      payload: { foo: 'bar' },
    });
    expect(h1).toBe(h2);
  });

  it('payload con keys en distinto orden → mismo hash (canonicalization)', async () => {
    const h1 = await computeEventHash({
      seq: 0,
      timestamp: t1,
      prevHash: GENESIS_HASH,
      actor: 'a',
      action: 'x',
      payload: { foo: 'bar', baz: 1 },
    });
    const h2 = await computeEventHash({
      seq: 0,
      timestamp: t1,
      prevHash: GENESIS_HASH,
      actor: 'a',
      action: 'x',
      payload: { baz: 1, foo: 'bar' },
    });
    expect(h1).toBe(h2);
  });

  it('cualquier field cambia → hash distinto', async () => {
    const base = {
      seq: 0,
      timestamp: t1,
      prevHash: GENESIS_HASH,
      actor: 'a',
      action: 'x',
      payload: { v: 1 },
    };
    const h0 = await computeEventHash(base);
    expect(await computeEventHash({ ...base, seq: 1 })).not.toBe(h0);
    expect(await computeEventHash({ ...base, timestamp: t2 })).not.toBe(h0);
    expect(await computeEventHash({ ...base, prevHash: 'xx' })).not.toBe(h0);
    expect(await computeEventHash({ ...base, actor: 'b' })).not.toBe(h0);
    expect(await computeEventHash({ ...base, action: 'y' })).not.toBe(h0);
    expect(await computeEventHash({ ...base, payload: { v: 2 } })).not.toBe(h0);
  });
});

describe('appendEvent', () => {
  it('genesis: prev=null → seq=0, prevHash=GENESIS', async () => {
    const ev = await appendEvent(null, {
      actor: 'system',
      action: 'init',
      payload: {},
      timestamp: t1,
    });
    expect(ev.seq).toBe(0);
    expect(ev.prevHash).toBe(GENESIS_HASH);
    expect(ev.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('continuation: seq incrementa, prevHash = prev.hash', async () => {
    const e0 = await appendEvent(null, {
      actor: 'a',
      action: 'first',
      payload: { i: 1 },
      timestamp: t1,
    });
    const e1 = await appendEvent(e0, {
      actor: 'b',
      action: 'second',
      payload: { i: 2 },
      timestamp: t2,
    });
    expect(e1.seq).toBe(1);
    expect(e1.prevHash).toBe(e0.hash);
  });

  it('timestamp default = now() si no se pasa', async () => {
    const ev = await appendEvent(null, {
      actor: 'a',
      action: 'x',
      payload: {},
    });
    expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('timestamp invalido → throws INVALID_TIMESTAMP', async () => {
    await expect(
      appendEvent(null, {
        actor: 'a',
        action: 'x',
        payload: {},
        timestamp: 'no-es-iso',
      }),
    ).rejects.toThrow(/INVALID_TIMESTAMP/);
  });

  it('timestamp anterior al prev → NONMONOTONIC_TIMESTAMP', async () => {
    const e0 = await appendEvent(null, {
      actor: 'a',
      action: 'x',
      payload: {},
      timestamp: t2,
    });
    await expect(
      appendEvent(e0, {
        actor: 'b',
        action: 'y',
        payload: {},
        timestamp: t1, // anterior
      }),
    ).rejects.toThrow(/NONMONOTONIC_TIMESTAMP/);
  });

  it('timestamp igual al prev → OK (no-decreciente, no estrictamente creciente)', async () => {
    const e0 = await appendEvent(null, {
      actor: 'a',
      action: 'x',
      payload: {},
      timestamp: t1,
    });
    const e1 = await appendEvent(e0, {
      actor: 'b',
      action: 'y',
      payload: {},
      timestamp: t1, // mismo
    });
    expect(e1.seq).toBe(1);
  });
});

describe('verifyChain', () => {
  it('cadena vacía → valid=true', async () => {
    const r = await verifyChain([]);
    expect(r.valid).toBe(true);
    expect(r.verifiedCount).toBe(0);
  });

  it('cadena válida construida → valid=true', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: { v: 1 }, timestamp: t1 },
      { actor: 'b', action: 'y', payload: { v: 2 }, timestamp: t2 },
      { actor: 'c', action: 'z', payload: { v: 3 }, timestamp: t3 },
    ]);
    const r = await verifyChain(chain);
    expect(r.valid).toBe(true);
    expect(r.verifiedCount).toBe(3);
  });

  it('payload modificado in-place → HASH_MISMATCH en ese seq', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: { v: 1 }, timestamp: t1 },
      { actor: 'b', action: 'y', payload: { v: 2 }, timestamp: t2 },
    ]);
    // Tamper el payload del seq=1 SIN recomputar el hash.
    const tampered: AuditEvent[] = [
      chain[0]!,
      { ...chain[1]!, payload: { v: 999 } },
    ];
    const r = await verifyChain(tampered);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('HASH_MISMATCH');
    expect(r.failedAt).toBe(1);
  });

  it('seq gap (faltó un evento) → SEQ_GAP', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: {}, timestamp: t1 },
      { actor: 'b', action: 'y', payload: {}, timestamp: t2 },
      { actor: 'c', action: 'z', payload: {}, timestamp: t3 },
    ]);
    // Quitamos el seq=1 — verificar la cadena con [0, 2] como si fueran [0, 1]
    // Pero los seq originales son [0, 2] así que el segundo seq=2 falla.
    const truncated = [chain[0]!, chain[2]!];
    const r = await verifyChain(truncated);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('SEQ_GAP');
    expect(r.failedAt).toBe(1);
  });

  it('prevHash incorrecta (eventos reordenados) → INVALID_PREV_HASH', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: { v: 1 }, timestamp: t1 },
      { actor: 'b', action: 'y', payload: { v: 2 }, timestamp: t2 },
    ]);
    // Cambiamos manualmente prevHash del seq=1 a un hash incorrecto.
    const tampered: AuditEvent[] = [
      chain[0]!,
      { ...chain[1]!, prevHash: 'a'.repeat(64) },
    ];
    const r = await verifyChain(tampered);
    expect(r.valid).toBe(false);
    // El verify chequea prevHash ANTES de recompute hash, así que el
    // error specific es INVALID_PREV_HASH (el seq=1 dice "yo vengo de
    // X" pero X no es el hash real del seq=0).
    expect(r.errorCode).toBe('INVALID_PREV_HASH');
    expect(r.failedAt).toBe(1);
  });

  it('primer evento con prevHash != GENESIS → GENESIS_MISMATCH', async () => {
    const ev = await appendEvent(null, {
      actor: 'a',
      action: 'x',
      payload: {},
      timestamp: t1,
    });
    const evilFirst: AuditEvent = { ...ev, prevHash: 'b'.repeat(64) };
    const r = await verifyChain([evilFirst]);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('GENESIS_MISMATCH');
    expect(r.failedAt).toBe(0);
  });

  it('hash inválido en seq=0 → HASH_MISMATCH al revisar genesis hash', async () => {
    const ev = await appendEvent(null, {
      actor: 'a',
      action: 'x',
      payload: {},
      timestamp: t1,
    });
    const tampered: AuditEvent = { ...ev, hash: 'c'.repeat(64) };
    const r = await verifyChain([tampered]);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('HASH_MISMATCH');
  });

  it('timestamp no-monotónico in-chain → NONMONOTONIC_TIMESTAMP', async () => {
    // Manualmente construimos una cadena donde seq=2 tiene timestamp < seq=1.
    const e0 = await appendEvent(null, {
      actor: 'a',
      action: 'x',
      payload: {},
      timestamp: t1,
    });
    const e1 = await appendEvent(e0, {
      actor: 'b',
      action: 'y',
      payload: {},
      timestamp: t3,
    });
    // Forzamos un seq=2 con timestamp t2 (< t3). Re-computamos hash
    // sobre los campos manipulados para que SOLO el timestamp esté
    // fuera de orden, NO el hash.
    const e2Fields = {
      seq: 2,
      timestamp: t2,
      prevHash: e1.hash,
      actor: 'c',
      action: 'z',
      payload: {},
    };
    const e2Hash = await computeEventHash(e2Fields);
    const e2: AuditEvent = { ...e2Fields, hash: e2Hash };
    const r = await verifyChain([e0, e1, e2]);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('NONMONOTONIC_TIMESTAMP');
    expect(r.failedAt).toBe(2);
  });
});

describe('buildChain', () => {
  it('cadena vacía → []', async () => {
    expect(await buildChain([])).toEqual([]);
  });

  it('hash chain linked y verifiable', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: {}, timestamp: t1 },
      { actor: 'b', action: 'y', payload: {}, timestamp: t2 },
      { actor: 'c', action: 'z', payload: {}, timestamp: t3 },
      { actor: 'd', action: 'w', payload: {}, timestamp: t4 },
    ]);
    expect(chain).toHaveLength(4);
    for (let i = 0; i < chain.length; i++) {
      expect(chain[i]!.seq).toBe(i);
    }
    expect(chain[1]!.prevHash).toBe(chain[0]!.hash);
    expect(chain[2]!.prevHash).toBe(chain[1]!.hash);
    expect(chain[3]!.prevHash).toBe(chain[2]!.hash);
    expect((await verifyChain(chain)).valid).toBe(true);
  });
});

describe('chainAnchor', () => {
  it('cadena vacía → null', () => {
    expect(chainAnchor([])).toBeNull();
  });

  it('último hash de la cadena', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: {}, timestamp: t1 },
      { actor: 'b', action: 'y', payload: {}, timestamp: t2 },
    ]);
    expect(chainAnchor(chain)).toBe(chain[1]!.hash);
  });
});

describe('findFirstGap', () => {
  it('cadena sin gaps → null', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: {}, timestamp: t1 },
      { actor: 'b', action: 'y', payload: {}, timestamp: t2 },
    ]);
    expect(findFirstGap(chain)).toBeNull();
  });

  it('cadena con gap detecta primer salto', async () => {
    const chain = await buildChain([
      { actor: 'a', action: 'x', payload: {}, timestamp: t1 },
      { actor: 'b', action: 'y', payload: {}, timestamp: t2 },
      { actor: 'c', action: 'z', payload: {}, timestamp: t3 },
    ]);
    // Quitamos el seq=1 — la lista resultante tiene seq=[0,2]
    const gappy = [chain[0]!, chain[2]!];
    const g = findFirstGap(gappy);
    expect(g).toEqual({ gapAt: 1 });
  });
});

describe('end-to-end: real-world scenarios', () => {
  it('investigación post-fatal: 5 eventos previos al accidente, cadena íntegra', async () => {
    const investigationChain = await buildChain([
      { actor: 'worker-uid-juan', action: 'shift.start', payload: { area: 'sector-c' }, timestamp: '2026-05-14T08:00:00Z' },
      { actor: 'worker-uid-juan', action: 'task.assign', payload: { taskId: 't-77', risk: 'altura' }, timestamp: '2026-05-14T08:15:00Z' },
      { actor: 'worker-uid-juan', action: 'epp.checklist', payload: { items: ['arnes', 'casco'], passed: true }, timestamp: '2026-05-14T08:20:00Z' },
      { actor: 'system', action: 'sensor.weather', payload: { wind: 18, temp: 12 }, timestamp: '2026-05-14T09:00:00Z' },
      { actor: 'worker-uid-juan', action: 'sos.trigger', payload: { fallDetected: true, gps: '-33.4500,-70.6700' }, timestamp: '2026-05-14T09:42:33Z' },
    ]);
    const v = await verifyChain(investigationChain);
    expect(v.valid).toBe(true);
    expect(v.verifiedCount).toBe(5);
    expect(chainAnchor(investigationChain)).toBeTruthy();
  });

  it('atacante intenta borrar el evento "no usé arnés" → SEQ_GAP detecta', async () => {
    const chain = await buildChain([
      { actor: 'w1', action: 'shift.start', payload: {}, timestamp: t1 },
      { actor: 'w1', action: 'epp.skipped', payload: { reason: 'cansado' }, timestamp: t2 },
      { actor: 'w1', action: 'accident', payload: {}, timestamp: t3 },
    ]);
    // Atacante borra el evento del medio
    const tampered = [chain[0]!, chain[2]!];
    const r = await verifyChain(tampered);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('SEQ_GAP');
  });

  it('atacante intenta cambiar payload "uso arnés=false → true"', async () => {
    const chain = await buildChain([
      { actor: 'w1', action: 'epp.checklist', payload: { harness: false }, timestamp: t1 },
      { actor: 'w1', action: 'accident', payload: {}, timestamp: t2 },
    ]);
    // Atacante reescribe payload
    const tampered: AuditEvent[] = [
      { ...chain[0]!, payload: { harness: true } }, // pero hash no cambia
      chain[1]!,
    ];
    const r = await verifyChain(tampered);
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('HASH_MISMATCH');
    expect(r.failedAt).toBe(0);
  });
});

describe('AuditChainError exposure', () => {
  it('error tiene .code + .seq accesibles', async () => {
    try {
      await appendEvent(null, {
        actor: 'a',
        action: 'x',
        payload: {},
        timestamp: 'invalid',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuditChainError);
      expect((err as AuditChainError).code).toBe('INVALID_TIMESTAMP');
    }
  });
});
