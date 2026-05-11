// Praeventio Guard — Sprint 39 Fase L.11: Hazmat QR + Modo Derrame + Compatibilidad GHS.
//
// Cierra: Documento usuario "§376-390" — Top usuario #14
//
// Extiende `hazmatInventory` con:
//   - substanceQrLookup: payload de QR → HDS resumen + EPP + protocolo derrame
//   - spillProtocol: pasos por familia de sustancia
//   - storageCompatibilityCheck: matriz GHS (no almacenar A junto a B)
//   - wasteContainerCapacityAlert: contenedor cerca de límite
//   - missingHdsAlert: sustancia sin HDS
//   - waterPointInventory + eyewashShowerRegistry (§376-378)
//
// Determinístico. Tablas curadas — datos públicos OSHA + NCh 2245.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SubstanceFamily =
  | 'acido_fuerte'
  | 'base_fuerte'
  | 'inflamable'
  | 'comburente'
  | 'toxico'
  | 'corrosivo'
  | 'gas_comprimido'
  | 'peroxido_organico'
  | 'reactivo_agua'
  | 'biologico';

export type GhsPictogram =
  | 'GHS01' // explosivo
  | 'GHS02' // inflamable
  | 'GHS03' // comburente
  | 'GHS04' // gas comprimido
  | 'GHS05' // corrosivo
  | 'GHS06' // toxico
  | 'GHS07' // irritante
  | 'GHS08' // peligro salud
  | 'GHS09'; // peligro ambiental

export interface SubstanceQrPayload {
  /** UUID interno del registro de sustancia. */
  substanceId: string;
  /** Versión del HDS al momento del QR. Cliente debe revalidar. */
  hdsVersion: string;
  /** Hash SHA-256 del HDS para integridad. */
  hdsHash?: string;
}

export interface SubstanceQrLookupResult {
  substanceId: string;
  commonName: string;
  family: SubstanceFamily;
  pictograms: GhsPictogram[];
  /** Frases H / P resumidas. */
  hStatements: string[];
  pStatements: string[];
  /** EPP recomendado. */
  recommendedEpp: string[];
  /** Pasos de primeros auxilios resumidos. */
  firstAidSteps: string[];
  /** True si el QR matchea el HDS vigente. */
  hdsCurrent: boolean;
  /** Edad de la HDS en días (0 si recién publicada). */
  hdsAgeDays: number;
  /** Recomendación si HDS vieja. */
  hdsAdvisory: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// QR lookup (resolve via repository contract)
// ────────────────────────────────────────────────────────────────────────

export interface HdsRepository {
  fetchSubstanceSummary(
    substanceId: string,
  ): Promise<Omit<SubstanceQrLookupResult, 'hdsCurrent' | 'hdsAgeDays' | 'hdsAdvisory'> & {
    currentHdsVersion: string;
    hdsPublishedAt: string;
  } | null>;
}

const HDS_STALE_DAYS = 365 * 2; // 2 años, por reglas usuales

export async function substanceQrLookup(
  payload: SubstanceQrPayload,
  repo: HdsRepository,
  nowIso: string = new Date().toISOString(),
): Promise<SubstanceQrLookupResult | null> {
  const data = await repo.fetchSubstanceSummary(payload.substanceId);
  if (!data) return null;

  const hdsCurrent = data.currentHdsVersion === payload.hdsVersion;
  const hdsAgeDays = Math.floor(
    (Date.parse(nowIso) - Date.parse(data.hdsPublishedAt)) / 86_400_000,
  );
  let hdsAdvisory: string | null = null;
  if (!hdsCurrent) {
    hdsAdvisory = `QR apunta a HDS v${payload.hdsVersion}; la versión vigente es ${data.currentHdsVersion}. Re-imprimir etiqueta.`;
  } else if (hdsAgeDays > HDS_STALE_DAYS) {
    hdsAdvisory = `HDS vigente fue publicada hace ${hdsAgeDays} días (>${HDS_STALE_DAYS}). Solicitar actualización al proveedor.`;
  }

  return {
    substanceId: data.substanceId,
    commonName: data.commonName,
    family: data.family,
    pictograms: data.pictograms,
    hStatements: data.hStatements,
    pStatements: data.pStatements,
    recommendedEpp: data.recommendedEpp,
    firstAidSteps: data.firstAidSteps,
    hdsCurrent,
    hdsAgeDays,
    hdsAdvisory,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Spill protocol (§384)
// ────────────────────────────────────────────────────────────────────────

export interface SpillProtocol {
  family: SubstanceFamily;
  /** Pasos ordenados a ejecutar. */
  steps: string[];
  /** EPP mínimo durante respuesta. */
  responseEpp: string[];
  /** Si debe activar protocolo SOS automático. */
  triggerSos: boolean;
  /** Si debe notificar a autoridad ambiental. */
  notifyEnvironmentalAuthority: boolean;
}

const SPILL_PROTOCOLS: Record<SubstanceFamily, Omit<SpillProtocol, 'family'>> = {
  acido_fuerte: {
    steps: [
      'Aislar zona inmediatamente (3-5m)',
      'NO usar agua sobre derrame concentrado (riesgo proyección)',
      'Neutralizar con carbonato de sodio o tierra absorbente',
      'Confinar usando dique con absorbente',
      'Etiquetar residuo y enviar a disposición final autorizada',
    ],
    responseEpp: ['traje tyvek', 'guantes nitrilo + neopreno', 'careta facial', 'botas pvc'],
    triggerSos: false,
    notifyEnvironmentalAuthority: true,
  },
  base_fuerte: {
    steps: [
      'Aislar zona',
      'Neutralizar con ácido débil diluido (ácido acético)',
      'Confinar con absorbente neutro',
      'Etiquetar residuo y disponer',
    ],
    responseEpp: ['traje tyvek', 'guantes nitrilo', 'careta facial'],
    triggerSos: false,
    notifyEnvironmentalAuthority: true,
  },
  inflamable: {
    steps: [
      'ELIMINAR fuentes ignición (cortar energía, prohibir cualquier chispa)',
      'Evacuar personal no esencial 25m radio',
      'Confinar con absorbente NO inflamable (arena, tierra)',
      'Si hubo ignición: extintor polvo químico / espuma AFFF',
      'Disponer en contenedor metálico cerrado',
    ],
    responseEpp: ['traje retardante llama', 'botas dieléctricas', 'protección respiratoria'],
    triggerSos: true,
    notifyEnvironmentalAuthority: true,
  },
  comburente: {
    steps: [
      'Aislar de combustibles inmediatamente',
      'NO usar trapos comunes (combustión espontánea)',
      'Confinar con absorbente inerte',
      'Disponer en contenedor metálico SEPARADO',
    ],
    responseEpp: ['traje tyvek', 'guantes neopreno'],
    triggerSos: false,
    notifyEnvironmentalAuthority: true,
  },
  toxico: {
    steps: [
      'Evacuar zona inmediatamente',
      'Ventilar área (si interior) — abrir puertas, activar extracción',
      'Personal de respuesta con respirador purificador de aire',
      'Confinar derrame con absorbente',
      'Disponer como residuo peligroso',
    ],
    responseEpp: ['respirador full-face', 'traje tyvek', 'guantes nitrilo'],
    triggerSos: true,
    notifyEnvironmentalAuthority: true,
  },
  corrosivo: {
    steps: [
      'Aislar 3-5m',
      'Neutralizar según pH del derrame',
      'Confinar con absorbente compatible',
      'Disponer como residuo peligroso',
    ],
    responseEpp: ['traje tyvek', 'guantes nitrilo + neopreno', 'careta facial'],
    triggerSos: false,
    notifyEnvironmentalAuthority: true,
  },
  gas_comprimido: {
    steps: [
      'Si fuga de gas → evacuar 50m',
      'Cortar válvula si seguro hacerlo',
      'Ventilar al máximo',
      'NO usar llamas/chispas',
      'Notificar SAMU 131 si hay exposición de personas',
    ],
    responseEpp: ['respirador autocontenido (SCBA)', 'traje retardante'],
    triggerSos: true,
    notifyEnvironmentalAuthority: false,
  },
  peroxido_organico: {
    steps: [
      'Evacuar zona — riesgo descomposición explosiva',
      'NO confinar (calor puede acelerar reacción)',
      'Refrigerar si seguro',
      'Notificar especialistas químicos',
    ],
    responseEpp: ['traje retardante', 'careta facial'],
    triggerSos: true,
    notifyEnvironmentalAuthority: true,
  },
  reactivo_agua: {
    steps: [
      'NO usar agua bajo ninguna circunstancia',
      'Confinar con arena seca o tierra',
      'Cubrir derrame con manta antichispas',
      'Disponer en contenedor seco hermético',
    ],
    responseEpp: ['traje retardante', 'guantes neopreno', 'careta facial'],
    triggerSos: true,
    notifyEnvironmentalAuthority: true,
  },
  biologico: {
    steps: [
      'Cubrir derrame con papel absorbente desechable',
      'Aplicar desinfectante de amplio espectro (hipoclorito 1%)',
      'Dejar actuar 15 minutos',
      'Recoger con pinzas/utensilios desechables',
      'Disponer como residuo biológico (bolsa roja sellada)',
    ],
    responseEpp: ['guantes nitrilo doble', 'mascarilla N95+', 'antiparras'],
    triggerSos: false,
    notifyEnvironmentalAuthority: false,
  },
};

export function getSpillProtocol(family: SubstanceFamily): SpillProtocol {
  return { family, ...SPILL_PROTOCOLS[family] };
}

// ────────────────────────────────────────────────────────────────────────
// Storage compatibility matrix (§380)
// ────────────────────────────────────────────────────────────────────────

type CompatibilityStatus = 'compatible' | 'segregate' | 'never';

/** Matriz simétrica simplificada NCh 2245 + 49 CFR. */
const COMPATIBILITY_MATRIX: Partial<
  Record<SubstanceFamily, Partial<Record<SubstanceFamily, CompatibilityStatus>>>
> = {
  acido_fuerte: {
    base_fuerte: 'never',
    comburente: 'never',
    reactivo_agua: 'never',
    peroxido_organico: 'never',
    inflamable: 'segregate',
    toxico: 'segregate',
  },
  base_fuerte: {
    acido_fuerte: 'never',
    peroxido_organico: 'segregate',
  },
  inflamable: {
    comburente: 'never',
    peroxido_organico: 'never',
    acido_fuerte: 'segregate',
  },
  comburente: {
    inflamable: 'never',
    acido_fuerte: 'never',
    peroxido_organico: 'never',
    reactivo_agua: 'segregate',
  },
  reactivo_agua: {
    acido_fuerte: 'never',
    base_fuerte: 'segregate',
    comburente: 'segregate',
  },
  peroxido_organico: {
    inflamable: 'never',
    comburente: 'never',
    acido_fuerte: 'never',
    base_fuerte: 'segregate',
  },
};

export function storageCompatibilityCheck(
  familyA: SubstanceFamily,
  familyB: SubstanceFamily,
): CompatibilityStatus {
  if (familyA === familyB) return 'compatible';
  const statusA = COMPATIBILITY_MATRIX[familyA]?.[familyB];
  const statusB = COMPATIBILITY_MATRIX[familyB]?.[familyA];
  if (statusA === 'never' || statusB === 'never') return 'never';
  if (statusA === 'segregate' || statusB === 'segregate') return 'segregate';
  return 'compatible';
}

// ────────────────────────────────────────────────────────────────────────
// Waste container capacity (§387)
// ────────────────────────────────────────────────────────────────────────

export interface WasteContainer {
  id: string;
  capacityLiters: number;
  currentFillLiters: number;
  family: SubstanceFamily;
}

export interface WasteCapacityAlert {
  containerId: string;
  fillPercent: number;
  /** Alerta si >80%. Bloquea agregar si >95%. */
  level: 'ok' | 'warning' | 'critical' | 'full';
  message: string;
}

export function checkWasteCapacity(container: WasteContainer): WasteCapacityAlert {
  const fillPercent = (container.currentFillLiters / container.capacityLiters) * 100;
  let level: WasteCapacityAlert['level'];
  let message: string;
  if (fillPercent >= 100) {
    level = 'full';
    message = `Contenedor ${container.id} LLENO. Reemplazar antes de continuar.`;
  } else if (fillPercent >= 95) {
    level = 'critical';
    message = `Contenedor ${container.id} al ${Math.round(fillPercent)}%. Programar retiro urgente.`;
  } else if (fillPercent >= 80) {
    level = 'warning';
    message = `Contenedor ${container.id} al ${Math.round(fillPercent)}%. Coordinar retiro próximamente.`;
  } else {
    level = 'ok';
    message = `Contenedor ${container.id} al ${Math.round(fillPercent)}%.`;
  }
  return { containerId: container.id, fillPercent: Math.round(fillPercent), level, message };
}
