// Praeventio Guard — Sprint 39 Fase C.5: números de emergencia país-aware.
//
// Cuando el botón SOS se activa, mostrar AUTOMÁTICAMENTE en pantalla los
// 3 números del país detectado (ambulancia/bomberos/policía), no solo
// como listado estático en la página /emergency. Si no hay GPS o el país
// no está en la tabla, fallback a Chile (mercado primario).
//
// Determinístico, sin LLM. Tabla canónica curada manualmente — agregar
// países nuevos es 1 entry. Bounding boxes aproximados (lat/lng) para
// reverse-lookup sin geocoding remoto.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface EmergencyNumbers {
  /** Código ISO-3166 alpha-2 (en mayúsculas). */
  regionCode: string;
  /** Nombre del país (para UI). */
  countryName: string;
  /** Número de servicio médico. */
  medical: string;
  /** Bomberos. */
  fire: string;
  /** Policía. */
  police: string;
  /** Número universal alternativo (si existe). */
  universal?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface CountryRecord extends EmergencyNumbers {
  /** Bounding box aproximado [latMin, latMax, lngMin, lngMax]. */
  bbox: [number, number, number, number];
}

// ────────────────────────────────────────────────────────────────────────
// Catalog (extensible — agregar país = 1 entry)
// ────────────────────────────────────────────────────────────────────────

/**
 * Lista curada de los países donde Praeventio opera o se planea operar.
 * Bounding boxes son aproximados — sirven para reverse-lookup barato
 * cuando hay GPS pero no servicio de reverse-geocoding. Si dos boxes
 * superponen (zonas fronterizas), gana el primero declarado.
 */
const COUNTRIES: readonly CountryRecord[] = [
  {
    regionCode: 'CL',
    countryName: 'Chile',
    medical: '131',
    fire: '132',
    police: '133',
    universal: '112',
    bbox: [-56, -17.5, -75.7, -66.4],
  },
  {
    regionCode: 'AR',
    countryName: 'Argentina',
    medical: '107',
    fire: '100',
    police: '911',
    universal: '911',
    bbox: [-55, -21.8, -73.6, -53.6],
  },
  {
    regionCode: 'PE',
    countryName: 'Perú',
    medical: '106',
    fire: '116',
    police: '105',
    universal: '911',
    bbox: [-18.4, -0.05, -81.4, -68.7],
  },
  {
    regionCode: 'BO',
    countryName: 'Bolivia',
    medical: '118',
    fire: '119',
    police: '110',
    bbox: [-22.9, -9.7, -69.6, -57.5],
  },
  {
    regionCode: 'MX',
    countryName: 'México',
    medical: '911',
    fire: '911',
    police: '911',
    universal: '911',
    bbox: [14.5, 32.7, -117.1, -86.7],
  },
  {
    regionCode: 'CO',
    countryName: 'Colombia',
    medical: '125',
    fire: '119',
    police: '123',
    universal: '123',
    bbox: [-4.2, 12.5, -79, -66.9],
  },
  {
    regionCode: 'US',
    countryName: 'Estados Unidos',
    medical: '911',
    fire: '911',
    police: '911',
    universal: '911',
    bbox: [18.9, 71.4, -179.1, -66.9],
  },
  {
    regionCode: 'CA',
    countryName: 'Canadá',
    medical: '911',
    fire: '911',
    police: '911',
    universal: '911',
    bbox: [41.7, 83.1, -141, -52.6],
  },
  {
    regionCode: 'BR',
    countryName: 'Brasil',
    medical: '192',
    fire: '193',
    police: '190',
    bbox: [-33.7, 5.3, -73.9, -34.7],
  },
  // Unión Europea (común a la mayoría)
  {
    regionCode: 'EU',
    countryName: 'Unión Europea',
    medical: '112',
    fire: '112',
    police: '112',
    universal: '112',
    bbox: [35.9, 71.2, -10.5, 31.6],
  },
];

const CHILE_FALLBACK: EmergencyNumbers = {
  regionCode: 'CL',
  countryName: 'Chile',
  medical: '131',
  fire: '132',
  police: '133',
  universal: '112',
};

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Devuelve los números de emergencia del país que contiene el punto GPS
 * dado. Si ningún país matchea (mar abierto, Antártida, error de GPS),
 * devuelve el fallback Chile.
 *
 * Algoritmo: lookup lineal en bbox (10-30 países, irrelevante para perf).
 * Si dos bboxes se solapan (frontera), gana el primero declarado.
 */
export function getEmergencyNumbersByCoords(point: GeoPoint): EmergencyNumbers {
  for (const country of COUNTRIES) {
    const [latMin, latMax, lngMin, lngMax] = country.bbox;
    if (
      point.lat >= latMin &&
      point.lat <= latMax &&
      point.lng >= lngMin &&
      point.lng <= lngMax
    ) {
      const { bbox: _bbox, ...rest } = country;
      return rest;
    }
  }
  return CHILE_FALLBACK;
}

/**
 * Lookup directo por código ISO 3166 alpha-2 (case-insensitive). Más
 * confiable que GPS si el caller tiene el dato del perfil del proyecto.
 */
export function getEmergencyNumbersByRegion(regionCode: string): EmergencyNumbers {
  const upper = regionCode.trim().toUpperCase();
  const country = COUNTRIES.find((c) => c.regionCode === upper);
  if (!country) return CHILE_FALLBACK;
  const { bbox: _bbox, ...rest } = country;
  return rest;
}

/**
 * Devuelve la lista de países conocidos (para selector manual en UI
 * cuando no hay GPS ni región configurada).
 */
export function listSupportedCountries(): EmergencyNumbers[] {
  return COUNTRIES.map(({ bbox: _bbox, ...rest }) => rest);
}

/**
 * Construye un `tel:` URI seguro para link clickeable. Filtra cualquier
 * caracter que no sea dígito, asterisco, almohadilla o `+` (para evitar
 * tel-injection si el dato viene mal sanitizado).
 */
export function toTelUri(number: string): string {
  const sanitized = number.replace(/[^0-9*#+]/g, '');
  return `tel:${sanitized}`;
}
