// Sprint 13 — Digital Twin Phase A
// Firestore-bound persistence helpers for site geometry. Kept separate from
// `siteGeometry.ts` so the pure helpers remain unit-testable under node
// without pulling firebase/firestore into the test surface.
//
// Storage path:
//   tenants/{tenantId}/projects/{projectId}/site_geometry/{geomId}

import {
  db,
  collection,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
} from '../firebase';
import {
  buildFeature,
  siteGeometryPath,
  type SiteGeometryFeature,
  type SiteGeometryProps,
} from './siteGeometry';

export interface SitePolygonRecord {
  id: string;
  type: SiteGeometryFeature['properties']['type'];
  label: string;
  heightM: number;
  notes?: string;
  /** Outer ring as [lng, lat] pairs (closed). */
  coordinates: [number, number][];
  updatedAt?: unknown;
}

/**
 * Persist a polygon under `tenants/{}/projects/{}/site_geometry/{geomId}`.
 * Returns the feature so the caller can update local state optimistically.
 */
export async function savePolygon(
  tenantId: string,
  projectId: string,
  props: SiteGeometryProps,
  ring: [number, number][],
): Promise<SiteGeometryFeature> {
  const feature = buildFeature(props, ring);
  const path = `${siteGeometryPath(tenantId, projectId)}/${props.id}`;
  const record: SitePolygonRecord = {
    id: props.id,
    type: props.type,
    label: props.label,
    heightM: props.heightM,
    notes: props.notes,
    coordinates: feature.geometry.coordinates[0],
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, path), record);
  return feature;
}

/** Re-hydrate a Firestore record into the GeoJSON feature shape. */
export function recordToFeature(rec: SitePolygonRecord): SiteGeometryFeature {
  return buildFeature(
    {
      id: rec.id,
      label: rec.label,
      type: rec.type,
      heightM: rec.heightM,
      notes: rec.notes,
    },
    rec.coordinates,
  );
}

/**
 * Live subscription to a project's site_geometry collection. Returns the
 * unsubscribe function so React effects can clean up.
 */
export function subscribeSiteGeometry(
  tenantId: string,
  projectId: string,
  onChange: (features: SiteGeometryFeature[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = collection(db, siteGeometryPath(tenantId, projectId));
  return onSnapshot(
    ref,
    (snap) => {
      const features: SiteGeometryFeature[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as SitePolygonRecord;
          features.push(recordToFeature({ ...data, id: d.id }));
        } catch {
          // Skip degenerate or malformed records — pure builder throws on
          // invalid rings; we don't want one bad doc to nuke the whole map.
        }
      });
      onChange(features);
    },
    (err) => onError?.(err as Error),
  );
}
