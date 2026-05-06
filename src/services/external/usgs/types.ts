// USGS Earthquake feed adapter — type definitions.
//
// Same directiva 4 caveat as EONET: do NOT leak the source organism
// (USGS) into user-facing recommendation copy.

import { z } from 'zod';

export const UsgsEarthquakePropertiesSchema = z.object({
  mag: z.number().nullable().optional(),
  place: z.string().nullable().optional(),
  time: z.number(),
  updated: z.number().nullable().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
});

export const UsgsEarthquakeGeometrySchema = z.object({
  type: z.literal('Point'),
  // [lon, lat, depthKm]
  coordinates: z.array(z.number()).min(2),
});

export const UsgsEarthquakeFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  properties: UsgsEarthquakePropertiesSchema,
  geometry: UsgsEarthquakeGeometrySchema,
});

export const UsgsEarthquakeFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(UsgsEarthquakeFeatureSchema),
});

export type UsgsEarthquake = z.infer<typeof UsgsEarthquakeFeatureSchema>;
export type UsgsEarthquakeFeatureCollection = z.infer<
  typeof UsgsEarthquakeFeatureCollectionSchema
>;
