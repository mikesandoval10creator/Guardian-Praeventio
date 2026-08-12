// Digital Twin — lectura reactiva de capturas Gaussian Splat.
//
// Las escrituras de `splat_captures` son server-only (firestore.rules); esta
// capa expone únicamente lectura de la captura preferida para el visor.
// Selección determinística del dominio: canónica primero; si falta, la más
// reciente que alcance calidad buena/excelente; como último recurso la más reciente.

import { db, collection, onSnapshot, orderBy, query } from "../firebase";
import {
  selectCanonicalCapture,
  type SplatCapture,
} from "./gaussianSplatRegistry";

const splatCapturesPath = (tenantId: string, projectId: string) =>
  `tenants/${tenantId}/projects/${projectId}/splat_captures`;

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
 * Un documento inválido se omite para que no derribe la pantalla; una denegación
 * o falta de caché muestra estado vacío honesto y delega el detalle al caller.
 */
export function subscribePreferredSplatCapture(
  tenantId: string,
  projectId: string,
  onCapture: (capture: SplatCapture | null) => void,
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
    (snapshot) => {
      const captures: SplatCapture[] = [];
      snapshot.forEach((document) => {
        const data = document.data() as Partial<SplatCapture>;
        if (!data.capturedAt || !data.storageUrl || !data.format) return;
        captures.push({ ...data, id: document.id, projectId } as SplatCapture);
      });
      onCapture(choosePreferredSplatCapture(captures));
    },
    (error) => {
      onError?.(error as Error);
      onCapture(null);
    },
  );
}
