// SPDX-License-Identifier: MIT
//
// Sprint 34 — Edge Filtering, dos fases (mineria subterranea / mesh-first).
//
// Por que existe:
//   En un E2E real (mina subterranea, faena con sensores BLE-mesh) NO se
//   puede mandar 60 samples/min/dispositivo por la red mesh — la
//   bandwidth efectiva por hop es de pocos kbps. La regla #1 del producto
//   es "filtrar el 90% de los datos irrelevantes y enviar SOLO las
//   anomalias". La regla #2 es "doble chequeo": despues de Fase 1 (alerta
//   minima), enviar contexto suficiente para que un supervisor + IA
//   verifiquen si fue real o false positive.
//
// Reglas de negocio del usuario:
//   1. NUNCA bloquear maquinaria. Toda recomendacion sale con
//      `blockOperation: false` y cita normativa cientifica (DS-594, ISO,
//      etc.). El UI es informativo.
//   2. NO push a organismos externos. Datos quedan en el ecosistema
//      cliente (mesh + Firestore tenant-scoped).
//
// Filtrado 90% — politica de buckets:
//   - severity 'critical'  → Fase 1 inmediata + Fase 2 contextual a los
//                            ~30s.
//   - severity 'warning'   → agregada en buckets de 60s (1 packet/min en
//                            lugar de hasta 60).
//   - severity 'info'/normal→ heartbeat oportunistico cada 5 min (o
//                            descartada si la red esta saturada).
//   El throughput resultante es ≤ 10% de lo que llega — cumple la
//   brecha del usuario.
//
// Patron Sentry: cualquier error fuera del happy-path se enruta por
// `getErrorTracker().captureException(...)`. Nunca debe tumbar al
// productor de samples (sensor adapter / pose loop).

import { evaluateSample } from './ingestRuleEngine.js';
import type {
  IngestDecision,
  IngestRule,
  TelemetrySample,
} from './types.js';
import {
  buildPacket,
  type MeshPacket,
  type MeshPacketType,
} from '../mesh/meshPacket.js';
import type { TransportFacade } from '../mesh/transportFacade.js';
import { getErrorTracker, getMetrics } from '../observability/index.js';

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export type EdgeSeverity = 'normal' | 'warning' | 'critical';

export interface EdgeAnomaly {
  type: 'iot_anomaly';
  severity: EdgeSeverity;
  metric: string;
  value: number;
  unit: string;
  deviceId: string;
  timestamp: number;
  /** opcional — si el productor sabe ubicacion (gateway, GPS, faena id). */
  location?: { lat?: number; lng?: number; zoneId?: string };
  /** mensaje legible que dispara el supervisor. */
  label: string;
}

export interface EdgeRecommendation {
  type: 'recommendation';
  text: string;
  /** Cita normativa cientifica obligatoria — DS-594, ISO 11226, ISO 45001, etc. */
  citation: string;
  severity: 'low' | 'medium' | 'high';
  /** SIEMPRE false. Regla #1 del usuario: jamas bloquear maquinaria. */
  blockOperation: false;
  /** mismo timestamp que la anomalia que la origino. */
  timestamp: number;
}

export interface EdgeContextPacket {
  anomaly: EdgeAnomaly;
  /** Ventana temporal de samples crudos previos (ultimos N segundos). */
  window: TelemetrySample[];
  /** epoch ms en que el contexto se snapshote-o. */
  snapshotAt: number;
}

export interface EdgeFilterMetricsSnapshot {
  ingested: number;
  dropped: number;
  aggregated: number;
  phase1Sent: number;
  phase2Sent: number;
  recommendations: number;
}

export interface EdgeFilterOptions {
  /** Transporte mesh real o mock. */
  transport: TransportFacade | EdgeTransportLike;
  /** Reglas de evaluacion (default: DEFAULT_RULES). */
  rules?: IngestRule[];
  /** ms desde Fase 1 hasta Fase 2 (default 30_000). */
  phase2DelayMs?: number;
  /** ventana retro a incluir en Fase 2 (default 60_000 ms). */
  phase2WindowMs?: number;
  /** retencion del ring buffer (default 120_000 ms). */
  ringBufferMs?: number;
  /** ventana de agregacion de warnings (default 60_000 ms). */
  warningBucketMs?: number;
  /** ventana de heartbeat para 'normal'/'info' (default 300_000 ms). */
  heartbeatMs?: number;
  /** Inyectable para tests deterministas. */
  now?: () => number;
  /** Si esta presente, se llama por cada recomendacion local emitida. */
  onRecommendation?: (rec: EdgeRecommendation) => void;
  /** Mapeo opcional de metric → cita normativa (override). */
  citations?: Record<string, { citation: string; text: string }>;
  /** Identidad del nodo edge — usado para fromUid del MeshPacket. */
  fromUid: string;
  projectId?: string;
  /** scheduler inyectable (tests usan setTimeout determinista). */
  scheduleTimeout?: (cb: () => void, ms: number) => void;
}

/** Subset estructural de TransportFacade — habilita inyectar mocks finos. */
export interface EdgeTransportLike {
  sendLocal: TransportFacade['sendLocal'];
}

// ---------------------------------------------------------------------------
// Citas normativas por defecto (regla #1 — toda recomendacion lleva cita)
// ---------------------------------------------------------------------------

const DEFAULT_CITATIONS: Record<string, { citation: string; text: string }> = {
  gas_co_ppm: {
    citation: 'DS-594 Art 110 / NIOSH IDLH 1200 ppm',
    text:
      'Concentracion de CO sobre umbral de accion. Evacuar zona y ventilar antes de continuar.',
  },
  co2_ppm: {
    citation: 'DS-594 / OSHA PEL 5000 ppm 8h',
    text:
      'Concentracion de CO2 sobre el limite de exposicion. Aumentar ventilacion y monitorear sintomas.',
  },
  heart_rate_bpm: {
    citation: 'ISO 45001 / NIOSH heat stress guidance',
    text:
      'Frecuencia cardiaca fuera de rango fisiologico esperado. Pausa hidratacion/descanso recomendada.',
  },
  temperature_c: {
    citation: 'ISO 7243 (WBGT) / DS-594',
    text: 'Temperatura ambiente fuera de rango seguro. Ajustar regimen trabajo-descanso.',
  },
  vibration_g: {
    citation: 'ISO 2631 / DS-594',
    text: 'Vibracion sobre umbral. Inspeccionar rodamientos y revisar mantenimiento preventivo.',
  },
  pose_reba: {
    citation: 'DS-594 Art 110 / ISO 11226',
    text: 'Postura forzada detectada. Ajustar mecanica corporal y rotar tarea.',
  },
  pose_rula: {
    citation: 'ISO 11228-3 / DS-594',
    text: 'Postura de extremidad superior critica. Rotar tarea y reducir carga repetitiva.',
  },
};

const FALLBACK_CITATION = {
  citation: 'ISO 45001:2018 / DS-594',
  text: 'Anomalia detectada. Revisar condicion y aplicar control segun procedimiento.',
};

// ---------------------------------------------------------------------------
// EdgeFilter
// ---------------------------------------------------------------------------

export class EdgeFilter {
  private readonly rules?: IngestRule[];
  private readonly phase2DelayMs: number;
  private readonly phase2WindowMs: number;
  private readonly ringBufferMs: number;
  private readonly warningBucketMs: number;
  private readonly heartbeatMs: number;
  private readonly now: () => number;
  private readonly transport: EdgeTransportLike;
  private readonly fromUid: string;
  private readonly projectId?: string;
  private readonly onRecommendation?: (rec: EdgeRecommendation) => void;
  private readonly citations: Record<string, { citation: string; text: string }>;
  private readonly schedule: (cb: () => void, ms: number) => void;

  /** Ring buffer de samples brutos. */
  private buffer: TelemetrySample[] = [];

  /** Ultimo dispatch de warning por metric — agregacion 60s. */
  private lastWarningSentAt = new Map<string, number>();
  private warningBucketCount = new Map<string, number>();
  private warningBucketLastValue = new Map<string, TelemetrySample>();

  /** Ultimo heartbeat 'normal' enviado. */
  private lastHeartbeatAt = 0;

  /** Counters publicos. */
  private metrics: EdgeFilterMetricsSnapshot = {
    ingested: 0,
    dropped: 0,
    aggregated: 0,
    phase1Sent: 0,
    phase2Sent: 0,
    recommendations: 0,
  };

  constructor(opts: EdgeFilterOptions) {
    this.transport = opts.transport;
    this.rules = opts.rules;
    this.phase2DelayMs = opts.phase2DelayMs ?? 30_000;
    this.phase2WindowMs = opts.phase2WindowMs ?? 60_000;
    this.ringBufferMs = opts.ringBufferMs ?? 120_000;
    this.warningBucketMs = opts.warningBucketMs ?? 60_000;
    this.heartbeatMs = opts.heartbeatMs ?? 300_000;
    this.now = opts.now ?? Date.now;
    this.fromUid = opts.fromUid;
    this.projectId = opts.projectId;
    this.onRecommendation = opts.onRecommendation;
    this.citations = { ...DEFAULT_CITATIONS, ...(opts.citations ?? {}) };
    this.schedule =
      opts.scheduleTimeout ??
      ((cb, ms) => {
        // setTimeout es seguro en navegador y node moderno.
        setTimeout(cb, ms);
      });
  }

  /**
   * Punto de entrada principal. Productor de samples (MQTT consumer
   * local, BLE adapter, etc.) llama esto por cada lectura. La logica
   * decide phase1 / phase2 / agregar / descartar.
   */
  async ingestSample(sample: TelemetrySample): Promise<{
    severity: EdgeSeverity;
    action: 'phase1' | 'aggregated' | 'heartbeat' | 'discarded';
  }> {
    this.metrics.ingested += 1;
    this.pushToBuffer(sample);

    let decision: IngestDecision;
    try {
      decision = evaluateSample(sample, this.rules);
    } catch (err) {
      this.captureError(err, 'evaluate');
      this.metrics.dropped += 1;
      return { severity: 'normal', action: 'discarded' };
    }

    const severity = topSeverity(decision);

    if (severity === 'critical') {
      const anomaly = this.buildAnomaly(sample, decision, 'critical');
      await this.dispatchPhase1(anomaly);
      this.scheduleContext(anomaly);
      return { severity, action: 'phase1' };
    }

    if (severity === 'warning') {
      this.warningBucketCount.set(
        sample.metric,
        (this.warningBucketCount.get(sample.metric) ?? 0) + 1,
      );
      this.warningBucketLastValue.set(sample.metric, sample);

      const last = this.lastWarningSentAt.get(sample.metric);
      const tNow = this.now();
      // El primer warning del bucket inicia el contador; no se dispara
      // hasta que pasen `warningBucketMs` desde el inicio del bucket.
      if (last === undefined) {
        this.lastWarningSentAt.set(sample.metric, tNow);
        this.metrics.aggregated += 1;
        return { severity, action: 'aggregated' };
      }
      if (tNow - last >= this.warningBucketMs) {
        // Mandamos UN packet representativo del bucket.
        const aggregated = this.buildAnomaly(sample, decision, 'warning');
        // Adjuntamos count del bucket en label para el supervisor.
        aggregated.label =
          `${aggregated.label} (agregado x${this.warningBucketCount.get(sample.metric)} en ${Math.round(
            this.warningBucketMs / 1000,
          )}s)`;
        await this.dispatchPhase1(aggregated);
        this.lastWarningSentAt.set(sample.metric, tNow);
        this.warningBucketCount.set(sample.metric, 0);
      } else {
        this.metrics.aggregated += 1;
      }
      return { severity, action: 'aggregated' };
    }

    // 'normal' — heartbeat oportunistico, o descarte.
    const tNow = this.now();
    if (tNow - this.lastHeartbeatAt >= this.heartbeatMs) {
      this.lastHeartbeatAt = tNow;
      // No despachamos packet de heartbeat por mesh por defecto (se
      // descarta para conservar bandwidth). Dejamos el slot para que
      // un futuro consumer active "low-priority heartbeat" en redes
      // saturadas.
      this.metrics.dropped += 1;
      return { severity: 'normal', action: 'heartbeat' };
    }
    this.metrics.dropped += 1;
    return { severity: 'normal', action: 'discarded' };
  }

  /**
   * Empaqueta y despacha el packet minimo de Fase 1 + emite
   * recomendacion local. Tambien se invoca por wrappers (pose, etc.).
   */
  async dispatchPhase1(anomaly: EdgeAnomaly): Promise<void> {
    const tNow = this.now();
    const isLifeThreat = anomaly.severity === 'critical';
    const meshType: MeshPacketType = isLifeThreat ? 'sos' : 'event_to_supervisor';

    let packet: MeshPacket;
    try {
      packet = buildPacket({
        type: meshType,
        fromUid: this.fromUid,
        toUid: 'supervisors',
        bornAtMs: tNow,
        priority: isLifeThreat ? 'sos' : 'high',
        projectId: this.projectId,
        payload: {
          edgeAnomaly: anomaly,
          // El campo projectId interno cumple `packetBelongsToProject`.
          projectId: this.projectId,
        },
      });
    } catch (err) {
      this.captureError(err, 'phase1.buildPacket');
      return;
    }

    try {
      await this.transport.sendLocal(packet);
      this.metrics.phase1Sent += 1;
    } catch (err) {
      this.captureError(err, 'phase1.sendLocal');
    }

    // Recomendacion local — siempre con cita normativa, NUNCA bloquea.
    this.emitRecommendation(anomaly);
  }

  /**
   * Despacha el packet de contexto (Fase 2) — ventana temporal de samples
   * + anomalia origen. Public para que pose/otros wrappers puedan
   * gatillarlo manualmente con un payload custom.
   */
  async dispatchPhase2(
    anomaly: EdgeAnomaly,
    extra?: { windowOverride?: TelemetrySample[]; payloadExtras?: Record<string, unknown> },
  ): Promise<void> {
    const tNow = this.now();
    const cutoff = tNow - this.phase2WindowMs;
    const window =
      extra?.windowOverride ??
      this.buffer.filter(
        (s) => s.timestamp >= cutoff && s.deviceId === anomaly.deviceId,
      );

    const ctx: EdgeContextPacket = {
      anomaly,
      window,
      snapshotAt: tNow,
    };

    let packet: MeshPacket;
    try {
      packet = buildPacket({
        type: 'event_to_supervisor',
        fromUid: this.fromUid,
        toUid: 'supervisors',
        bornAtMs: tNow,
        priority: 'normal',
        projectId: this.projectId,
        payload: {
          edgeContext: ctx,
          ...(extra?.payloadExtras ?? {}),
          projectId: this.projectId,
        },
      });
    } catch (err) {
      this.captureError(err, 'phase2.buildPacket');
      return;
    }

    try {
      await this.transport.sendLocal(packet);
      this.metrics.phase2Sent += 1;
      try {
        getMetrics()
          .counter('edge_filter.phase2_sent', { metric: anomaly.metric })
          .inc(1);
      } catch {
        /* metrics never breaks */
      }
    } catch (err) {
      this.captureError(err, 'phase2.sendLocal');
    }
  }

  /** Snapshot de metricas — util para tests y UI debug. */
  getMetricsSnapshot(): EdgeFilterMetricsSnapshot {
    return { ...this.metrics };
  }

  /** Limpia ring buffer. Para tests. */
  clearBuffer(): void {
    this.buffer = [];
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private pushToBuffer(sample: TelemetrySample): void {
    this.buffer.push(sample);
    const cutoff = this.now() - this.ringBufferMs;
    // pruning lazy — comun in-place para no asignar arrays todo el tiempo.
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }
  }

  private buildAnomaly(
    sample: TelemetrySample,
    decision: IngestDecision,
    severity: EdgeSeverity,
  ): EdgeAnomaly {
    const top = decision.alerts[0];
    return {
      type: 'iot_anomaly',
      severity,
      metric: sample.metric,
      value: sample.value,
      unit: sample.unit,
      deviceId: sample.deviceId,
      timestamp: sample.timestamp,
      label: top?.message ?? `${sample.metric}=${sample.value}${sample.unit}`,
    };
  }

  private scheduleContext(anomaly: EdgeAnomaly): void {
    this.schedule(() => {
      void this.dispatchPhase2(anomaly).catch((err) => this.captureError(err, 'phase2.timer'));
    }, this.phase2DelayMs);
  }

  private emitRecommendation(anomaly: EdgeAnomaly): void {
    const cite = this.citations[anomaly.metric] ?? FALLBACK_CITATION;
    const rec: EdgeRecommendation = {
      type: 'recommendation',
      text: cite.text,
      citation: cite.citation,
      severity:
        anomaly.severity === 'critical'
          ? 'high'
          : anomaly.severity === 'warning'
          ? 'medium'
          : 'low',
      // Regla #1 del usuario: jamas bloqueamos maquinaria.
      blockOperation: false,
      timestamp: anomaly.timestamp,
    };
    this.metrics.recommendations += 1;
    try {
      this.onRecommendation?.(rec);
    } catch (err) {
      this.captureError(err, 'recommendation.callback');
    }
    try {
      getMetrics()
        .counter('edge_filter.phase1_sent', { metric: anomaly.metric, severity: anomaly.severity })
        .inc(1);
    } catch {
      /* metrics never breaks */
    }
  }

  private captureError(err: unknown, step: string): void {
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { service: 'iot.edgeFilter', step } } as any,
      );
    } catch {
      /* observability never breaks the filter */
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function topSeverity(decision: IngestDecision): EdgeSeverity {
  if (decision.alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (decision.alerts.some((a) => a.severity === 'warning')) return 'warning';
  return 'normal';
}
