// Praeventio Guard — Sprint K: Modo PYME wizard rápido + Madurez Preventiva.
//
// Cierra: Documento usuario "§104-105, §110, F.26"
//
// Wizard de onboarding para PYMEs (10-50 trabajadores) que típicamente
// no tienen prevencionista dedicado. El wizard:
//   - Pregunta esenciales (industria, trabajadores, riesgos principales)
//   - Configura el proyecto con presets industriales
//   - Calcula índice de madurez preventiva (Nivel 1-5)
//   - Sugiere plan 30 días con acciones priorizadas
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PymeIndustry = 'construction' | 'mining' | 'agriculture' | 'industrial' | 'logistics' | 'services';

export interface PymeWizardInput {
  industry: PymeIndustry;
  workerCount: number;
  /** Si tiene supervisor o jefe terreno dedicado. */
  hasSupervisor: boolean;
  /** Si tiene CPHS funcionando. */
  hasCphs: boolean;
  /** Si tiene RIOHS aprobado. */
  hasRiohs: boolean;
  /** Si tiene programa de capacitación. */
  hasTrainingProgram: boolean;
  /** Si registra incidentes. */
  registersIncidents: boolean;
  /** Si tiene mutualidad activa. */
  hasMutualidad: boolean;
  /** Si usa EPP normado por DS 594. */
  usesNormedEpp: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Maturity index (F.26)
// ────────────────────────────────────────────────────────────────────────

export type MaturityLevel = 1 | 2 | 3 | 4 | 5;

export interface MaturityReport {
  level: MaturityLevel;
  label: 'reactive' | 'compliant' | 'proactive' | 'systematic' | 'autonomous';
  score: number; // 0-100
  /** Capacidades faltantes ordenadas por importancia. */
  missingCapabilities: string[];
  /** Próximas 3 capacidades a desarrollar. */
  nextSteps: string[];
}

const LEVEL_LABELS: Record<MaturityLevel, MaturityReport['label']> = {
  1: 'reactive',
  2: 'compliant',
  3: 'proactive',
  4: 'systematic',
  5: 'autonomous',
};

export function computeMaturity(input: PymeWizardInput): MaturityReport {
  let score = 0;
  const missing: string[] = [];

  // Compliance básico (Ley 16.744 + DS 594) — Level 2
  if (input.hasMutualidad) score += 15;
  else missing.push('Activar afiliación a mutualidad (Ley 16.744 obligatorio).');

  if (input.usesNormedEpp) score += 10;
  else missing.push('Adquirir EPP certificado DS 594.');

  if (input.hasRiohs) score += 15;
  else missing.push('Redactar Reglamento Interno (RIOHS).');

  // CPHS obligatorio >=25 workers
  if (input.workerCount >= 25 && !input.hasCphs) {
    missing.push('Formar CPHS — obligatorio para empresas con ≥25 trabajadores (DS 54).');
  } else if (input.hasCphs) {
    score += 15;
  } else if (input.workerCount < 25) {
    score += 10; // no obligatorio para PYME pequeña
  }

  if (input.hasSupervisor) score += 10;
  else missing.push('Designar supervisor de prevención (DS 76 si >25 workers).');

  if (input.hasTrainingProgram) score += 15;
  else missing.push('Establecer programa anual de capacitación (DS 594).');

  if (input.registersIncidents) score += 20;
  else missing.push('Registrar incidentes y near-miss sistemáticamente.');

  // Nivel calculado
  let level: MaturityLevel;
  if (score >= 85) level = 5;
  else if (score >= 70) level = 4;
  else if (score >= 50) level = 3;
  else if (score >= 30) level = 2;
  else level = 1;

  const nextSteps = missing.slice(0, 3);

  return {
    level,
    label: LEVEL_LABELS[level],
    score,
    missingCapabilities: missing,
    nextSteps,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 30-day plan (§111)
// ────────────────────────────────────────────────────────────────────────

export interface PlanAction {
  day: number; // 1-30
  title: string;
  /** Por qué importa. */
  rationale: string;
  /** Si requiere especialista o se hace internal. */
  requiresSpecialist: boolean;
}

export function buildThirtyDayPlan(maturity: MaturityReport, industry: PymeIndustry): PlanAction[] {
  const plan: PlanAction[] = [];

  // Universal en todos los planes
  if (maturity.missingCapabilities.some((m) => m.includes('mutualidad'))) {
    plan.push({
      day: 1,
      title: 'Activar afiliación mutualidad',
      rationale: 'Requisito legal Ley 16.744. Sin esto, todo lo demás queda en riesgo de invalidez.',
      requiresSpecialist: false,
    });
  }
  if (maturity.missingCapabilities.some((m) => m.includes('RIOHS'))) {
    plan.push({
      day: 3,
      title: 'Generar RIOHS borrador',
      rationale: 'Praeventio incluye plantilla pre-poblada por industria.',
      requiresSpecialist: false,
    });
  }
  if (maturity.missingCapabilities.some((m) => m.includes('EPP'))) {
    plan.push({
      day: 7,
      title: 'Comprar EPP base por industria',
      rationale: `Para ${industry}: kit base de ${industry === 'construction' ? 'arnés, casco, lentes, guantes anticorte' : 'EPP estándar industria'}.`,
      requiresSpecialist: false,
    });
  }
  if (maturity.missingCapabilities.some((m) => m.includes('supervisor'))) {
    plan.push({
      day: 10,
      title: 'Designar supervisor SST',
      rationale: 'Puede ser un trabajador interno capacitado en curso básico mutualidad.',
      requiresSpecialist: false,
    });
  }
  if (maturity.missingCapabilities.some((m) => m.includes('CPHS'))) {
    plan.push({
      day: 15,
      title: 'Constituir CPHS',
      rationale: 'Convocar elección representantes trabajadores. Praeventio genera acta.',
      requiresSpecialist: false,
    });
  }
  if (maturity.missingCapabilities.some((m) => m.includes('capacitación'))) {
    plan.push({
      day: 20,
      title: 'Programar capacitaciones críticas año',
      rationale: 'Mutualidad ofrece cursos gratuitos. Plan anual obligatorio DS 594.',
      requiresSpecialist: false,
    });
  }
  if (maturity.missingCapabilities.some((m) => m.includes('incidentes'))) {
    plan.push({
      day: 25,
      title: 'Capacitar equipo en reporte de incidentes',
      rationale: 'Sin registro, no hay aprendizaje. Praeventio ofrece flujo guiado.',
      requiresSpecialist: false,
    });
  }
  plan.push({
    day: 30,
    title: 'Primera revisión mensual',
    rationale: 'Evaluar avance + ajustar plan próximos 60 días.',
    requiresSpecialist: false,
  });

  return plan;
}
