// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) on-device PhotogrammetryAdapter.
//
// Reemplaza al ex-`/api/photogrammetry/jobs` server-side. Implementa
// `PhotogrammetryAdapter` ejecutando el pipeline ON-DEVICE
// (`onDeviceReconstruction/`) y persistiendo SOLO el resultado:
//   - mesh GLB → Firebase Storage (`reconstructions/{projectId}/{jobId}.glb`)
//   - PhotogrammetryJobResult → Firestore (reconstructionJobStore.ts)
//
// El video original NUNCA se sube. Esa es la directiva inviolable.
//
// Diferencias vs MockAdapter:
//   - Mock no procesa nada, este SÍ procesa el video real con
//     extractFramesFromVideo + buildPointCloudFromFrames + GLTFExporter.
//   - Mock devuelve un meshUri fake; este sube el GLB real a Storage
//     y devuelve la URL firmada de descarga (Firebase Storage SDK).
//
// El caller (DigitalTwinFaena UI) llama `submitJob` con un campo extra
// `videoFile: File` que NO está en el `PhotogrammetryJobInput` original
// (era para flujo server-side basado en `videoUri`). Solución: extendemos
// la interface con un sub-input `OnDeviceJobInput` que sí incluye `File`.

import { storage, ref as storageRef, uploadBytes, getDownloadURL } from '../../firebase';
import {
  reconstructFromVideo,
  type ReconstructionStage,
} from '../onDeviceReconstruction';
import {
  createReconstructionJob,
  markJobCompleted,
  markJobFailed,
  updateReconstructionJobProgress,
} from './reconstructionJobStore';
import type {
  PhotogrammetryJobInput,
  PhotogrammetryJobResult,
} from './types';
import { logger } from '../../../utils/logger';

/**
 * Input extendido para el adapter on-device. La diferencia clave vs
 * `PhotogrammetryJobInput` es que NO acepta `videoUri` (storage path
 * con video remoto) — exige el `File` directamente. Eso garantiza que
 * el video venga del Camera/File-Picker del usuario y nunca pase por
 * Storage como upload.
 */
export interface OnDeviceJobInput
  extends Omit<PhotogrammetryJobInput, 'videoUri' | 'engine'> {
  /** El File del video seleccionado en el browser. */
  videoFile: File;
  /**
   * Callback de progreso (0-1) — el caller lo conecta a la UI bar.
   * Recibe también el stage actual para mostrar status legible al usuario.
   */
  onProgress?: (ratio: number, stage: ReconstructionStage) => void;
  /** AbortSignal — el caller aborta si el usuario presiona "Cancelar". */
  abortSignal?: AbortSignal;
}

/**
 * El adapter on-device implementa `PhotogrammetryAdapter` pero acepta una
 * variante extendida de input (`OnDeviceJobInput`) que reemplaza
 * `videoUri` por `videoFile`. Como TypeScript no permite cambiar firma
 * mientras se implementa la interface estrictamente, omitimos `extends`
 * y exponemos manualmente los métodos requeridos. Cualquier consumidor
 * que necesite tipar por la interface canónica puede usar el alias
 * `PhotogrammetryAdapter` con un `as unknown as PhotogrammetryAdapter`
 * intencional — no es regression porque el adapter on-device tiene un
 * contrato DIFERENTE (no acepta videoUri remoto, exige File local).
 */
export class OnDeviceReconstructionAdapter {
  readonly engine = 'on-device-webxr' as const;

  /**
   * Procesa un job COMPLETO end-to-end: pipeline on-device + upload del
   * GLB resultante + persistencia del job a Firestore.
   *
   * Devuelve `{ jobId }` ANTES de terminar el procesamiento (igual que
   * adapters cloud) — el caller puede suscribirse a Firestore para
   * recibir updates en tiempo real. Internamente lanza una promesa
   * background que ejecuta el resto y persiste.
   */
  async submitJob(input: OnDeviceJobInput): Promise<{ jobId: string }> {
    if (!input.projectId) throw new Error('OnDeviceAdapter: projectId vacío');
    if (!input.userId) throw new Error('OnDeviceAdapter: userId vacío');
    if (!input.videoFile) throw new Error('OnDeviceAdapter: videoFile vacío');

    const jobId = generateJobId();
    const now = Date.now();

    // Crea el job en estado 'processing' (no 'queued' porque la pipeline
    // arranca inmediatamente — no hay cola server-side).
    const initialJob: PhotogrammetryJobResult = {
      jobId,
      status: 'processing',
      createdAt: now,
      engine: 'on-device-webxr',
      meshFormat: input.outputFormat ?? 'glb',
    };
    await createReconstructionJob(input.projectId, initialJob);

    // Ejecuta el resto en background. El caller puede suscribirse a
    // Firestore para ver updates; no necesita esperar este await.
    void this.executeJob(jobId, input).catch((err) => {
      logger.error('[OnDeviceAdapter] executeJob crashed', { jobId, err: String(err) });
      // Best-effort: marcar el job failed para que la UI no se quede
      // colgada en 'processing'.
      markJobFailed(input.projectId, jobId, String(err)).catch(() => {});
    });

    return { jobId };
  }

  /**
   * Pipeline interno: reconstrucción + upload GLB + mark completed.
   *
   * Privacy: el videoFile NUNCA pasa por Storage. Solo el GLB resultante
   * (que es estructura, no imagen identificable).
   */
  private async executeJob(jobId: string, input: OnDeviceJobInput): Promise<void> {
    try {
      // 1. Reconstrucción on-device (video → GLB + USDZ blobs).
      const { glb, usdz, metrics } = await reconstructFromVideo(input.videoFile, {
        // §2.28 (2026-05-23) — emitir USDZ en paralelo al GLB para que
        // iOS Quick Look pueda mostrar el mesh sin proceso server-side
        // adicional. Costo: ~30% más tiempo de export + ~100 KB extra.
        emitUsdz: true,
        onProgress: (ratio, stage) => {
          input.onProgress?.(ratio, stage);
          void updateReconstructionJobProgress(input.projectId, jobId, {
            metrics: {
              framesExtracted: stage === 'extract' ? Math.round(ratio * 30) : 30,
            },
          }).catch(() => {});
        },
        abortSignal: input.abortSignal,
      });

      // 2. Subir el GLB a Storage. Path determinista por (projectId, jobId).
      const glbPath = `reconstructions/${input.projectId}/${jobId}.glb`;
      const glbRef = storageRef(storage, glbPath);
      await uploadBytes(glbRef, glb, {
        contentType: 'model/gltf-binary',
        customMetadata: {
          onDeviceOnly: 'true',
          engine: 'on-device-webxr',
          userId: input.userId,
        },
      });
      const glbUrl = await getDownloadURL(glbRef);

      // 2.b §2.28 (2026-05-23) — subir USDZ para iOS Quick Look (si la
      // pipeline lo emitió). El path es paralelo al GLB para que el
      // UI pueda derivarlo cambiando solo la extensión cuando detecta iOS.
      let usdzUrl: string | undefined;
      let usdzSizeBytes: number | undefined;
      if (usdz) {
        const usdzPath = `reconstructions/${input.projectId}/${jobId}.usdz`;
        const usdzRef = storageRef(storage, usdzPath);
        await uploadBytes(usdzRef, usdz, {
          contentType: 'model/vnd.usdz+zip',
          customMetadata: {
            onDeviceOnly: 'true',
            engine: 'on-device-webxr',
            userId: input.userId,
            companionTo: glbPath,
          },
        });
        usdzUrl = await getDownloadURL(usdzRef);
        usdzSizeBytes = metrics.usdzSizeBytes;
      }

      // 3. Marcar el job completo en Firestore con métricas finales.
      // El meshUri principal sigue siendo el GLB (compatible everywhere);
      // el USDZ se guarda en `metrics.usdzUrl` (custom field) para que
      // ArViewLink pueda usarlo cuando detecta iOS.
      await markJobCompleted(input.projectId, jobId, glbUrl, 'glb', metrics.glbSizeBytes, {
        framesExtracted: metrics.framesExtracted,
        pointsReconstructed: metrics.pointsReconstructed,
        trianglesGenerated: usdz ? metrics.pointsReconstructed * 2 : 0,
        processingDurationS: metrics.durationMs / 1000,
      });

      // Persistimos usdzUrl + usdzSizeBytes en un patch separado porque
      // markJobCompleted no acepta esos campos. Firestore acepta campos
      // extra fuera del shape canónico; el UI los lee vía cast en
      // DigitalTwinFaena.tsx. Best-effort: si falla, el job sigue
      // completo solo con GLB.
      if (usdzUrl) {
        const extraPatch = { usdzUri: usdzUrl, usdzSizeBytes } as unknown as Parameters<
          typeof updateReconstructionJobProgress
        >[2];
        await updateReconstructionJobProgress(input.projectId, jobId, extraPatch).catch(
          (err) => {
            logger.warn('[OnDeviceAdapter] usdz patch failed', { err: String(err) });
          },
        );
      }

      logger.info('[OnDeviceAdapter] reconstruction completed', {
        jobId,
        projectId: input.projectId,
        durationMs: metrics.durationMs,
        glbSizeBytes: metrics.glbSizeBytes,
        usdzSizeBytes,
      });
    } catch (err) {
      // Cualquier error abort/extract/export/upload llega acá → marcar failed.
      if ((err as Error)?.name === 'AbortError') {
        await markJobFailed(input.projectId, jobId, 'Reconstrucción cancelada por el usuario.');
      } else {
        await markJobFailed(input.projectId, jobId, friendlyErrorMessage(err));
      }
      throw err;
    }
  }

  async getJobStatus(_jobId: string): Promise<PhotogrammetryJobResult> {
    // Para el adapter on-device, el caller debe pasar projectId; sin
    // contexto no podemos resolver el job en Firestore. El UI usa la
    // suscripción `subscribeReconstructionJobs` directamente, que es
    // más eficiente.
    throw new Error(
      'OnDeviceAdapter.getJobStatus: usar subscribeReconstructionJobs(projectId) en su lugar.',
    );
  }

  async cancelJob(_jobId: string): Promise<void> {
    // La cancelación real se hace pasando `abortSignal` en `submitJob`.
    // Este método es no-op; el caller que quiere cancelar debe llamar
    // `controller.abort()` en su AbortController.
    /* noop */
  }

  async waitForJob(_jobId: string, _timeoutMs?: number): Promise<PhotogrammetryJobResult> {
    throw new Error(
      'OnDeviceAdapter.waitForJob: usar subscribeReconstructionJobs(projectId) en su lugar.',
    );
  }
}

/** Factory. */
export function createOnDeviceReconstructionAdapter(): OnDeviceReconstructionAdapter {
  return new OnDeviceReconstructionAdapter();
}

/** Construye un jobId determinista basado en timestamp + random suffix. */
function generateJobId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ondev_${ts}_${rand}`;
}

/** Convierte errores técnicos en mensaje legible para el usuario. */
function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('duration inválida') || raw.includes('encoding')) {
    return 'El video no se pudo decodificar. Probá con mp4 o webm con keyframes.';
  }
  if (raw.includes('Canvas 2D context')) {
    return 'Tu navegador no expone canvas 2D — actualizá Chrome/Firefox.';
  }
  if (raw.includes('empty cloud')) {
    return 'El video resultó vacío después del análisis. Probá un video más largo o con más contraste.';
  }
  if (raw.includes('storage')) {
    return 'No se pudo subir el mesh resultante. Verificá tu conexión.';
  }
  return `Error procesando el video: ${raw}`;
}
