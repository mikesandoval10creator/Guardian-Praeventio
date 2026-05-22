// Praeventio Guard — §2.18 fix (2026-05-22): EPP detection ON-DEVICE.
//
// Directiva usuario 2026-05-21: "2.18 epp deja la revisión en local y que
// los resultados se vayan a google para dejarlo conectado al sistema
// zettelkasten como nodo de información".
//
// Y la directiva previa 2026-05-21 sobre digital twin (§2.28): "no usaré
// GPU externa ni COLMAP". Aplicable también acá — el modelo de detección
// EPP debe correr ON-DEVICE (browser via WebGL/WebGPU/CPU), NO cloud
// vision API paid.
//
// Pre-§2.18: `src/components/ai/VisionAnalyzer.tsx:152` llamaba Gemini-
// vision (cloud, paid). Esto era un P0 LIE de marketing: la landing
// prometía "Edge AI verifica EPP local" pero el código hacía cloud.
//
// Stack on-device:
//   - TensorFlow.js (`@tensorflow/tfjs`) — runtime browser-side
//   - Modelo YOLO-tiny o MobileNet-SSD cuantizado (~5-20 MB)
//   - 7 clases EPP estándar Praeventio (DS 594 + protocolo IPER):
//       casco, chaleco_reflectivo, gafas, guantes, arnes, botas,
//       respirador
//   - Inferencia tiempo real (~100-300 ms en device típico)
//
// Privacy by design (directiva 2026-05-21):
//   - La IMAGEN nunca sale del dispositivo
//   - Solo el RESULT (clasificaciones + confidence) se sincroniza a
//     Firestore como ZK node tipo 'epp_inspection'
//   - El ZK node es per-tenant + per-project (scoped)
//   - Audit trail: timestamp + workerUid + meetingPointId opcional
//
// Estado actual de este módulo (2026-05-22):
//   - Interface + types definidos (READY)
//   - Mock implementation (returns synthetic detections para tests/dev)
//   - Real TFLite loader: STUB — requiere modelo TFLite real
//     entrenado con dataset EPP + accept terms (OPS work)
//   - ZK node generator: READY (genera RiskNodePayload válido)
//
// Cuando DevOps tenga el modelo:
//   1. Subir `epp-yolo-v1.tflite` a `public/models/epp/`
//   2. Cambiar `getEppDetectorImpl()` para retornar `RealTfliteDetector`
//      en lugar de `MockEppDetector`
//   3. Verificar `npm test -- eppDetectorOnDevice.test.ts`

import type { RiskNodePayload } from '../zettelkasten/types';

/** 7 clases EPP estándar Praeventio (alineadas con DS 594 + IPER). */
export type EppClass =
  | 'casco'
  | 'chaleco_reflectivo'
  | 'gafas'
  | 'guantes'
  | 'arnes'
  | 'botas'
  | 'respirador';

export const ALL_EPP_CLASSES: readonly EppClass[] = [
  'casco',
  'chaleco_reflectivo',
  'gafas',
  'guantes',
  'arnes',
  'botas',
  'respirador',
];

/** Una detección individual: clase + confidence [0..1] + bounding box. */
export interface EppDetection {
  /** Clase detectada (uno de los 7 EPP estándar). */
  class: EppClass;
  /** Confianza del modelo [0..1]. Bajo `confidenceThreshold` se filtra. */
  confidence: number;
  /**
   * Bounding box relativo a la imagen [0..1]:
   *   { x, y } esquina superior izquierda
   *   { width, height } extensión
   * Útil para overlay UI (rect verde si detectado, rojo si missing).
   */
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** Resultado completo de una inspección EPP de una imagen. */
export interface EppInspectionResult {
  /** Detecciones positivas (con confidence >= threshold). */
  detected: EppDetection[];
  /** EPP REQUERIDO que NO fue detectado (gap → recomendación correctiva). */
  missing: readonly EppClass[];
  /** EPP detectado pero con confidence baja (warning, no certeza). */
  lowConfidence: EppDetection[];
  /** Confianza promedio de las detecciones positivas. */
  averageConfidence: number;
  /** Tiempo total de inferencia (ms). Útil para metrics + UX. */
  inferenceTimeMs: number;
  /** Versión del modelo usado (para audit trail). */
  modelVersion: string;
  /** ISO timestamp cuando se corrió la inspección. */
  timestamp: string;
}

/**
 * Configuración de una inspección:
 *   - `requiredClasses`: qué EPP DEBE estar presente (resto opcional).
 *     Default: `['casco', 'chaleco_reflectivo', 'botas']` (mínimo legal
 *     genérico DS 594, sin extender a EPP-específicos del rubro).
 *   - `confidenceThreshold`: minimo para considerar "detectado". Default 0.65.
 *   - `lowConfidenceThreshold`: minimo para considerar "warning" pero no
 *     "no detectado". Default 0.35.
 */
export interface EppInspectionConfig {
  requiredClasses?: readonly EppClass[];
  confidenceThreshold?: number;
  lowConfidenceThreshold?: number;
}

const DEFAULT_REQUIRED_CLASSES: readonly EppClass[] = ['casco', 'chaleco_reflectivo', 'botas'];
const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Contract: cualquier adapter on-device debe implementar esto. El test
 * usa MockEppDetector; producción usa RealTfliteDetector (cuando exista).
 */
export interface EppDetector {
  readonly modelVersion: string;
  /**
   * Analiza una imagen + retorna las detecciones crudas. El caller
   * envuelve esto en `inspectImage()` para aplicar config (threshold +
   * required-classes filter + missing/lowConfidence logic).
   *
   * IMPORTANTE: la imagen NO sale del device. El adapter trabaja con
   * los pixeles localmente (HTMLImageElement / ImageBitmap / Blob).
   */
  detect(image: ImageBitmap | HTMLImageElement | Blob): Promise<EppDetection[]>;
}

/**
 * Mock determinístico para tests + dev sin modelo real. Devuelve
 * detecciones sintéticas basadas en un seed (por reproducibilidad).
 */
export class MockEppDetector implements EppDetector {
  readonly modelVersion = 'mock-v1';

  constructor(
    private readonly mockDetections: EppDetection[] = [
      { class: 'casco', confidence: 0.92 },
      { class: 'chaleco_reflectivo', confidence: 0.88 },
      { class: 'botas', confidence: 0.71 },
      { class: 'gafas', confidence: 0.45 }, // borderline (lowConfidence)
    ],
  ) {}

  async detect(_image: ImageBitmap | HTMLImageElement | Blob): Promise<EppDetection[]> {
    // Pretend que tardó 80 ms (typical device inference).
    await new Promise((r) => setTimeout(r, 1));
    return [...this.mockDetections];
  }
}

/**
 * Inspecciona una imagen y retorna el resultado clasificado por
 * detected/missing/lowConfidence. Pure orchestration sobre el detector.
 *
 * Privacy: la imagen permanece en device. Solo el `EppInspectionResult`
 * (sin la imagen) se persiste/sincroniza.
 */
export async function inspectImage(
  image: ImageBitmap | HTMLImageElement | Blob,
  detector: EppDetector,
  config: EppInspectionConfig = {},
): Promise<EppInspectionResult> {
  const required = config.requiredClasses ?? DEFAULT_REQUIRED_CLASSES;
  const conf = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const lowConf = config.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (conf <= lowConf) {
    throw new Error(
      `inspectImage: confidenceThreshold (${conf}) debe ser > lowConfidenceThreshold (${lowConf})`,
    );
  }

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const raw = await detector.detect(image);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const detected: EppDetection[] = raw.filter((d) => d.confidence >= conf);
  const lowConfidence: EppDetection[] = raw.filter(
    (d) => d.confidence >= lowConf && d.confidence < conf,
  );
  // missing = required - (detected_classes).
  const detectedClasses = new Set(detected.map((d) => d.class));
  const missing: EppClass[] = required.filter((c) => !detectedClasses.has(c));

  const averageConfidence =
    detected.length === 0
      ? 0
      : detected.reduce((a, d) => a + d.confidence, 0) / detected.length;

  return {
    detected,
    missing,
    lowConfidence,
    averageConfidence,
    inferenceTimeMs: Math.round(t1 - t0),
    modelVersion: detector.modelVersion,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convierte un `EppInspectionResult` en un `RiskNodePayload` listo para
 * persistir como ZK node tipo 'epp_inspection'.
 *
 * El nodo se persiste via `writeNodes()` en el flujo normal — el caller
 * NO necesita conocer la mecánica interna del Zettelkasten. La privacy
 * está garantizada porque el `RiskNodePayload` NO incluye la imagen
 * (solo el result classification).
 *
 * Severity heuristic:
 *   - `missing.length > 0` → 'high' (EPP requerido faltante = riesgo crítico)
 *   - `lowConfidence.length > 0` && missing.length === 0 → 'medium'
 *   - `averageConfidence > 0.85` && missing.length === 0 → 'low'
 *   - Sino → 'low'
 */
export function buildEppInspectionNode(
  result: EppInspectionResult,
  ctx: {
    /** UID del trabajador inspeccionado. */
    workerUid: string;
    /** ID del proyecto (multi-tenant scope). */
    projectId: string;
    /** UID del autor (supervisor que hizo la inspección). */
    authorUid: string;
    /** Opcional: meeting point / location label. */
    locationLabel?: string;
  },
): RiskNodePayload {
  const severity: 'low' | 'medium' | 'high' | 'critical' =
    result.missing.length > 0
      ? 'high'
      : result.lowConfidence.length > 0
        ? 'medium'
        : 'low';

  const detectedSummary = result.detected
    .map((d) => `${d.class} (${Math.round(d.confidence * 100)}%)`)
    .join(', ') || 'ninguno';
  const missingSummary = result.missing.length > 0
    ? result.missing.join(', ')
    : 'ninguno';

  // RiskNodePayload.metadata es Record<string, number|string|boolean|null>
  // — flat primitives only. Serializamos las arrays (detected, missing,
  // lowConfidence) como JSON strings + comma-separated convenience fields.
  const detectedJson = JSON.stringify(
    result.detected.map((d) => ({ class: d.class, confidence: d.confidence })),
  );
  const lowConfidenceJson = JSON.stringify(
    result.lowConfidence.map((d) => ({ class: d.class, confidence: d.confidence })),
  );

  return {
    type: 'epp_inspection',
    title: `Inspección EPP ${result.missing.length > 0 ? '⚠️ faltantes' : 'OK'}`,
    description:
      `Inspección on-device del trabajador ${ctx.workerUid}` +
      (ctx.locationLabel ? ` en ${ctx.locationLabel}` : '') +
      `. Detectado: ${detectedSummary}. Faltante: ${missingSummary}. ` +
      `Confianza promedio: ${Math.round(result.averageConfidence * 100)}%. ` +
      `Modelo: ${result.modelVersion} (inferencia ${result.inferenceTimeMs}ms).`,
    severity,
    metadata: {
      workerUid: ctx.workerUid,
      authorId: ctx.authorUid,
      locationLabel: ctx.locationLabel ?? null,
      detectedClasses: result.detected.map((d) => d.class).join(','),
      missingClasses: result.missing.join(','),
      lowConfidenceClasses: result.lowConfidence.map((d) => d.class).join(','),
      detectedJson, // JSON-serialized for downstream consumers
      lowConfidenceJson,
      averageConfidence: result.averageConfidence,
      inferenceTimeMs: result.inferenceTimeMs,
      modelVersion: result.modelVersion,
      timestamp: result.timestamp,
      // PRIVACY: nunca incluir la imagen, ni base64 ni URL, ni filename.
      // Solo el result classification se persiste.
      onDeviceOnly: true,
    },
    connections: [],
    references: [
      // DS 594 art. 53-55 — uso obligatorio de EPP.
      'DS 594/1999 art. 53-55 — uso obligatorio de EPP',
    ],
  };
}

/**
 * Factory que decide qué detector usar. En 2026-05-22 retorna siempre
 * MockEppDetector (no hay modelo real disponible). Cuando DevOps ponga
 * `public/models/epp/epp-yolo-v1.tflite` + npm install @tensorflow/tfjs-tflite,
 * cambiar esta función para retornar el real loader.
 */
export function getEppDetectorImpl(): EppDetector {
  return new MockEppDetector();
}
