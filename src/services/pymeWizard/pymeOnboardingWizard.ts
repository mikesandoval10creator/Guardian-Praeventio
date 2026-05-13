// Praeventio Guard — Sprint K: PYME Onboarding Wizard rápido.
//
// Cierra: §105 (3ra tanda usuario).
//
// Asistente determinístico para empresas pequeñas (5-50 trabajadores) que
// necesitan onboarding < 30 minutos. Calcula plan de pasos según industria,
// tamaño y riesgos clave, con ruta crítica y módulos recomendados.
//
// Determinístico (sin LLM, sin I/O).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PymeIndustry =
  | 'construction'
  | 'mining'
  | 'agriculture'
  | 'industrial'
  | 'logistics'
  | 'services'
  | 'retail';

export type PymeKeyRisk =
  | 'falls_from_height'
  | 'chemical_exposure'
  | 'manual_handling'
  | 'vehicle_traffic'
  | 'noise'
  | 'electrical'
  | 'fire'
  | 'psychosocial'
  | 'biological';

export interface PymeOnboardingInput {
  industry: PymeIndustry;
  workerCount: number;
  keyRisks: PymeKeyRisk[];
  hasExistingRiohs?: boolean;
  hasExistingCphs?: boolean;
}

export type StepKind =
  | 'profile'
  | 'document'
  | 'committee'
  | 'training'
  | 'module_setup'
  | 'review';

export interface OnboardingStep {
  id: string;
  kind: StepKind;
  /** Texto legible (i18n key-style). */
  label: string;
  required: boolean;
  estimatedMinutes: number;
  /** Datos adicionales (módulo a activar, doc a generar, etc.). */
  payload?: Record<string, string | number | boolean>;
}

export interface OnboardingPlan {
  steps: OnboardingStep[];
  /** Minutos del quick-path required (objetivo <30 min). Codex P2 PR #129. */
  totalEstimatedMinutes: number;
  /** Minutos adicionales si la PYME decide setupear módulos opcionales. */
  optionalSetupMinutes: number;
  /** IDs en orden de los pasos que NO pueden saltarse para legalidad/seguridad mínima. */
  criticalPath: string[];
  /** Módulos recomendados a activar tras el onboarding. */
  recommendedModules: string[];
  /** Notas regulatorias relevantes (Chile, baseline DS 594 / Ley 16.744). */
  regulatoryNotes: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function profileStep(input: PymeOnboardingInput): OnboardingStep {
  return {
    id: 'profile',
    kind: 'profile',
    label: 'wizard.step.profile',
    required: true,
    estimatedMinutes: 3,
    payload: { industry: input.industry, workerCount: input.workerCount },
  };
}

function riohsStep(input: PymeOnboardingInput): OnboardingStep {
  return {
    id: 'doc_riohs',
    kind: 'document',
    label: 'wizard.step.riohs',
    required: true,
    estimatedMinutes: input.hasExistingRiohs ? 3 : 8,
    payload: { docType: 'RIOHS', reuseExisting: !!input.hasExistingRiohs },
  };
}

function cphsStep(input: PymeOnboardingInput): OnboardingStep {
  return {
    id: 'committee_cphs',
    kind: 'committee',
    label: 'wizard.step.cphs',
    required: true,
    estimatedMinutes: input.hasExistingCphs ? 2 : 6,
    payload: { reuseExisting: !!input.hasExistingCphs },
  };
}

function inductionStep(): OnboardingStep {
  return {
    id: 'training_induction',
    kind: 'training',
    label: 'wizard.step.induction',
    required: true,
    estimatedMinutes: 5,
  };
}

function reviewStep(): OnboardingStep {
  return {
    id: 'final_review',
    kind: 'review',
    label: 'wizard.step.review',
    required: true,
    estimatedMinutes: 4,
  };
}

function riskTrainingStep(risk: PymeKeyRisk): OnboardingStep {
  return {
    id: `training_risk_${risk}`,
    kind: 'training',
    label: `wizard.step.training.${risk}`,
    required: true,
    estimatedMinutes: 3,
    payload: { risk },
  };
}

function moduleStep(moduleKey: string): OnboardingStep {
  return {
    id: `module_${moduleKey}`,
    kind: 'module_setup',
    label: `wizard.step.module.${moduleKey}`,
    required: false,
    estimatedMinutes: 2,
    payload: { module: moduleKey },
  };
}

function modulesForIndustry(industry: PymeIndustry): string[] {
  switch (industry) {
    case 'construction':
      return ['height_work', 'epp', 'incidents', 'documents'];
    case 'mining':
      return ['critical_controls', 'fatigue', 'epp', 'incidents'];
    case 'agriculture':
      return ['chemical', 'heat_stress', 'epp', 'documents'];
    case 'industrial':
      return ['epp', 'incidents', 'chemical', 'documents'];
    case 'logistics':
      return ['vehicle_safety', 'manual_handling', 'incidents'];
    case 'services':
      return ['psychosocial', 'ergonomics', 'documents'];
    case 'retail':
      return ['ergonomics', 'documents', 'incidents'];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────

export function buildOnboardingPlan(input: PymeOnboardingInput): OnboardingPlan {
  if (input.workerCount < 1) {
    throw new Error('workerCount must be at least 1');
  }

  const steps: OnboardingStep[] = [];
  const notes: string[] = [];

  steps.push(profileStep(input));
  steps.push(riohsStep(input));

  // CPHS regulation: Chile Ley 16.744 → obligatorio con ≥25 trabajadores.
  // Adicionalmente, construction con ≥25 SIEMPRE incluye CPHS aún si declaran no tenerlo.
  const cphsMandatory =
    input.workerCount >= 25 ||
    (input.industry === 'construction' && input.workerCount >= 25);

  if (cphsMandatory) {
    steps.push(cphsStep(input));
    notes.push('reg.cphs.mandatory_25plus');
  } else if (input.workerCount >= 10) {
    // Recomendado pero no obligatorio entre 10-24.
    const s = cphsStep(input);
    s.required = false;
    steps.push(s);
    notes.push('reg.cphs.recommended_10to24');
  }

  steps.push(inductionStep());

  // Training específico por riesgo clave, ordenado alfabéticamente para
  // determinismo. Codex P2 PR #129: dedupe upstream input — duplicados
  // como `['noise','noise']` generarían dos pasos con el mismo id que
  // colisionan en cualquier UI keyed por step.id.
  const uniqueRisks = Array.from(new Set(input.keyRisks)).sort();
  for (const risk of uniqueRisks) {
    steps.push(riskTrainingStep(risk));
  }

  // Módulos recomendados (no requeridos en el wizard, se setupean opcional).
  const modules = modulesForIndustry(input.industry);
  for (const m of modules) {
    steps.push(moduleStep(m));
  }

  steps.push(reviewStep());

  // Notas regulatorias adicionales.
  if (input.keyRisks.includes('chemical_exposure')) {
    notes.push('reg.ds594.chemical_inventory_required');
  }
  if (input.keyRisks.includes('falls_from_height')) {
    notes.push('reg.height_work_procedure_required');
  }
  if (input.industry === 'mining') {
    notes.push('reg.sernageomin.applicable');
  }

  // Codex P2 PR #129: `totalEstimatedMinutes` debe representar el "quick
  // onboarding <30 min" — solo cuenta los pasos required/critical-path,
  // NO los module_setup opcionales. Los optionales se exponen aparte vía
  // `optionalSetupMinutes` para que la UI muestre ambos.
  const totalEstimatedMinutes = steps
    .filter((s) => s.required)
    .reduce((acc, s) => acc + s.estimatedMinutes, 0);
  const optionalSetupMinutes = steps
    .filter((s) => !s.required)
    .reduce((acc, s) => acc + s.estimatedMinutes, 0);
  const criticalPath = steps.filter((s) => s.required).map((s) => s.id);

  return {
    steps,
    totalEstimatedMinutes,
    optionalSetupMinutes,
    criticalPath,
    recommendedModules: modules,
    regulatoryNotes: notes,
  };
}
