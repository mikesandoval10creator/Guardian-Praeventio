// Digital Twin — lectura reactiva de capturas Gaussian Splat.
//
// Las escrituras de `splat_captures` son server-only (firestore.rules); esta
// capa expone únicamente lectura de la captura preferida para el visor.
// Selección determinística del dominio: canónica primero; si falta, la más
// reciente que alcance calidad buena/excelente; como último recurso la más reciente.

import { z } from "zod";
import { db, collection, onSnapshot, orderBy, query } from "../firebase";
import {
  selectCanonicalCapture,
  type SplatCapture,
} from "./gaussianSplatRegistry";

const splatCapturesPath = (tenantId: string, projectId: string) =>
  `tenants/${tenantId}/projects/${projectId}/splat_captures`;

// Metadata for preview only. A valid record is not proof of object provenance or permission to fetch it.
const previewMetadata = z.object({
  tenantId: z.string().optional(),
  projectId: z.string().optional(),
  capturedAt: z.string().refine((date) => Number.isFinite(Date.parse(date))),
  capturedByUid: z.string().min(1),
  format: z.enum(["ply", "splat", "compressed_splat"]),
  storageUrl: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  splatCount: z.number().int().nonnegative(),
  extentMeters: z.number().finite().nonnegative(),
  centerCoords: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  isCanonical: z.boolean(),
  notes: z.string().optional(),
});

/**
 * Selecciona la captura que debe representar la faena.
 *
 * La canónica prevalece por decisión explícita del proyecto. Sin una, delega
 * al selector de dominio: primero la más reciente con calidad buena/excelente
 * y, como último recurso, la más reciente por `capturedAt`; así el visor nunca
 * depende del orden de Firestore.
 */
export function choosePreferredSplatCapture(
  captures: SplatCapture[],
): SplatCapture | null {
  return selectCanonicalCapture(captures).capture;
}

/**
 * Suscribe solo a la metadata de capturas del tenant/proyecto actual.
 * Omite documentos inválidos e informa si el resultado procede de la caché.
 * Un resultado vacío en caché no confirma que el proyecto no tenga capturas.
 */
export function subscribePreferredSplatCapture(
  tenantId: string,
  projectId: string,
  onCapture: (capture: SplatCapture | null, fromCache?: boolean) => void,
  onError?: (error: Error) => void,
): () => void {
  if (!tenantId || !projectId) {
    onCapture(null);
    return () => undefined;
  }

  const capturesQuery = query(
    collection(db, splatCapturesPath(tenantId, projectId)),
    orderBy("capturedAt", "desc"),
  );

  return onSnapshot(
    capturesQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      const captures: SplatCapture[] = [];
      snapshot.forEach((document) => {
        const parsed = previewMetadata.safeParse(document.data());
        if (!parsed.success) return;
        const { tenantId: stampedTenant, projectId: stampedProject, ...data } = parsed.data;
        // Legacy records may omit stamps; a contradictory stamp is never silently rewritten.
        if ((stampedTenant !== undefined && stampedTenant !== tenantId) ||
            (stampedProject !== undefined && stampedProject !== projectId)) return;
        captures.push({ ...data, id: document.id, projectId });
      });
      onCapture(choosePreferredSplatCapture(captures), snapshot.metadata.fromCache);
    },
    (error) => {
      onError?.(error as Error);
      onCapture(null);
    },
  );
}
