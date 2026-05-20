// Praeventio Guard — Evacuation Headcount client hook (REST + live Firestore).
//
// Wraps the four endpoints in `src/server/routes/evacuationHeadcount.ts`:
//
//   POST /api/evacuation/start
//   POST /api/evacuation/scan-qr
//   GET  /api/evacuation/status
//   POST /api/evacuation/end
//
// Sirve a `<EvacuationDashboard />` (live UI) + `<EvacuationQRScanner />`
// (scan-action button). El dashboard suscribe directamente a Firestore para
// latencia <1s — este hook expone además `subscribeToDrill` que centraliza
// la subscription helper para que el componente quede limpio.
//
// ADR 0019: cliente Firebase modular (`firebase/firestore`) — NO migrar a
// adaptadores OSS. `auth.currentUser` viene de `services/firebase.ts`.

import { useCallback } from 'react';
import {
  doc,
  collection,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import type {
  EvacuationDrill,
  EvacuationStatus,
  EvacuationPostmortem,
  EvacuationScan,
} from '../services/evacuation/evacuationHeadcount';

// ────────────────────────────────────────────────────────────────────────
// Low-level fetch helpers
// ────────────────────────────────────────────────────────────────────────

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ────────────────────────────────────────────────────────────────────────
// Public input / output shapes
// ────────────────────────────────────────────────────────────────────────

export interface StartEvacuationInput {
  projectId: string;
  kind: 'drill' | 'real';
  meetingPointId: string;
  expectedWorkers: EvacuationDrill['expectedWorkers'];
  /** Optional client id for offline-first idempotent retry. */
  id?: string;
}
export interface StartEvacuationResponse {
  ok: true;
  drill: EvacuationDrill;
}

export interface ScanQrInput {
  projectId: string;
  drillId: string;
  workerUid: string;
  meetingPointId: string;
  scannedAt?: string;
}
export interface ScanQrResponse {
  ok: true;
  drill: EvacuationDrill;
  status: EvacuationStatus;
}

export interface FetchStatusInput {
  projectId: string;
  drillId: string;
}
export interface FetchStatusResponse {
  ok: true;
  drill: EvacuationDrill;
  status: EvacuationStatus;
}

export interface EndEvacuationInput {
  projectId: string;
  drillId: string;
  endedAt?: string;
}
export interface EndEvacuationResponse {
  ok: true;
  drill: EvacuationDrill;
  postmortem: EvacuationPostmortem;
}

// ────────────────────────────────────────────────────────────────────────
// Live Firestore subscription
// ────────────────────────────────────────────────────────────────────────

export interface SubscribeArgs {
  tenantId: string;
  projectId: string;
  drillId: string;
}

/**
 * Subscribe to the drill doc + scans subcollection. Calls `onUpdate` with
 * the latest assembled drill on every change. Returns an unsubscribe.
 *
 * IMPORTANT — uses two listeners (drill doc + scans subcollection) and
 * stitches them client-side. The pattern matches the Firestore adapter
 * shape on the server (`evacuationFirestoreAdapter.ts`): drill metadata
 * lives in the parent doc, scans in `scans/{workerUid}`.
 */
export function subscribeToDrill(
  args: SubscribeArgs,
  onUpdate: (drill: EvacuationDrill | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const { tenantId, projectId, drillId } = args;
  const drillRef = doc(
    db,
    'tenants',
    tenantId,
    'projects',
    projectId,
    'evacuations',
    drillId,
  );
  const scansCol = collection(
    db,
    'tenants',
    tenantId,
    'projects',
    projectId,
    'evacuations',
    drillId,
    'scans',
  );

  let metadata: Omit<EvacuationDrill, 'scans'> | null = null;
  let scans: EvacuationScan[] = [];
  let initialized = { meta: false, scans: false };

  const emit = () => {
    if (!metadata) {
      onUpdate(null);
      return;
    }
    onUpdate({ ...metadata, scans });
  };

  const unsubMeta = onSnapshot(
    drillRef,
    (snap) => {
      if (!snap.exists()) {
        metadata = null;
      } else {
        const d = snap.data() as Omit<EvacuationDrill, 'scans'> & {
          endedAt?: string | null;
        };
        metadata = {
          id: d.id,
          projectId: d.projectId,
          kind: d.kind,
          startedAt: d.startedAt,
          startedByUid: d.startedByUid,
          meetingPointId: d.meetingPointId,
          expectedWorkers: d.expectedWorkers ?? [],
          endedAt: d.endedAt ?? undefined,
        };
      }
      initialized.meta = true;
      if (initialized.meta && initialized.scans) emit();
    },
    (err) => onError?.(err as Error),
  );

  const unsubScans = onSnapshot(
    scansCol,
    (snap) => {
      scans = snap.docs.map((d) => d.data() as EvacuationScan);
      initialized.scans = true;
      if (initialized.meta && initialized.scans) emit();
    },
    (err) => onError?.(err as Error),
  );

  return () => {
    unsubMeta();
    unsubScans();
  };
}

// ────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────

export function useEvacuationHeadcount() {
  const start = useCallback(
    async (input: StartEvacuationInput): Promise<StartEvacuationResponse> => {
      const res = await authedFetch('/api/evacuation/start', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return json<StartEvacuationResponse>(res);
    },
    [],
  );

  const scanQr = useCallback(
    async (input: ScanQrInput): Promise<ScanQrResponse> => {
      const res = await authedFetch('/api/evacuation/scan-qr', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return json<ScanQrResponse>(res);
    },
    [],
  );

  const fetchStatus = useCallback(
    async (input: FetchStatusInput): Promise<FetchStatusResponse> => {
      const params = new URLSearchParams({
        projectId: input.projectId,
        drillId: input.drillId,
      });
      const res = await authedFetch(`/api/evacuation/status?${params}`, {
        method: 'GET',
      });
      return json<FetchStatusResponse>(res);
    },
    [],
  );

  const end = useCallback(
    async (input: EndEvacuationInput): Promise<EndEvacuationResponse> => {
      const res = await authedFetch('/api/evacuation/end', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return json<EndEvacuationResponse>(res);
    },
    [],
  );

  return { start, scanQr, fetchStatus, end, subscribeToDrill };
}
