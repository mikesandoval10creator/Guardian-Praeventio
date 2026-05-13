import { describe, it, expect } from 'vitest';
import {
  analyzeBundle,
  formatReportMarkdown,
  DEFAULT_BUDGET,
  type ChunkStats,
} from './bundleSizeAnalyzer.js';

const KB = 1024;

function chunk(over: Partial<ChunkStats>): ChunkStats {
  return {
    name: 'index.js',
    bytes: 200 * KB,
    bytesGzipped: 60 * KB,
    eager: true,
    ...over,
  };
}

describe('analyzeBundle — within budget', () => {
  it('bundle pequeño pasa sin violations', () => {
    const r = analyzeBundle([
      chunk({ name: 'main.js', bytesGzipped: 100 * KB }),
      chunk({ name: 'vendor.js', bytesGzipped: 80 * KB }),
    ]);
    expect(r.pass).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('cuenta eager vs lazy correctamente', () => {
    const r = analyzeBundle([
      chunk({ name: 'main.js', eager: true }),
      chunk({ name: 'twin-scene.js', eager: false }),
      chunk({ name: 'risk-matrix.js', eager: false }),
    ]);
    expect(r.eagerCount).toBe(1);
    expect(r.lazyCount).toBe(2);
    expect(r.chunkCount).toBe(3);
  });
});

describe('analyzeBundle — violations', () => {
  it('chunk excede maxChunkGzipBytes → violation', () => {
    const r = analyzeBundle([chunk({ name: 'huge.js', bytesGzipped: 300 * KB })]);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.kind === 'chunk_over_budget')).toBe(true);
  });

  it('initial eager total excede budget → violation', () => {
    const r = analyzeBundle([
      chunk({ name: 'main.js', bytesGzipped: 150 * KB, eager: true }),
      chunk({ name: 'app.js', bytesGzipped: 150 * KB, eager: true }),
    ]);
    expect(r.violations.some((v) => v.kind === 'initial_over_budget')).toBe(true);
  });

  it('WASM cargado eagerly → violation específica', () => {
    const r = analyzeBundle([
      chunk({
        name: 'onnxruntime-web.js',
        bytesGzipped: 80 * KB,
        eager: true,
      }),
    ]);
    expect(r.violations.some((v) => v.kind === 'wasm_loaded_eagerly')).toBe(true);
  });

  it('detecta WASM por topModules aún si el chunk name no lo dice', () => {
    const r = analyzeBundle([
      chunk({
        name: 'shared.js',
        bytesGzipped: 90 * KB,
        eager: true,
        topModules: [{ id: 'node_modules/onnxruntime-web/dist/ort.wasm', bytes: 80 * KB * 1024 }],
      }),
    ]);
    expect(r.violations.some((v) => v.kind === 'wasm_loaded_eagerly')).toBe(true);
  });

  it('total bundle excede budget total → violation', () => {
    const r = analyzeBundle(
      Array.from({ length: 30 }, (_, i) =>
        chunk({ name: `chunk-${i}.js`, bytesGzipped: 200 * KB, eager: false }),
      ),
    );
    expect(r.violations.some((v) => v.kind === 'total_over_budget')).toBe(true);
  });
});

describe('analyzeBundle — recommendations', () => {
  it('sugiere lazy-load para chunks eager >100KB', () => {
    const r = analyzeBundle([
      chunk({ name: 'heavy-chart.js', bytesGzipped: 150 * KB, eager: true }),
    ]);
    expect(r.recommendations.some((s) => /heavy-chart\.js/.test(s))).toBe(true);
    expect(r.recommendations[0]).toMatch(/Lazy-load/);
  });

  it('máximo 3 recomendaciones de lazy', () => {
    const r = analyzeBundle(
      Array.from({ length: 10 }, (_, i) =>
        chunk({ name: `c-${i}.js`, bytesGzipped: 110 * KB, eager: true }),
      ),
    );
    expect(r.recommendations.filter((s) => s.includes('Lazy-load')).length).toBeLessThanOrEqual(3);
  });
});

describe('analyzeBundle — topByGzipBytes', () => {
  it('ordenado desc por gzip + max 10', () => {
    const chunks = Array.from({ length: 15 }, (_, i) =>
      chunk({ name: `c-${i}.js`, bytesGzipped: (i + 1) * KB, eager: false }),
    );
    const r = analyzeBundle(chunks);
    expect(r.topByGzipBytes).toHaveLength(10);
    expect(r.topByGzipBytes[0]!.bytesGzipped).toBeGreaterThanOrEqual(
      r.topByGzipBytes[1]!.bytesGzipped,
    );
  });
});

describe('formatReportMarkdown', () => {
  it('produce markdown válido con PASS/FAIL + sections', () => {
    const r = analyzeBundle([chunk({ name: 'a.js', bytesGzipped: 50 * KB })]);
    const md = formatReportMarkdown(r);
    expect(md).toMatch(/^# Bundle size report/m);
    expect(md).toMatch(/PASS|FAIL/);
    expect(md).toMatch(/Top 10 chunks/);
  });

  it('lista violaciones cuando hay', () => {
    const r = analyzeBundle([chunk({ name: 'huge.js', bytesGzipped: 300 * KB })]);
    const md = formatReportMarkdown(r);
    expect(md).toMatch(/❌ Violaciones/);
    expect(md).toMatch(/huge\.js/);
  });
});

describe('DEFAULT_BUDGET sanity', () => {
  it('tiene los 3 budgets', () => {
    expect(DEFAULT_BUDGET.maxInitialGzipBytes).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.maxChunkGzipBytes).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.maxTotalGzipBytes).toBeGreaterThan(0);
  });
});
