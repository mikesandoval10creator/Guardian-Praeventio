// Praeventio Guard — AR Quick Look fallback para iOS Safari.
//
// Safari iOS NO soporta WebXR. Apple expone AR via "Quick Look": un
// `<a href="model.usdz" rel="ar">` tag que al ser clickeado lanza el
// viewer nativo de iOS (ARKit) con un .usdz embebido. Es read-only
// (sin interacción ni hit-test custom), pero suficiente para "mostrar
// este extintor en mi cocina" o "previsualizar la salida de emergencia".
//
// Esta capa decide:
//   - Si Quick Look está disponible (combinación de browser features)
//   - Qué .usdz mostrar para cada `ArMarkerKind`
//   - Cómo construir el `<a>` tag con los attrs canónicos
//     (apple-payment-button, etc.)
//
// Pure / DOM-less — solo strings + objetos. El caller pasa el resultado
// a un componente React que renderiza el `<a>` tag.

import type { ArMarkerKind } from './arHitTest.js';

/**
 * Catálogo de .usdz hosted bajo `/models/ar/`. Cada marker tiene un
 * fallback Quick Look correspondiente. Si el marker no tiene .usdz
 * (todavía no procurado), devolvemos null y el caller debe esconder
 * el botón Quick Look para ese marker.
 *
 * Las URLs son relativas porque queremos que el SW las cachee
 * (`/models/*` runtime cache rule del PR #244).
 */
const USDZ_CATALOG: Record<ArMarkerKind, string | null> = {
  hazard_label: '/models/ar/hazard_label.usdz',
  evacuation_route: '/models/ar/evacuation_route.usdz',
  assembly_point: '/models/ar/assembly_point.usdz',
  extinguisher: '/models/ar/extinguisher_pqs.usdz',
  first_aid: '/models/ar/first_aid.usdz',
  restricted_zone: '/models/ar/restricted_zone.usdz',
  measurement_probe: null, // no asset todavía — mostrar 2D fallback
  note: null, // anotación libre — Quick Look no aplica
};

/**
 * Para algunos markers (extinguisher) existe variante CO2 vs PQS — el
 * caller pasa un sub-kind opcional.
 */
const VARIANT_OVERRIDES: Record<string, string> = {
  'extinguisher:co2': '/models/ar/extinguisher_co2.usdz',
  'extinguisher:pqs': '/models/ar/extinguisher_pqs.usdz',
};

export interface ArQuickLookConfig {
  /** True si el dispositivo es iOS Safari (`caps.isLikelyIosSafari`). */
  isAvailable: boolean;
  /** Si el dispositivo soporta Quick Look pero sin `<a rel="ar">`
   *  proper handling, fallback a download. */
  needsDownloadFallback: boolean;
  /** URL del .usdz, o null si el marker no tiene asset. */
  usdzUrl: string | null;
  /** Sub-flags útiles para la UI (botones disabled/enabled). */
  canPreview: boolean;
}

export interface BuildQuickLookConfigInput {
  isLikelyIosSafari: boolean;
  marker: ArMarkerKind;
  /** Override del catálogo — typically `extinguisher:co2` o `extinguisher:pqs`. */
  variant?: string;
}

/**
 * Decide si mostrar el botón Quick Look + qué asset usar.
 */
export function buildQuickLookConfig(
  input: BuildQuickLookConfigInput,
): ArQuickLookConfig {
  if (!input.isLikelyIosSafari) {
    return {
      isAvailable: false,
      needsDownloadFallback: false,
      usdzUrl: null,
      canPreview: false,
    };
  }

  let url: string | null = null;
  if (input.variant) {
    const variantKey = `${input.marker}:${input.variant}`;
    url = VARIANT_OVERRIDES[variantKey] ?? USDZ_CATALOG[input.marker];
  } else {
    url = USDZ_CATALOG[input.marker];
  }

  if (!url) {
    return {
      isAvailable: true,
      needsDownloadFallback: false,
      usdzUrl: null,
      canPreview: false,
    };
  }

  return {
    isAvailable: true,
    needsDownloadFallback: false,
    usdzUrl: url,
    canPreview: true,
  };
}

/**
 * Atributos canónicos para el `<a>` tag que dispara Quick Look. El
 * componente React los aplica directamente con
 * `<a {...quickLookAnchorProps(url, label)}>...</a>`.
 *
 *   - `rel="ar"` — gatillo Quick Look (Safari 13+).
 *   - `download` — fallback en browsers no-Safari (descarga el .usdz).
 *   - `type="model/vnd.usdz+zip"` — MIME oficial para ARKit USDZ.
 *
 * Apple recomienda envolver una imagen 2D dentro del `<a>` para que en
 * navegadores que ignoran `rel="ar"` se vea el placeholder.
 */
export function quickLookAnchorProps(
  url: string,
  ariaLabel: string,
): {
  href: string;
  rel: string;
  type: string;
  'aria-label': string;
  download: string;
} {
  return {
    href: url,
    rel: 'ar',
    type: 'model/vnd.usdz+zip',
    'aria-label': ariaLabel,
    // El attr `download` desencadena la descarga en browsers que no
    // entienden `rel="ar"`. En Safari iOS, el `rel="ar"` toma
    // precedencia y abre Quick Look directamente.
    download: url.split('/').pop() ?? 'model.usdz',
  };
}

/**
 * Resolves un display label legible para un marker. Útil para el
 * `aria-label` y el alt text del placeholder.
 */
export function labelForMarker(kind: ArMarkerKind): string {
  const labels: Record<ArMarkerKind, string> = {
    hazard_label: 'Etiqueta de peligro',
    evacuation_route: 'Ruta de evacuación',
    assembly_point: 'Punto de encuentro',
    extinguisher: 'Extintor',
    first_aid: 'Botiquín de primeros auxilios',
    restricted_zone: 'Zona restringida',
    measurement_probe: 'Sonda de medición',
    note: 'Anotación',
  };
  return labels[kind];
}
