// Praeventio Guard — Sprint K: Mapa de Roles Críticos + Sustitutos.
//
// Cierra: Documento usuario "§271-272" (complementa L.1 con flujo
// de detección de cargos indispensables y plan de sucesión).
//
// Mientras `operationalVulnerabilityMap.ts` (L.1) produce el reporte
// final, este módulo:
//   - Define el catálogo de cargos críticos por industria
//   - Construye matriz de sustitutos (titular + N candidatos)
//   - Calcula `bus factor` por rol crítico
//   - Sugiere plan de capacitación para llegar al mínimo

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Industry = 'mining' | 'construction' | 'industrial' | 'agriculture' | 'electrical' | 'logistics';

export interface CriticalRoleDefinition {
  /** Codigo canónico del rol. */
  code: string;
  label: string;
  /** Industrias donde aplica. */
  industries: Industry[];
  /** Mínimo de personas autorizadas para operar sin riesgo. */
  minimumAuthorized: number;
  /** Trainings requeridos (códigos). */
  requiredTrainings: string[];
  /** Documentos/licencias requeridos. */
  requiredDocuments: string[];
  /** Tareas que NO se pueden ejecutar sin este rol. */
  blocksTaskCategories: string[];
}

/**
 * Catálogo curado. Agregar industria/rol = 1 entry. Extender sin tocar
 * la API consumidora.
 */
export const ROLE_CATALOG: CriticalRoleDefinition[] = [
  {
    code: 'grua_operator',
    label: 'Operador autorizado de grúa',
    industries: ['mining', 'construction', 'industrial', 'logistics'],
    minimumAuthorized: 2,
    requiredTrainings: ['grua_operator_curso', 'altura_R1'],
    requiredDocuments: ['licencia_grua', 'examen_psicotecnico'],
    blocksTaskCategories: ['izaje', 'movimiento_carga'],
  },
  {
    code: 'rigger',
    label: 'Rigger certificado',
    industries: ['mining', 'construction', 'industrial'],
    minimumAuthorized: 2,
    requiredTrainings: ['rigger_curso'],
    requiredDocuments: ['certificacion_rigger'],
    blocksTaskCategories: ['izaje'],
  },
  {
    code: 'electrician_sec',
    label: 'Electricista con licencia SEC',
    industries: ['mining', 'construction', 'industrial', 'electrical'],
    minimumAuthorized: 2,
    requiredTrainings: ['electric_safety', 'arc_flash'],
    requiredDocuments: ['licencia_sec_clase_a'],
    blocksTaskCategories: ['electric', 'loto'],
  },
  {
    code: 'confined_space_supervisor',
    label: 'Supervisor de espacios confinados',
    industries: ['mining', 'industrial'],
    minimumAuthorized: 1,
    requiredTrainings: ['confined_space', 'rescue_basic'],
    requiredDocuments: ['cert_confined_space'],
    blocksTaskCategories: ['confinado'],
  },
  {
    code: 'blasting_specialist',
    label: 'Especialista en tronaduras',
    industries: ['mining'],
    minimumAuthorized: 1,
    requiredTrainings: ['blasting_R1'],
    requiredDocuments: ['licencia_explosivos_dgmn'],
    blocksTaskCategories: ['tronadura'],
  },
  {
    code: 'forklift_operator',
    label: 'Operador grúa horquilla',
    industries: ['logistics', 'industrial', 'construction'],
    minimumAuthorized: 3,
    requiredTrainings: ['forklift_curso'],
    requiredDocuments: ['licencia_clase_d'],
    blocksTaskCategories: ['movimiento_pallets'],
  },
  {
    code: 'medical_emergency_response',
    label: 'Brigadista primeros auxilios',
    industries: ['mining', 'construction', 'industrial', 'agriculture', 'electrical', 'logistics'],
    minimumAuthorized: 2,
    requiredTrainings: ['primeros_auxilios_basico'],
    requiredDocuments: [],
    blocksTaskCategories: [],
  },
];

export function getRolesForIndustry(industry: Industry): CriticalRoleDefinition[] {
  return ROLE_CATALOG.filter((r) => r.industries.includes(industry));
}

export function findRoleByCode(code: string): CriticalRoleDefinition | undefined {
  return ROLE_CATALOG.find((r) => r.code === code);
}

// ────────────────────────────────────────────────────────────────────────
// Substitute matrix (§272)
// ────────────────────────────────────────────────────────────────────────

export interface WorkerProfile {
  uid: string;
  fullName: string;
  isActive: boolean;
  activeTrainings: string[];
  activeDocuments: string[];
  /** Trainings en curso (aún no completados). */
  trainingsInProgress: string[];
}

export type CertificationStatus = 'titular' | 'sustituto' | 'en_capacitacion' | 'no_apto';

export interface RoleCoverage {
  role: CriticalRoleDefinition;
  titulars: WorkerProfile[];
  substitutes: WorkerProfile[];
  inTraining: WorkerProfile[];
  /** Bus factor: cuántos se pueden caer sin perder cobertura mínima. */
  busFactor: number;
  /** True si el rol queda inviable si pierde a 1 persona. */
  isFragile: boolean;
}

function classifyWorkerForRole(
  worker: WorkerProfile,
  role: CriticalRoleDefinition,
): CertificationStatus {
  if (!worker.isActive) return 'no_apto';
  const trainingsOk = role.requiredTrainings.every((t) => worker.activeTrainings.includes(t));
  const docsOk = role.requiredDocuments.every((d) => worker.activeDocuments.includes(d));
  if (trainingsOk && docsOk) {
    return 'titular';
  }
  // Sustituto: tiene los trainings pero no todos los documentos (sigue siendo apto operacional)
  if (trainingsOk && !docsOk) return 'sustituto';
  // En capacitación: tiene algún training en curso o le falta solo 1 training/doc
  const trainingsInProgress = role.requiredTrainings.some((t) =>
    worker.trainingsInProgress.includes(t),
  );
  if (trainingsInProgress) return 'en_capacitacion';
  return 'no_apto';
}

export function buildRoleCoverage(
  role: CriticalRoleDefinition,
  workers: WorkerProfile[],
): RoleCoverage {
  const titulars: WorkerProfile[] = [];
  const substitutes: WorkerProfile[] = [];
  const inTraining: WorkerProfile[] = [];

  for (const w of workers) {
    const status = classifyWorkerForRole(w, role);
    if (status === 'titular') titulars.push(w);
    else if (status === 'sustituto') substitutes.push(w);
    else if (status === 'en_capacitacion') inTraining.push(w);
  }

  const totalCertified = titulars.length + substitutes.length;
  const busFactor = Math.max(0, totalCertified - role.minimumAuthorized);
  const isFragile = totalCertified <= role.minimumAuthorized;

  return { role, titulars, substitutes, inTraining, busFactor, isFragile };
}

// ────────────────────────────────────────────────────────────────────────
// Training plan suggestion (§275 — plan de redundancia)
// ────────────────────────────────────────────────────────────────────────

export interface TrainingPlan {
  roleCode: string;
  /** Trabajadores candidatos: tienen algo en curso o trainings parciales. */
  recommendedCandidates: WorkerProfile[];
  /** Trainings a programar (rolloout). */
  missingTrainings: string[];
  /** Estimación días para tener cobertura mínima. */
  estimatedDaysToCoverage: number;
  message: string;
}

const TRAINING_DURATION_DAYS = 14; // estimación canónica por curso

export function suggestTrainingPlan(
  coverage: RoleCoverage,
  workers: WorkerProfile[],
): TrainingPlan {
  const candidates = workers.filter((w) => {
    if (!w.isActive) return false;
    const status = classifyWorkerForRole(w, coverage.role);
    return status === 'en_capacitacion' || status === 'sustituto';
  });

  const missingTrainings: string[] = [];
  for (const t of coverage.role.requiredTrainings) {
    if (!candidates.some((c) => c.activeTrainings.includes(t))) {
      missingTrainings.push(t);
    }
  }

  const gap = Math.max(0, coverage.role.minimumAuthorized - coverage.titulars.length);
  const estimatedDaysToCoverage = missingTrainings.length * TRAINING_DURATION_DAYS;

  let message: string;
  if (gap === 0 && !coverage.isFragile) {
    message = `Rol ${coverage.role.label} con cobertura adecuada (bus factor ${coverage.busFactor}).`;
  } else if (candidates.length === 0) {
    message = `URGENTE: rol ${coverage.role.label} sin candidatos en capacitación. Iniciar reclutamiento.`;
  } else {
    message = `${candidates.length} candidato(s) en proceso. Estimado ${estimatedDaysToCoverage}d para cubrir.`;
  }

  return {
    roleCode: coverage.role.code,
    recommendedCandidates: candidates,
    missingTrainings,
    estimatedDaysToCoverage,
    message,
  };
}
