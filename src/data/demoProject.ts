// Sprint 26 — Bucket YY.4 — Demo project sintético (ADR 0011)
//
// Este project es público (skipea Gate 3 biometric) para que prospectos
// puedan ver el twin sin onboarding. Los Gates 1+2 (auth + email
// verificado) siguen aplicando.
//
// La verificación `isDemoProject(id)` se inyecta en el `useTwinAccess`
// hook como faker — el hook detecta el demo project y pasa por el branch
// "granted" sin pedir biometric.

export const DEMO_PROJECT_ID = 'demo-faena-praeventio';

/** Polígonos GeoJSON de la faena demo. lng/lat en orden (GeoJSON). */
const DEMO_POLYGONS: Array<{
  id: string;
  label: string;
  type: 'boundary' | 'building' | 'hazard' | 'evacuation' | 'parking';
  coords: [number, number][];
}> = [
  {
    id: 'demo-boundary',
    label: 'Perímetro faena',
    type: 'boundary',
    coords: [
      [-70.6605, -33.4505],
      [-70.6595, -33.4505],
      [-70.6595, -33.4495],
      [-70.6605, -33.4495],
      [-70.6605, -33.4505],
    ],
  },
  {
    id: 'demo-warehouse',
    label: 'Bodega central',
    type: 'building',
    coords: [
      [-70.6603, -33.4503],
      [-70.6600, -33.4503],
      [-70.6600, -33.4500],
      [-70.6603, -33.4500],
      [-70.6603, -33.4503],
    ],
  },
  {
    id: 'demo-tank',
    label: 'Tanque combustible',
    type: 'hazard',
    coords: [
      [-70.6598, -33.4502],
      [-70.6596, -33.4502],
      [-70.6596, -33.4500],
      [-70.6598, -33.4500],
      [-70.6598, -33.4502],
    ],
  },
  {
    id: 'demo-office',
    label: 'Oficinas',
    type: 'building',
    coords: [
      [-70.6603, -33.4499],
      [-70.6600, -33.4499],
      [-70.6600, -33.4497],
      [-70.6603, -33.4497],
      [-70.6603, -33.4499],
    ],
  },
];

/** Objetos placeable demo: extintores, hidrantes, puntos de reunión. */
const DEMO_PLACED_OBJECTS = [
  { id: 'demo-ext-1', kind: 'extintor', position: { x: 2, y: 1, z: 1 } },
  { id: 'demo-ext-2', kind: 'extintor', position: { x: -2, y: 1, z: 1 } },
  { id: 'demo-ext-3', kind: 'extintor', position: { x: 0, y: 1, z: 4 } },
  { id: 'demo-hidrante-1', kind: 'hidrante', position: { x: 5, y: 1, z: 3 } },
  { id: 'demo-hidrante-2', kind: 'hidrante', position: { x: -5, y: 1, z: -3 } },
  { id: 'demo-punto-reunion', kind: 'puntoReunion', position: { x: 0, y: 1, z: -6 } },
  { id: 'demo-botiquin', kind: 'botiquin', position: { x: 3, y: 1, z: -1 } },
  { id: 'demo-ducha', kind: 'duchaEmergencia', position: { x: -3, y: 1, z: 2 } },
] as const;

export const DEMO_PROJECT = {
  id: DEMO_PROJECT_ID,
  __demo__: true as const,
  name: 'Faena Demo Praeventio',
  geometry: {
    polygons: DEMO_POLYGONS,
  },
  placedObjects: DEMO_PLACED_OBJECTS,
  outdoor: true,
  workTypes: ['mining', 'general'] as const,
  geo: { lat: -33.45, lng: -70.66 }, // Santiago
  supervisorUids: ['demo-supervisor'] as const,
} as const;

/** Verificación que un projectId apunta al demo. */
export function isDemoProject(id: string): boolean {
  return id === DEMO_PROJECT_ID;
}
