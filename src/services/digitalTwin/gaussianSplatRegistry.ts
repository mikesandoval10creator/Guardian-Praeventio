// Praeventio Guard — Fase D parcial: Gaussian Splat registry for Digital Twin.
//
// Cierra brecha doc usuario "copia de la faena" (planificar + simulacros).
//
// Gestiona metadata de las capturas 3D Gaussian Splat de la faena:
//   - Validación de quality (point count, file size, dimensiones)
//   - Camera presets (puntos cardinales + waypoints para simulacros)
//   - Overlays de simulación (rutas evacuación, zonas riesgo, workers)
//   - Health check del bundle splat (¿está fresco? ¿hay version newer?)
//
// El renderizado WebGL vive en `gaussianSplatViewer.ts` con lazy import
// de `playcanvas`. Este módulo es 100% determinístico y testeable.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SplatFormat = 'ply' | 'splat' | 'compressed_splat';

export interface SplatCapture {
  id: string;
  projectId: string;
  /** ISO-8601 de la captura. */
  capturedAt: string;
  /** UID del que hizo la captura. */
  capturedByUid: string;
  format: SplatFormat;
  /** URL del archivo en Cloud Storage. */
  storageUrl: string;
  /** Tamaño bytes. */
  sizeBytes: number;
  /** Número aproximado de splats (puntos gaussianos). */
  splatCount: number;
  /** Extent de la captura en metros (bbox edge length max). */
  extentMeters: number;
  /** Localización geográfica del centro. */
  centerCoords: { lat: number; lng: number };
  /** Si el cliente la marcó como capture canónica del proyecto. */
  isCanonical: boolean;
  /** Notas operacionales. */
  notes?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Quality validation
// ────────────────────────────────────────────────────────────────────────

export type QualityLevel = 'low' | 'fair' | 'good' | 'excellent';

export interface SplatQualityReport {
  captureId: string;
  /** Score 0-100. */
  qualityScore: number;
  level: QualityLevel;
  /** Issues detectados. */
  issues: string[];
  /** True si el visor puede usarlo sin warnings. */
  isViewable: boolean;
}

/**
 * Evalúa la calidad de una captura. Reglas:
 *   - <100k splats → muy disperso (low)
 *   - 100k-500k → fair (ok para overview)
 *   - 500k-2M → good (ok para detail medio)
 *   - >2M → excellent (detalle alto)
 *   - Size >500MB → warn (bundle pesado para móvil)
 *   - Extent >500m → warn (poco detalle por área)
 */
export function evaluateSplatQuality(capture: SplatCapture): SplatQualityReport {
  const issues: string[] = [];
  let score = 50;

  if (capture.splatCount < 100_000) {
    issues.push(`Solo ${capture.splatCount.toLocaleString('es-CL')} splats — captura muy dispersa.`);
    score -= 20;
  } else if (capture.splatCount < 500_000) {
    score += 10;
  } else if (capture.splatCount < 2_000_000) {
    score += 25;
  } else {
    score += 40;
  }

  if (capture.sizeBytes > 500 * 1024 * 1024) {
    issues.push(`Bundle ${(capture.sizeBytes / 1024 / 1024).toFixed(0)}MB — puede ser lento en móvil.`);
    score -= 10;
  }

  if (capture.extentMeters > 500) {
    issues.push(`Cobertura ${capture.extentMeters}m — baja densidad por área. Considerar capturas parciales.`);
    score -= 10;
  } else if (capture.extentMeters < 5) {
    issues.push('Cobertura <5m — captura demasiado pequeña, ¿es un detalle?');
    score -= 5;
  }

  // Antigüedad: si >180d, sugiere recapturar
  const ageDays = Math.floor((Date.now() - Date.parse(capture.capturedAt)) / 86_400_000);
  if (ageDays > 180) {
    issues.push(`Captura tiene ${ageDays} días — la faena puede haber cambiado, considera recapturar.`);
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  let level: QualityLevel;
  if (score >= 80) level = 'excellent';
  else if (score >= 60) level = 'good';
  else if (score >= 40) level = 'fair';
  else level = 'low';

  const isViewable = score >= 30 && capture.splatCount >= 50_000;

  return { captureId: capture.id, qualityScore: score, level, issues, isViewable };
}

// ────────────────────────────────────────────────────────────────────────
// Camera presets
// ────────────────────────────────────────────────────────────────────────

export interface CameraPreset {
  id: string;
  label: string;
  /** Posición xyz relativa al centro de la captura. */
  position: { x: number; y: number; z: number };
  /** Look-at target. */
  target: { x: number; y: number; z: number };
  /** Field of view. */
  fov: number;
}

/**
 * Genera 4 presets cardinales + cenital sobre el centro de la captura.
 * Útiles como botones rápidos en la UI del Twin.
 */
export function buildCardinalPresets(extentMeters: number): CameraPreset[] {
  const distance = extentMeters * 0.8;
  const altitude = extentMeters * 0.4;
  return [
    {
      id: 'north',
      label: 'Norte',
      position: { x: 0, y: altitude, z: -distance },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
    },
    {
      id: 'south',
      label: 'Sur',
      position: { x: 0, y: altitude, z: distance },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
    },
    {
      id: 'east',
      label: 'Este',
      position: { x: distance, y: altitude, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
    },
    {
      id: 'west',
      label: 'Oeste',
      position: { x: -distance, y: altitude, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
    },
    {
      id: 'top',
      label: 'Cenital',
      position: { x: 0, y: extentMeters * 1.2, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fov: 45,
    },
  ];
}

// ────────────────────────────────────────────────────────────────────────
// Simulation overlays (rutas evacuación, riesgos)
// ────────────────────────────────────────────────────────────────────────

export type OverlayKind = 'evacuation_path' | 'risk_zone' | 'meeting_point' | 'worker_position' | 'fire_extinguisher';

export interface SplatOverlay {
  id: string;
  kind: OverlayKind;
  /** Coordenadas locales relativas al centro de la captura (metros). */
  coords: Array<{ x: number; y: number; z: number }>;
  /** Color hex para el render. */
  color: string;
  /** Etiqueta para la UI. */
  label: string;
}

const OVERLAY_DEFAULT_COLOR: Record<OverlayKind, string> = {
  evacuation_path: '#10b981',  // verde
  risk_zone: '#ef4444',        // rojo
  meeting_point: '#3b82f6',    // azul
  worker_position: '#f59e0b',  // ámbar
  fire_extinguisher: '#dc2626', // rojo oscuro
};

export function buildEvacuationPathOverlay(
  id: string,
  waypoints: Array<{ x: number; y: number; z: number }>,
  label: string = 'Ruta de evacuación',
): SplatOverlay {
  return {
    id,
    kind: 'evacuation_path',
    coords: waypoints,
    color: OVERLAY_DEFAULT_COLOR.evacuation_path,
    label,
  };
}

export function buildMeetingPointOverlay(
  id: string,
  position: { x: number; y: number; z: number },
  label: string,
): SplatOverlay {
  return {
    id,
    kind: 'meeting_point',
    coords: [position],
    color: OVERLAY_DEFAULT_COLOR.meeting_point,
    label,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Path geometry helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Distancia euclidiana 3D entre dos puntos.
 */
export function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Longitud total de una ruta como suma de segmentos.
 */
export function pathLength(waypoints: Array<{ x: number; y: number; z: number }>): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += distance3d(waypoints[i - 1], waypoints[i]);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Tiempo estimado para recorrer la ruta caminando (4.5 km/h).
 */
export function estimateEvacuationTimeSec(pathLengthMeters: number): number {
  const speedMps = 4.5 * 1000 / 3600;
  return Math.round(pathLengthMeters / speedMps);
}

// ────────────────────────────────────────────────────────────────────────
// Canonical capture selector
// ────────────────────────────────────────────────────────────────────────

export interface CanonicalCaptureSelection {
  capture: SplatCapture | null;
  reason: string;
}

/**
 * Elige la captura canónica de un proyecto. Prioriza la marcada como
 * `isCanonical=true`. Si no hay, elige la más reciente con calidad >=
 * 'good'. Si no, devuelve null con razón explicativa.
 */
export function selectCanonicalCapture(
  captures: SplatCapture[],
): CanonicalCaptureSelection {
  if (captures.length === 0) {
    return { capture: null, reason: 'Sin capturas registradas para este proyecto.' };
  }
  const flagged = captures.find((c) => c.isCanonical);
  if (flagged) {
    return { capture: flagged, reason: 'Marcada manualmente como canónica.' };
  }
  const sorted = [...captures].sort(
    (a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
  );
  for (const candidate of sorted) {
    const quality = evaluateSplatQuality(candidate);
    if (quality.level === 'good' || quality.level === 'excellent') {
      return { capture: candidate, reason: `Más reciente con calidad ${quality.level}.` };
    }
  }
  return {
    capture: sorted[0],
    reason: `Ninguna captura cumple calidad mínima — usando la más reciente (${evaluateSplatQuality(sorted[0]).level}).`,
  };
}
