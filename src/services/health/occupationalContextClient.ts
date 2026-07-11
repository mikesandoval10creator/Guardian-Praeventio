/**
 * OccupationalContextBundle — client-safe types and pure functions.
 *
 * Extracted from occupationalContext.ts to avoid pulling server-side
 * imports (node:crypto, kmsEnvelope) into the client bundle.
 *
 * Per ADR 0012 §"Ergonomía continua + cruce con PortableCurriculum":
 * la app entrega al MÉDICO TRATANTE un bundle informativo (historial
 * laboral + métricas ergonómicas + síntomas auto-reportados). La app
 * NUNCA califica una enfermedad como profesional o común — eso lo
 * decide el médico tratante después de leer este bundle.
 *
 * Reglas sagradas (code review checklist ADR 0012):
 *   1. Función pura. Sin I/O, sin firebase, sin random.
 *   2. JAMÁS infiere patología, diagnóstico, ni clasificación
 *      profesional/común. Solo organiza lo que ya existe.
 *   3. Todo bundle lleva el disclaimer obligatorio (string-equality test).
 *   4. Symptom.triggeredByWork = null se preserva como null. La app
 *      nunca completa esa aserción por inferencia.
 *   5. NO hay function names que sugieran diagnóstico clínico.
 *        - Permitido: build*, summarize*, *ToMarkdown, organize*, cite*.
 *        - Ver ADR-0012 para la lista completa de patrones prohibidos.
 */

// ─────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────

export interface LaborHistoryEntry {
  yearFrom: number;
  yearTo: number;
  employer: string;
  role: string;
  /** Demandas físicas declaradas: 'manual_lifting', 'overhead_work',
   *  'kneeling', 'vibration', etc. Strings libres. */
  physicalDemands: string[];
  /** Agentes de riesgo declarados: 'silica', 'noise', 'vibration',
   *  'lead', 'asbestos', etc. Strings libres. */
  riskAgents: string[];
  workplaceCountry: string;
}

export interface ErgonomicLogEntry {
  /** YYYY-MM-DD */
  date: string;
  rebaScore: number;
  rulaScore: number;
  /** Zonas afectadas: 'lumbar', 'cervical', 'shoulder', 'wrist', 'knee'. */
  affectedZones: string[];
  minutesObserved: number;
  /** ej. 'soldadura altura'. */
  taskType?: string;
}

export interface SelfReportedSymptomEntry {
  /** YYYY-MM-DD */
  date: string;
  /** 'lumbar', 'cervical', 'shoulder', etc. */
  bodyPart: string;
  severity: 1 | 2 | 3 | 4 | 5;
  description: string;
  /**
   * Aserción del trabajador sobre si cree que el síntoma se gatilla
   * por el trabajo. NULL = no asertado. La app NUNCA infiere esto —
   * solo registra lo que el trabajador dijo.
   */
  triggeredByWork: boolean | null;
}

/**
 * Disclaimer obligatorio. Es un literal type para que el compilador
 * impida modificarlo accidentalmente.
 */
export const OCCUPATIONAL_BUNDLE_DISCLAIMER =
  'Esta información fue organizada por Praeventio para ser revisada por el médico tratante. Praeventio no diagnostica. El médico decide.' as const;

export type OccupationalBundleDisclaimer = typeof OCCUPATIONAL_BUNDLE_DISCLAIMER;

export interface OccupationalContextBundle {
  workerUid: string;
  generatedAt: number;
  laborHistory: LaborHistoryEntry[];
  ergonomicMetrics: ErgonomicLogEntry[];
  selfReportedSymptoms: SelfReportedSymptomEntry[];
  /** Disclaimer obligatorio en cada bundle. */
  readonly disclaimer: OccupationalBundleDisclaimer;
}

export interface BundleSummary {
  yearsOfLaborHistory: number;
  uniquePhysicalDemands: string[];
  uniqueRiskAgents: string[];
  ergonomicHotspots: Array<{
    zone: string;
    observationCount: number;
    avgReba: number;
  }>;
  symptomBodyPartFrequency: Array<{
    bodyPart: string;
    count: number;
    avgSeverity: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Constructor (función pura)
// ─────────────────────────────────────────────────────────────────────

/**
 * Construye el bundle ocupacional. Función pura: copia las entradas
 * (shallow) para evitar aliasing externo y devuelve la estructura
 * con el disclaimer ya pegado. NO infiere absolutamente nada.
 */
export function buildOccupationalContextBundle(
  workerUid: string,
  laborHistory: LaborHistoryEntry[],
  ergonomicLogs: ErgonomicLogEntry[],
  symptoms: SelfReportedSymptomEntry[],
  options?: { now?: () => number },
): OccupationalContextBundle {
  const now = options?.now ?? Date.now;
  return {
    workerUid,
    generatedAt: now(),
    laborHistory: laborHistory.map((e) => ({
      ...e,
      physicalDemands: [...e.physicalDemands],
      riskAgents: [...e.riskAgents],
    })),
    ergonomicMetrics: ergonomicLogs.map((e) => ({
      ...e,
      affectedZones: [...e.affectedZones],
    })),
    // CRÍTICO: triggeredByWork se preserva tal cual (incluido null).
    // Nunca rellenamos por inferencia.
    selfReportedSymptoms: symptoms.map((s) => ({ ...s })),
    disclaimer: OCCUPATIONAL_BUNDLE_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Summary (estadísticas, no diagnóstico)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resumen estadístico del bundle. SIN inferir patología. Las funciones
 * de agregación solo cuentan, deduplican y promedian — no clasifican,
 * no etiquetan, no diagnostican.
 */
export function summarizeBundle(
  bundle: OccupationalContextBundle,
): BundleSummary {
  // ── yearsOfLaborHistory: suma de (yearTo − yearFrom) por entry,
  //    saneando entradas con yearTo < yearFrom (ignoradas).
  let yearsOfLaborHistory = 0;
  for (const entry of bundle.laborHistory) {
    const span = entry.yearTo - entry.yearFrom;
    if (span > 0 && Number.isFinite(span)) {
      yearsOfLaborHistory += span;
    }
  }

  // ── uniquePhysicalDemands / uniqueRiskAgents (dedupe + sort estable).
  const physicalDemandsSet = new Set<string>();
  const riskAgentsSet = new Set<string>();
  for (const entry of bundle.laborHistory) {
    for (const d of entry.physicalDemands) physicalDemandsSet.add(d);
    for (const a of entry.riskAgents) riskAgentsSet.add(a);
  }
  const uniquePhysicalDemands = Array.from(physicalDemandsSet).sort();
  const uniqueRiskAgents = Array.from(riskAgentsSet).sort();

  // ── ergonomicHotspots: agregamos por zona.
  //    observationCount = cuántas entradas mencionan la zona.
  //    avgReba          = promedio del rebaScore de esas entradas.
  const hotspotAcc = new Map<
    string,
    { count: number; rebaSum: number }
  >();
  for (const log of bundle.ergonomicMetrics) {
    for (const zone of log.affectedZones) {
      const cur = hotspotAcc.get(zone) ?? { count: 0, rebaSum: 0 };
      cur.count += 1;
      cur.rebaSum += log.rebaScore;
      hotspotAcc.set(zone, cur);
    }
  }
  const ergonomicHotspots = Array.from(hotspotAcc.entries())
    .map(([zone, v]) => ({
      zone,
      observationCount: v.count,
      avgReba: v.count > 0 ? v.rebaSum / v.count : 0,
    }))
    .sort((a, b) => b.observationCount - a.observationCount || a.zone.localeCompare(b.zone));

  // ── symptomBodyPartFrequency: count + avgSeverity por bodyPart.
  const symptomAcc = new Map<
    string,
    { count: number; severitySum: number }
  >();
  for (const sym of bundle.selfReportedSymptoms) {
    const cur = symptomAcc.get(sym.bodyPart) ?? {
      count: 0,
      severitySum: 0,
    };
    cur.count += 1;
    cur.severitySum += sym.severity;
    symptomAcc.set(sym.bodyPart, cur);
  }
  const symptomBodyPartFrequency = Array.from(symptomAcc.entries())
    .map(([bodyPart, v]) => ({
      bodyPart,
      count: v.count,
      avgSeverity: v.count > 0 ? v.severitySum / v.count : 0,
    }))
    .sort((a, b) => b.count - a.count || a.bodyPart.localeCompare(b.bodyPart));

  return {
    yearsOfLaborHistory,
    uniquePhysicalDemands,
    uniqueRiskAgents,
    ergonomicHotspots,
    symptomBodyPartFrequency,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Renderer markdown
// ─────────────────────────────────────────────────────────────────────

/**
 * Renderiza el bundle como markdown human-readable. NUNCA usa las
 * palabras "diagnóstico" o "patología" — solo describe los datos
 * recolectados y deja la decisión al médico tratante.
 *
 * Ergonomic metrics se ordenan por fecha desc (más reciente primero).
 */
export function bundleToMarkdown(bundle: OccupationalContextBundle): string {
  const summary = summarizeBundle(bundle);
  const lines: string[] = [];

  lines.push('# Bundle de contexto ocupacional');
  lines.push('');
  lines.push(`> ${bundle.disclaimer}`);
  lines.push('');
  lines.push(`**Worker UID:** ${bundle.workerUid}`);
  lines.push(`**Generado:** ${new Date(bundle.generatedAt).toISOString()}`);
  lines.push('');

  // ── Resumen estadístico.
  lines.push('## Resumen estadístico');
  lines.push('');
  lines.push(
    `- Años acumulados de historial laboral: ${summary.yearsOfLaborHistory}`,
  );
  lines.push(
    `- Demandas físicas únicas: ${
      summary.uniquePhysicalDemands.length === 0
        ? '(ninguna)'
        : summary.uniquePhysicalDemands.join(', ')
    }`,
  );
  lines.push(
    `- Agentes de riesgo únicos: ${
      summary.uniqueRiskAgents.length === 0
        ? '(ninguno)'
        : summary.uniqueRiskAgents.join(', ')
    }`,
  );
  lines.push('');

  // ── Historial laboral.
  lines.push('## Historial laboral');
  lines.push('');
  if (bundle.laborHistory.length === 0) {
    lines.push('_(sin entradas registradas)_');
  } else {
    for (const e of bundle.laborHistory) {
      lines.push(
        `- ${e.yearFrom}–${e.yearTo} · ${e.employer} · ${e.role} · ${e.workplaceCountry}`,
      );
      if (e.physicalDemands.length > 0) {
        lines.push(`  - Demandas físicas: ${e.physicalDemands.join(', ')}`);
      }
      if (e.riskAgents.length > 0) {
        lines.push(`  - Agentes de riesgo: ${e.riskAgents.join(', ')}`);
      }
    }
  }
  lines.push('');

  // ── Métricas ergonómicas (ordenadas por fecha desc).
  lines.push('## Métricas ergonómicas (REBA / RULA)');
  lines.push('');
  if (bundle.ergonomicMetrics.length === 0) {
    lines.push('_(sin observaciones registradas)_');
  } else {
    const sorted = [...bundle.ergonomicMetrics].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    for (const m of sorted) {
      const task = m.taskType ? ` · ${m.taskType}` : '';
      const zones =
        m.affectedZones.length > 0
          ? ` · zonas: ${m.affectedZones.join(', ')}`
          : '';
      lines.push(
        `- ${m.date} · REBA ${m.rebaScore} · RULA ${m.rulaScore} · ${m.minutesObserved} min${task}${zones}`,
      );
    }
  }
  lines.push('');

  // ── Síntomas auto-reportados.
  lines.push('## Síntomas auto-reportados');
  lines.push('');
  if (bundle.selfReportedSymptoms.length === 0) {
    lines.push('_(sin síntomas registrados)_');
  } else {
    for (const s of bundle.selfReportedSymptoms) {
      const triggered =
        s.triggeredByWork === null
          ? 'no asertado'
          : s.triggeredByWork
          ? 'el trabajador afirma que sí'
          : 'el trabajador afirma que no';
      lines.push(
        `- ${s.date} · ${s.bodyPart} · severidad ${s.severity}/5 · gatillado por trabajo: ${triggered}`,
      );
      lines.push(`  - "${s.description}"`);
    }
  }
  lines.push('');

  // ── Hotspots y frecuencias (estadística pura, sin clasificar).
  if (summary.ergonomicHotspots.length > 0) {
    lines.push('## Zonas con mayor observación ergonómica');
    lines.push('');
    for (const h of summary.ergonomicHotspots) {
      lines.push(
        `- ${h.zone}: ${h.observationCount} obs · REBA promedio ${h.avgReba.toFixed(2)}`,
      );
    }
    lines.push('');
  }
  if (summary.symptomBodyPartFrequency.length > 0) {
    lines.push('## Frecuencia de síntomas por zona corporal');
    lines.push('');
    for (const f of summary.symptomBodyPartFrequency) {
      lines.push(
        `- ${f.bodyPart}: ${f.count} reportes · severidad promedio ${f.avgSeverity.toFixed(2)}/5`,
      );
    }
    lines.push('');
  }

  // ── Footer disclaimer (redundante a propósito: el médico debe ver
  //    siempre que la app no diagnostica).
  lines.push('---');
  lines.push('');
  lines.push(
    '_Praeventio organiza información ocupacional pero no emite ningún juicio clínico. La calificación del origen (laboral o común) es decisión exclusiva del médico tratante._',
  );

  return lines.join('\n');
}
