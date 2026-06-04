// Praeventio Guard — B1 evacuation map renderer (2026-06).
//
// Renders the REAL Digital Twin footprint and the A* evacuation route computed
// by `evacuationGrid.planEvacuationRoute` — replacing the hardcoded fake floor
// plan that `VectorialEvacuationMap` drew. Everything here is the worker's
// actual site geometry (site_geometry polygons) and their real position; the
// green route is the real shortest path around hazards, not decoration.
//
// Tap anywhere walkable to report a blocked area in real time — it re-routes.

import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { TYPE_COLORS, type SiteGeometryFeature } from '../../services/digitalTwin/siteGeometry';
import type { LngLat, EvacuationRoute, GeoBounds } from '../../services/routing/evacuationGrid';

const W = 800;
const H = 600;
const PAD = 28;

interface Projector {
  toX: (lng: number) => number;
  toY: (lat: number) => number;
  fromClient: (clientX: number, clientY: number, rect: DOMRect) => LngLat;
}

/** Build a lng/lat ↔ SVG-viewBox projector (y is flipped — north is up). */
export function makeProjector(bounds: GeoBounds): Projector {
  const spanLng = Math.max(1e-9, bounds.maxLng - bounds.minLng);
  const spanLat = Math.max(1e-9, bounds.maxLat - bounds.minLat);
  const toX = (lng: number) => PAD + ((lng - bounds.minLng) / spanLng) * (W - 2 * PAD);
  const toY = (lat: number) => H - PAD - ((lat - bounds.minLat) / spanLat) * (H - 2 * PAD);
  const fromClient = (clientX: number, clientY: number, rect: DOMRect): LngLat => {
    const vx = ((clientX - rect.left) / rect.width) * W;
    const vy = ((clientY - rect.top) / rect.height) * H;
    const lng = bounds.minLng + ((vx - PAD) / (W - 2 * PAD)) * spanLng;
    const lat = bounds.minLat + ((H - PAD - vy) / (H - 2 * PAD)) * spanLat;
    return { lng, lat };
  };
  return { toX, toY, fromClient };
}

function ringToPoints(ring: [number, number][], p: Projector): string {
  return ring.map(([lng, lat]) => `${p.toX(lng).toFixed(1)},${p.toY(lat).toFixed(1)}`).join(' ');
}

function centroid(ring: [number, number][]): [number, number] {
  const pts =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of pts) {
    sx += lng;
    sy += lat;
  }
  return [sx / Math.max(1, pts.length), sy / Math.max(1, pts.length)];
}

export interface EvacuationGridMapProps {
  features: SiteGeometryFeature[];
  bounds: GeoBounds;
  worker: LngLat | null;
  route: EvacuationRoute | null;
  blocked: LngLat[];
  /** Tap-to-report a blocked area (lng/lat of the tapped point). */
  onBlockPoint?: (p: LngLat) => void;
}

export function EvacuationGridMap({
  features,
  bounds,
  worker,
  route,
  blocked,
  onBlockPoint,
}: EvacuationGridMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const proj = makeProjector(bounds);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onBlockPoint || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    onBlockPoint(proj.fromClient(e.clientX, e.clientY, rect));
  };

  const byType = (t: SiteGeometryFeature['properties']['type']) =>
    features.filter((f) => f.properties.type === t);

  const routePoints = route
    ? route.path.map((pt) => `${proj.toX(pt.lng).toFixed(1)},${proj.toY(pt.lat).toFixed(1)}`).join(' ')
    : '';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      onClick={handleClick}
      role="img"
      aria-label="Mapa de evacuación del sitio"
      style={{ cursor: onBlockPoint ? 'crosshair' : 'default' }}
    >
      <defs>
        <pattern id="evgrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
        <marker id="ev-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#10b981" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="url(#evgrid)" />

      {/* Site boundary */}
      {byType('boundary').map((f) => (
        <polygon
          key={f.id}
          points={ringToPoints(f.geometry.coordinates[0], proj)}
          fill="rgba(255,255,255,0.02)"
          stroke={TYPE_COLORS.boundary}
          strokeWidth={2}
        />
      ))}

      {/* Buildings */}
      {byType('building').map((f) => (
        <polygon
          key={f.id}
          points={ringToPoints(f.geometry.coordinates[0], proj)}
          fill="rgba(245,158,11,0.12)"
          stroke={TYPE_COLORS.building}
          strokeWidth={1.5}
        />
      ))}

      {/* Hazard zones */}
      {byType('hazard').map((f) => {
        const [clng, clat] = centroid(f.geometry.coordinates[0]);
        return (
          <g key={f.id}>
            <polygon
              points={ringToPoints(f.geometry.coordinates[0], proj)}
              fill="rgba(239,68,68,0.18)"
              stroke={TYPE_COLORS.hazard}
              strokeWidth={1.5}
            />
            <text x={proj.toX(clng)} y={proj.toY(clat)} fill={TYPE_COLORS.hazard} fontSize={12} textAnchor="middle" fontWeight="bold">
              {f.properties.label}
            </text>
          </g>
        );
      })}

      {/* Evacuation / safe zones */}
      {byType('evacuation').map((f) => {
        const [clng, clat] = centroid(f.geometry.coordinates[0]);
        return (
          <g key={f.id}>
            <polygon
              points={ringToPoints(f.geometry.coordinates[0], proj)}
              fill="rgba(34,197,94,0.18)"
              stroke={TYPE_COLORS.evacuation}
              strokeWidth={2}
            />
            <text x={proj.toX(clng)} y={proj.toY(clat)} fill={TYPE_COLORS.evacuation} fontSize={12} textAnchor="middle" fontWeight="bold">
              {f.properties.label || 'Zona segura'}
            </text>
          </g>
        );
      })}

      {/* The REAL A* route */}
      {route && route.path.length > 1 && (
        <motion.polyline
          points={routePoints}
          fill="none"
          stroke="#10b981"
          strokeWidth={4}
          strokeLinejoin="round"
          strokeLinecap="round"
          markerEnd="url(#ev-arrow)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
        />
      )}

      {/* Exit endpoint */}
      {route && (
        <circle cx={proj.toX(route.goal.lng)} cy={proj.toY(route.goal.lat)} r={9} fill="#10b981" className="animate-pulse" />
      )}

      {/* User-reported blocked points */}
      {blocked.map((b, i) => (
        <g key={`blk-${i}`} stroke="#ef4444" strokeWidth={2.5}>
          <line x1={proj.toX(b.lng) - 6} y1={proj.toY(b.lat) - 6} x2={proj.toX(b.lng) + 6} y2={proj.toY(b.lat) + 6} />
          <line x1={proj.toX(b.lng) + 6} y1={proj.toY(b.lat) - 6} x2={proj.toX(b.lng) - 6} y2={proj.toY(b.lat) + 6} />
        </g>
      ))}

      {/* Worker (start) */}
      {worker && (
        <g>
          <circle cx={proj.toX(worker.lng)} cy={proj.toY(worker.lat)} r={12} fill="rgba(59,130,246,0.25)" className="animate-ping" />
          <circle cx={proj.toX(worker.lng)} cy={proj.toY(worker.lat)} r={7} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}
