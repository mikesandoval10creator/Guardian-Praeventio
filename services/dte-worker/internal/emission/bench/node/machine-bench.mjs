/* global process, console */
// Node reference for the Go emission-machine hot path (gate Go item 7:
// benchmark contra TypeScript). Same mixed workload as BenchmarkHotPath:
// enqueue (with ~20% stale-retry duplicates), claim, complete.
// Usage: node machine-bench.mjs [ops]   -> prints p50/p95 ns per op.
'use strict';

class Machine {
  constructor() {
    this.byKey = new Map();
    this.order = [];
    this.nextID = 1;
  }
  enqueue(tenant, key, docType) {
    const id = tenant + '|' + key;
    const seen = this.byKey.get(id);
    if (seen) return { emission: seen, deduped: true };
    const em = {
      id: String(this.nextID++), tenantID: tenant, idempotencyKey: key,
      documentType: docType, state: 'queued', attempts: 0, resultRef: '',
    };
    this.byKey.set(id, em);
    this.order.push(em);
    return { emission: em, deduped: false };
  }
  claimNext(worker) {
    for (const em of this.order) {
      if (em.state === 'queued' || (em.state === 'failed' && em.attempts < 5)) {
        em.state = 'emitting';
        em.claimedBy = worker;
        em.attempts++;
        return em;
      }
    }
    return null;
  }
  complete(id, resultRef) {
    for (const em of this.order) {
      if (em.id === id && em.state === 'emitting') {
        em.state = 'emitted';
        em.resultRef = resultRef;
        em.claimedBy = '';
        return true;
      }
    }
    return false;
  }
}

const ops = Number(process.argv[2] || 50000);
const m = new Machine();
const samples = new Float64Array(ops);
let key = 0;
for (let i = 0; i < ops; i++) {
  const t0 = process.hrtime.bigint();
  switch (i % 5) {
    case 0: case 1:
      key++;
      m.enqueue('t', 'k' + (key % 97), '33');
      break;
    case 2: {
      const c = m.claimNext('w');
      if (c) m.complete(c.id, 'ref');
      break;
    }
    default:
      m.enqueue('t', 'k' + (key % 97), '33');
  }
  samples[i] = Number(process.hrtime.bigint() - t0);
}
samples.sort();
const q = (p) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
console.log(JSON.stringify({ ops, p50_ns: q(0.5), p95_ns: q(0.95), p99_ns: q(0.99) }));
