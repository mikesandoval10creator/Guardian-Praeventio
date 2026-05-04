// Sprint 13 — Digital Twin Phase A
// Hazmat wind-suction overlay. For each `hazard` polygon, computes a
// downwind risk halo using `bernoulliEngine.windLoadOnSurface` (via the
// `projectWindSuction` helper in siteGeometry.ts). Wind data is read from
// `UniversalKnowledgeContext` so the cone updates live as the weather
// snapshot refreshes (every 15 min via the orchestrator).

import React, { useEffect, useMemo } from 'react';
import { Circle, Polyline } from '@react-google-maps/api';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import {
  projectWindSuction,
  ringCentroid,
  type SiteGeometryFeature,
} from '../../services/digitalTwin/siteGeometry';
import { useProject } from '../../contexts/ProjectContext';
import { generateGasLeakNode } from '../../services/zettelkasten/bernoulli/gasLeakDetection';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';

interface Props {
  features: SiteGeometryFeature[];
}

/**
 * Estimates a hazard footprint area from its polygon ring (m²) using a
 * spherical-Earth equirectangular approximation. We avoid pulling Turf.js
 * (no new deps) — accuracy is fine at site scale (<500 m extents) and the
 * value only feeds a halo radius, not a regulatory metric.
 */
function approxRingAreaM2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  // Convert to local metres around the centroid.
  const [cLng, cLat] = ringCentroid(ring);
  const latRad = (cLat * Math.PI) / 180;
  const mPerDegLat = 111_000;
  const mPerDegLng = 111_000 * Math.max(0.01, Math.cos(latRad));
  const pts = ring.map(([lng, lat]) => [
    (lng - cLng) * mPerDegLng,
    (lat - cLat) * mPerDegLat,
  ]);
  // Shoelace formula.
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function HazmatWindOverlay({ features }: Props): React.ReactElement | null {
  const { environment } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const weather = environment?.weather ?? null;
  const windKmh = weather?.windSpeed ?? 0;
  // Bucket B.2 — gas leak Bernoulli check. Uses each hazmat hazard polygon as
  // a synthetic two-point pipe network; if a sensor concentration exceeds the
  // leak tolerance the generator emits a node. Threshold is internal to the
  // generator (15% over expected friction loss).
  const gasSensorConcentrationPpm = (weather as unknown as { gasConcentrationPpm?: number })?.gasConcentrationPpm ?? 0;
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) return;
    if (gasSensorConcentrationPpm <= 0) return;
    // Velocity proxy from wind speed (m/s). Higher concentration → larger pressure drop.
    const vMs = Math.max(0.1, windKmh / 3.6);
    const nodes = features
      .filter((f) => f.properties.type === 'hazard')
      .map((f) => generateGasLeakNode(
        { id: `${f.id}-A`, pressurePa: 200_000, velocityMs: vMs, heightM: 0 },
        { id: `${f.id}-B`, pressurePa: 180_000, velocityMs: vMs * (1 + gasSensorConcentrationPpm / 1000), heightM: 0 },
        { id: 'GLP', densityKgM3: 2.0, expectedFrictionLossJKg: 50, lelVolPercent: 1.8 },
      ))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    if (nodes.length > 0) writeNodesDebounced(nodes, { projectId });
  }, [features, gasSensorConcentrationPpm, windKmh, selectedProject?.id]);
  // WeatherData currently doesn't carry windDirection — fall back to the
  // optional `metadata` shape some upstream sources provide. Treat missing
  // direction as "draw a symmetric halo".
  const windDirectionDeg = (weather as unknown as { windDirection?: number })
    ?.windDirection;

  const overlays = useMemo(() => {
    return features
      .filter((f) => f.properties.type === 'hazard')
      .map((f) => {
        const ring = f.geometry.coordinates[0];
        const centroid = ringCentroid(ring);
        const areaM2 = approxRingAreaM2(ring);
        // Use a reasonable exposed-surface fraction (front face of stored
        // hazmat). 0.4 × footprint area is a conservative phase-A heuristic.
        const exposedAreaM2 = Math.max(1, areaM2 * 0.4);
        const overlay = projectWindSuction({
          centroid,
          windSpeedKmh: windKmh,
          windDirectionDeg,
          exposedAreaM2,
          pressureCoeff: 0.8, // spec: windLoadOnSurface(area, vMs, 0.8)
        });
        return { id: f.id, centroid, ...overlay };
      });
  }, [features, windKmh, windDirectionDeg]);

  if (overlays.length === 0) return null;

  return (
    <>
      {overlays.map((o) => (
        <React.Fragment key={`hazmat-${o.id}`}>
          {/* Translucent risk halo (downwind) */}
          <Circle
            center={{ lat: o.downwindAnchor[1], lng: o.downwindAnchor[0] }}
            radius={o.hotZoneRadiusM}
            options={{
              strokeColor: '#dc2626',
              strokeOpacity: 0.6,
              strokeWeight: 1,
              fillColor: '#ef4444',
              fillOpacity: 0.18,
              clickable: false,
              zIndex: 1,
            }}
          />
          {/* Wind direction line: hazard centroid → downwind anchor */}
          <Polyline
            path={[
              { lat: o.centroid[1], lng: o.centroid[0] },
              { lat: o.downwindAnchor[1], lng: o.downwindAnchor[0] },
            ]}
            options={{
              strokeColor: '#fca5a5',
              strokeOpacity: 0.85,
              strokeWeight: 2,
              icons: [
                {
                  icon: { path: 1 /* google.maps.SymbolPath.FORWARD_OPEN_ARROW */ },
                  offset: '100%',
                },
              ],
            }}
          />
        </React.Fragment>
      ))}
    </>
  );
}

export default HazmatWindOverlay;
