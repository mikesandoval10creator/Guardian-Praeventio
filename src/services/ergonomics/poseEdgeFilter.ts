// SPDX-License-Identifier: MIT
//
// Sprint 34 — Pose-driven edge filter (REBA / RULA).
//
// Aplica la misma politica de 2 fases que `iot/edgeFilter.ts` pero con
// fuente "MediaPipe Pose": cuando un score REBA ≥ 11 o RULA ≥ 7 es
// detectado en el dispositivo, mandamos por mesh:
//   Fase 1: payload minimo {score, action, deviceId, timestamp} +
//           recomendacion local con cita normativa (DS-594, ISO 11226).
//   Fase 2 (default 30s): frame de evidencia con landmarks (solo
//           coordenadas; jamas la imagen — privacidad worker).
//
// Reglas usuario:
//   • blockOperation: false SIEMPRE.
//   • cita normativa cientifica obligatoria.
//   • Datos no se mandan a organismos — solo a supervisor del proyecto
//     via mesh.

import type { PoseLandmark } from '../../hooks/useMediaPipePose';
import type { RebaResult } from './reba';
import type { RulaResult } from './rula';
import {
  buildPacket,
  type MeshPacket,
} from '../mesh/meshPacket.js';
import type { EdgeRecommendation, EdgeTransportLike } from '../iot/edgeFilter.js';
import { getErrorTracker, getMetrics } from '../observability/index.js';

export interface PoseAnomaly {
  type: 'pose_anomaly';
  /** 'reba' o 'rula' segun la tabla que disparo. */
  source: 'reba' | 'rula';
  /** finalScore. REBA 1..15, RULA 1..7. */
  score: number;
  /** REBA action level | RULA action level. */
  actionLevel: RebaResult['actionLevel'] | RulaResult['actionLevel'];
  deviceId: string;
  timestamp: number;
  label: string;
}

export interface PoseEdgeFilterMetrics {
  rebaIngested: number;
  rulaIngested: number;
  phase1Sent: number;
  phase2Sent: number;
  skipped: number;
}

export interface PoseEvidenceFrame {
  /** 33 landmarks normalizados (sin imagen — privacidad). */
  landmarks: PoseLandmark[];
  capturedAtMs: number;
}

export interface PoseEdgeFilterOptions {
  transport: EdgeTransportLike;
  fromUid: string;
  projectId?: string;
  /** REBA score que dispara fase 1 (default 11 — "very high"). */
  rebaThreshold?: number;
  /** RULA score que dispara fase 1 (default 7). */
  rulaThreshold?: number;
  phase2DelayMs?: number;
  now?: () => number;
  scheduleTimeout?: (cb: () => void, ms: number) => void;
  onRecommendation?: (rec: EdgeRecommendation) => void;
}

const REBA_CITATION = {
  citation: 'DS-594 Art 110 / ISO 11226',
  text:
    'Postura forzada detectada (REBA critica). Ajustar mecanica corporal y rotar tarea. Recomendacion informativa.',
};
const RULA_CITATION = {
  citation: 'ISO 11228-3 / DS-594',
  text:
    'Postura de extremidad superior critica (RULA alta). Rotar tarea y reducir carga repetitiva.',
};

export class PoseEdgeFilter {
  private readonly transport: EdgeTransportLike;
  private readonly fromUid: string;
  private readonly projectId?: string;
  private readonly rebaThreshold: number;
  private readonly rulaThreshold: number;
  private readonly phase2DelayMs: number;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void, ms: number) => void;
  private readonly onRecommendation?: (rec: EdgeRecommendation) => void;

  private metrics: PoseEdgeFilterMetrics = {
    rebaIngested: 0,
    rulaIngested: 0,
    phase1Sent: 0,
    phase2Sent: 0,
    skipped: 0,
  };

  constructor(opts: PoseEdgeFilterOptions) {
    this.transport = opts.transport;
    this.fromUid = opts.fromUid;
    this.projectId = opts.projectId;
    this.rebaThreshold = opts.rebaThreshold ?? 11;
    this.rulaThreshold = opts.rulaThreshold ?? 7;
    this.phase2DelayMs = opts.phase2DelayMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.schedule =
      opts.scheduleTimeout ?? ((cb, ms) => setTimeout(cb, ms));
    this.onRecommendation = opts.onRecommendation;
  }

  /** Llamar tras cada calculateReba(). */
  async ingestRebaResult(
    result: RebaResult,
    ctx: { deviceId: string; landmarks?: PoseLandmark[]; timestamp?: number },
  ): Promise<'phase1' | 'skipped'> {
    this.metrics.rebaIngested += 1;
    if (result.finalScore < this.rebaThreshold) {
      this.metrics.skipped += 1;
      return 'skipped';
    }
    const ts = ctx.timestamp ?? this.now();
    const anomaly: PoseAnomaly = {
      type: 'pose_anomaly',
      source: 'reba',
      score: result.finalScore,
      actionLevel: result.actionLevel,
      deviceId: ctx.deviceId,
      timestamp: ts,
      label: `REBA ${result.finalScore} (${result.actionLevel})`,
    };
    await this.dispatchPhase1(anomaly);
    if (ctx.landmarks) this.scheduleContext(anomaly, ctx.landmarks);
    return 'phase1';
  }

  /** Llamar tras cada calculateRula(). */
  async ingestRulaResult(
    result: RulaResult,
    ctx: { deviceId: string; landmarks?: PoseLandmark[]; timestamp?: number },
  ): Promise<'phase1' | 'skipped'> {
    this.metrics.rulaIngested += 1;
    if (result.finalScore < this.rulaThreshold) {
      this.metrics.skipped += 1;
      return 'skipped';
    }
    const ts = ctx.timestamp ?? this.now();
    const anomaly: PoseAnomaly = {
      type: 'pose_anomaly',
      source: 'rula',
      score: result.finalScore,
      actionLevel: result.actionLevel,
      deviceId: ctx.deviceId,
      timestamp: ts,
      label: `RULA ${result.finalScore} (action ${result.actionLevel})`,
    };
    await this.dispatchPhase1(anomaly);
    if (ctx.landmarks) this.scheduleContext(anomaly, ctx.landmarks);
    return 'phase1';
  }

  async dispatchPhase1(anomaly: PoseAnomaly): Promise<void> {
    const tNow = this.now();
    let packet: MeshPacket;
    try {
      packet = buildPacket({
        type: 'event_to_supervisor',
        fromUid: this.fromUid,
        toUid: 'supervisors',
        bornAtMs: tNow,
        priority: 'high',
        projectId: this.projectId,
        payload: {
          poseAnomaly: anomaly,
          projectId: this.projectId,
        },
      });
    } catch (err) {
      this.captureError(err, 'poseEdge.phase1.buildPacket');
      return;
    }
    try {
      await this.transport.sendLocal(packet);
      this.metrics.phase1Sent += 1;
    } catch (err) {
      this.captureError(err, 'poseEdge.phase1.sendLocal');
    }
    this.emitRecommendation(anomaly);
  }

  async dispatchPhase2Frame(
    anomaly: PoseAnomaly,
    landmarks: PoseLandmark[],
  ): Promise<void> {
    const tNow = this.now();
    const frame: PoseEvidenceFrame = {
      landmarks,
      capturedAtMs: tNow,
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
          poseEvidence: { anomaly, frame },
          projectId: this.projectId,
        },
      });
    } catch (err) {
      this.captureError(err, 'poseEdge.phase2.buildPacket');
      return;
    }
    try {
      await this.transport.sendLocal(packet);
      this.metrics.phase2Sent += 1;
      try {
        getMetrics()
          .counter('pose_edge_filter.phase2_sent', { source: anomaly.source })
          .inc(1);
      } catch {
        /* metrics never break */
      }
    } catch (err) {
      this.captureError(err, 'poseEdge.phase2.sendLocal');
    }
  }

  getMetricsSnapshot(): PoseEdgeFilterMetrics {
    return { ...this.metrics };
  }

  // -----------------------------------------------------------------------

  private scheduleContext(anomaly: PoseAnomaly, landmarks: PoseLandmark[]): void {
    this.schedule(() => {
      void this.dispatchPhase2Frame(anomaly, landmarks).catch((err) =>
        this.captureError(err, 'poseEdge.phase2.timer'),
      );
    }, this.phase2DelayMs);
  }

  private emitRecommendation(anomaly: PoseAnomaly): void {
    const cite = anomaly.source === 'reba' ? REBA_CITATION : RULA_CITATION;
    const rec: EdgeRecommendation = {
      type: 'recommendation',
      text: cite.text,
      citation: cite.citation,
      severity: 'high',
      blockOperation: false, // Regla #1 — jamas bloquear maquinaria.
      timestamp: anomaly.timestamp,
    };
    try {
      this.onRecommendation?.(rec);
    } catch (err) {
      this.captureError(err, 'poseEdge.recommendation.callback');
    }
    try {
      getMetrics()
        .counter('pose_edge_filter.phase1_sent', { source: anomaly.source })
        .inc(1);
    } catch {
      /* metrics never break */
    }
  }

  private captureError(err: unknown, step: string): void {
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { service: 'ergonomics.poseEdgeFilter', step } } as any,
      );
    } catch {
      /* observability never breaks */
    }
  }
}
