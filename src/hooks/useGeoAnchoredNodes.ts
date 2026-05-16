// SPDX-License-Identifier: MIT
//
// useGeoAnchoredNodes — Bucket K.1
//
// Reads ZK nodes whose `metadata.geo.{lat,lng}` lies within a given
// radius of a center point. Powers the MaintenanceStatusPanel's
// "Histórico" feed: when the user selects a PlacedObject in the Digital
// Twin we want to surface every previously-written ZK record that lives
// nearby (mantenimientos, inspecciones, hallazgos asociados).
//
// Strategy — Firestore can only express a single inequality per query
// across multiple fields, so we drive the query off `metadata.geo.lat`
// (composite index: projectId ASC, metadata.geo.lat ASC) and then refine
// the bounding box → true circle in-memory with Haversine. This trades
// a tiny over-fetch for one round-trip per selection — perfectly fine
// at the scale of a single faena (≈10²–10³ nodes max).
//
// Optional filters:
//   - objectKind  — restricts to nodes tagged with that kind. Matches
//     the orchestrator's tag layout: `[next.kind, lifecycle, …]`.
//   - controlOnly — restricts to nodes carrying `control-material` tag,
//     i.e. only the safety control objects (extintores, AEDs, hidrantes…)
//     and not arbitrary risks/findings that happen to live nearby.
//
// Required Firestore index (one-time per project):
//
//   gcloud firestore indexes composite create \
//     --collection-group=nodes \
//     --query-scope=COLLECTION \
//     --field-config=field-path=projectId,order=ascending \
//     --field-config=field-path=metadata.geo.lat,order=ascending
//
// See `docs/firestore-indexes.md` for the complete catalog.

import { useEffect, useState, useMemo, useRef } from 'react';
import type { RiskNode } from '../types';
import {
  db,
  collection,
  query,
  where,
  onSnapshot,
  handleFirestoreError,
  OperationType,
} from '../services/firebase';
import { boundingBox, haversineMeters } from '../utils/haversine';

export interface GeoQueryOptions {
  /** Project the user is currently working in (multi-tenant scope). */
  projectId: string;
  /** Center of the search radius — typically `placedObject.geo`. */
  center: { lat: number; lng: number };
  /** Search radius in metres. Caller decides; UI defaults to 5–25 m. */
  radiusM: number;
  /**
   * Filters by `tags.includes(objectKind)`. Matches the lifecycle
   * orchestrator's tag layout (`tags = [next.kind, lifecycle, ...]`).
   */
  objectKind?: string;
  /**
   * If `true`, restricts to nodes tagged `control-material` — i.e.
   * the safety installations themselves, not arbitrary risk records
   * that happen to share a coordinate.
   */
  controlOnly?: boolean;
}

export interface UseGeoAnchoredNodesResult {
  nodes: RiskNode[];
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribes to nodes within a bounding box and refines the result set
 * to a true circle via Haversine. Re-subscribes whenever any of the
 * query knobs (projectId / center / radius) change.
 */
export function useGeoAnchoredNodes(
  opts: GeoQueryOptions,
): UseGeoAnchoredNodesResult {
  const { projectId, center, radiusM, objectKind, controlOnly } = opts;

  // Stable references so changing object identity in re-renders doesn't
  // tear the snapshot down on every paint.
  const centerKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
  const stableCenter = useMemo(() => ({ lat: center.lat, lng: center.lng }), [centerKey]);

  const [rawDocs, setRawDocs] = useState<RiskNode[]>([]);
  const [loading, setLoading] = useState<boolean>(!!projectId);
  const [error, setError] = useState<Error | null>(null);
  const subRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Tear down previous subscription before swapping in a new one — a
    // bare `useEffect` cleanup would still race when projectId flips.
    if (subRef.current) {
      subRef.current();
      subRef.current = null;
    }

    if (!projectId) {
      setRawDocs([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const box = boundingBox(stableCenter, radiusM);
    setLoading(true);
    setError(null);

    try {
      const q = query(
        collection(db, 'nodes'),
        where('projectId', '==', projectId),
        where('metadata.geo.lat', '>=', box.latMin),
        where('metadata.geo.lat', '<=', box.latMax),
      );

      const unsub = onSnapshot(
        q,
        (snap) => {
          const next = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskNode));
          setRawDocs(next);
          setLoading(false);
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'nodes');
          setError(err as Error);
          setLoading(false);
        },
      );
      subRef.current = unsub;
    } catch (err) {
      // Defensive: malformed query (e.g. missing composite index) throws
      // synchronously in some Firestore SDK paths.
      setError(err as Error);
      setLoading(false);
    }

    return () => {
      if (subRef.current) {
        subRef.current();
        subRef.current = null;
      }
    };
  }, [projectId, stableCenter, radiusM]);

  // Final filter pass — bounding-box → true radius + tag filters. Pure
  // memo; runs whenever the upstream snapshot or filter knobs change.
  const nodes = useMemo(() => {
    if (rawDocs.length === 0) return rawDocs;
    return rawDocs.filter((node) => {
      const geo = (node.metadata as any)?.geo as
        | { lat: number; lng: number }
        | undefined;
      if (!geo || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        return false;
      }
      const dist = haversineMeters(stableCenter, { lat: geo.lat, lng: geo.lng });
      if (dist > radiusM) return false;
      if (controlOnly && !(node.tags ?? []).includes('control-material')) {
        return false;
      }
      if (objectKind && !(node.tags ?? []).includes(objectKind)) {
        return false;
      }
      return true;
    });
  }, [rawDocs, stableCenter, radiusM, objectKind, controlOnly]);

  return { nodes, loading, error };
}
