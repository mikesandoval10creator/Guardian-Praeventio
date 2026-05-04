// SPDX-License-Identifier: MIT
//
// useGeoAnchor — Sprint 21 Ola 3 Bucket J.4.
//
// Mapea coords del mesh ↔ lat/lng/altitudeM cuando el job de fotogrametría
// trae un `geoAnchor` (lat/lng/altitudeM) en su input.
//
// Convención mesh → mundo (alineada con Three.js + cómo arma los meshes
// `objectLifecycleOrchestrator`):
//   x → este (longitud creciente)
//   y → arriba (altitud)
//   z → norte (latitud creciente)
//
// La aproximación es local (faena ≤ 5 km × 5 km típica): trata 1° lat ≈
// 111111 m, 1° lng ≈ 111111 · cos(lat) m. No es exacta para distancias
// continentales pero es perfectamente apta para una faena.
//
// Si no hay `geoAnchor`, ambas funciones devuelven `null` — el caller
// debe hacer fallback al espacio mesh local (sin georreferencia real).

import { useMemo } from 'react';

export interface GeoAnchor {
  lat: number;
  lng: number;
  altitudeM?: number;
}

export interface MeshCoord {
  x: number;
  y: number;
  z: number;
}

export interface GeoCoord {
  lat: number;
  lng: number;
  altitudeM?: number;
}

const METERS_PER_DEG_LAT = 111_111;

export interface UseGeoAnchorApi {
  /** True cuando hay un anchor configurado. */
  hasAnchor: boolean;
  /** Mesh local → geo absoluto. `null` si no hay anchor. */
  meshToGeo: (meshPos: MeshCoord) => GeoCoord | null;
  /** Geo absoluto → mesh local. `null` si no hay anchor. */
  geoToMesh: (geo: GeoCoord) => MeshCoord | null;
}

export function useGeoAnchor(geoAnchor?: GeoAnchor | null): UseGeoAnchorApi {
  return useMemo<UseGeoAnchorApi>(() => {
    if (!geoAnchor) {
      return {
        hasAnchor: false,
        meshToGeo: () => null,
        geoToMesh: () => null,
      };
    }

    const anchorLat = geoAnchor.lat;
    const anchorLng = geoAnchor.lng;
    const anchorAlt = geoAnchor.altitudeM ?? 0;
    // Pre-computamos cos(lat) — constante para el anchor; evita recomputarlo
    // por cada conversión y mantiene la simetría meshToGeo↔geoToMesh.
    const cosLat = Math.cos((anchorLat * Math.PI) / 180);
    const metersPerDegLng = METERS_PER_DEG_LAT * cosLat;

    return {
      hasAnchor: true,
      meshToGeo(meshPos: MeshCoord): GeoCoord {
        const dLat = meshPos.z / METERS_PER_DEG_LAT;
        const dLng = metersPerDegLng !== 0 ? meshPos.x / metersPerDegLng : 0;
        return {
          lat: anchorLat + dLat,
          lng: anchorLng + dLng,
          altitudeM: anchorAlt + meshPos.y,
        };
      },
      geoToMesh(geo: GeoCoord): MeshCoord {
        const dLat = geo.lat - anchorLat;
        const dLng = geo.lng - anchorLng;
        return {
          x: dLng * metersPerDegLng,
          y: (geo.altitudeM ?? 0) - anchorAlt,
          z: dLat * METERS_PER_DEG_LAT,
        };
      },
    };
  }, [geoAnchor?.lat, geoAnchor?.lng, geoAnchor?.altitudeM]);
}
