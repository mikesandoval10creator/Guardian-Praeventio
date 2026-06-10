/**
 * Pure preventive-profile engine for the SII rubros épica (slice 1).
 *
 * Builds an industry risk profile from EXISTING verified pieces — no legal
 * data is fabricated here:
 *  - Regulations come from the CL country pack (`src/data/normativa/cl.ts`,
 *    BCN-verified ids/urls); this module only SELECTS which pack entries
 *    apply to a GP-* sector.
 *  - EPP comes from `EPP_BY_SECTOR` / `EPP_DEFAULT` (`src/constants.ts`).
 *  - `riesgosTipicos` are seed PREVENTIVE content (standard hazard lists per
 *    sector, es-CL copy) — they are not legal citations.
 *  - Headcount thresholds are read from the pack argument, never hardcoded.
 *
 * Pure functions: deterministic, no I/O, results are fresh copies.
 */
import { EPP_BY_SECTOR, EPP_DEFAULT } from '../../constants';
import { CL_PACK } from '../../data/normativa/cl';
import type { CountryPack, Regulation } from '../normativa/countryPacks';

export interface IndustryRiskProfile {
  /** Normalised GP-* subsector id, e.g. 'GP-MIN-MET'. */
  sectorId: string;
  /** Major sector prefix, e.g. 'GP-MIN'. */
  sectorPrefix: string;
  /** Applicable CL-pack regulations (universal base + sector-specific). */
  regulations: Regulation[];
  /** Typical EPP kit for the sector (from EPP_BY_SECTOR, default fallback). */
  epp: { emoji: string; label: string }[];
  /** Seed hazard list for the sector (es-CL preventive content). */
  riesgosTipicos: string[];
  /** Sector-specific preventive notes (es-CL), e.g. bitácora de faena. */
  notasPreventivas: string[];
}

export interface ObligacionesDotacion {
  /** Comité Paritario de Higiene y Seguridad required at this headcount. */
  cphsRequired: boolean;
  /** Delegado(a) de SST required (below the CPHS threshold, DS 44/2024). */
  delegadoSstRequired: boolean;
  /** Departamento de Prevención de Riesgos required. */
  preventionDeptRequired: boolean;
  /** es-CL copy describing each obligation, ready for the wizard UI. */
  obligaciones: string[];
}

/** Universal base for every Chilean workplace (Ley 16.744 + DS 44/2024). */
const BASE_REGULATION_IDS = ['cl-ley-16744', 'cl-ds-44'];

/**
 * Sector-specific regulation ids, keyed by GP id (longest prefix wins, so a
 * full subsector key beats its major-sector key). All ids must exist in
 * CL_PACK — enforced by tests.
 */
const SECTOR_REGULATION_IDS: Record<string, string[]> = {
  // Mining: DS 132 (Reglamento de Seguridad Minera) + DS 76 (faenas with
  // contractors are the norm in Chilean mining).
  'GP-MIN': ['cl-ds-132', 'cl-ds-76'],
  // Construction: DS 76 (art. 66 bis Ley 16.744, registro de faena) +
  // Ley 20.123 (subcontratación).
  'GP-CONS': ['cl-ds-76', 'cl-ley-20123'],
  // Agriculture/forestry/fishing: DS 594 (condiciones sanitarias, EPP,
  // límites permisibles — pesticide handling notes go as text below).
  'GP-AGR': ['cl-ds-594'],
  // Waste collection/treatment and decontamination: DS 148 (residuos
  // peligrosos) + DS 594.
  'GP-ENERG-RES': ['cl-ds-148', 'cl-ds-594'],
  'GP-ENERG-SAN': ['cl-ds-148', 'cl-ds-594'],
  // Chemical and petroleum manufacturing generate hazardous waste: DS 148.
  'GP-MANU-QUIM': ['cl-ds-148', 'cl-ds-594'],
  'GP-MANU-COQ': ['cl-ds-148', 'cl-ds-594'],
  // General manufacturing: DS 594 (ruido, EPP, límites permisibles).
  'GP-MANU': ['cl-ds-594'],
};

/** Sector-specific preventive notes (es-CL). Textual, not fabricated ids. */
const SECTOR_NOTAS: Record<string, string[]> = {
  'GP-CONS': [
    'Mantener en la faena el registro actualizado de antecedentes (bitácora de faena) exigido por el DS 76 a la empresa principal.',
    'Si conviven 50 o más trabajadores propios y subcontratados en la faena, la empresa principal debe implementar un Sistema de Gestión de SST (Ley 20.123 / DS 76).',
  ],
  'GP-MIN': [
    'Avisar a SERNAGEOMIN el inicio o reinicio de faenas y mantener plan de emergencia y brigada de rescate según el DS 132.',
  ],
  'GP-AGR': [
    'El uso de plaguicidas exige aplicadores capacitados, respeto de los períodos de reingreso al predio y EPP específico (DS 594 y normativa MINSAL/SAG de plaguicidas de uso agrícola).',
    'Considerar protección frente a radiación UV solar para trabajo a la intemperie (Ley 20.096: informar riesgos y entregar fotoprotección).',
  ],
  'GP-ENERG-RES': [
    'El almacenamiento de residuos peligrosos sin autorización sanitaria no puede exceder 6 meses; segregar por incompatibilidad y rotular según SGA (DS 148).',
  ],
};

/** Seed hazard lists per major sector (es-CL preventive content, 5-8 each). */
const RIESGOS_POR_SECTOR: Record<string, string[]> = {
  'GP-AGR': [
    'Exposición a plaguicidas y agroquímicos',
    'Sobreesfuerzo por manejo manual de carga',
    'Exposición a radiación UV solar en trabajo a la intemperie',
    'Volcamiento o atrapamiento por tractores y maquinaria agrícola',
    'Mordeduras, picaduras y contacto con agentes biológicos (zoonosis)',
    'Caídas al mismo nivel en terreno irregular',
    'Cortes y golpes por herramientas manuales',
  ],
  'GP-MIN': [
    'Caída de rocas y planchoneo en frentes de trabajo',
    'Exposición a sílice cristalina (riesgo de silicosis)',
    'Tronaduras y manejo de explosivos',
    'Atropello o colisión por equipos de alto tonelaje',
    'Exposición a ruido sobre límites permisibles',
    'Fatiga y somnolencia en sistemas de turnos',
    'Gases y deficiencia de oxígeno en minería subterránea',
    'Caída a distinto nivel en piques y chimeneas',
  ],
  'GP-MANU': [
    'Atrapamiento por partes móviles de máquinas',
    'Exposición a ruido sobre límites permisibles',
    'Contacto con superficies calientes y proyección de partículas',
    'Exposición a sustancias químicas peligrosas',
    'Cortes con herramientas y elementos filosos',
    'Trastornos musculoesqueléticos por movimientos repetitivos',
    'Incendio o explosión por materiales combustibles',
  ],
  'GP-ELEC': [
    'Contacto eléctrico directo o indirecto',
    'Arco eléctrico y quemaduras',
    'Caída a distinto nivel en postes, torres y estructuras',
    'Trabajo en proximidad de líneas energizadas',
    'Golpes y atrapamientos en maniobras con equipos',
    'Exposición a condiciones climáticas extremas en terreno',
  ],
  'GP-ENERG': [
    'Contacto con aguas servidas y agentes biológicos',
    'Gases tóxicos y deficiencia de oxígeno en espacios confinados',
    'Cortes y pinchazos por residuos mal segregados',
    'Atropello durante recolección en vías públicas',
    'Exposición a sustancias químicas de tratamiento',
    'Sobreesfuerzo por manipulación de contenedores y cargas',
  ],
  'GP-CONS': [
    'Caída a distinto nivel desde andamios, losas y aberturas',
    'Derrumbe o desprendimiento en excavaciones y zanjas',
    'Caída de objetos y materiales desde altura',
    'Contacto eléctrico con instalaciones provisorias o líneas aéreas',
    'Atrapamiento o golpe por maquinaria pesada y vehículos en obra',
    'Exposición a sílice y polvo en faenas de corte y demolición',
    'Exposición a ruido sobre límites permisibles',
    'Sobreesfuerzo por manejo manual de materiales',
  ],
  'GP-COM': [
    'Caídas al mismo nivel en salas de venta y bodegas',
    'Sobreesfuerzo por manipulación manual de carga',
    'Asaltos y violencia de origen externo',
    'Cortes con elementos filosos y herramientas',
    'Atropello en zonas de carga y descarga',
  ],
  'GP-TRANS': [
    'Choque, colisión o volcamiento en ruta',
    'Fatiga y somnolencia en conducción prolongada',
    'Atropello en patios de maniobra y andenes',
    'Caída desde la cabina, rampa o carrocería',
    'Sobreesfuerzo en carga y descarga de mercancías',
    'Asaltos y violencia en ruta o en paraderos',
  ],
  'GP-ALOJA': [
    'Quemaduras y cortes en cocinas',
    'Caídas al mismo nivel en pisos húmedos',
    'Sobreesfuerzo por manipulación de carga y posturas forzadas',
    'Contacto con productos químicos de limpieza',
    'Violencia y agresiones de terceros (clientes)',
  ],
  'GP-ADM': [
    'Violencia y agresiones de terceros',
    'Caídas al mismo nivel en recintos de terceros',
    'Contacto con productos químicos de limpieza',
    'Sobreesfuerzo y posturas forzadas',
    'Trabajo solitario o nocturno con respuesta de emergencia limitada',
  ],
};

/** Generic seed hazards when the sector has no curated list (offices, etc.). */
const RIESGOS_DEFAULT: string[] = [
  'Riesgos psicosociales laborales (vigilancia CEAL-SM/SUSESO)',
  'Trastornos musculoesqueléticos por trabajo repetitivo o postura mantenida',
  'Caídas al mismo nivel',
  'Fatiga visual por uso prolongado de pantallas',
  'Accidentes de trayecto',
];

/** Normalises wizard input ('GP-X-Y: label' or 'GP-X-Y') to the GP id. */
function normalizeSectorId(sectorId: string): string {
  return sectorId.split(':')[0].trim();
}

/** Longest-prefix lookup in a GP-keyed record ('GP-ADM-SEG' beats 'GP-ADM'). */
function longestPrefixMatch<T>(record: Record<string, T>, sectorId: string): T | undefined {
  let best: T | undefined;
  let bestLength = -1;
  for (const [key, value] of Object.entries(record)) {
    if ((sectorId === key || sectorId.startsWith(`${key}-`)) && key.length > bestLength) {
      best = value;
      bestLength = key.length;
    }
  }
  return best;
}

/**
 * Builds the preventive profile for a GP-* sector from the CL pack,
 * EPP_BY_SECTOR and the curated seed hazard lists. Pure and total: unknown
 * sector ids degrade to the universal base profile.
 */
export function getRiskProfileForSector(sectorId: string): IndustryRiskProfile {
  const id = normalizeSectorId(sectorId);
  const sectorPrefix = id.split('-').slice(0, 2).join('-');

  const regulationIds = [
    ...BASE_REGULATION_IDS,
    ...(longestPrefixMatch(SECTOR_REGULATION_IDS, id) ?? []),
  ];
  const seen = new Set<string>();
  const regulations: Regulation[] = [];
  for (const regId of regulationIds) {
    if (seen.has(regId)) continue;
    seen.add(regId);
    const regulation = CL_PACK.regulations.find((r) => r.id === regId);
    // Selection table only references real pack ids (pinned by tests);
    // skip silently if a pack entry is ever renamed instead of crashing.
    if (regulation) regulations.push({ ...regulation });
  }

  return {
    sectorId: id,
    sectorPrefix,
    regulations,
    epp: (longestPrefixMatch(EPP_BY_SECTOR, id) ?? EPP_DEFAULT).map((e) => ({ ...e })),
    riesgosTipicos: [...(longestPrefixMatch(RIESGOS_POR_SECTOR, id) ?? RIESGOS_DEFAULT)],
    notasPreventivas: [...(longestPrefixMatch(SECTOR_NOTAS, id) ?? [])],
  };
}

/**
 * Derives DS 44/2024 headcount obligations from the pack thresholds — the
 * numbers are READ from `pack.thresholds`, never hardcoded:
 *  - headcount ≥ comité threshold → CPHS;
 *  - 1..(comité threshold - 1) → delegado(a) de SST;
 *  - headcount ≥ prevention-department threshold → Departamento de Prevención.
 */
export function obligacionesPorDotacion(
  workerCount: number,
  pack: CountryPack,
): ObligacionesDotacion {
  const { comiteRequiredAtWorkers, preventionDeptRequiredAtWorkers, monthlyMeetingsRequired } =
    pack.thresholds;

  const cphsRequired = workerCount >= comiteRequiredAtWorkers;
  const delegadoSstRequired = workerCount > 0 && !cphsRequired;
  const preventionDeptRequired = workerCount >= preventionDeptRequiredAtWorkers;

  const obligaciones: string[] = [];
  if (delegadoSstRequired) {
    obligaciones.push(
      `Designar delegado(a) de Seguridad y Salud en el Trabajo (dotación bajo ${comiteRequiredAtWorkers} personas trabajadoras).`,
    );
  }
  if (cphsRequired) {
    obligaciones.push(
      `Constituir Comité Paritario de Higiene y Seguridad (CPHS) — dotación de ${comiteRequiredAtWorkers} o más personas trabajadoras.`,
    );
    if (monthlyMeetingsRequired) {
      obligaciones.push('Realizar reuniones mensuales del CPHS y dejar acta de cada sesión.');
    }
  }
  if (preventionDeptRequired) {
    obligaciones.push(
      `Contar con Departamento de Prevención de Riesgos a cargo de un(a) experto(a) en prevención — dotación de ${preventionDeptRequiredAtWorkers} o más personas trabajadoras.`,
    );
  }

  return { cphsRequired, delegadoSstRequired, preventionDeptRequired, obligaciones };
}
