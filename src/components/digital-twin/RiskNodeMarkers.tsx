// Sprint 13 — Digital Twin Phase A
// Risk node markers: subscribes to `tenants/{}/zettelkasten_nodes` filtered
// by projectId (limit 100, ordered by createdAt desc). Severity-coloured
// pins with click → bottom-sheet description.
//
// If the Sprint 11 zettelkasten_nodes collection isn't populated yet, this
// renders nothing and logs a debug message. No fake data fallback.

import React, { useEffect, useState } from 'react';
import { Marker, InfoWindow } from '@react-google-maps/api';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  db,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from '../../services/firebase';
import { severityColor } from '../../services/digitalTwin/siteGeometry';
import { logger } from '../../utils/logger';

interface RiskNodeDoc {
  id: string;
  title: string;
  description?: string;
  severity?: string;
  /** Optional `[lng, lat]` position. Some nodes carry only a textual location. */
  coordinates?: { lat: number; lng: number };
  metadata?: Record<string, unknown>;
}

interface Props {
  tenantId: string;
  projectId: string;
}

/**
 * Best-effort severity extractor: zettelkasten nodes vary — some store
 * `severity` at the top level, others under `metadata.severity` or
 * `metadata.riskLevel`.
 */
function pickSeverity(doc: RiskNodeDoc): string | undefined {
  if (doc.severity) return doc.severity;
  const m = doc.metadata ?? {};
  return (
    (m.severity as string | undefined) ??
    (m.riskLevel as string | undefined) ??
    undefined
  );
}

function pickCoords(doc: RiskNodeDoc): { lat: number; lng: number } | null {
  if (
    doc.coordinates &&
    typeof doc.coordinates.lat === 'number' &&
    typeof doc.coordinates.lng === 'number'
  ) {
    return doc.coordinates;
  }
  const m = doc.metadata ?? {};
  const lat = (m.lat ?? (m.coordinates as any)?.lat) as number | undefined;
  const lng = (m.lng ?? (m.coordinates as any)?.lng) as number | undefined;
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  return null;
}

export function RiskNodeMarkers({ tenantId, projectId }: Props): React.ReactElement | null {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<RiskNodeDoc[]>([]);
  const [active, setActive] = useState<RiskNodeDoc | null>(null);

  useEffect(() => {
    // TODO(sprint-11): once the persistence wiring lands, we may need to
    // adjust the path to include tenantId as a prefix. For now we follow
    // the spec exactly: `tenants/{tenantId}/zettelkasten_nodes`.
    const ref = collection(db, `tenants/${tenantId}/zettelkasten_nodes`);
    let q;
    try {
      q = query(
        ref,
        where('projectId', '==', projectId),
        orderBy('createdAt', 'desc'),
        limit(100),
      );
    } catch (err) {
      logger.error('RiskNodeMarkers query build failed', { err: String(err) });
      return undefined;
    }
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr: RiskNodeDoc[] = [];
        snap.forEach((d) => {
          arr.push({ id: d.id, ...(d.data() as Omit<RiskNodeDoc, 'id'>) });
        });
        setNodes(arr);
      },
      (err) => {
        // Sprint 11 may not have shipped persistence yet — degrade silently.
        logger.debug?.('zettelkasten_nodes subscription empty/error', {
          err: String(err),
        });
        setNodes([]);
      },
    );
    return unsub;
  }, [tenantId, projectId]);

  const positioned = nodes
    .map((n) => ({ node: n, pos: pickCoords(n) }))
    .filter((x): x is { node: RiskNodeDoc; pos: { lat: number; lng: number } } =>
      x.pos !== null,
    );

  if (positioned.length === 0) return null;

  return (
    <>
      {positioned.map(({ node, pos }) => {
        const sev = pickSeverity(node);
        const color = severityColor(sev);
        return (
          <Marker
            key={node.id}
            position={pos}
            onClick={() => setActive(node)}
            title={node.title}
            icon={{
              path: 0 /* google.maps.SymbolPath.CIRCLE */,
              scale: 8,
              fillColor: color,
              fillOpacity: 0.95,
              strokeColor: '#0a0a0a',
              strokeWeight: 1.5,
            }}
          />
        );
      })}

      {active && pickCoords(active) && (
        <InfoWindow
          position={pickCoords(active)!}
          onCloseClick={() => setActive(null)}
        >
          <div className="max-w-[260px] text-zinc-900">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black uppercase tracking-wide">
                {active.title}
              </p>
              <button
                aria-label={t('common.close')}
                onClick={() => setActive(null)}
                className="text-zinc-500 hover:text-zinc-800"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            {active.description && (
              <p className="text-[11px] mt-1 text-zinc-700 leading-snug">
                {active.description}
              </p>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export default RiskNodeMarkers;
