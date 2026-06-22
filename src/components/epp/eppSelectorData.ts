// Pure data module — rubro → EPP item mapping for the EppSelector component.
// Based on Chilean PPE norms DS 594 + DS 44/2024 + founder-confirmed industry list.
// No side effects, no imports — safe to import in tests without mocking.

export interface EppCardItem {
  emoji: string;
  label: string;
}

export interface EppSelectorRubro {
  id: string;
  label: string;
  items: EppCardItem[];
}

// Founder-confirmed industry list with DS 594-compliant EPP sets.
// Keys intentionally use GP- prefixes that align with constants.ts INDUSTRY_SECTORS
// to allow future cross-referencing.
export const EPP_SELECTOR_RUBROS: EppSelectorRubro[] = [
  {
    id: 'GP-MIN',
    label: 'Minería',
    items: [
      { emoji: '⛏️', label: 'Casco minero' },
      { emoji: '🧤', label: 'Guantes de cabretilla' },
      { emoji: '🥽', label: 'Lentes de seguridad' },
      { emoji: '🥾', label: 'Zapatos punta de acero' },
      { emoji: '🔇', label: 'Protector auditivo' },
      { emoji: '😷', label: 'Respirador gases' },
    ],
  },
  {
    id: 'GP-CONS',
    label: 'Construcción',
    items: [
      { emoji: '👷', label: 'Casco de seguridad' },
      { emoji: '🧤', label: 'Guantes de cabretilla' },
      { emoji: '🥽', label: 'Lentes de seguridad' },
      { emoji: '🥾', label: 'Zapatos de seguridad' },
      { emoji: '🦺', label: 'Arnés de seguridad' },
      { emoji: '🦺', label: 'Chaleco reflectante' },
    ],
  },
  {
    id: 'GP-AGR-SIL',
    label: 'Forestal',
    items: [
      { emoji: '👷', label: 'Casco forestal' },
      { emoji: '🧤', label: 'Guantes anticorte' },
      { emoji: '🥾', label: 'Botas con puntera' },
      { emoji: '🔇', label: 'Protector auditivo' },
      { emoji: '🥽', label: 'Lentes forestales' },
      { emoji: '🦺', label: 'Pantalón anticorte' },
    ],
  },
  {
    id: 'GP-AGR-PES',
    label: 'Salmonicultura',
    items: [
      { emoji: '🧤', label: 'Guantes impermeables' },
      { emoji: '🥾', label: 'Botas impermeables' },
      { emoji: '🦺', label: 'Traje impermeable' },
      { emoji: '😷', label: 'Mascarilla antipolvo' },
      { emoji: '🥽', label: 'Lentes de protección' },
      { emoji: '🦺', label: 'Chaleco salvavidas' },
    ],
  },
  {
    id: 'GP-AGR',
    label: 'Agricultura',
    items: [
      { emoji: '👷', label: 'Casco de seguridad' },
      { emoji: '🧤', label: 'Guantes agrícolas' },
      { emoji: '🥾', label: 'Botas de seguridad' },
      { emoji: '🥽', label: 'Lentes de seguridad' },
      { emoji: '🧥', label: 'Traje impermeable' },
      { emoji: '😷', label: 'Respirador pesticidas' },
    ],
  },
  {
    id: 'GP-TRANS-MAR',
    label: 'Portuario',
    items: [
      { emoji: '👷', label: 'Casco de seguridad' },
      { emoji: '🦺', label: 'Chaleco salvavidas' },
      { emoji: '🦺', label: 'Chaleco reflectante' },
      { emoji: '🥾', label: 'Zapatos punta de acero' },
      { emoji: '🧤', label: 'Guantes de trabajo' },
      { emoji: '🔇', label: 'Protector auditivo' },
    ],
  },
  {
    id: 'GP-ELEC-EOL',
    label: 'Energía Eólica',
    items: [
      { emoji: '⚡', label: 'Casco dieléctrico' },
      { emoji: '🧤', label: 'Guantes aislantes' },
      { emoji: '🥾', label: 'Botas dieléctricas' },
      { emoji: '🦺', label: 'Arnés anticaídas' },
      { emoji: '🥽', label: 'Careta facial' },
      { emoji: '🦺', label: 'Ropa ignífuga' },
    ],
  },
  {
    id: 'GP-ALOJA-COM',
    label: 'Gastronomía',
    items: [
      { emoji: '👨‍🍳', label: 'Gorro de cocinero' },
      { emoji: '🦺', label: 'Mandil impermeable' },
      { emoji: '🥾', label: 'Calzado antideslizante' },
      { emoji: '🧤', label: 'Guantes térmicos' },
      { emoji: '😷', label: 'Mascarilla higiénica' },
      { emoji: '🧤', label: 'Guantes de corte' },
    ],
  },
  {
    id: 'GP-SAL',
    label: 'Área de Salud',
    items: [
      { emoji: '😷', label: 'Mascarilla N95' },
      { emoji: '🧤', label: 'Guantes desechables' },
      { emoji: '🦺', label: 'Bata de protección' },
      { emoji: '🥽', label: 'Protección ocular' },
      { emoji: '🥾', label: 'Calzado cerrado' },
      { emoji: '🧴', label: 'Desinfectante manos' },
    ],
  },
];

// Default fallback — shown before any rubro is selected or for unknown ids
export const EPP_SELECTOR_DEFAULT: EppCardItem[] = [
  { emoji: '👷', label: 'Casco de seguridad' },
  { emoji: '🧤', label: 'Guantes de trabajo' },
  { emoji: '🥽', label: 'Lentes de seguridad' },
  { emoji: '🥾', label: 'Zapatos de seguridad' },
];

/** Returns the EPP items for a given rubro id, falling back to the default set. */
export function getEppForRubro(rubroId: string): EppCardItem[] {
  const found = EPP_SELECTOR_RUBROS.find((r) => r.id === rubroId);
  return found ? found.items : EPP_SELECTOR_DEFAULT;
}
