import { performance } from 'node:perf_hooks';
import { runSimulation } from '../../src/workers/forceGraphWorker';

type Fixture = { nodes: { id: string }[]; links: { source: string; target: string }[] };

function fixture(size: number): Fixture {
  const nodes = Array.from({ length: size }, (_, i) => ({ id: `n${i}` }));
  const links = Array.from({ length: Math.max(0, size - 1) }, (_, i) => ({
    source: `n${i}`,
    target: `n${i + 1}`,
  }));
  return { nodes, links };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(size: number, warmups = 3, samples = 7) {
  const input = fixture(size);
  for (let i = 0; i < warmups; i++) runSimulation({ ...input, iterations: 60, dim: 2 });
  const timings: number[] = [];
  let outputSize = 0;
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    const output = runSimulation({ ...input, iterations: 60, dim: 2 });
    timings.push(performance.now() - start);
    outputSize = output.length;
  }
  return {
    nodes: size,
    links: input.links.length,
    iterations: 60,
    outputSize,
    medianMs: Number(median(timings).toFixed(2)),
    minMs: Number(Math.min(...timings).toFixed(2)),
    maxMs: Number(Math.max(...timings).toFixed(2)),
    samples,
  };
}

const results = [100, 1_000, 10_000].map((size) => measure(size));
for (const result of results) {
  if (result.outputSize !== result.nodes) throw new Error(`invalid output for ${result.nodes}`);
}
console.log(JSON.stringify({ engine: 'typescript-d3-force', results }, null, 2));
