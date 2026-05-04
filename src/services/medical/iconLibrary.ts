/**
 * Sprint 17c — Bioicons-derived medical icon registry.
 *
 * Pure constant export. Maps a stable semantic name → public asset path
 * served by Vite from `/public/icons/biology/`. Each entry declares its
 * SPDX-style license so the UI layer can render attribution where required.
 *
 * Icons in this registry are sourced from the Bioicons project
 * (https://bioicons.com, MIT/CC0/CC-BY-4.0). The initial subset is 100% CC0
 * for ease of use; if CC-BY entries are added, the
 * `MedicalIconAttribution` component must be mounted in the relevant page
 * footer.
 *
 * No npm dependency — icons are shipped as static SVG files in
 * `public/icons/biology/`. See ADR 0003.
 */

export interface MedicalIconEntry {
  /** Stable name used by app code (kebab-case). */
  name: string;
  /** Public path served by Vite (must start with `/`). */
  publicPath: string;
  /** License this specific icon uses. */
  license: 'CC0' | 'CC-BY-4.0' | 'MIT';
  /** Attribution text (only required for CC-BY). */
  attribution?: string;
  /** Bioicons category for traceability. */
  category: string;
}

export const MEDICAL_ICON_REGISTRY: ReadonlyArray<MedicalIconEntry> = [
  // Anatomy / silhouettes
  { name: 'human-body-male-front', publicPath: '/icons/biology/human-body-male-front.svg', license: 'CC0', category: 'anatomy' },
  { name: 'human-body-female-front', publicPath: '/icons/biology/human-body-female-front.svg', license: 'CC0', category: 'anatomy' },
  { name: 'spine', publicPath: '/icons/biology/spine.svg', license: 'CC0', category: 'anatomy' },

  // Organs
  { name: 'lung-pair', publicPath: '/icons/biology/lung-pair.svg', license: 'CC0', category: 'organs' },
  { name: 'heart-anatomical', publicPath: '/icons/biology/heart-anatomical.svg', license: 'CC0', category: 'organs' },
  { name: 'kidney-pair', publicPath: '/icons/biology/kidney-pair.svg', license: 'CC0', category: 'organs' },
  { name: 'liver', publicPath: '/icons/biology/liver.svg', license: 'CC0', category: 'organs' },
  { name: 'brain', publicPath: '/icons/biology/brain.svg', license: 'CC0', category: 'organs' },
  { name: 'eye', publicPath: '/icons/biology/eye.svg', license: 'CC0', category: 'organs' },
  { name: 'ear', publicPath: '/icons/biology/ear.svg', license: 'CC0', category: 'organs' },

  // PPE
  { name: 'mask-n95', publicPath: '/icons/biology/mask-n95.svg', license: 'CC0', category: 'ppe' },
  { name: 'mask-surgical', publicPath: '/icons/biology/mask-surgical.svg', license: 'CC0', category: 'ppe' },
  { name: 'gloves-medical', publicPath: '/icons/biology/gloves-medical.svg', license: 'CC0', category: 'ppe' },
  { name: 'goggles-safety', publicPath: '/icons/biology/goggles-safety.svg', license: 'CC0', category: 'ppe' },
  { name: 'helmet-safety', publicPath: '/icons/biology/helmet-safety.svg', license: 'CC0', category: 'ppe' },
  { name: 'hearing-protection', publicPath: '/icons/biology/hearing-protection.svg', license: 'CC0', category: 'ppe' },
  { name: 'fall-arrest-harness', publicPath: '/icons/biology/fall-arrest-harness.svg', license: 'CC0', category: 'ppe' },

  // Pharma
  { name: 'pill', publicPath: '/icons/biology/pill.svg', license: 'CC0', category: 'pharma' },
  { name: 'syringe', publicPath: '/icons/biology/syringe.svg', license: 'CC0', category: 'pharma' },
  { name: 'iv-bag', publicPath: '/icons/biology/iv-bag.svg', license: 'CC0', category: 'pharma' },
  { name: 'first-aid-kit', publicPath: '/icons/biology/first-aid-kit.svg', license: 'CC0', category: 'pharma' },

  // Instruments
  { name: 'stethoscope', publicPath: '/icons/biology/stethoscope.svg', license: 'CC0', category: 'instruments' },
  { name: 'spirometer', publicPath: '/icons/biology/spirometer.svg', license: 'CC0', category: 'instruments' },
  { name: 'audiometer', publicPath: '/icons/biology/audiometer.svg', license: 'CC0', category: 'instruments' },
  { name: 'thermometer', publicPath: '/icons/biology/thermometer.svg', license: 'CC0', category: 'instruments' },
  { name: 'blood-pressure-cuff', publicPath: '/icons/biology/blood-pressure-cuff.svg', license: 'CC0', category: 'instruments' },
  { name: 'pulse-oximeter', publicPath: '/icons/biology/pulse-oximeter.svg', license: 'CC0', category: 'instruments' },

  // Rehabilitation
  { name: 'wheelchair', publicPath: '/icons/biology/wheelchair.svg', license: 'CC0', category: 'rehabilitation' },
  { name: 'crutch', publicPath: '/icons/biology/crutch.svg', license: 'CC0', category: 'rehabilitation' },

  // Injuries
  { name: 'arm-fracture', publicPath: '/icons/biology/arm-fracture.svg', license: 'CC0', category: 'injuries' },
  { name: 'leg-fracture', publicPath: '/icons/biology/leg-fracture.svg', license: 'CC0', category: 'injuries' },
  { name: 'burn-skin', publicPath: '/icons/biology/burn-skin.svg', license: 'CC0', category: 'injuries' },
  { name: 'cut-wound', publicPath: '/icons/biology/cut-wound.svg', license: 'CC0', category: 'injuries' },
];

export function findMedicalIcon(name: string): MedicalIconEntry | undefined {
  return MEDICAL_ICON_REGISTRY.find((i) => i.name === name);
}

/** Returns true if the registry contains any CC-BY-4.0 icon (drives footer mounting). */
export function hasAnyCcByIcons(): boolean {
  return MEDICAL_ICON_REGISTRY.some((i) => i.license === 'CC-BY-4.0');
}
