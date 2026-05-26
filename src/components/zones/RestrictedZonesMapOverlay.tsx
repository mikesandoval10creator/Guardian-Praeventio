// Praeventio Guard — Restricted Zones Map Overlay (Sprint 39 wire #3.4).
//
// Renders polygons for each restricted zone over a Google Maps base. Colors
// (red / amber / sky) map to zone "severity tier" derived from kind. Built
// on top of `@react-google-maps/api` and the shared `getMapLoaderConfig()`
// helper used by Site25DPanel — no new map-loader bootstrap, no extra
// npm deps.
//
// Founder directive — informational, not enforcing:
//   This overlay shows where restricted zones ARE. It does not gate any
//   action. Clicking a zone opens a per-zone summary; entry into the zone
//   is acknowledged separately through <ZoneEntryGate /> (the modal that
//   logs the worker's informed-entry event without blocking).
//
// Data source: `useRestrictedZones`'s `listRestrictedZonesBySite()` wrapper.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GoogleMap,
  useJsApiLoader,
  Polygon,
  Marker,
  InfoWindow,
} from '@react-google-maps/api';
import { MapPin, ShieldAlert, Loader2 } from 'lucide-react';
import { getMapLoaderConfig } from '../maps/mapConfig';
import {
  listRestrictedZonesBySite,
} from '../../hooks/useRestrictedZones';
import type {
  RestrictedZone,
  ZoneKind,
} from '../../services/zones/restrictedZonesEngine';
import { logger } from '../../utils/logger';

interface RestrictedZonesMapOverlayProps {
  projectId: string;
  /**
   * Center coords for the map when there is no zone data yet (or zones
   * lack perimeter). Defaults to a Santiago-CL fallback, matching the
   * convention used by Site25DPanel.
   */
  defaultCenter?: { lat: number; lng: number };
  /** Optional click handler — fires with the clicked zone. */
  onZoneClick?: (zone: RestrictedZone) => void;
  /** Optional minHeight override for embed contexts. */
  minHeight?: string;
}

const SANTIAGO_CENTER = { lat: -33.45, lng: -70.66 };

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '420px',
};

/**
 * Severity → color tier. Red for high-energy / life-safety; amber for
 * medium; sky for traffic / advisory. Aligns with the teal/red/amber
 * project palette and respects dark-mode contrast.
 */
type SeverityTier = 'high' | 'medium' | 'advisory';

function severityFor(kind: ZoneKind): SeverityTier {
  switch (kind) {
    case 'atex':
    case 'high_voltage':
    case 'biohazard':
    case 'exclusion':
      return 'high';
    case 'hot':
    case 'confined':
    case 'lifting':
      return 'medium';
    case 'heavy_traffic':
    default:
      return 'advisory';
  }
}

const TIER_COLORS: Record<SeverityTier, string> = {
  // Tailwind rose-500 / amber-500 / sky-500 hexes (kept inline because
  // Google Maps PolygonOptions wants raw color strings, not CSS classes).
  high: '#f43f5e',
  medium: '#f59e0b',
  advisory: '#0ea5e9',
};

const TIER_LABELS: Record<SeverityTier, string> = {
  high: 'Alto',
  medium: 'Medio',
  advisory: 'Advertencia',
};

function polygonOptionsFor(kind: ZoneKind): google.maps.PolygonOptions {
  const color = TIER_COLORS[severityFor(kind)];
  return {
    strokeColor: color,
    strokeOpacity: 0.95,
    strokeWeight: 2,
    fillColor: color,
    fillOpacity: 0.22,
    clickable: true,
  };
}

function centroidOf(perimeter: Array<[number, number]>): { lat: number; lng: number } {
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of perimeter) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / perimeter.length, lng: sumLng / perimeter.length };
}

export function RestrictedZonesMapOverlay({
  projectId,
  defaultCenter = SANTIAGO_CENTER,
  onZoneClick,
  minHeight,
}: RestrictedZonesMapOverlayProps): React.ReactElement {
  const { t } = useTranslation();
  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  const [zones, setZones] = useState<RestrictedZone[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listRestrictedZonesBySite(projectId)
      .then((resp) => {
        if (cancelled) return;
        setZones(resp.zones);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        logger.error('restricted_zones overlay fetch failed', { err: String(err) });
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Center: first zone with perimeter, or fallback.
  const center = useMemo(() => {
    const zoneWithPerimeter = zones.find(
      (z) => Array.isArray(z.perimeter) && z.perimeter.length >= 3,
    );
    if (zoneWithPerimeter && zoneWithPerimeter.perimeter) {
      return centroidOf(zoneWithPerimeter.perimeter);
    }
    return defaultCenter;
  }, [zones, defaultCenter]);

  const handlePolygonClick = useCallback(
    (zone: RestrictedZone) => {
      setActiveZoneId(zone.id);
      onZoneClick?.(zone);
    },
    [onZoneClick],
  );

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) ?? null,
    [zones, activeZoneId],
  );

  // Tier summary for the legend chip — count zones per tier.
  const tierCounts = useMemo(() => {
    const counts: Record<SeverityTier, number> = { high: 0, medium: 0, advisory: 0 };
    for (const z of zones) counts[severityFor(z.kind)] += 1;
    return counts;
  }, [zones]);

  if (!isLoaded) {
    return (
      <div
        className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400"
        style={{ minHeight: minHeight ?? '420px' }}
      >
        <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
        <span className="text-xs">
          {t('restrictedZones.loadingMap', 'Cargando mapa de zonas…')}
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full"
      style={{ minHeight: minHeight ?? '420px' }}
      data-testid="restricted-zones-map-overlay"
    >
      <GoogleMap
        mapContainerStyle={
          minHeight ? { ...containerStyle, minHeight } : containerStyle
        }
        center={center}
        zoom={16}
        tilt={0}
        mapTypeId="hybrid"
        options={{
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false,
        }}
      >
        {zones.map((zone) => {
          if (!zone.perimeter || zone.perimeter.length < 3) return null;
          const path = zone.perimeter.map(([lng, lat]) => ({ lat, lng }));
          return (
            <Polygon
              key={zone.id}
              paths={path}
              options={polygonOptionsFor(zone.kind)}
              onClick={() => handlePolygonClick(zone)}
            />
          );
        })}

        {zones.map((zone) => {
          if (!zone.perimeter || zone.perimeter.length < 3) return null;
          const c = centroidOf(zone.perimeter);
          const color = TIER_COLORS[severityFor(zone.kind)];
          return (
            <Marker
              key={`marker-${zone.id}`}
              position={c}
              icon={{
                path: 0, // google.maps.SymbolPath.CIRCLE — resolved at runtime
                fillColor: color,
                fillOpacity: 0.95,
                strokeColor: '#ffffff',
                strokeWeight: 2,
                scale: 6,
              }}
              onClick={() => handlePolygonClick(zone)}
            />
          );
        })}

        {activeZone &&
          activeZone.perimeter &&
          activeZone.perimeter.length >= 3 && (
            <InfoWindow
              position={centroidOf(activeZone.perimeter)}
              onCloseClick={() => setActiveZoneId(null)}
            >
              <div className="text-xs">
                <p className="font-bold mb-1">{activeZone.name}</p>
                <p className="text-zinc-600">
                  {t('restrictedZones.kind', 'Tipo')}: {activeZone.kind}
                </p>
                <p className="text-zinc-600">
                  {t('restrictedZones.severity', 'Severidad')}:{' '}
                  {TIER_LABELS[severityFor(activeZone.kind)]}
                </p>
                {activeZone.rules.requiredEpp.length > 0 && (
                  <p className="text-zinc-600 mt-1">
                    EPP: {activeZone.rules.requiredEpp.join(', ')}
                  </p>
                )}
              </div>
            </InfoWindow>
          )}
      </GoogleMap>

      {/* Header chip — non-blocking informational */}
      <div
        className="absolute top-3 left-3 rounded-xl border border-white/10 bg-black/75 dark:bg-black/80 p-3 backdrop-blur-md max-w-[220px]"
        data-testid="restricted-zones-overlay-header"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <MapPin className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
          <p className="text-[10px] font-black text-zinc-200 uppercase tracking-widest">
            {t('restrictedZones.title', 'Zonas restringidas')}
          </p>
        </div>
        {loading && (
          <p className="text-[10px] text-zinc-400">
            {t('restrictedZones.loading', 'Cargando zonas…')}
          </p>
        )}
        {error && (
          <p className="text-[10px] text-rose-400 font-bold">{error}</p>
        )}
        {!loading && !error && zones.length === 0 && (
          <p className="text-[10px] text-zinc-400">
            {t(
              'restrictedZones.empty',
              'Aún no hay zonas restringidas definidas para este sitio.',
            )}
          </p>
        )}
        {!loading && zones.length > 0 && (
          <p className="text-[10px] text-zinc-300">
            {zones.length}{' '}
            {t('restrictedZones.zonesFound', 'zonas activas')}
          </p>
        )}
      </div>

      {/* Legend — severity tier swatches */}
      <div
        className="absolute bottom-3 left-3 rounded-xl border border-white/10 bg-black/75 dark:bg-black/80 p-3 backdrop-blur-md"
        data-testid="restricted-zones-overlay-legend"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <ShieldAlert className="w-3 h-3 text-amber-400" aria-hidden="true" />
          <p className="text-[9px] font-black text-zinc-300 uppercase tracking-widest">
            {t('restrictedZones.legend', 'Leyenda')}
          </p>
        </div>
        <div className="space-y-1">
          {(['high', 'medium', 'advisory'] as SeverityTier[]).map((tier) => (
            <div
              key={tier}
              className="flex items-center gap-2 text-[10px] text-zinc-300"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: TIER_COLORS[tier] }}
                aria-hidden="true"
              />
              <span className="flex-1">{TIER_LABELS[tier]}</span>
              <span className="font-bold tabular-nums text-zinc-400">
                {tierCounts[tier]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RestrictedZonesMapOverlay;
