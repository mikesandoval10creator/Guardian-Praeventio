// Real worker positions for the live/evacuation map.
//
// Workers' devices write a survival beacon to `pings/{uid}` ({lat,lng,timestamp,
// status}) via useSurvivalPing. Rescue coordinators (admin/supervisor) may read
// them (firestore.rules:1012 — pings allow read for owner/admin/supervisor).
// This hook resolves a project's members and reads their beacons so the
// evacuation map can plot WHERE workers actually are — real GPS, never a
// fabricated roster. Stale beacons (older than the freshness window) are
// dropped so we never show a worker who left hours ago as "here now".

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { logger } from '../utils/logger';

export interface WorkerPing {
  uid: string;
  lat: number;
  lng: number;
  status?: string;
  /** ms since the beacon was written, at read time. */
  ageMs: number;
}

interface RawPingRow {
  uid: string;
  data:
    | {
        lat?: unknown;
        lng?: unknown;
        status?: unknown;
        timestamp?: { toMillis?: () => number } | number | string | null;
      }
    | undefined;
}

/** Default freshness window: a beacon older than this is not shown as live. */
export const PING_FRESHNESS_MS = 15 * 60_000; // 15 min

function pingMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return Number.isNaN(p) ? null : p;
  }
  const toMillis = (ts as { toMillis?: () => number }).toMillis;
  if (typeof toMillis === 'function') {
    const v = toMillis.call(ts);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/**
 * Pure projection: keep only rows with a valid lat/lng AND a fresh beacon
 * (within `maxAgeMs` of `nowMs`). A missing/unparseable timestamp is treated as
 * stale (dropped) — we never plot a position we can't date. No fabrication.
 */
export function selectFreshWorkerPings(
  rows: RawPingRow[],
  nowMs: number,
  maxAgeMs: number = PING_FRESHNESS_MS,
): WorkerPing[] {
  const out: WorkerPing[] = [];
  for (const row of rows) {
    const d = row.data;
    if (!d) continue;
    const lat = typeof d.lat === 'number' ? d.lat : Number(d.lat);
    const lng = typeof d.lng === 'number' ? d.lng : Number(d.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const ms = pingMillis(d.timestamp as unknown);
    if (ms == null) continue; // undatable → not shown as live
    const ageMs = nowMs - ms;
    if (ageMs < 0 || ageMs > maxAgeMs) continue; // stale or clock-skewed future
    out.push({
      uid: row.uid,
      lat,
      lng,
      status: typeof d.status === 'string' ? d.status : undefined,
      ageMs,
    });
  }
  return out;
}

// Cap the fan-out so a huge project doesn't issue thousands of reads.
const MAX_MEMBERS = 200;

export interface UseWorkerPingsResult {
  workers: WorkerPing[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Read the latest fresh GPS beacon for each member of `projectId`. Returns
 * real positioned workers (empty when none are fresh — never fabricated).
 */
export function useWorkerPings(
  projectId: string | null,
  opts: { maxAgeMs?: number; pollMs?: number } = {},
): UseWorkerPingsResult {
  const { maxAgeMs = PING_FRESHNESS_MS, pollMs = 30_000 } = opts;
  const [workers, setWorkers] = useState<WorkerPing[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setWorkers([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Member UIDs come from the `members` array on the project doc — the
        // SAME source `isProjectMember` checks in firestore.rules (NOT the
        // server-written `members` subcollection, which the client cannot rely
        // on being populated). Reading the project doc is allowed for any member.
        const projectSnap = await getDoc(doc(db, 'projects', projectId));
        const memberArray = projectSnap.exists()
          ? (projectSnap.data() as { members?: unknown }).members
          : null;
        const uids = (Array.isArray(memberArray)
          ? memberArray.filter((u): u is string => typeof u === 'string')
          : []
        ).slice(0, MAX_MEMBERS);
        if (uids.length === 0) {
          logger.warn('useWorkerPings_no_members', { projectId });
        }
        const rows: RawPingRow[] = await Promise.all(
          uids.map(async (uid) => {
            try {
              const snap = await getDoc(doc(db, 'pings', uid));
              return { uid, data: snap.exists() ? (snap.data() as RawPingRow['data']) : undefined };
            } catch {
              // A single unreadable beacon must never blank the whole map.
              return { uid, data: undefined };
            }
          }),
        );
        if (cancelled) return;
        setWorkers(selectFreshWorkerPings(rows, Date.now(), maxAgeMs));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        logger.warn('useWorkerPings_failed', {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Clear stale positions: never keep plotting a previous fetch's workers
        // as "live" once the data source is known to have failed.
        setWorkers([]);
        setError('No se pudieron leer las ubicaciones de los trabajadores.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, maxAgeMs, tick]);

  // Light polling so the rescue view stays current during an emergency.
  useEffect(() => {
    if (!projectId || pollMs <= 0) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [projectId, pollMs]);

  return { workers, loading, error, refetch: () => setTick((t) => t + 1) };
}
