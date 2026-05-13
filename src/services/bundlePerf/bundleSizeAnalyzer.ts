// Praeventio Guard — Sprint 47 D.7: Bundle size analyzer + lazy strategy.
//
// Cierra D.7 del plan maestro. Motor puro que analiza estadísticas de
// chunks Vite (que el caller resuelve desde el output) y genera:
//   - Reporte por chunk: tamaño raw + gzipped + lazy/eager
//   - Detección de chunks "demasiado grandes para eager" (>200KB gzip)
//   - Recomendaciones específicas (cuáles componentes deberían ser lazy)
//   - Budget tracking: total bundle main + per-tier targets
//
// 100% determinístico. CI lo invoca con el output de `vite build --json`
// (manualChunks stats) y bloquea PR si excede budget.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ChunkStats {
  name: string;
  /** Tamaño raw del chunk en bytes. */
  bytes: number;
  /** Tamaño gzipped. */
  bytesGzipped: number;
  /** Si se carga eagerly (en el main entry). */
  eager: boolean;
  /** Módulos top-N que más pesan dentro del chunk (debugging). */
  topModules?: Array<{ id: string; bytes: number }>;
}

export interface BundleBudget {
  /** Bytes gzipped del initial bundle (main + critical CSS). Default 250KB. */
  maxInitialGzipBytes: number;
  /** Bytes gzipped por chunk individual. Default 200KB. */
  maxChunkGzipBytes: number;
  /** Total bytes gzipped del bundle completo. Default 5MB. */
  maxTotalGzipBytes: number;
}

export const DEFAULT_BUDGET: BundleBudget = {
  maxInitialGzipBytes: 250 * 1024,
  maxChunkGzipBytes: 200 * 1024,
  maxTotalGzipBytes: 5 * 1024 * 1024,
};

export type BundleViolation =
  | 'initial_over_budget'
  | 'chunk_over_budget'
  | 'total_over_budget'
  | 'wasm_loaded_eagerly';

export interface BundleViolationDetail {
  kind: BundleViolation;
  chunkName?: string;
  observed: number;
  budget: number;
  remediation: string;
}

export interface BundleAnalysisReport {
  totalGzipBytes: number;
  initialGzipBytes: number;
  chunkCount: number;
  eagerCount: number;
  lazyCount: number;
  violations: BundleViolationDetail[];
  recommendations: string[];
  topByGzipBytes: ChunkStats[];
  pass: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Analysis
// ────────────────────────────────────────────────────────────────────────

const WASM_PATTERNS = [/\.wasm$/i, /onnxruntime/i, /mediapipe/i, /tasks-vision/i];

function isWasmHeavy(chunk: ChunkStats): boolean {
  if (WASM_PATTERNS.some((re) => re.test(chunk.name))) return true;
  if (chunk.topModules?.some((m) => WASM_PATTERNS.some((re) => re.test(m.id)))) return true;
  return false;
}

export function analyzeBundle(
  chunks: ReadonlyArray<ChunkStats>,
  budget: BundleBudget = DEFAULT_BUDGET,
): BundleAnalysisReport {
  const violations: BundleViolationDetail[] = [];
  const recommendations: string[] = [];

  const totalGzip = chunks.reduce((s, c) => s + c.bytesGzipped, 0);
  const eagerChunks = chunks.filter((c) => c.eager);
  const initialGzip = eagerChunks.reduce((s, c) => s + c.bytesGzipped, 0);

  if (initialGzip > budget.maxInitialGzipBytes) {
    violations.push({
      kind: 'initial_over_budget',
      observed: initialGzip,
      budget: budget.maxInitialGzipBytes,
      remediation:
        'Lazy-import componentes pesados (charts, 3D, AI chat) y deferir hasta interacción del usuario.',
    });
  }

  if (totalGzip > budget.maxTotalGzipBytes) {
    violations.push({
      kind: 'total_over_budget',
      observed: totalGzip,
      budget: budget.maxTotalGzipBytes,
      remediation:
        'Auditar dependencias top — buscar deps duplicadas y tree-shaking improvements (npm dedupe).',
    });
  }

  for (const c of chunks) {
    if (c.bytesGzipped > budget.maxChunkGzipBytes) {
      violations.push({
        kind: 'chunk_over_budget',
        chunkName: c.name,
        observed: c.bytesGzipped,
        budget: budget.maxChunkGzipBytes,
        remediation: `Split el chunk ${c.name} en sub-chunks por feature.`,
      });
    }
    if (c.eager && isWasmHeavy(c)) {
      violations.push({
        kind: 'wasm_loaded_eagerly',
        chunkName: c.name,
        observed: c.bytesGzipped,
        budget: 0,
        remediation: `Chunk ${c.name} contiene WASM (ONNX/MediaPipe) — debe ser lazy + Suspense, no en initial bundle.`,
      });
    }
  }

  // Recomendaciones automáticas basadas en patrones
  const heavyEager = chunks
    .filter((c) => c.eager && c.bytesGzipped > 100 * 1024)
    .sort((a, b) => b.bytesGzipped - a.bytesGzipped);
  for (const h of heavyEager.slice(0, 3)) {
    recommendations.push(
      `Lazy-load "${h.name}" (${Math.round(h.bytesGzipped / 1024)}KB gzipped) — usar React.lazy + Suspense.`,
    );
  }

  const topByGzip = [...chunks]
    .sort((a, b) => b.bytesGzipped - a.bytesGzipped)
    .slice(0, 10);

  return {
    totalGzipBytes: totalGzip,
    initialGzipBytes: initialGzip,
    chunkCount: chunks.length,
    eagerCount: eagerChunks.length,
    lazyCount: chunks.length - eagerChunks.length,
    violations,
    recommendations,
    topByGzipBytes: topByGzip,
    pass: violations.length === 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// CI report formatter (markdown)
// ────────────────────────────────────────────────────────────────────────

export function formatReportMarkdown(report: BundleAnalysisReport): string {
  const lines: string[] = [];
  lines.push(`# Bundle size report\n`);
  lines.push(`**Status:** ${report.pass ? '✅ PASS' : '❌ FAIL'}\n`);
  lines.push(`**Total gzipped:** ${formatBytes(report.totalGzipBytes)}`);
  lines.push(`**Initial gzipped:** ${formatBytes(report.initialGzipBytes)}`);
  lines.push(`**Chunks:** ${report.chunkCount} (${report.eagerCount} eager / ${report.lazyCount} lazy)\n`);

  if (report.violations.length > 0) {
    lines.push(`## ❌ Violaciones (${report.violations.length})\n`);
    for (const v of report.violations) {
      lines.push(
        `- **${v.kind}**${v.chunkName ? ` (${v.chunkName})` : ''}: ${formatBytes(v.observed)} > ${formatBytes(
          v.budget,
        )}. → ${v.remediation}`,
      );
    }
    lines.push('');
  }

  if (report.recommendations.length > 0) {
    lines.push(`## 💡 Recomendaciones\n`);
    for (const r of report.recommendations) lines.push(`- ${r}`);
    lines.push('');
  }

  lines.push(`## Top 10 chunks (por gzip)\n`);
  lines.push(`| Chunk | Gzipped | Raw | Eager |`);
  lines.push(`|---|---|---|---|`);
  for (const c of report.topByGzipBytes) {
    lines.push(`| ${c.name} | ${formatBytes(c.bytesGzipped)} | ${formatBytes(c.bytes)} | ${c.eager ? 'sí' : 'no'} |`);
  }

  return lines.join('\n');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
