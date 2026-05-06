// External natural-event feed adapter — type definitions.
//
// IMPORTANT (directiva 4 — recomendación tranquila):
//   The "source organism" of these events (NASA EONET) is treated as
//   metadata; it MUST NOT bleed into user-facing recommendation copy.
//   See `recommendationBuilder.ts` for body sanitisation rules.

import { z } from 'zod';

export type EonetCategory =
  | 'wildfires'
  | 'severeStorms'
  | 'volcanoes'
  | 'seaLakeIce'
  | 'floods'
  | 'manmade'
  | 'landslides'
  | 'drought';

export const EONET_CATEGORIES: ReadonlyArray<EonetCategory> = [
  'wildfires',
  'severeStorms',
  'volcanoes',
  'seaLakeIce',
  'floods',
  'manmade',
  'landslides',
  'drought',
];

export interface BBox {
  /** western longitude (left) */
  lonMin: number;
  /** northern latitude (top) */
  latMax: number;
  /** eastern longitude (right) */
  lonMax: number;
  /** southern latitude (bottom) */
  latMin: number;
}

// EONET v3 geometry: a single event can have several time-stamped points or
// polygons. We accept either a [lon, lat] tuple or any nested coordinate array
// (polygons), validated loosely so we don't reject upstream variants.
export const EonetGeometrySchema = z.object({
  date: z.string(),
  type: z.string(),
  // coordinates can be number[] (Point) or number[][] / number[][][] (Polygon)
  coordinates: z.unknown(),
});

export const EonetCategoryRefSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
});

export const EonetSourceRefSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
});

export const EonetEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  link: z.string().optional(),
  closed: z.string().nullable().optional(),
  categories: z.array(EonetCategoryRefSchema).default([]),
  sources: z.array(EonetSourceRefSchema).default([]),
  geometry: z.array(EonetGeometrySchema).default([]),
});

export const EonetResponseSchema = z.object({
  events: z.array(EonetEventSchema),
});

export type EonetEvent = z.infer<typeof EonetEventSchema>;
export type EonetResponse = z.infer<typeof EonetResponseSchema>;
