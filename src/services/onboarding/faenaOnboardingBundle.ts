// Praeventio Guard — Sprint 39 Fase G.10: Paquete de ingreso a faena.
//
// Cierra: Documento usuario "Recomendaciones nuevas §46, §47, §48"
//         Plan integral Top 15 #3
//
// Para que un trabajador (propio o contratista) ingrese a faena, debe
// completar un paquete con:
//   - Contrato vigente
//   - Exámenes ocupacionales pre-ingreso aprobados
//   - Inducción específica + DDR ("derecho a saber")
//   - EPP entregado y registrado
//   - Capacitaciones de los riesgos de la faena
//   - Documentos legales firmados (RIOHS lectura confirmada, ODI, etc.)
//   - Permisos vigentes si va a tareas críticas
//
// Estado del bundle: pending | partial | approved | observed | rejected.

export interface OnboardingRequirement {
  /** Categoría humana para UI. */
  category:
    | 'contract'
    | 'medical_exam'
    | 'induction'
    | 'epp'
    | 'training'
    | 'document_read'
    | 'permit';
  /** Label visible al supervisor. */
  label: string;
  /** Si está completado / aprobado. */
  fulfilled: boolean;
  /** Detalle opcional para mostrar (vigencia, fecha, observación). */
  detail?: string;
  /** Mandante puede observar; permite quick-fix. */
  observation?: string;
}

export interface OnboardingBundle {
  id: string;
  workerUid: string;
  workerFullName: string;
  /** Si es contratista, qué empresa lo manda. */
  contractorCompanyName?: string;
  /** Proyecto al que ingresará. */
  projectId: string;
  requirements: OnboardingRequirement[];
  /** Mandante decide aceptar / observar / rechazar. */
  reviewerUid?: string;
  reviewedAt?: string;
  /** Notas de revisión. */
  reviewerNotes?: string;
  /** Status derivado de requirements + reviewer decision. */
  status: OnboardingStatus;
  createdAt: string;
  updatedAt: string;
}

export type OnboardingStatus =
  | 'pending'
  | 'partial'
  | 'ready_for_review'
  | 'observed'
  | 'approved'
  | 'rejected';

/**
 * Computes the status from the requirements list + reviewer state.
 *
 * Rules:
 *   - pending: no requirements fulfilled yet
 *   - partial: some fulfilled, not all
 *   - ready_for_review: all fulfilled, no reviewer decision yet
 *   - observed: reviewer marked one or more observations
 *   - approved: reviewer approved
 *   - rejected: reviewer rejected
 */
export function deriveStatus(
  bundle: Pick<OnboardingBundle, 'requirements' | 'reviewedAt' | 'reviewerNotes'> & {
    reviewerDecision?: 'approved' | 'rejected' | 'observed';
  },
): OnboardingStatus {
  const total = bundle.requirements.length;
  const fulfilled = bundle.requirements.filter((r) => r.fulfilled).length;
  const observed = bundle.requirements.filter((r) => r.observation && r.observation.trim().length > 0);

  if (bundle.reviewerDecision === 'approved' && bundle.reviewedAt) return 'approved';
  if (bundle.reviewerDecision === 'rejected' && bundle.reviewedAt) return 'rejected';
  if (bundle.reviewerDecision === 'observed' && bundle.reviewedAt) return 'observed';
  if (observed.length > 0) return 'observed';

  if (fulfilled === 0) return 'pending';
  if (fulfilled < total) return 'partial';
  return 'ready_for_review';
}

export interface OnboardingProgress {
  totalRequirements: number;
  fulfilledCount: number;
  observedCount: number;
  /** % requirements fulfilled. */
  completionPercent: number;
  /** Próximo item pendiente (UX hint). */
  nextRequirement?: OnboardingRequirement;
  /** Items observados que requieren acción. */
  observedItems: OnboardingRequirement[];
}

export function computeProgress(bundle: OnboardingBundle): OnboardingProgress {
  const total = bundle.requirements.length;
  const fulfilled = bundle.requirements.filter((r) => r.fulfilled).length;
  const observed = bundle.requirements.filter(
    (r) => r.observation && r.observation.trim().length > 0,
  );
  const nextRequirement = bundle.requirements.find((r) => !r.fulfilled);

  return {
    totalRequirements: total,
    fulfilledCount: fulfilled,
    observedCount: observed.length,
    completionPercent: total === 0 ? 100 : Math.round((fulfilled / total) * 100),
    nextRequirement,
    observedItems: observed,
  };
}

/**
 * Bundle canónico para nuevo ingreso. Esta plantilla se ajusta por
 * industria (caller decide qué trainings/documentos adicionales).
 */
export function buildStandardOnboardingTemplate(): OnboardingRequirement[] {
  return [
    { category: 'contract', label: 'Contrato de trabajo vigente', fulfilled: false },
    { category: 'medical_exam', label: 'Examen ocupacional pre-ingreso', fulfilled: false },
    { category: 'induction', label: 'Inducción general de seguridad', fulfilled: false },
    { category: 'induction', label: 'Derecho a saber (DDR) específico al cargo', fulfilled: false },
    { category: 'epp', label: 'Entrega de EPP base', fulfilled: false },
    { category: 'training', label: 'Capacitación inicial de la faena', fulfilled: false },
    { category: 'document_read', label: 'Lectura confirmada del RIOHS', fulfilled: false },
    { category: 'document_read', label: 'Aceptación de Política de Seguridad', fulfilled: false },
  ];
}

/**
 * Cuando el mandante OBSERVA un requirement → se crea automáticamente
 * una corrective action en el flujo F.4. Esto es la "Control de
 * observaciones de acreditación" §48.
 */
export interface ObservationActionPayload {
  type: 'onboarding_observation';
  bundleId: string;
  workerUid: string;
  requirementCategory: OnboardingRequirement['category'];
  requirementLabel: string;
  observation: string;
  projectId: string;
  createdAt: string;
}

export function buildActionFromObservation(
  bundle: OnboardingBundle,
  req: OnboardingRequirement,
  now: Date = new Date(),
): ObservationActionPayload {
  if (!req.observation || req.observation.trim().length === 0) {
    throw new Error('requirement has no observation to convert into action');
  }
  return {
    type: 'onboarding_observation',
    bundleId: bundle.id,
    workerUid: bundle.workerUid,
    requirementCategory: req.category,
    requirementLabel: req.label,
    observation: req.observation,
    projectId: bundle.projectId,
    createdAt: now.toISOString(),
  };
}
