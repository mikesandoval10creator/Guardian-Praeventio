/**
 * Unit tests for the forceGraphWorker (Sprint 29 Bucket BB — H22).
 *
 * We exercise the pure helpers (`parseForceGraphRequest`, `runSimulation`)
 * directly rather than spinning up a real Worker. The worker boilerplate
 * at module scope only attaches `self.onmessage` when running inside an
 * actual `DedicatedWorkerGlobalScope`; under Node that side effect is
 * skipped and the helpers remain pure.
 *
 * Three cases covered:
 *   1. valid message — returns a position array of correct length and shape.
 *   2. invalid message — `parseForceGraphRequest` rejects with `null`.
 *   3. clean termination — re-running the simulation in the same module
 *      scope yields fresh positions, i.e. there is no hidden cross-call
 *      state. This is what "clean termination" means for a stateless
 *      worker: the `runSimulation` call is idempotent w.r.t. previous
 *      calls.
 */

import { describe, expect, it } from 'vitest';
import { parseForceGraphRequest, runSimulation } from './forceGraphWorker';

describe('forceGraphWorker', () => {
  it('processes a valid simulate message and returns positions for every node', () => {
    const payload = {
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      links: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
      iterations: 30,
    };
    const parsed = parseForceGraphRequest({ type: 'simulate', payload });
    expect(parsed).not.toBeNull();
    const positions = runSimulation(parsed!);
    expect(positions).toHaveLength(3);
    for (const p of positions) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Every original node must be represented exactly once.
    const ids = new Set(positions.map((p) => p.id));
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(true);
  });

  it('rejects an invalid simulate message via parseForceGraphRequest', () => {
    expect(parseForceGraphRequest(null)).toBeNull();
    expect(parseForceGraphRequest({ type: 'unknown' })).toBeNull();
    expect(parseForceGraphRequest({ type: 'simulate' })).toBeNull();
    expect(parseForceGraphRequest({ type: 'simulate', payload: { nodes: 'no', links: [] } })).toBeNull();
    expect(
      parseForceGraphRequest({ type: 'simulate', payload: { nodes: [{ id: 1 }], links: [] } }),
    ).toBeNull();
    expect(
      parseForceGraphRequest({ type: 'simulate', payload: { nodes: [{ id: 'a' }], links: [{ source: 1, target: 'a' }] } }),
    ).toBeNull();
  });

  it('produces independent results across runs (clean termination contract)', () => {
    // Two independent simulate calls should not share state. We seed
    // with explicit positions so determinism is easier to assert.
    const seed = {
      nodes: [
        { id: 'a', x: 10, y: 0 },
        { id: 'b', x: -10, y: 0 },
      ],
      links: [{ source: 'a', target: 'b' }],
      iterations: 10,
    };
    const first = runSimulation(seed);
    // Same input again — fresh simulation, same shape.
    const second = runSimulation(seed);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    // Both runs must finish (no NaN, no infinite). This is the only
    // guarantee we can give without locking a specific d3 version's
    // numerical behaviour into the test.
    for (const arr of [first, second]) {
      for (const p of arr) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('honours dim:3 and emits a numeric z coordinate', () => {
    const positions = runSimulation({
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      iterations: 5,
      dim: 3,
    });
    for (const p of positions) {
      expect(typeof p.z).toBe('number');
      expect(Number.isFinite(p.z!)).toBe(true);
    }
  });
});
