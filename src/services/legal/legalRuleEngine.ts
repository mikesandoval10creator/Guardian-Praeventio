// Praeventio Guard — Sprint 39 Fase B.10: abogado codificado.
//
// Cierra: Documento usuario "Ideas implementables §2.6"
//         Plan integral Fase B.10
//
// Reglas determinísticas (NO LLM) que sugieren obligaciones legales
// chilenas según el perfil del proyecto. Las reglas son evaluadas en
// orden; cada una contribuye un `LegalRequirement` con cita normativa.
//
// Filosofía:
//   - El sistema NO bloquea: solo SUGIERE. La decisión final es de la
//     empresa y su prevencionista (regla de producto "no bloquear
//     maquinaria, solo recomendar científicamente").
//   - Las citas normativas son chilenas (Ley 16.744 + DS 54/76/78/109/
//     132/594). Roadmap Fase E.4 añade jurisdicciones UK/CA/AU/JP/KR/
//     IN con su propio engine paralelo.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ProjectProfile {
  /** Cantidad total de trabajadores del proyecto. */
  workersCount: number;
  /** Sector industrial (GP-MIN, GP-CONS, GP-ELEC, GP-SAL, ...). */
  industry?: string;
  /** Lista de riskTypes presentes en el proyecto (e.g. 'silice', 'altura'). */
  presentRisks?: string[];
  /** Si la operación incluye sustancias peligrosas declaradas. */
  hasHazmat?: boolean;
  /** Si la empresa usa contratistas / subcontratistas. */
  hasSubcontractors?: boolean;
  /** Si hay trabajo en jornada nocturna. */
  hasNightShift?: boolean;
  /** Si hay exposición a trabajos pesados (Ley 19.404). */
  hasHeavyWork?: boolean;
}

export interface LegalRequirement {
  /** Id único de la regla (estable para tracking). */
  ruleId: string;
  /** Categoría: 'committee' | 'training' | 'process' | 'document' | 'medical'. */
  category: LegalCategory;
  /** Sugerencia accionable para el prevencionista. */
  recommendation: string;
  /** Normativa que respalda la sugerencia. */
  legalCitation: string;
  /** Urgencia: 'critical' = obligación legal directa, 'recommended' = mejor práctica. */
  urgency: LegalUrgency;
  /** Plazo sugerido para implementación. */
  suggestedDeadline?: string;
}

export type LegalCategory =
  | 'committee'
  | 'training'
  | 'process'
  | 'document'
  | 'medical'
  | 'epp';

export type LegalUrgency = 'critical' | 'recommended';

// ────────────────────────────────────────────────────────────────────────
// Reglas
//
// 10 reglas iniciales (Chile). Cada una es self-contained — agregar más
// es PR pequeño + 1 test case.
// ────────────────────────────────────────────────────────────────────────

interface Rule {
  ruleId: string;
  predicate: (p: ProjectProfile) => boolean;
  build: (p: ProjectProfile) => Omit<LegalRequirement, 'ruleId'>;
}

const RULES: Rule[] = [
  // 1. CPHS — Comité Paritario obligatorio sobre 25 trabajadores
  {
    ruleId: 'cphs_25_workers',
    predicate: (p) => p.workersCount >= 25,
    build: () => ({
      category: 'committee',
      recommendation:
        'Constituir Comité Paritario de Higiene y Seguridad (CPHS) con 3 representantes ' +
        'del empleador + 3 de los trabajadores. Acta firmada + Ministerio del Trabajo.',
      legalCitation: 'DS 54 / Ley 16.744 art. 66',
      urgency: 'critical',
      suggestedDeadline: '30 días desde superar los 25 trabajadores',
    }),
  },

  // 2. Departamento de Prevención — obligatorio sobre 100 trabajadores
  {
    ruleId: 'prevention_dept_100_workers',
    predicate: (p) => p.workersCount >= 100,
    build: () => ({
      category: 'process',
      recommendation:
        'Constituir Departamento de Prevención de Riesgos a cargo de un experto en ' +
        'prevención inscrito en SUSESO. Mantener registros de horas dedicadas.',
      legalCitation: 'Ley 16.744 art. 8 + DS 44/2024 (reemplaza DS 40/1969, derogado 2025-02-01)',
      urgency: 'critical',
    }),
  },

  // 3. Sílice — protocolo MINSAL vigilancia médica
  {
    ruleId: 'silice_minsal_protocol',
    predicate: (p) =>
      (p.presentRisks ?? []).some((r) => /silice|silicosis|polvo.*respir/i.test(r)),
    build: () => ({
      category: 'medical',
      recommendation:
        'Implementar Programa de Vigilancia Médica para exposición a sílice: ' +
        'evaluación pre-ocupacional + radiografías anuales + espirometrías + ' +
        'medición ambiental sílice respirable < 0.025 mg/m³.',
      legalCitation: 'Protocolo MINSAL 2015 + DS 594 art. 60 + Ley 16.744',
      urgency: 'critical',
    }),
  },

  // 4. Minería — DS 132 obligaciones específicas
  {
    ruleId: 'mining_ds132',
    predicate: (p) => /^GP-MIN/i.test(p.industry ?? ''),
    build: () => ({
      category: 'process',
      recommendation:
        'Aplicar Reglamento de Seguridad Minera (DS 132): plan de emergencia + ' +
        'capacitación rescate minero + ventilación documentada + fortificación ' +
        'inspeccionada. Cumplir además con Ley 16.744 art. 76 (DIAT/DIEP).',
      legalCitation: 'DS 132 + DS 594 + Ley 16.744',
      urgency: 'critical',
    }),
  },

  // 5. Construcción — DS 76 + Ley 20.123 subcontratación
  {
    ruleId: 'construction_ds76',
    predicate: (p) => /^GP-CONS/i.test(p.industry ?? ''),
    build: (p) => ({
      category: 'process',
      recommendation:
        'Aplicar Reglamento para Seguridad y Salud Ocupacional en obras (DS 76). ' +
        (p.hasSubcontractors
          ? 'Empresa principal mantiene responsabilidad subsidiaria por contratistas ' +
            'según Ley 20.123 — registro mensual ChileCompra + acreditación SUSESO.'
          : ''),
      legalCitation: 'DS 76 + Ley 20.123 (si subcontrata)',
      urgency: 'critical',
    }),
  },

  // 6. Trabajo en altura — DS 594 art. 53
  {
    ruleId: 'altura_ds594',
    predicate: (p) => (p.presentRisks ?? []).some((r) => /altura|caida.*nivel/i.test(r)),
    build: () => ({
      category: 'training',
      recommendation:
        'Capacitación obligatoria "Trabajo en Altura" + curso de rescate vigente ' +
        'antes de exposición. Inspección diaria de arnés y línea de vida. ' +
        'Permiso de trabajo en altura firmado por supervisor.',
      legalCitation: 'DS 594 art. 53 + DS 76',
      urgency: 'critical',
    }),
  },

  // 7. Eléctricos — DS 132 / SEC
  {
    ruleId: 'electric_ds132_sec',
    predicate: (p) =>
      /^GP-ELEC/i.test(p.industry ?? '') ||
      (p.presentRisks ?? []).some((r) => /electric|tension|loto/i.test(r)),
    build: () => ({
      category: 'training',
      recommendation:
        'Trabajadores con licencia SEC clase A/B/C según nivel de tensión. ' +
        'LOTO obligatorio antes de intervención. Capacitación arco eléctrico ' +
        'NFPA 70E o equivalente.',
      legalCitation: 'DS 132 baja tensión + DS 109 (alta tensión) + Reglamento SEC',
      urgency: 'critical',
    }),
  },

  // 8. Hazmat / DS 78
  {
    ruleId: 'hazmat_ds78',
    predicate: (p) => p.hasHazmat === true,
    build: () => ({
      category: 'document',
      recommendation:
        'Mantener Hoja de Datos de Seguridad (HDS) de cada sustancia + plan ' +
        'derrames + bodegas con incompatibilidades + capacitación nivel HAZMAT. ' +
        'Comunicación de peligros (NCh 2245).',
      legalCitation: 'DS 78 + DS 43 + NCh 2245',
      urgency: 'critical',
    }),
  },

  // 9. Trabajo nocturno — DS 594 + Ley 20.949
  {
    ruleId: 'night_shift_ds594',
    predicate: (p) => p.hasNightShift === true,
    build: () => ({
      category: 'medical',
      recommendation:
        'Evaluación de aptitud médica anual para trabajadores nocturnos. ' +
        'Pausas obligatorias + descanso 11h entre turnos + iluminación mínima ' +
        '300 lux en áreas de trabajo.',
      legalCitation: 'DS 594 art. 102-104 + Código del Trabajo art. 38',
      urgency: 'critical',
    }),
  },

  // 10. Trabajos pesados — Ley 19.404
  {
    ruleId: 'heavy_work_ley19404',
    predicate: (p) => p.hasHeavyWork === true,
    build: () => ({
      category: 'document',
      recommendation:
        'Calificar las labores como "Trabajo Pesado" ante SUSESO (Ley 19.404). ' +
        'Trabajadores aportan 4% adicional al fondo de pensiones para retiro ' +
        'anticipado. Empleador aporta 2% adicional.',
      legalCitation: 'Ley 19.404 + DS 71',
      urgency: 'recommended',
    }),
  },
];

// ────────────────────────────────────────────────────────────────────────
// API principal
// ────────────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las obligaciones legales que aplican al perfil del
 * proyecto. Reglas evaluadas en orden — el output mantiene ese orden.
 */
export function getRequirementsForProject(profile: ProjectProfile): LegalRequirement[] {
  return RULES.filter((r) => r.predicate(profile)).map((r) => ({
    ruleId: r.ruleId,
    ...r.build(profile),
  }));
}

/**
 * Filtra solo las críticas (no las recommended). Útil para semáforo
 * cumplimiento Fase F.2 — críticas en rojo si no están atendidas.
 */
export function getCriticalRequirements(profile: ProjectProfile): LegalRequirement[] {
  return getRequirementsForProject(profile).filter((r) => r.urgency === 'critical');
}
