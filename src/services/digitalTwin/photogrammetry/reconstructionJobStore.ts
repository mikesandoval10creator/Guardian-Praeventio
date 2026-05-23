// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction.
//
// Firestore-bound CRUD para `PhotogrammetryJobResult`. Reemplaza al ex-
// endpoint `/api/photogrammetry/jobs` que fue descartado por directiva
// usuario "on-device only" (TODO §2.28).
//
// Storage path:
//   projects/{projectId}/reconstruction_jobs/{jobId}
//
// Cada job representa una sesión on-device. El cliente lo crea con
// status='processing', lo actualiza con métricas a medida que ejecuta
// el pipeline `reconstructFromVideo`, y al terminar marca completed +
// meshUri (URL del GLB en Firebase Storage).
//
// Privacy: solo el resultado (mesh + métricas) se persiste. El video
// original NUNCA se sube — esto está enforced por contrato + por la
// pipeline `onDeviceReconstruction/` que no acepta Storage uploads.

import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
} from '../../firebase';
import type {
  PhotogrammetryJobResult,
  PhotogrammetryJobStatus,
  MeshFormat,
} from './types';

/** Path Firestore para los reconstruction jobs de un proyecto. */
function jobsCollectionPath(projectId: string): string {
  return `projects/${projectId}/reconstruction_jobs`;
}

/**
 * Crea un job en estado inicial. Idempotente (setDoc con id determinista).
 * Llamar al inicio de la pipeline ON-DEVICE: el caller arma el jobId con
 * un UUID local + crea el doc, luego ejecuta `reconstructFromVideo`, y
 * al terminar llama `markJobCompleted` o `markJobFailed`.
 */
export async function createReconstructionJob(
  projectId: string,
  job: PhotogrammetryJobResult,
): Promise<void> {
  if (!projectId) throw new Error('createReconstructionJob: projectId vacío');
  if (!job?.jobId) throw new Error('createReconstructionJob: jobId vacío');
  const ref = doc(db, jobsCollectionPath(projectId), job.jobId);
  await setDoc(
    ref,
    {
      ...job,
      // Marca explícita de que este job se procesó on-device. Si en el
      // futuro algún sidecar server-side reaparece, los jobs llevan
      // esta etiqueta y se pueden filtrar.
      onDeviceOnly: true,
      // Timestamp normalizado del lado servidor para ordering estable.
      createdAtServer: Date.now(),
    },
    { merge: true },
  );
}

/**
 * Actualiza el progreso/status de un job en curso. Pensado para llamar
 * desde el callback `onProgress` del pipeline `reconstructFromVideo`.
 */
export async function updateReconstructionJobProgress(
  projectId: string,
  jobId: string,
  patch: Partial<
    Pick<
      PhotogrammetryJobResult,
      'status' | 'metrics' | 'errorMessage' | 'meshUri' | 'meshFormat' | 'meshSizeBytes' | 'completedAt'
    >
  >,
): Promise<void> {
  if (!projectId || !jobId) {
    throw new Error('updateReconstructionJobProgress: projectId/jobId vacíos');
  }
  const ref = doc(db, jobsCollectionPath(projectId), jobId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

/** Marca el job como completed con mesh + métricas finales. */
export async function markJobCompleted(
  projectId: string,
  jobId: string,
  meshUri: string,
  meshFormat: MeshFormat,
  meshSizeBytes: number,
  metrics: NonNullable<PhotogrammetryJobResult['metrics']>,
): Promise<void> {
  await updateReconstructionJobProgress(projectId, jobId, {
    status: 'completed',
    meshUri,
    meshFormat,
    meshSizeBytes,
    metrics,
    completedAt: Date.now(),
  });
}

/** Marca el job como failed con mensaje legible. */
export async function markJobFailed(
  projectId: string,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  await updateReconstructionJobProgress(projectId, jobId, {
    status: 'failed',
    errorMessage,
    completedAt: Date.now(),
  });
}

/**
 * Lista los jobs recientes de un proyecto (ordered desc por createdAt).
 * Default limit = 20 (suficiente para la UI lista).
 *
 * Devuelve [] cuando no hay proyecto o no hay jobs — sin tirar.
 */
export async function listReconstructionJobs(
  projectId: string,
  limitCount: number = 20,
): Promise<PhotogrammetryJobResult[]> {
  if (!projectId) return [];
  const col = collection(db, jobsCollectionPath(projectId));
  const q = query(col, orderBy('createdAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 100))));
  const snap = await getDocs(q);
  const jobs: PhotogrammetryJobResult[] = [];
  snap.forEach((d) => {
    try {
      const data = d.data() as PhotogrammetryJobResult;
      jobs.push({ ...data, jobId: d.id });
    } catch {
      /* skip malformed */
    }
  });
  return jobs;
}

/**
 * Live subscription a los jobs de un proyecto. Devuelve `unsubscribe`.
 *
 * Útil para la UI: cuando un job se actualiza por la pipeline (status →
 * processing → completed), la lista refresca sin polling.
 */
export function subscribeReconstructionJobs(
  projectId: string,
  onSnap: (jobs: PhotogrammetryJobResult[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 20,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, jobsCollectionPath(projectId));
  const q = query(col, orderBy('createdAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 100))));
  return onSnapshot(
    q,
    (snap) => {
      const jobs: PhotogrammetryJobResult[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as PhotogrammetryJobResult;
          jobs.push({ ...data, jobId: d.id });
        } catch {
          /* skip */
        }
      });
      onSnap(jobs);
    },
    (err) => {
      onError?.(err as Error);
      onSnap([]);
    },
  );
}

/** Filtra solo jobs con status `completed` y meshUri presente. */
export function getCompletedJobs(
  jobs: PhotogrammetryJobResult[],
): PhotogrammetryJobResult[] {
  return jobs.filter((j) => j.status === 'completed' && !!j.meshUri);
}

/** Filtra solo jobs con status `processing`. */
export function getActiveJobs(
  jobs: PhotogrammetryJobResult[],
): PhotogrammetryJobResult[] {
  return jobs.filter(
    (j) => j.status === 'processing' || (j.status as PhotogrammetryJobStatus) === 'queued',
  );
}
