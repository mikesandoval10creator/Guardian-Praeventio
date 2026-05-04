// SPDX-License-Identifier: MIT
//
// Photogrammetry types — Brecha C foundation.
//
// Pipeline conceptual:
//
//   1. Usuario graba video de la faena con su celular (10-60 s, ~30 fps,
//      Capacitor Camera API o Web MediaRecorder).
//   2. Cliente sube el archivo a Cloud Storage (signed URL).
//   3. Cloud Run job (Meshroom MPL2 / RealityCapture API / Hyper3D MCP)
//      procesa frame extraction → feature matching → bundle adjustment →
//      depth maps → meshing → texturing → output GLB/GLTF.
//   4. Cliente descarga el .glb resultante + lo carga en Three.js.
//   5. Usuario coloca objetos virtuales (extintores, hidrantes, señalética).
//   6. Sistema valida normativa (DS 594, NCh 1410, etc.) en tiempo real.
//   7. Cuando objeto físico se instala, se crea geo-anchored ZK node que
//      registra el ciclo de vida (mantenimientos, inspecciones).
//
// Este archivo define solo TIPOS — sin lógica. La lógica vive en:
//   - photogrammetryAdapter.ts (interface)
//   - mockAdapter.ts (testing)
//   - jobOrchestrator.ts (upload→process→download)
//   - meshLoader.ts (GLTF → Three.js)

/** Formato de mesh soportado. GLTF/GLB son el estándar moderno; OBJ legacy. */
export type MeshFormat = 'gltf' | 'glb' | 'obj' | 'ply';

/**
 * Engine usado para procesar el video. Cada uno tiene trade-offs de
 * licencia, costo, calidad. Decisión final en
 * `docs/sprints/SPRINT_20_SPEC.md` Brecha C.
 */
export type PhotogrammetryEngine =
  | 'meshroom' // MPL2 license, free, CPU intensivo (Cloud Run worker)
  | 'colmap' // BSD license, COLMAP open source en Cloud Run worker (CPU-only)
  | 'reality-capture' // CapturingReality cloud API, paid per minute
  | 'hyper3d' // MCP-mediated (text-to-3d / image-to-3d, beta)
  | 'mock'; // for tests + development sin internet

export type PhotogrammetryJobStatus =
  | 'queued' // upload completo, esperando worker
  | 'processing' // worker corriendo
  | 'completed' // mesh disponible
  | 'failed' // error procesando (ver errorMessage)
  | 'cancelled'; // usuario abortó

export interface PhotogrammetryJobInput {
  /** Storage path o URL al video subido. */
  videoUri: string;
  /** Engine elegido para este job. */
  engine: PhotogrammetryEngine;
  /** Formato deseado del mesh resultante. Default 'glb' (binary, single file). */
  outputFormat?: MeshFormat;
  /** ID del proyecto al que pertenece (multi-tenant). */
  projectId: string;
  /** ID del usuario que inició el job (para audit). */
  userId: string;
  /** Geo-anchor opcional — coordenadas reales de la faena para georreferenciar el mesh. */
  geoAnchor?: { lat: number; lng: number; altitudeM?: number };
  /** Métricas opcionales del video original — útil para troubleshooting. */
  videoMeta?: {
    durationS: number;
    framesCount?: number;
    resolutionWidth?: number;
    resolutionHeight?: number;
    fileSizeBytes: number;
  };
}

export interface PhotogrammetryJobResult {
  /** ID asignado al job (uuid o Firestore doc id). */
  jobId: string;
  status: PhotogrammetryJobStatus;
  /** Cuándo se inició el job (ms epoch). */
  createdAt: number;
  /** Cuándo terminó (ms epoch, undefined si no terminó). */
  completedAt?: number;
  /**
   * URI al mesh resultante (Storage path o URL firmada). Solo presente
   * si status === 'completed'.
   */
  meshUri?: string;
  /** Formato del mesh resultante. */
  meshFormat?: MeshFormat;
  /** Tamaño del mesh en bytes (útil para mostrar progreso de descarga). */
  meshSizeBytes?: number;
  /** Si status === 'failed', mensaje legible del error (ya redactado). */
  errorMessage?: string;
  /** Engine usado (eco del input para debugging). */
  engine: PhotogrammetryEngine;
  /** Métricas de procesamiento (latencia, frames procesados, etc.). */
  metrics?: {
    framesExtracted?: number;
    featuresMatched?: number;
    pointsReconstructed?: number;
    trianglesGenerated?: number;
    processingDurationS?: number;
  };
}

/**
 * Interfaz que cualquier adapter de fotogrametría debe implementar.
 * Esto desacopla el orchestrator del engine concreto — futuro swap
 * Meshroom→RealityCapture es un único cambio de adapter, no del cliente.
 */
export interface PhotogrammetryAdapter {
  readonly engine: PhotogrammetryEngine;

  /**
   * Encolar un job. Devuelve el jobId inmediato. El procesamiento real
   * ocurre asíncrono (worker pool en Cloud Run).
   */
  submitJob(input: PhotogrammetryJobInput): Promise<{ jobId: string }>;

  /** Consultar estado de un job. */
  getJobStatus(jobId: string): Promise<PhotogrammetryJobResult>;

  /** Cancelar un job en cola o procesando. No-op si ya completed/failed. */
  cancelJob(jobId: string): Promise<void>;

  /**
   * Polling helper — espera hasta que el job termine (completed, failed,
   * o cancelled) y devuelve el result final. Lanza error si el polling
   * excede `timeoutMs`.
   */
  waitForJob(jobId: string, timeoutMs?: number): Promise<PhotogrammetryJobResult>;
}

/**
 * Object placeable en el mesh — extintor, hidrante, señalética, vía de
 * evacuación, etc. Se persiste en Firestore con coordenadas relativas al
 * mesh O coordenadas geo-absolutas si hay geoAnchor.
 */
export interface PlacedObject {
  /** UUID del objeto. */
  id: string;
  /** Tipo del objeto — drive de iconografía + reglas de normativa. */
  kind: PlacedObjectKind;
  /** Posición en el mesh (coordenadas Three.js: x derecha, y arriba, z atrás). */
  position: { x: number; y: number; z: number };
  /** Rotación en radianes (Euler XYZ). */
  rotation?: { x: number; y: number; z: number };
  /** Escala — default 1. */
  scale?: number;
  /** Geo-coordenadas absolutas (lat/lng) cuando el mesh tiene geoAnchor. */
  geo?: { lat: number; lng: number; altitudeM?: number };
  /** Estado del objeto: planning (virtual) → installed (físico) → active → retired. */
  lifecycle: PlacedObjectLifecycle;
  /** Notas del prevencionista. */
  notes?: string;
  /** Firestore doc ID del nodo Zettelkasten asociado (cuando lifecycle === 'installed'+). */
  zettelkastenNodeId?: string;
  /** ms epoch del último cambio de estado. */
  updatedAt: number;
  /** ms epoch de creación. */
  createdAt: number;
}

export type PlacedObjectKind =
  | 'extinguisher_pqs' // polvo químico seco
  | 'extinguisher_co2'
  | 'extinguisher_water'
  | 'hydrant'
  | 'sign_evacuation'
  | 'sign_warning'
  | 'sign_mandatory'
  | 'sign_prohibition'
  | 'aed' // desfibrilador automático
  | 'first_aid_kit'
  | 'emergency_shower'
  | 'eye_wash_station'
  | 'gas_detector'
  | 'spill_kit'
  | 'safety_shower'
  | 'assembly_point'
  | 'evacuation_route';

export type PlacedObjectLifecycle =
  | 'planning' // virtual en el twin, no instalado
  | 'pending_install' // aprobado, esperando instalación
  | 'installed' // instalado en faena, ZK node creado
  | 'active' // operativo + tiene historial de mantenimientos
  | 'maintenance_due' // requiere mantenimiento (auto o manual)
  | 'retired'; // dado de baja
