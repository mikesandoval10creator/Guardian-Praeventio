// Praeventio Guard — Sprint K: Observaciones Positivas + Balance.
//
// Cierra: Documento usuario "§214-215"
//
// Una cultura preventiva sana NO solo registra lo malo: también
// reconoce comportamientos seguros, soluciones improvisadas que
// valieron la pena, mejoras propuestas por trabajadores.
//
// Este servicio:
//   - Registra observaciones positivas con autor + categoría
//   - Calcula el "balance" entre observaciones positivas vs correctivas
//   - Detecta áreas/personas con sólo feedback negativo (señal de
//     cultura punitiva)
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PositiveObservationKind =
  | 'safe_behavior'           // hizo lo correcto (verificó EPP, paró tarea)
  | 'improvement_idea'        // propuso mejora
  | 'helpful_intervention'    // intervino para ayudar
  | 'creative_workaround'     // resolvió con creatividad segura
  | 'mentoring_action';       // enseñó / mentoreó a otro

export interface PositiveObservation {
  id: string;
  observedWorkerUid: string;
  observerUid: string;
  observerRole: string;
  kind: PositiveObservationKind;
  description: string;
  /** ISO-8601. */
  observedAt: string;
  /** Ubicación. */
  location: string;
  /** Si se compartió como lección para otros. */
  shared: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Balance (§215)
// ────────────────────────────────────────────────────────────────────────

export interface BalanceInput {
  positiveCount: number;
  /** Observaciones correctivas / hallazgos negativos. */
  correctiveCount: number;
}

export interface BalanceReport {
  positiveCount: number;
  correctiveCount: number;
  total: number;
  positiveRatio: number; // 0-1
  /** Ideal: 3+ positivas por cada 1 correctiva (cultura sana). */
  level: 'punitive' | 'imbalanced' | 'balanced' | 'positive_skew';
  message: string;
}

export function computeBalance(input: BalanceInput): BalanceReport {
  const { positiveCount, correctiveCount } = input;
  const total = positiveCount + correctiveCount;
  const positiveRatio = total > 0 ? positiveCount / total : 0;

  let level: BalanceReport['level'];
  if (correctiveCount > 0 && positiveCount === 0) level = 'punitive';
  else if (positiveRatio < 0.4) level = 'imbalanced';
  else if (positiveRatio < 0.75) level = 'balanced';
  else level = 'positive_skew';

  const message = (() => {
    if (level === 'punitive')
      return 'Solo se registran observaciones correctivas. Cultura punitiva.';
    if (level === 'imbalanced')
      return `Solo ${Math.round(positiveRatio * 100)}% positivas. Promover registro de comportamientos seguros.`;
    if (level === 'balanced') return 'Balance saludable de feedback positivo y correctivo.';
    return `${Math.round(positiveRatio * 100)}% positivas. Asegurar que las correctivas siguen registrándose.`;
  })();

  return { positiveCount, correctiveCount, total, positiveRatio, level, message };
}

// ────────────────────────────────────────────────────────────────────────
// Worker recognition tracker
// ────────────────────────────────────────────────────────────────────────

export interface WorkerRecognitionStats {
  workerUid: string;
  positiveObservationCount: number;
  byKind: Record<PositiveObservationKind, number>;
  /** Última observación. */
  lastObservedAt?: string;
}

export function buildRecognitionStats(
  observations: PositiveObservation[],
): WorkerRecognitionStats[] {
  const byWorker = new Map<string, PositiveObservation[]>();
  for (const o of observations) {
    if (!byWorker.has(o.observedWorkerUid)) byWorker.set(o.observedWorkerUid, []);
    byWorker.get(o.observedWorkerUid)!.push(o);
  }

  const out: WorkerRecognitionStats[] = [];
  for (const [uid, list] of byWorker) {
    const byKind: Record<PositiveObservationKind, number> = {
      safe_behavior: 0,
      improvement_idea: 0,
      helpful_intervention: 0,
      creative_workaround: 0,
      mentoring_action: 0,
    };
    for (const o of list) byKind[o.kind] += 1;
    const sortedByDate = list.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    out.push({
      workerUid: uid,
      positiveObservationCount: list.length,
      byKind,
      lastObservedAt: sortedByDate[0]?.observedAt,
    });
  }
  return out.sort((a, b) => b.positiveObservationCount - a.positiveObservationCount);
}

// ────────────────────────────────────────────────────────────────────────
// Area / location balance
// ────────────────────────────────────────────────────────────────────────

export interface LocationBalance {
  location: string;
  positiveCount: number;
  correctiveCount: number;
  balance: BalanceReport;
}

export function buildLocationBalance(
  positives: PositiveObservation[],
  correctivesByLocation: Record<string, number>,
): LocationBalance[] {
  const positiveByLocation = new Map<string, number>();
  for (const p of positives) {
    positiveByLocation.set(p.location, (positiveByLocation.get(p.location) ?? 0) + 1);
  }
  const allLocations = new Set([
    ...positiveByLocation.keys(),
    ...Object.keys(correctivesByLocation),
  ]);

  return [...allLocations].map((location) => {
    const positiveCount = positiveByLocation.get(location) ?? 0;
    const correctiveCount = correctivesByLocation[location] ?? 0;
    return {
      location,
      positiveCount,
      correctiveCount,
      balance: computeBalance({ positiveCount, correctiveCount }),
    };
  });
}
