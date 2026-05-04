// Praeventio Guard — Sprint 19 cost-opt R1.
//
// Centralized config for @react-google-maps/api loaders across the app.
//
// Why centralize: if two components request DIFFERENT libraries (or use
// different `id`s) in the same session, @react-google-maps/api re-loads
// the Maps JS, which counts as an additional map load (billing impact)
// and emits a console warning. One shared config = one load.
//
// Beneficio mantenibilidad: cambiar la lista de libraries en un solo lugar.

/**
 * Libraries cargadas por @react-google-maps/api.
 *
 * Recommended set para Praeventio (todas gratis, NO se cobran extra sobre el
 * map load):
 *   - 'drawing'  — DrawingManager (zonas en Site25D, evacuation polygons)
 *   - 'geometry' — distancias, áreas (computar distancias entre nodos)
 *
 * NO cargamos:
 *   - 'places'        → cobra por request, usa Places API HTTP server-side
 *   - 'visualization' → no usamos heatmaps todavía
 *   - 'marker'        → V3 nuevo, deferred hasta que estabilice
 */
export const MAP_LIBRARIES: ('drawing' | 'geometry')[] = ['drawing', 'geometry'];

/**
 * Loader ID. ALL useJsApiLoader hooks in the bundle MUST share this id and
 * MAP_LIBRARIES — else the Maps script re-loads and a console warning fires.
 */
export const MAP_LOADER_ID = 'praeventio-google-maps';

/**
 * Standard config helper for useJsApiLoader.
 *
 * Usage:
 *   const { isLoaded } = useJsApiLoader(getMapLoaderConfig());
 *
 * En lugar de:
 *   const { isLoaded } = useJsApiLoader({
 *     id: 'foo',
 *     googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
 *     libraries: ['drawing'],
 *   });
 */
export const getMapLoaderConfig = () => ({
  id: MAP_LOADER_ID,
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
  libraries: MAP_LIBRARIES,
});
