// Praeventio Guard — Sprint 51 §163: Rule Drift Detector
//
// Cierra §163 (drift detector de reglas: cuando una regla se aplica
// menos/más que histórico baseline) de la 2da tanda usuario.
//
// 100% determinístico. NO usa LLMs. Compara la ratio de aplicación
// (applicationCount / totalEntitiesEvaluated) del último período vs
// la mediana de hasta N períodos anteriores, y emite alertas cuando
// hay desvío estadísticamente notable.
//
// Caso de uso: motor de compliance evalúa N tareas/checklists por mes
// y aplica regla "exposición ruido > 85 dB → EPP requerido". Si el
// ratio cae 80% mes-a-mes, o se duplica, queremos saberlo antes que
// auditoría externa lo descubra.

// ────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────

export interface RuleApplicationSample {
  ruleId: string;
  /** 'YYYY-MM' o 'YYYY-Wnn'. */
  period: string;
  applicationCount: number;
  totalEntitiesEvaluated: number;
}

export type DriftDirection = 'increasing' | 'decreasing';

export type DriftSeverity =
  | 'info'
  | 'warning'
  | 'critical'
  | 'block_and_investigate';

export interface DriftAlert {
  ruleId: string;
  direction: DriftDirection;
  /** Δ% del ratio vs baseline (mediana). Signo coincide con direction. */
  changePct: number;
  severity: DriftSeverity;
  baseline: { period: string; ratio: number };
  current: { period: string; ratio: number };
  recommendation: string;
}

export interface DetectRuleDriftOptions {
  /** Máximo de períodos anteriores a usar como baseline. Default 12. */
  baselineWindow?: number;
  /**
   * Mínimo de períodos previos requeridos para considerar baseline
   * válido. Default 3. Si hay menos, esa regla se omite.
   */
  minBaselinePeriods?: number;
  /**
   * Ratio mínimo (>0) para que el baseline sea estable. Si la mediana
   * baseline es 0, dividir por 0 es indefinido → omitimos a menos que
   * el current también sea 0.
   */
  minBaselineRatio?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_BASELINE_WINDOW = 12;
const DEFAULT_MIN_BASELINE_PERIODS = 3;
const DEFAULT_MIN_BASELINE_RATIO = 1e-9;

function safeRatio(count: number, total: number): number {
  if (total <= 0) return 0;
  return count / total;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function severityForChange(absPct: number): DriftSeverity {
  if (absPct >= 80) return 'block_and_investigate';
  if (absPct >= 50) return 'critical';
  if (absPct >= 20) return 'warning';
  return 'info';
}

function recommendationFor(
  direction: DriftDirection,
  severity: DriftSeverity,
): string {
  if (severity === 'info') {
    return 'Drift menor. Sin acción inmediata; mantener observación.';
  }
  if (direction === 'decreasing') {
    if (severity === 'block_and_investigate') {
      return 'Caída crítica (≥80%). Revisar si la regla quedó obsoleta, si datos están incompletos o si pipeline de ingestión se rompió. Bloquear despliegue hasta investigar.';
    }
    if (severity === 'critical') {
      return 'Revisar si la regla quedó obsoleta o si datos están incompletos.';
    }
    return 'Aplicación bajando. Confirmar que el universo de entidades evaluadas sigue siendo representativo.';
  }
  // increasing
  if (severity === 'block_and_investigate') {
    return 'Subida crítica (≥80%). Revisar si la regla está sobre-disparando, si umbral quedó muy bajo, o si entró ruido en los datos. Bloquear despliegue hasta investigar.';
  }
  if (severity === 'critical') {
    return 'Revisar si la regla está sobre-disparando (falso positivo).';
  }
  return 'Aplicación subiendo. Verificar que no hay duplicados en la ingestión y que el umbral sigue calibrado.';
}

/**
 * Agrupa por ruleId y ordena por period (lex sort funciona con
 * 'YYYY-MM' y 'YYYY-Wnn' siempre que el padding sea consistente).
 */
function groupAndSort(
  samples: RuleApplicationSample[],
): Map<string, RuleApplicationSample[]> {
  const byRule = new Map<string, RuleApplicationSample[]>();
  for (const s of samples) {
    const arr = byRule.get(s.ruleId) ?? [];
    arr.push(s);
    byRule.set(s.ruleId, arr);
  }
  for (const arr of byRule.values()) {
    arr.sort((a, b) => a.period.localeCompare(b.period));
  }
  return byRule;
}

// ────────────────────────────────────────────────────────────────────────
// API principal
// ────────────────────────────────────────────────────────────────────────

/**
 * Detecta drift comparando el último período de cada regla vs la
 * mediana de los `baselineWindow` períodos anteriores.
 *
 * Devuelve UNA alerta por ruleId con severity > info, ordenadas por
 * |changePct| descendente.
 */
export function detectRuleDrift(
  samples: RuleApplicationSample[],
  options: DetectRuleDriftOptions = {},
): DriftAlert[] {
  const baselineWindow = options.baselineWindow ?? DEFAULT_BASELINE_WINDOW;
  const minBaseline = options.minBaselinePeriods ?? DEFAULT_MIN_BASELINE_PERIODS;
  const minBaselineRatio =
    options.minBaselineRatio ?? DEFAULT_MIN_BASELINE_RATIO;

  const alerts: DriftAlert[] = [];
  const grouped = groupAndSort(samples);

  for (const [ruleId, series] of grouped) {
    if (series.length < minBaseline + 1) continue;

    const current = series[series.length - 1];
    const previous = series.slice(0, -1);
    const window = previous.slice(-baselineWindow);

    const baselineRatios = window.map((s) =>
      safeRatio(s.applicationCount, s.totalEntitiesEvaluated),
    );
    const baselineRatio = median(baselineRatios);
    const currentRatio = safeRatio(
      current.applicationCount,
      current.totalEntitiesEvaluated,
    );

    // Baseline ≈ 0 → no podemos calcular % de cambio significativo.
    // Solo alertamos si current > 0 (aparece una regla que nunca aplicaba).
    if (baselineRatio < minBaselineRatio) {
      if (currentRatio > minBaselineRatio) {
        alerts.push({
          ruleId,
          direction: 'increasing',
          changePct: 100, // baseline 0, current > 0 → tratamos como +100%
          severity: 'critical',
          baseline: { period: window[window.length - 1].period, ratio: baselineRatio },
          current: { period: current.period, ratio: currentRatio },
          recommendation: recommendationFor('increasing', 'critical'),
        });
      }
      continue;
    }

    const rawChange = ((currentRatio - baselineRatio) / baselineRatio) * 100;
    const direction: DriftDirection =
      rawChange >= 0 ? 'increasing' : 'decreasing';
    const absPct = Math.abs(rawChange);
    const severity = severityForChange(absPct);

    if (severity === 'info') continue;

    alerts.push({
      ruleId,
      direction,
      changePct: Number(rawChange.toFixed(2)),
      severity,
      baseline: {
        period: window[window.length - 1].period,
        ratio: Number(baselineRatio.toFixed(6)),
      },
      current: {
        period: current.period,
        ratio: Number(currentRatio.toFixed(6)),
      },
      recommendation: recommendationFor(direction, severity),
    });
  }

  alerts.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return alerts;
}
