// Praeventio Guard — CPHS acta writer API client.
//
// A CPHS acta is a legally-significant minute (Comité Paritario), so its
// WRITES go through audited server routes (cphsMinute.ts) — never a direct
// client Firestore write (CLAUDE.md #3: server stamps identity + audit_logs).
// The page still READS actas live via the Firestore subscription; only the
// create/append/update-status writes come through here.

import { apiAuthHeaders } from '../../lib/apiAuth';

export type ActaTipo = 'Ordinaria' | 'Extraordinaria';
export type AcuerdoEstado = 'Pendiente' | 'En Progreso' | 'Completado';

export interface Acuerdo {
  id: string;
  descripcion: string;
  responsable: string;
  fechaPlazo: string;
  estado: AcuerdoEstado;
}

const base = (projectId: string) => `/api/sprint-k/${projectId}/cphs/actas`;

async function cphsFetch<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await apiAuthHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(b.message ?? b.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

/** Create a new acta. Returns the server-generated acta id. */
export async function createActaApi(
  projectId: string,
  input: { fecha: string; tipo: ActaTipo; asistentes: string[] },
): Promise<{ id: string }> {
  return cphsFetch(base(projectId), 'POST', input);
}

/** Append an acuerdo (action item) to an acta. Returns the created acuerdo (server-assigned id). */
export async function addAcuerdoApi(
  projectId: string,
  actaId: string,
  input: { descripcion: string; responsable: string; fechaPlazo: string },
): Promise<{ acuerdo: Acuerdo }> {
  return cphsFetch(`${base(projectId)}/${actaId}/acuerdos`, 'POST', input);
}

/** Change the estado of a single acuerdo (server does the read-modify-write in a transaction). */
export async function updateAcuerdoEstadoApi(
  projectId: string,
  actaId: string,
  acuerdoId: string,
  estado: AcuerdoEstado,
): Promise<{ ok: boolean }> {
  return cphsFetch(`${base(projectId)}/${actaId}/acuerdos/${acuerdoId}`, 'PATCH', { estado });
}
