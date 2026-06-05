// Praeventio Guard — B3 (Fase 5, 2026-06-05): Bio-Análisis 100% on-device.
//
// Directiva DURA #12: el procesamiento biométrico es 100% on-device
// (MediaPipe Vision). Ningún frame de cámara sale del dispositivo. Antes,
// `BioAnalysis.tsx` capturaba el frame en vivo y lo enviaba a Gemini Vision
// (`analyzeBioImage`) solo para detectar EPP — egress de cámara prohibido.
//
// Este módulo PURO consolida las señales que YA se computan on-device:
//   - métricas MediaPipe (fatiga / postura / atención) del loop en vivo,
//   - el `EppInspectionResult` del detector EPP on-device
//     (`ColorBasedEppDetector`, pixel data local — la imagen no sale),
// y produce el reporte que pinta la UI (EPP detectado/faltante + alertas).
//
// Pure, determinístico, sin side-effects ni Firestore — testeable.

import type { EppClass, EppInspectionResult } from '../ai/eppDetectorOnDevice';

/** Etiquetas es-CL para las 7 clases EPP (DS 594). */
export const EPP_LABELS_ES: Record<EppClass, string> = {
  casco: 'Casco',
  chaleco_reflectivo: 'Chaleco reflectante',
  gafas: 'Lentes de seguridad',
  guantes: 'Guantes',
  arnes: 'Arnés',
  botas: 'Botas de seguridad',
  respirador: 'Respirador',
};

/** Umbrales de alerta — alineados con el color-coding de la UI de BioAnalysis. */
export const FATIGUE_ALERT_THRESHOLD = 70; // fatiga rose > 70
export const POSTURE_ALERT_THRESHOLD = 60; // postura amber < 60
export const ATTENTION_ALERT_THRESHOLD = 50; // atención amber < 50

/** Métricas biométricas que el loop MediaPipe en vivo ya mantiene. */
export interface BioMediaPipeMetrics {
  fatigue: number;
  posture: number;
  attention: number;
}

/** Reporte consolidado on-device que consume la UI. */
export interface OnDeviceBioReport {
  /** EPP detectado, en etiquetas es-CL. */
  eppDetected: string[];
  /** EPP requerido faltante, en etiquetas es-CL. */
  eppMissing: string[];
  /** Alertas accionables (es-CL, tuteo chileno). */
  alerts: string[];
  /** Score de cumplimiento EPP [0..100] derivado de requeridos vs faltantes. */
  eppScore: number;
}

function label(cls: EppClass): string {
  return EPP_LABELS_ES[cls] ?? cls;
}

/**
 * Construye el reporte on-device a partir de las métricas MediaPipe en vivo
 * y el resultado del detector EPP on-device. Si `inspection` es `null` (el
 * detector no pudo procesar el frame), el reporte es HONESTO: no fabrica EPP
 * detectado/faltante y avisa que no se pudo evaluar.
 */
export function buildOnDeviceBioReport(
  metrics: BioMediaPipeMetrics,
  inspection: EppInspectionResult | null,
  requiredClasses: readonly EppClass[],
): OnDeviceBioReport {
  const alerts: string[] = [];

  if (metrics.fatigue > FATIGUE_ALERT_THRESHOLD) {
    alerts.push('Nivel de fatiga elevado: considera tomar una pausa activa.');
  }
  if (metrics.posture < POSTURE_ALERT_THRESHOLD) {
    alerts.push('Postura deficiente detectada: corrige la alineación de hombros y espalda.');
  }
  if (metrics.attention < ATTENTION_ALERT_THRESHOLD) {
    alerts.push('Baja atención detectada: posible distracción o somnolencia.');
  }

  if (!inspection) {
    alerts.push('No se pudo evaluar el EPP on-device con esta captura. Reintenta con mejor encuadre.');
    return { eppDetected: [], eppMissing: [], alerts, eppScore: 100 };
  }

  const eppDetected = inspection.detected.map((d) => label(d.class));
  const eppMissing = inspection.missing.map((c) => label(c));

  for (const missing of inspection.missing) {
    alerts.push(`Falta EPP requerido: ${label(missing)} (DS 594 art. 53-55).`);
  }

  const requiredCount = requiredClasses.length;
  const eppScore =
    requiredCount === 0
      ? 100
      : Math.round(((requiredCount - inspection.missing.length) / requiredCount) * 100);

  return { eppDetected, eppMissing, alerts, eppScore: Math.max(0, Math.min(100, eppScore)) };
}
