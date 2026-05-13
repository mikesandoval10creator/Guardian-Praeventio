// Praeventio Guard — Sprint 52 §170: Consultative Sale Playbook.
//
// Cierra §170 de la 2da tanda usuario. Engine que dado un prospect
// (empresa con su contexto: industria, tamaño, dolor actual, jurisdicción)
// produce un sales playbook personalizado:
//   - Qué módulos del producto resuelven sus pains específicos
//   - Qué preguntas hacer en el discovery call
//   - Qué casos de éxito mostrar
//   - Qué objections anticipar + cómo responderlas
//   - Pricing tier recomendado + justificación

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Industry =
  | 'mining'
  | 'construction'
  | 'agriculture'
  | 'manufacturing'
  | 'energy'
  | 'transport'
  | 'services'
  | 'health'
  | 'education'
  | 'retail'
  | 'other';

export type CompanySize = 'micro' | 'small' | 'medium' | 'large' | 'enterprise';

export type SuggestedTier = 'free' | 'starter' | 'pro' | 'enterprise';

export type Pain =
  | 'manual_paperwork_heavy'      // §259 admin burden
  | 'difficult_audit_prep'         // F.1 audit express
  | 'high_incident_rate'           // F.13 risk radar
  | 'lack_visibility_field'        // F.21 shift risk
  | 'unclear_compliance_status'    // F.2 traffic light
  | 'training_compliance_gaps'     // §247 skill gap
  | 'multi_site_coordination'      // F.27 comparator
  | 'lone_worker_safety'           // C.5 SOS + loneWorker
  | 'reactive_culture'             // §61 culture
  | 'contractor_management'        // §35 vendor onboarding
  | 'mutual_reporting_burden'      // D.8.a SUSESO
  | 'budget_constraints'           // §174 ROI
  | 'regulatory_change_overload';  // §163 drift + B.10 legalEngine

export interface ProspectContext {
  companyName: string;
  industry: Industry;
  size: CompanySize;
  workersCount: number;
  projectsActive?: number;
  /** Jurisdicción primaria. */
  jurisdiction: 'CL' | 'AR' | 'PE' | 'MX' | 'CO' | 'BR' | 'UK' | 'CA' | 'AU' | 'JP' | 'KR' | 'IN' | 'US' | 'EU';
  /** Pains que el prospect declaró. */
  declaredPains: Pain[];
  /** Si compite con algún producto en cancha. */
  currentSolution?: 'paper'|'spreadsheets'|'generic_saas'|'competitor_a'|'competitor_b'|'in_house';
  /** Si es renovación o nueva venta. */
  stage: 'discovery'|'qualification'|'demo'|'proposal'|'closing'|'renewal';
}

export interface ProductModule {
  id: string;
  name: string;
  /** Pains que resuelve. */
  resolves: Pain[];
  /** Tier mínimo que lo incluye. */
  minTier: SuggestedTier;
}

const PRODUCT_CATALOG: ProductModule[] = [
  { id: 'audit_express', name: 'Auditoría Express', resolves: ['difficult_audit_prep', 'manual_paperwork_heavy'], minTier: 'starter' },
  { id: 'risk_radar', name: 'Radar Riesgos Repetidos', resolves: ['high_incident_rate', 'reactive_culture'], minTier: 'starter' },
  { id: 'compliance_traffic_light', name: 'Semáforo Cumplimiento', resolves: ['unclear_compliance_status'], minTier: 'starter' },
  { id: 'shift_risk_panel', name: 'Panel Riesgo Turno', resolves: ['lack_visibility_field', 'high_incident_rate'], minTier: 'starter' },
  { id: 'sos_lone_worker', name: 'SOS + Lone Worker', resolves: ['lone_worker_safety'], minTier: 'starter' },
  { id: 'skill_gap_analyzer', name: 'Skill Gap + Plan Capacitación', resolves: ['training_compliance_gaps'], minTier: 'pro' },
  { id: 'multi_project_comparator', name: 'Comparador Multi-Proyecto', resolves: ['multi_site_coordination'], minTier: 'pro' },
  { id: 'vendor_onboarding', name: 'Portal Proveedores', resolves: ['contractor_management'], minTier: 'pro' },
  { id: 'culture_pulse', name: 'Cultura Pulse', resolves: ['reactive_culture'], minTier: 'pro' },
  { id: 'suseso_diat', name: 'SUSESO DIAT/DIEP', resolves: ['mutual_reporting_burden'], minTier: 'starter' },
  { id: 'roi_calculator', name: 'ROI + Cost Calculator', resolves: ['budget_constraints'], minTier: 'pro' },
  { id: 'legal_drift', name: 'Legal Rule Engine + Drift', resolves: ['regulatory_change_overload'], minTier: 'pro' },
  { id: 'inbox_prevencionista', name: 'Inbox Prevencionista', resolves: ['manual_paperwork_heavy'], minTier: 'starter' },
];

// ────────────────────────────────────────────────────────────────────────
// Tier recommendation
// ────────────────────────────────────────────────────────────────────────

function recommendTier(ctx: ProspectContext): { tier: SuggestedTier; reason: string } {
  // Enterprise size or 500+ workers → enterprise
  if (ctx.size === 'enterprise' || ctx.workersCount >= 500) {
    return { tier: 'enterprise', reason: 'Tamaño enterprise o ≥500 trabajadores' };
  }
  // Industria de alto riesgo (mining/construction/energy) + >50 workers → pro mínimo
  if (
    (ctx.industry === 'mining' || ctx.industry === 'construction' || ctx.industry === 'energy') &&
    ctx.workersCount > 50
  ) {
    return { tier: 'pro', reason: 'Industria alto riesgo + >50 trabajadores' };
  }
  // Pains avanzados (multi-site, skill gap, vendor management) → pro
  const advancedPains: Pain[] = ['multi_site_coordination', 'contractor_management', 'training_compliance_gaps', 'budget_constraints', 'regulatory_change_overload'];
  if (ctx.declaredPains.some((p) => advancedPains.includes(p))) {
    return { tier: 'pro', reason: 'Dolores que requieren features Pro' };
  }
  // Size medium o small con multiple pains → starter
  if (ctx.size === 'medium' || ctx.declaredPains.length >= 3) {
    return { tier: 'starter', reason: 'Tamaño medio o varios pains básicos' };
  }
  // Micro / muy chico → free para que pruebe
  return { tier: 'free', reason: 'Probar free tier antes de upgrade' };
}

// ────────────────────────────────────────────────────────────────────────
// Discovery questions per stage
// ────────────────────────────────────────────────────────────────────────

const DISCOVERY_QUESTIONS: Record<ProspectContext['stage'], string[]> = {
  discovery: [
    '¿Cómo manejan hoy los registros de inspecciones diarias?',
    '¿Cuánto tiempo le toma a tu prevencionista preparar un reporte mensual?',
    '¿Cuándo fue tu última auditoría externa y qué fue lo más complicado?',
    '¿Cómo capacitan a un trabajador nuevo en seguridad?',
    '¿Tienen visibilidad en tiempo real de qué está pasando en faena?',
  ],
  qualification: [
    '¿Quién toma la decisión de compra para herramientas de seguridad?',
    '¿Cuál es el presupuesto anual asignado a HSE?',
    '¿Qué resultados específicos esperarías ver en los primeros 90 días?',
    '¿Han evaluado otras soluciones? ¿Qué les faltó?',
  ],
  demo: [
    '¿Quieres que partamos por el módulo que más te interesa o un tour ejecutivo?',
    '¿Hay alguna situación reciente que quisieras ver cómo Guardian habría ayudado?',
    '¿Quiénes deberían estar presentes en la demo además de ti?',
  ],
  proposal: [
    '¿Qué objetions o dudas tiene tu equipo legal/IT sobre la propuesta?',
    '¿Necesitas un pilot project antes del rollout completo?',
    '¿Cuál es tu timeline ideal para arrancar?',
  ],
  closing: [
    '¿Hay algún tema pendiente que necesitemos resolver antes de firmar?',
    '¿Qué necesitas de mí para que esto pase esta semana?',
    '¿Quieres que prepare un kickoff plan ahora?',
  ],
  renewal: [
    '¿Cuáles fueron los 3 wins más visibles este año?',
    '¿Hay nuevos pains que no estamos cubriendo?',
    '¿Qué módulos NO usaron y por qué?',
  ],
};

// ────────────────────────────────────────────────────────────────────────
// Objections playbook
// ────────────────────────────────────────────────────────────────────────

export interface ObjectionResponse {
  objection: string;
  response: string;
  /** Métricas a citar para reforzar. */
  evidencePoints?: string[];
}

const OBJECTIONS_LIBRARY: ObjectionResponse[] = [
  {
    objection: 'Es caro para nuestro tamaño',
    response: 'El ROI típico se ve en 3-6 meses. Calculamos cuánto cuesta un incidente directo + indirecto Heinrich 4:1 y la inversión se recupera con prevenir 1 sólo evento medio al año.',
    evidencePoints: ['roi_calculator integrado', 'tier free + starter accesibles'],
  },
  {
    objection: 'Ya tenemos planillas Excel que funcionan',
    response: 'Excel no escala, no es auditable, y depende de quien lo mantiene. Guardian es 100% auditable + reportes automáticos + colaborativo multi-usuario.',
    evidencePoints: ['Compliance Score automático', 'Audit log inmutable', 'Multi-rol concurrente'],
  },
  {
    objection: 'No queremos sumar otra herramienta más',
    response: 'Guardian reemplaza ~10 herramientas (planillas Excel, papelitos, WhatsApp, archivadores, plantillas docx). Es consolidación, no fragmentación.',
    evidencePoints: ['Importador Excel + dedup', 'Plantillas RIOHS/DDR/ODI', 'Comms map integrado'],
  },
  {
    objection: 'Mis trabajadores no son tech-savvy',
    response: 'La UI prioriza pictogramas (modo easy_read), botones grandes (modo guantes), funciona offline, y solo el supervisor necesita conocer el sistema. El worker usa app mobile o QR.',
    evidencePoints: ['UX modes adaptativos', 'Offline-first', 'QR acknowledgement signing'],
  },
  {
    objection: 'No confío en la nube para datos médicos',
    response: 'ADR 0012 obliga separación PII médica con role claim adicional. Datos médicos sensibles viven en buckets aislados + jurisdicción configurable. Nunca cruzamos data a cloud externo sin tu autorización.',
    evidencePoints: ['ADR 0012 medical double-lock', 'Privacy regimes 8 codificados', 'Data residency per jurisdiction'],
  },
  {
    objection: 'Ya nos sentimos compliant',
    response: 'El compliance score objetivo lo dirá. Casi todos los clientes descubren gaps en sus primeras 2 semanas — no porque hayan sido negligentes, sino porque los gaps son sutiles (vencimientos, audit trail, etc).',
    evidencePoints: ['Semáforo compliance', 'Vencimientos universales', 'Consistency auditor diario'],
  },
];

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

export interface SalePlaybook {
  prospectName: string;
  recommendedTier: SuggestedTier;
  tierJustification: string;
  /** Módulos prioritarios para mostrar en demo. */
  priorityModules: Array<{ module: ProductModule; resolvesPainsCount: number }>;
  /** Preguntas para la siguiente conversación. */
  nextStageQuestions: string[];
  /** Objections potenciales priorizadas por probabilidad. */
  anticipatedObjections: ObjectionResponse[];
  /** Casos de éxito relevantes (industry + size match). */
  caseStudyHints: string[];
  /** Estimación de close probability 0-100. */
  estimatedCloseProb: number;
  /** Detalle de razones. */
  rationale: string[];
}

export function buildSalePlaybook(ctx: ProspectContext): SalePlaybook {
  const { tier, reason } = recommendTier(ctx);

  // Módulos prioritarios: filter por pains + tier accesible
  const tierRank: Record<SuggestedTier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
  const accessibleModules = PRODUCT_CATALOG.filter(
    (m) => tierRank[m.minTier] <= tierRank[tier],
  );
  const priorityModules = accessibleModules
    .map((m) => ({
      module: m,
      resolvesPainsCount: m.resolves.filter((p) => ctx.declaredPains.includes(p)).length,
    }))
    .filter((m) => m.resolvesPainsCount > 0)
    .sort((a, b) => b.resolvesPainsCount - a.resolvesPainsCount)
    .slice(0, 5);

  const nextStageQuestions = DISCOVERY_QUESTIONS[ctx.stage].slice(0, 4);

  // Objections priorizadas — siempre cita las 3 más universales primero
  const anticipatedObjections = OBJECTIONS_LIBRARY.slice(0, 4);

  // Case study hints
  const caseStudyHints: string[] = [];
  if (ctx.industry === 'mining') caseStudyHints.push('Mining mediano CL — Codelco contratista');
  if (ctx.industry === 'construction') caseStudyHints.push('Construcción CL — Echeverría Izquierdo');
  if (ctx.industry === 'energy') caseStudyHints.push('Energía + transmisión — Transelec');
  if (ctx.size === 'enterprise') caseStudyHints.push('Enterprise rollout 5+ sitios');
  if (ctx.workersCount >= 200) caseStudyHints.push('Caso con >200 trabajadores');

  // Close probability scoring
  let closeProb = 30; // base
  if (ctx.declaredPains.length >= 3) closeProb += 15;
  if (priorityModules.length >= 3) closeProb += 15;
  if (ctx.currentSolution === 'paper' || ctx.currentSolution === 'spreadsheets') closeProb += 20;
  if (ctx.stage === 'closing') closeProb += 20;
  else if (ctx.stage === 'proposal') closeProb += 10;
  if (ctx.size === 'micro' && tier === 'free') closeProb -= 10; // free no monetiza tanto
  closeProb = Math.max(0, Math.min(100, closeProb));

  const rationale: string[] = [];
  rationale.push(`Tier recomendado: ${tier} (${reason})`);
  rationale.push(`${priorityModules.length} módulos hit ${ctx.declaredPains.length} pains declarados`);
  if (ctx.currentSolution === 'paper' || ctx.currentSolution === 'spreadsheets') {
    rationale.push('Cliente en papel/Excel — alta oportunidad de salto');
  }
  if (ctx.industry === 'mining' || ctx.industry === 'construction' || ctx.industry === 'energy') {
    rationale.push('Industria alto-riesgo — pain por SIF + compliance frecuente');
  }

  return {
    prospectName: ctx.companyName,
    recommendedTier: tier,
    tierJustification: reason,
    priorityModules,
    nextStageQuestions,
    anticipatedObjections,
    caseStudyHints,
    estimatedCloseProb: closeProb,
    rationale,
  };
}
