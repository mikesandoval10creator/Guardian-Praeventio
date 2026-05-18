// Praeventio Guard — F.18 Historial Profesional Portátil hooks.
//
// Pareja cliente de `src/server/routes/portableHistory.ts`. Migrado del
// monolito `useSprintK.ts` (2026-05-17) — Sprint K reformulation.
//
// Ley 19.628 (Chile) — datos personales del trabajador.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type PortableHistoryFormat = 'json' | 'pdf';

export interface PortableHistoryConsent {
  allowsPortableExport: boolean;
  includesIncidents: boolean;
  updatedAt: string;
  updatedByUid: string;
}

/** Forma deliberadamente laxa — el server agrega documentos de varias
 *  colecciones legacy + canonical (Worker training_assignments, EPP
 *  assignments, medical_aptitudes, etc.). El UI lee los campos comunes
 *  que casi todos comparten; campos faltantes degradan al fallback "—".
 *
 *  Codex P2 fix: TS strict desfasaba `[key: string]: unknown` con los
 *  accesos directos en el UI (e.eppCategory, a.recordedAt, etc.). Los
 *  campos opcionales se declaran como `string | undefined` para que TS
 *  resuelva el tipo sin obligar al UI a hacer narrowing manual. */
export interface PortableHistoryRecord {
  id?: string;
  obtainedAt?: string;
  trainingName?: string;
  trainingCode?: string;
  eppItemName?: string;
  eppCategory?: string;
  eppModel?: string;
  category?: string;
  deliveredAt?: string;
  aptitudeStatus?: string;
  status?: string;
  recordedAt?: string;
  evaluationDate?: string;
  role?: string;
  roleName?: string;
  roleCode?: string;
  startDate?: string;
  startedAt?: string;
  endedAt?: string;
  signedAt?: string;
  signatureType?: string;
  documentTitle?: string;
  documentKind?: string;
  occurredAt?: string;
  severity?: string;
  description?: string;
}

export interface PortableHistoryBundle {
  schemaVersion: '1.0.0';
  generatedAt: string;
  workerUid: string;
  consent: PortableHistoryConsent;
  identity: {
    fullName: string;
    rut: string;
    email?: string | null;
  };
  trainings: PortableHistoryRecord[];
  eppDeliveries: PortableHistoryRecord[];
  aptitudes: PortableHistoryRecord[];
  criticalRoles: PortableHistoryRecord[];
  signatures: PortableHistoryRecord[];
  incidents: PortableHistoryRecord[];
  disclaimer: string;
}

export interface PortableHistoryResponse {
  bundle: PortableHistoryBundle;
}

export function useWorkerPortableHistory(
  projectId: string | null,
  workerUid: string | null,
) {
  return useEndpoint<PortableHistoryResponse>(
    projectId && workerUid
      ? `/api/sprint-k/${projectId}/workers/${workerUid}/portable-history`
      : null,
  );
}

export async function updatePortableConsent(
  projectId: string,
  workerUid: string,
  flags: { allowsPortableExport: boolean; includesIncidents: boolean },
): Promise<PortableHistoryConsent> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/workers/${workerUid}/portable-history/consent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(flags),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as { ok: true; consent: PortableHistoryConsent };
  return json.consent;
}

export async function exportPortableHistory(
  projectId: string,
  workerUid: string,
  format: PortableHistoryFormat = 'json',
): Promise<{ blob: Blob; filename: string; checksum: string | null }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/workers/${workerUid}/portable-history/export?format=${encodeURIComponent(format)}`,
    {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const blob = await res.blob();
  const ext = format === 'pdf' ? 'pdf' : 'json';
  const filename = `portable-history-${workerUid}.${ext}`;
  const checksum = res.headers.get('X-Portable-History-Checksum');
  return { blob, filename, checksum };
}
