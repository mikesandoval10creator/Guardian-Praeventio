/**
 * Sprint 17c — Bioicons-derived medical icon registry.
 * Sprint 20 Fase 1b — soporta PNG hosted en server Praeventio (`VITE_MEDICAL_ICONS_BASE_URL`)
 * con fallback graceful al SVG local cuando el env var no está seteado o el PNG no carga.
 *
 * Cada entry mapea un nombre estable → public path. El path se RESUELVE al render
 * vía `resolveIconUrl(entry)`:
 *   1. Si `VITE_MEDICAL_ICONS_BASE_URL` está seteado, devuelve `${base}/${name}.png` (Praeventio CDN).
 *   2. Si no, o si el PNG falla en cargar, el componente cae al `publicPath` local SVG.
 *
 * Esto permite migración zero-downtime: deploya el código primero, sube los PNG al
 * bucket cuando estén listos, y los PNG aparecen sin nuevo deploy.
 *
 * Icons ENGINE-LEVEL Bioicons (https://bioicons.com, MIT/CC0/CC-BY-4.0). El subset
 * inicial es 100% CC0 — si se agrega CC-BY, montar `MedicalIconAttribution` en el
 * footer correspondiente.
 *
 * Ver ADR 0003 (Bioicons primary) y ADR 0004 (medical icons hosted on server).
 */

export type MedicalIconFormat = 'svg' | 'png';

export interface MedicalIconEntry {
  /** Stable name used by app code (kebab-case). */
  name: string;
  /** Local fallback path served by Vite (must start with `/`). Used when the
   *  hosted PNG isn't reachable or `VITE_MEDICAL_ICONS_BASE_URL` is unset. */
  publicPath: string;
  /** Preferred render format. The hosted bucket serves PNG (Sprint 20 Fase 1b);
   *  the local fallback is the SVG placeholder shipped from public/icons/biology/. */
  format: MedicalIconFormat;
  /** License this specific icon uses. */
  license: 'CC0' | 'CC-BY-4.0' | 'MIT';
  /** Attribution text (only required for CC-BY). */
  attribution?: string;
  /** Bioicons category for traceability. */
  category: string;
}

export const MEDICAL_ICON_REGISTRY: ReadonlyArray<MedicalIconEntry> = [
  // Anatomy / silhouettes
  { name: 'human-body-male-front', publicPath: '/icons/biology/human-body-male-front.svg', format: 'png', license: 'CC0', category: 'anatomy' },
  { name: 'human-body-female-front', publicPath: '/icons/biology/human-body-female-front.svg', format: 'png', license: 'CC0', category: 'anatomy' },
  { name: 'spine', publicPath: '/icons/biology/spine.svg', format: 'png', license: 'CC0', category: 'anatomy' },

  // Organs
  { name: 'lung-pair', publicPath: '/icons/biology/lung-pair.svg', format: 'png', license: 'CC0', category: 'organs' },
  { name: 'heart-anatomical', publicPath: '/icons/biology/heart-anatomical.svg', format: 'png', license: 'CC0', category: 'organs' },
  { name: 'kidney-pair', publicPath: '/icons/biology/kidney-pair.svg', format: 'png', license: 'CC0', category: 'organs' },
  { name: 'liver', publicPath: '/icons/biology/liver.svg', format: 'png', license: 'CC0', category: 'organs' },
  { name: 'brain', publicPath: '/icons/biology/brain.svg', format: 'png', license: 'CC0', category: 'organs' },
  { name: 'eye', publicPath: '/icons/biology/eye.svg', format: 'png', license: 'CC0', category: 'organs' },
  { name: 'ear', publicPath: '/icons/biology/ear.svg', format: 'png', license: 'CC0', category: 'organs' },

  // PPE
  { name: 'mask-n95', publicPath: '/icons/biology/mask-n95.svg', format: 'png', license: 'CC0', category: 'ppe' },
  { name: 'mask-surgical', publicPath: '/icons/biology/mask-surgical.svg', format: 'png', license: 'CC0', category: 'ppe' },
  { name: 'gloves-medical', publicPath: '/icons/biology/gloves-medical.svg', format: 'png', license: 'CC0', category: 'ppe' },
  { name: 'goggles-safety', publicPath: '/icons/biology/goggles-safety.svg', format: 'png', license: 'CC0', category: 'ppe' },
  { name: 'helmet-safety', publicPath: '/icons/biology/helmet-safety.svg', format: 'png', license: 'CC0', category: 'ppe' },
  { name: 'hearing-protection', publicPath: '/icons/biology/hearing-protection.svg', format: 'png', license: 'CC0', category: 'ppe' },
  { name: 'fall-arrest-harness', publicPath: '/icons/biology/fall-arrest-harness.svg', format: 'png', license: 'CC0', category: 'ppe' },

  // Pharma
  { name: 'pill', publicPath: '/icons/biology/pill.svg', format: 'png', license: 'CC0', category: 'pharma' },
  { name: 'syringe', publicPath: '/icons/biology/syringe.svg', format: 'png', license: 'CC0', category: 'pharma' },
  { name: 'iv-bag', publicPath: '/icons/biology/iv-bag.svg', format: 'png', license: 'CC0', category: 'pharma' },
  { name: 'first-aid-kit', publicPath: '/icons/biology/first-aid-kit.svg', format: 'png', license: 'CC0', category: 'pharma' },

  // Instruments
  { name: 'stethoscope', publicPath: '/icons/biology/stethoscope.svg', format: 'png', license: 'CC0', category: 'instruments' },
  { name: 'spirometer', publicPath: '/icons/biology/spirometer.svg', format: 'png', license: 'CC0', category: 'instruments' },
  { name: 'audiometer', publicPath: '/icons/biology/audiometer.svg', format: 'png', license: 'CC0', category: 'instruments' },
  { name: 'thermometer', publicPath: '/icons/biology/thermometer.svg', format: 'png', license: 'CC0', category: 'instruments' },
  { name: 'blood-pressure-cuff', publicPath: '/icons/biology/blood-pressure-cuff.svg', format: 'png', license: 'CC0', category: 'instruments' },
  { name: 'pulse-oximeter', publicPath: '/icons/biology/pulse-oximeter.svg', format: 'png', license: 'CC0', category: 'instruments' },

  // Rehabilitation
  { name: 'wheelchair', publicPath: '/icons/biology/wheelchair.svg', format: 'png', license: 'CC0', category: 'rehabilitation' },
  { name: 'crutch', publicPath: '/icons/biology/crutch.svg', format: 'png', license: 'CC0', category: 'rehabilitation' },

  // Injuries
  { name: 'arm-fracture', publicPath: '/icons/biology/arm-fracture.svg', format: 'png', license: 'CC0', category: 'injuries' },
  { name: 'leg-fracture', publicPath: '/icons/biology/leg-fracture.svg', format: 'png', license: 'CC0', category: 'injuries' },
  { name: 'burn-skin', publicPath: '/icons/biology/burn-skin.svg', format: 'png', license: 'CC0', category: 'injuries' },
  { name: 'cut-wound', publicPath: '/icons/biology/cut-wound.svg', format: 'png', license: 'CC0', category: 'injuries' },
];

// Lazy-initialized index for O(1) lookup. Tested in iconLibrary.test.ts.
let _index: Map<string, MedicalIconEntry> | null = null;
function getIndex(): Map<string, MedicalIconEntry> {
  if (_index === null) {
    _index = new Map(MEDICAL_ICON_REGISTRY.map((entry) => [entry.name, entry]));
  }
  return _index;
}

export function findMedicalIcon(name: string): MedicalIconEntry | undefined {
  return getIndex().get(name);
}

/** Returns true if the registry contains any CC-BY-4.0 icon (drives footer mounting). */
export function hasAnyCcByIcons(): boolean {
  return MEDICAL_ICON_REGISTRY.some((i) => i.license === 'CC-BY-4.0');
}

/**
 * Resolves the URL to render for an icon entry. Prefers the hosted PNG
 * (Praeventio CDN bucket) when `VITE_MEDICAL_ICONS_BASE_URL` is set; falls
 * back to the local SVG path otherwise. The component layer (`MedicalIcon`)
 * also wires an `onError` fallback for the case where the hosted PNG is
 * configured but unavailable at runtime.
 *
 * Env var examples:
 *   VITE_MEDICAL_ICONS_BASE_URL=https://storage.googleapis.com/praeventio-public-assets/medical-icons/v1
 *   VITE_MEDICAL_ICONS_BASE_URL=https://assets.praeventio.net/medical-icons/v1
 */
export function resolveIconUrl(entry: MedicalIconEntry): string {
  if (entry.format !== 'png') return entry.publicPath;
  const base = readMedicalIconsBaseUrl();
  if (!base) return entry.publicPath;
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}/${entry.name}.png`;
}

/** Resolved at module-load. Exposed for tests. */
export function readMedicalIconsBaseUrl(): string | undefined {
  // Vite injects `import.meta.env.VITE_*` at build time. In Node tests the
  // value is undefined; we also support a process.env fallback for SSR.
  const fromVite =
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MEDICAL_ICONS_BASE_URL;
  if (typeof fromVite === 'string' && fromVite.length > 0) return fromVite;
  if (typeof process !== 'undefined' && process.env?.VITE_MEDICAL_ICONS_BASE_URL) {
    return process.env.VITE_MEDICAL_ICONS_BASE_URL;
  }
  return undefined;
}
