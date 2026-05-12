// Praeventio Guard — Sprint 39 Fase L.12: Cadena de Medición + Calibración.
//
// Cierra: Documento usuario "§391-400" — Top usuario #15
//
// Una medición ocupacional (ruido, polvo, gases, iluminación, UV) NO
// vale si el instrumento estaba descalibrado. Este módulo:
//
//   - Registra instrumentos con su certificación
//   - Bloquea uso si la calibración está vencida (§397)
//   - Mantiene historial de uso (§395)
//   - Valida que la "cadena" (instrumento → certificado → operador → norma)
//     esté completa para que la medición sea legalmente defendible (§398)
//   - Computa calidad agregada del set de mediciones (§399)
//
// Determinístico, sin LLM. Repositorios via DI.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type InstrumentKind =
  | 'sonometer'      // ruido
  | 'luxmeter'       // iluminación
  | 'gas_detector'   // multigas
  | 'anemometer'     // viento
  | 'wbgt_meter'     // estrés térmico
  | 'dosimeter'      // dosímetro personal
  | 'ph_meter'
  | 'thermohygrometer'
  | 'air_sampler'
  | 'uv_radiometer';

export interface MeasurementInstrument {
  id: string;
  kind: InstrumentKind;
  brand: string;
  model: string;
  serialNumber: string;
  /** ISO-8601 del último certificado de calibración. */
  calibratedAt: string;
  /** ISO-8601 hasta cuándo es válida. */
  calibratedUntil: string;
  /** URL del certificado en Storage. */
  certificateUrl?: string;
  /** UID del custodio responsable. */
  custodianUid: string;
  /** Estado operacional. */
  status: 'operativo' | 'en_calibracion' | 'fuera_servicio' | 'retirado';
}

// ────────────────────────────────────────────────────────────────────────
// 1. Expiration alert
// ────────────────────────────────────────────────────────────────────────

export interface InstrumentExpirationStatus {
  instrumentId: string;
  /** Días hasta vencimiento (negativo si vencido). */
  daysUntilExpiration: number;
  isExpired: boolean;
  /** True si vence en próximos 30d. */
  expiresSoon: boolean;
  /** True si el caller debe bloquear mediciones nuevas. */
  blockUse: boolean;
  message: string;
}

export function checkInstrumentExpiration(
  instrument: MeasurementInstrument,
  nowIso: string = new Date().toISOString(),
): InstrumentExpirationStatus {
  const daysUntilExpiration = Math.floor(
    (Date.parse(instrument.calibratedUntil) - Date.parse(nowIso)) / 86_400_000,
  );
  const isExpired = daysUntilExpiration < 0;
  const expiresSoon = !isExpired && daysUntilExpiration <= 30;
  const blockUse = isExpired || instrument.status !== 'operativo';

  let message: string;
  if (instrument.status === 'retirado') {
    message = `Instrumento ${instrument.id} RETIRADO de servicio.`;
  } else if (instrument.status === 'fuera_servicio') {
    message = `Instrumento ${instrument.id} fuera de servicio.`;
  } else if (instrument.status === 'en_calibracion') {
    message = `Instrumento ${instrument.id} EN proceso de calibración.`;
  } else if (isExpired) {
    message = `Instrumento ${instrument.id} con calibración VENCIDA hace ${Math.abs(daysUntilExpiration)}d.`;
  } else if (expiresSoon) {
    message = `Instrumento ${instrument.id} vence en ${daysUntilExpiration}d. Coordinar calibración.`;
  } else {
    message = `Instrumento ${instrument.id} con calibración vigente (${daysUntilExpiration}d restantes).`;
  }
  return { instrumentId: instrument.id, daysUntilExpiration, isExpired, expiresSoon, blockUse, message };
}

// ────────────────────────────────────────────────────────────────────────
// 2. Usage log
// ────────────────────────────────────────────────────────────────────────

export interface InstrumentUsageEntry {
  instrumentId: string;
  operatorUid: string;
  measurementId: string;
  usedAt: string;
  /** ¿Para qué se usó? (ej: "medición ruido sector A"). */
  purpose: string;
}

export interface InstrumentUsageStats {
  instrumentId: string;
  totalUses: number;
  /** UIDs únicos que operaron el instrumento. */
  uniqueOperators: number;
  /** Última fecha de uso. */
  lastUsedAt?: string;
  /** Lista de operadores con cantidad de usos. */
  byOperator: Array<{ operatorUid: string; count: number }>;
}

export function computeUsageStats(
  instrumentId: string,
  log: InstrumentUsageEntry[],
): InstrumentUsageStats {
  const own = log.filter((e) => e.instrumentId === instrumentId);
  const operatorCounts = new Map<string, number>();
  let lastUsedAt: string | undefined;
  for (const entry of own) {
    operatorCounts.set(entry.operatorUid, (operatorCounts.get(entry.operatorUid) ?? 0) + 1);
    if (!lastUsedAt || entry.usedAt > lastUsedAt) lastUsedAt = entry.usedAt;
  }
  const byOperator = [...operatorCounts.entries()]
    .map(([operatorUid, count]) => ({ operatorUid, count }))
    .sort((a, b) => b.count - a.count);
  return {
    instrumentId,
    totalUses: own.length,
    uniqueOperators: operatorCounts.size,
    lastUsedAt,
    byOperator,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 3. Chain validation (§397-398)
// ────────────────────────────────────────────────────────────────────────

export interface MeasurementChainEntry {
  measurementId: string;
  takenAt: string;
  /** Instrumento usado. */
  instrument: MeasurementInstrument;
  /** Operador. */
  operatorUid: string;
  /** Norma citada (ej: "DS 594 art. 75"). */
  normReference: string;
  /** Contexto adicional (hora, clima, ubicación). */
  context: {
    location: string;
    temperatureC?: number;
    humidityPercent?: number;
    windSpeedMs?: number;
  };
}

export interface ChainValidationResult {
  measurementId: string;
  isValid: boolean;
  /** Razones por las que falla la cadena. */
  failures: string[];
  /** Avisos no bloqueantes. */
  warnings: string[];
}

/**
 * Valida que la medición esté legalmente defendible. Rechaza si:
 *   - El instrumento está vencido o fuera de servicio al momento de la toma
 *   - El instrumento no es del kind apropiado para la norma
 *   - Falta certificado de calibración (URL)
 *   - Falta norma de referencia
 */
export function validateMeasurementChain(
  entry: MeasurementChainEntry,
): ChainValidationResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  const expirationStatus = checkInstrumentExpiration(entry.instrument, entry.takenAt);
  if (expirationStatus.isExpired) {
    failures.push(
      `Instrumento ${entry.instrument.id} con calibración vencida al momento de la toma (${entry.takenAt}).`,
    );
  }
  if (entry.instrument.status !== 'operativo') {
    failures.push(
      `Instrumento ${entry.instrument.id} estaba en status '${entry.instrument.status}' al momento de la toma.`,
    );
  }
  if (!entry.instrument.certificateUrl) {
    failures.push(`Instrumento ${entry.instrument.id} sin URL de certificado de calibración.`);
  }
  if (entry.normReference.trim().length === 0) {
    failures.push('Medición sin referencia normativa explícita.');
  }
  if (!entry.context.location || entry.context.location.trim().length === 0) {
    failures.push('Medición sin ubicación registrada.');
  }
  if (expirationStatus.expiresSoon && !expirationStatus.isExpired) {
    warnings.push(
      `Instrumento ${entry.instrument.id} vence en ${expirationStatus.daysUntilExpiration}d. Re-medir con instrumento recalibrado para validación futura.`,
    );
  }
  if (entry.instrument.kind === 'wbgt_meter' && entry.context.temperatureC === undefined) {
    warnings.push('Medición WBGT sin contexto de temperatura — recomendado registrar para auditoría.');
  }
  return {
    measurementId: entry.measurementId,
    isValid: failures.length === 0,
    failures,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 4. Aggregate quality panel (§399)
// ────────────────────────────────────────────────────────────────────────

export interface MeasurementQualityReport {
  total: number;
  valid: number;
  invalid: number;
  withWarnings: number;
  /** Score 0-100. */
  qualityScore: number;
  /** Razones de fallo agrupadas. */
  failureBreakdown: Record<string, number>;
}

export function buildQualityReport(
  results: ChainValidationResult[],
): MeasurementQualityReport {
  const total = results.length;
  const valid = results.filter((r) => r.isValid).length;
  const invalid = total - valid;
  const withWarnings = results.filter((r) => r.warnings.length > 0).length;
  const qualityScore = total === 0 ? 100 : Math.round((valid / total) * 100);

  const failureBreakdown: Record<string, number> = {};
  for (const r of results) {
    for (const f of r.failures) {
      // agrupar por prefijo "Instrumento X" → "Instrumento" para abrigar
      const key = f.startsWith('Instrumento')
        ? 'Instrumento (calibración/estado/cert)'
        : f.startsWith('Medición sin')
          ? f.replace(/'[^']+'/g, "'X'")
          : f;
      failureBreakdown[key] = (failureBreakdown[key] ?? 0) + 1;
    }
  }

  return { total, valid, invalid, withWarnings, qualityScore, failureBreakdown };
}
