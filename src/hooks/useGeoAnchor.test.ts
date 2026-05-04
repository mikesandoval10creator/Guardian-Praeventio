// SPDX-License-Identifier: MIT
//
// useGeoAnchor — unit tests para la conversión mesh ↔ geo.
//
// Probamos la API pura via `renderHook` no es necesario aquí: el hook
// solo envuelve `useMemo` y devuelve funciones puras. Para evitar arrastrar
// React testing library, llamamos a la implementación a través de un
// wrapper trivial.

import { describe, expect, it } from 'vitest';
import { useGeoAnchor } from './useGeoAnchor';

// Hack: useGeoAnchor solo usa `useMemo`. En tests sin renderer, podemos
// invocarlo directamente — `useMemo` desde React tiene comportamiento
// indefinido fuera de un componente, así que reimplementamos el contrato
// puro evaluando manualmente. Pero la forma más simple es evaluar las
// funciones devueltas en un componente fake. En vez de eso, expongamos
// la lógica reusable extrayéndola — pero el spec pide UN archivo. Optamos
// por test driver minimal: useMemo de React funciona en este harness
// porque los hooks SOLO se invocan a través del runtime React; podemos
// simular React mockeando `useMemo`.
import { vi } from 'vitest';

vi.mock('react', () => ({
  useMemo: <T,>(fn: () => T, _deps: unknown[]) => fn(),
}));

describe('useGeoAnchor — sin anchor', () => {
  it('hasAnchor=false y ambas conversiones devuelven null', () => {
    const api = useGeoAnchor(undefined);
    expect(api.hasAnchor).toBe(false);
    expect(api.meshToGeo({ x: 1, y: 2, z: 3 })).toBeNull();
    expect(api.geoToMesh({ lat: 0, lng: 0 })).toBeNull();
  });

  it('null explícito también da null en ambas', () => {
    const api = useGeoAnchor(null);
    expect(api.hasAnchor).toBe(false);
    expect(api.meshToGeo({ x: 1, y: 0, z: 1 })).toBeNull();
  });
});

describe('useGeoAnchor — con anchor', () => {
  const anchor = { lat: -33.45, lng: -70.65, altitudeM: 520 };

  it('origen mesh (0,0,0) mapea exactamente al anchor', () => {
    const api = useGeoAnchor(anchor);
    expect(api.hasAnchor).toBe(true);
    const geo = api.meshToGeo({ x: 0, y: 0, z: 0 });
    expect(geo).not.toBeNull();
    expect(geo!.lat).toBeCloseTo(anchor.lat, 12);
    expect(geo!.lng).toBeCloseTo(anchor.lng, 12);
    expect(geo!.altitudeM).toBeCloseTo(anchor.altitudeM, 12);
  });

  it('anchor en geo mapea al origen mesh', () => {
    const api = useGeoAnchor(anchor);
    const mesh = api.geoToMesh({ ...anchor });
    expect(mesh).not.toBeNull();
    expect(mesh!.x).toBeCloseTo(0, 6);
    expect(mesh!.y).toBeCloseTo(0, 6);
    expect(mesh!.z).toBeCloseTo(0, 6);
  });

  it('round-trip mesh → geo → mesh converge a la entrada', () => {
    const api = useGeoAnchor(anchor);
    const inputs = [
      { x: 10, y: 1.5, z: -25 },
      { x: -150, y: 0, z: 80 },
      { x: 1234, y: 12, z: -800 },
    ];
    for (const m of inputs) {
      const geo = api.meshToGeo(m);
      const back = api.geoToMesh(geo!);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(m.x, 4);
      expect(back!.y).toBeCloseTo(m.y, 6);
      expect(back!.z).toBeCloseTo(m.z, 4);
    }
  });

  it('round-trip geo → mesh → geo converge a la entrada', () => {
    const api = useGeoAnchor(anchor);
    const inputs: Array<{ lat: number; lng: number; altitudeM?: number }> = [
      { lat: -33.4505, lng: -70.6505, altitudeM: 525 },
      { lat: -33.4490, lng: -70.6510, altitudeM: 510 },
      { lat: -33.4400, lng: -70.6600, altitudeM: 530 },
    ];
    for (const g of inputs) {
      const mesh = api.geoToMesh(g);
      const back = api.meshToGeo(mesh!);
      expect(back).not.toBeNull();
      expect(back!.lat).toBeCloseTo(g.lat, 8);
      expect(back!.lng).toBeCloseTo(g.lng, 8);
      expect(back!.altitudeM).toBeCloseTo(g.altitudeM!, 4);
    }
  });

  it('sentidos: +x mesh → lng creciente; +z mesh → lat creciente; +y mesh → altitud creciente', () => {
    const api = useGeoAnchor(anchor);
    const east = api.meshToGeo({ x: 100, y: 0, z: 0 });
    const north = api.meshToGeo({ x: 0, y: 0, z: 100 });
    const up = api.meshToGeo({ x: 0, y: 50, z: 0 });
    expect(east!.lng).toBeGreaterThan(anchor.lng);
    expect(east!.lat).toBeCloseTo(anchor.lat, 12);
    expect(north!.lat).toBeGreaterThan(anchor.lat);
    expect(north!.lng).toBeCloseTo(anchor.lng, 12);
    expect(up!.altitudeM).toBeCloseTo(anchor.altitudeM + 50, 6);
  });

  it('100 m al norte produce ~9e-4° de latitud (≈ 1/111111)', () => {
    const api = useGeoAnchor(anchor);
    const geo = api.meshToGeo({ x: 0, y: 0, z: 100 });
    const expectedDeltaLat = 100 / 111_111;
    expect(geo!.lat - anchor.lat).toBeCloseTo(expectedDeltaLat, 8);
  });
});
