// Praeventio Guard — Sprint K: Continuidad Operacional + Punto Único de Falla + Polivalencia.
//
// Cierra: Documento usuario "§237-243"
//
// Detecta puntos únicos de falla (SPOF — Single Point of Failure) en:
//   - Personal clave
//   - Equipos críticos
//   - Proveedores únicos
//
// Y propone:
//   - Plan de polivalencia (cross-training)
//   - Simulador de escenarios ("si X se cae, qué pasa")
//   - Brecha de capacitación
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SpofKind = 'person' | 'equipment' | 'supplier' | 'document' | 'permit';

export interface SinglePointOfFailure {
  kind: SpofKind;
  /** Identificador de lo que es SPOF. */
  id: string;
  label: string;
  /** Servicios/tareas que dependen únicamente de este recurso. */
  dependentTasks: string[];
  /** Impacto si cae (operational, safety, compliance). */
  impactScopes: Array<'operational' | 'safety' | 'compliance'>;
  /** Mitigación recomendada. */
  mitigation: string;
}

export interface ContinuityInput {
  /** Personas con habilidades únicas (NO replicadas). */
  uniqueSkillHolders: Array<{ uid: string; skill: string; dependentTasks: string[] }>;
  /** Equipos críticos sin backup. */
  equipmentWithoutBackup: Array<{ id: string; label: string; dependentTasks: string[] }>;
  /** Proveedores únicos por servicio crítico. */
  soleSuppliers: Array<{ supplierId: string; service: string }>;
  /** Documentos críticos sin versión de respaldo física/digital. */
  unbackedCriticalDocs: Array<{ docId: string; title: string }>;
}

export function detectSPOFs(input: ContinuityInput): SinglePointOfFailure[] {
  const spofs: SinglePointOfFailure[] = [];

  for (const h of input.uniqueSkillHolders) {
    spofs.push({
      kind: 'person',
      id: h.uid,
      label: `${h.uid} (${h.skill})`,
      dependentTasks: h.dependentTasks,
      impactScopes: ['operational', 'safety'],
      mitigation: `Cross-training: identificar 2 candidatos para certificar en ${h.skill}.`,
    });
  }
  for (const eq of input.equipmentWithoutBackup) {
    spofs.push({
      kind: 'equipment',
      id: eq.id,
      label: eq.label,
      dependentTasks: eq.dependentTasks,
      impactScopes: ['operational'],
      mitigation: `Adquirir equipo backup o acuerdo de leasing emergencia para ${eq.label}.`,
    });
  }
  for (const s of input.soleSuppliers) {
    spofs.push({
      kind: 'supplier',
      id: s.supplierId,
      label: s.supplierId,
      dependentTasks: [],
      impactScopes: ['operational', 'compliance'],
      mitigation: `Calificar al menos un proveedor alternativo para ${s.service}.`,
    });
  }
  for (const d of input.unbackedCriticalDocs) {
    spofs.push({
      kind: 'document',
      id: d.docId,
      label: d.title,
      dependentTasks: [],
      impactScopes: ['compliance'],
      mitigation: `Guardar backup geográfico + digital con hash de integridad para ${d.title}.`,
    });
  }

  return spofs;
}

// ────────────────────────────────────────────────────────────────────────
// Scenario simulator (§239)
// ────────────────────────────────────────────────────────────────────────

export interface ScenarioInput {
  /** Qué recurso se "cae". */
  resourceId: string;
  resourceKind: SpofKind;
  /** Duración estimada de la caída (horas). */
  outageHours: number;
  /** SPOFs conocidos. */
  spofs: SinglePointOfFailure[];
}

export interface ScenarioOutcome {
  affectedTaskCount: number;
  affectedTasks: string[];
  productionStopHours: number;
  riskExposureHours: number;
  /** Plan de mitigación inmediata. */
  mitigationSteps: string[];
  /** Severity. */
  severity: 'minor' | 'moderate' | 'major' | 'catastrophic';
}

export function simulateOutage(input: ScenarioInput): ScenarioOutcome {
  const target = input.spofs.find(
    (s) => s.id === input.resourceId && s.kind === input.resourceKind,
  );
  if (!target) {
    return {
      affectedTaskCount: 0,
      affectedTasks: [],
      productionStopHours: 0,
      riskExposureHours: 0,
      mitigationSteps: ['Recurso no es SPOF — outage tiene impacto mínimo.'],
      severity: 'minor',
    };
  }

  const affectedTaskCount = target.dependentTasks.length;
  const productionStopHours = target.impactScopes.includes('operational')
    ? input.outageHours
    : 0;
  const riskExposureHours = target.impactScopes.includes('safety')
    ? input.outageHours
    : 0;

  let severity: ScenarioOutcome['severity'];
  if (target.impactScopes.includes('safety') && input.outageHours > 8) severity = 'catastrophic';
  else if (target.impactScopes.includes('safety')) severity = 'major';
  else if (affectedTaskCount > 5 || input.outageHours > 24) severity = 'major';
  else if (affectedTaskCount > 0) severity = 'moderate';
  else severity = 'minor';

  const mitigationSteps: string[] = [target.mitigation];
  if (severity === 'catastrophic') {
    mitigationSteps.push('Detener todas las tareas dependientes inmediatamente.');
    mitigationSteps.push('Notificar gerencia + cliente mandante.');
  } else if (severity === 'major') {
    mitigationSteps.push('Reasignar tareas a recursos alternativos donde sea posible.');
  }

  return {
    affectedTaskCount,
    affectedTasks: target.dependentTasks,
    productionStopHours,
    riskExposureHours,
    mitigationSteps,
    severity,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Polyvalence plan (§240-243)
// ────────────────────────────────────────────────────────────────────────

export interface SkillMatrix {
  workerUid: string;
  skills: Set<string>;
}

export interface PolyvalencePlan {
  /** Habilidades canónicas requeridas en faena. */
  requiredSkills: string[];
  /** % de workers que tienen cada habilidad. */
  coverageBySkill: Record<string, number>;
  /** Habilidades con cobertura insuficiente. */
  underCoveredSkills: string[];
  /** Sugerencias de pares para cross-training. */
  trainingPairs: Array<{ trainer: string; trainee: string; skill: string }>;
}

export function buildPolyvalencePlan(
  matrix: SkillMatrix[],
  requiredSkills: string[],
  minCoveragePercent: number = 30,
): PolyvalencePlan {
  const coverageBySkill: Record<string, number> = {};
  const matrixSize = matrix.length;

  for (const skill of requiredSkills) {
    const holders = matrix.filter((m) => m.skills.has(skill)).length;
    coverageBySkill[skill] = matrixSize > 0 ? Math.round((holders / matrixSize) * 100) : 0;
  }

  const underCoveredSkills = requiredSkills.filter(
    (s) => coverageBySkill[s] < minCoveragePercent,
  );

  const trainingPairs: Array<{ trainer: string; trainee: string; skill: string }> = [];
  for (const skill of underCoveredSkills) {
    const trainers = matrix.filter((m) => m.skills.has(skill));
    const trainees = matrix.filter((m) => !m.skills.has(skill));
    // Empareja round-robin
    for (let i = 0; i < Math.min(trainers.length, trainees.length); i++) {
      trainingPairs.push({
        trainer: trainers[i].workerUid,
        trainee: trainees[i].workerUid,
        skill,
      });
    }
  }

  return {
    requiredSkills,
    coverageBySkill,
    underCoveredSkills,
    trainingPairs,
  };
}
