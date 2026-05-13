// Praeventio Guard — Sprint 52: Onboarding por rol con tracks dirigidos.
//
// Cierra: Documento usuario "§164-170" (parte de role-specific onboarding tracks).
//
// Mientras que:
//   - `adoptionAnalytics` mide adopción/embudo a nivel de tenant
//   - `faenaOnboardingBundle` cubre el bundle de ingreso a faena (contrato/EPP/examen)
//   - `pymeWizard` configura el tenant en < 30 min
//
// AQUÍ definimos el **track de aprendizaje por rol del usuario individual**:
// qué pasos (video / lectura / quiz / sandbox / shadow) debe completar un
// `worker | supervisor | prevencionista | admin | cphs_member | executive | contractor`
// para poder *operar* la plataforma sin acompañamiento.
//
// Determinístico, sin LLM, sin I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'worker'
  | 'supervisor'
  | 'prevencionista'
  | 'admin'
  | 'cphs_member'
  | 'executive'
  | 'contractor';

export type OnboardingStepKind =
  | 'video'
  | 'doc_read'
  | 'quiz'
  | 'live_demo'
  | 'sandbox_task'
  | 'shadow_session';

export interface OnboardingStep {
  id: string;
  title: string;
  kind: OnboardingStepKind;
  estimatedMinutes: number;
  /** Skill esperado a alcanzar al completar este paso. */
  learningOutcome: string;
  /** Si bloquea el progreso para que el rol pueda operar. */
  blockingForOperation: boolean;
}

export interface OnboardingTrack {
  role: UserRole;
  /** Id determinístico del track (ej: 'track_v1_worker'). */
  trackId: string;
  steps: OnboardingStep[];
  estimatedTotalMinutes: number;
  /** % completion mínima para "completar" el track. */
  completionThresholdPct: number;
}

export interface UserOnboardingProgress {
  userUid: string;
  role: UserRole;
  completedStepIds: string[];
  startedAt: string;
  completedAt?: string;
}

export interface OnboardingStatus {
  trackId: string;
  totalSteps: number;
  completedSteps: number;
  completedPct: number;
  blockedSteps: number;
  /** True si todos los pasos `blockingForOperation` están completos. */
  canOperate: boolean;
  /** Tiempo restante estimado en minutos. */
  remainingMinutes: number;
  /** Próximo step recomendado (siguiente blocking pendiente; si no, siguiente no-blocking). */
  nextRecommendedStepId?: string;
  /** True si el track alcanzó el umbral `completionThresholdPct`. */
  trackCompleted: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Track definitions — calibradas por rol
// ────────────────────────────────────────────────────────────────────────

const TRACK_VERSION = 'v1';
const DEFAULT_COMPLETION_THRESHOLD_PCT = 80;

function buildTrack(role: UserRole, steps: OnboardingStep[], completionThresholdPct = DEFAULT_COMPLETION_THRESHOLD_PCT): OnboardingTrack {
  const estimatedTotalMinutes = steps.reduce((acc, s) => acc + s.estimatedMinutes, 0);
  return {
    role,
    trackId: `track_${TRACK_VERSION}_${role}`,
    steps,
    estimatedTotalMinutes,
    completionThresholdPct,
  };
}

const WORKER_STEPS: OnboardingStep[] = [
  { id: 'worker.welcome', title: 'Bienvenida a Praeventio Guard', kind: 'video', estimatedMinutes: 5, learningOutcome: 'Comprender el propósito de la plataforma', blockingForOperation: true },
  { id: 'worker.epp_basics', title: 'Reglas básicas de EPP', kind: 'doc_read', estimatedMinutes: 10, learningOutcome: 'Reconocer EPP obligatorio por tarea', blockingForOperation: true },
  { id: 'worker.first_supervised_task', title: 'Primera asignación supervisada', kind: 'sandbox_task', estimatedMinutes: 15, learningOutcome: 'Aceptar y reportar avance de una tarea', blockingForOperation: true },
  { id: 'worker.quiz_safety', title: 'Quiz: seguridad básica', kind: 'quiz', estimatedMinutes: 8, learningOutcome: 'Demostrar comprensión de reglas básicas', blockingForOperation: true },
  { id: 'worker.sos_app', title: 'Uso de SOS desde la app', kind: 'live_demo', estimatedMinutes: 6, learningOutcome: 'Activar SOS y reportar emergencia', blockingForOperation: true },
  { id: 'worker.first_acceptance_ack', title: 'Acuse de recibo: primera aceptación', kind: 'sandbox_task', estimatedMinutes: 4, learningOutcome: 'Firmar acuse digital con huella', blockingForOperation: true },
];

const SUPERVISOR_STEPS: OnboardingStep[] = [
  { id: 'supervisor.welcome', title: 'Bienvenida supervisor', kind: 'video', estimatedMinutes: 6, learningOutcome: 'Entender el rol del supervisor en la plataforma', blockingForOperation: true },
  { id: 'supervisor.delegation', title: 'Delegación y asignación de tareas', kind: 'doc_read', estimatedMinutes: 12, learningOutcome: 'Asignar tareas con responsable + plazo', blockingForOperation: true },
  { id: 'supervisor.inbox_usage', title: 'Uso del Inbox unificado', kind: 'live_demo', estimatedMinutes: 10, learningOutcome: 'Triagear notificaciones y reportes entrantes', blockingForOperation: true },
  { id: 'supervisor.escalation', title: 'Cómo escalar incidentes', kind: 'doc_read', estimatedMinutes: 8, learningOutcome: 'Aplicar protocolo de escalamiento', blockingForOperation: true },
  { id: 'supervisor.first_cphs_meeting', title: 'Primera reunión CPHS', kind: 'shadow_session', estimatedMinutes: 30, learningOutcome: 'Participar como invitado en sesión CPHS', blockingForOperation: false },
  { id: 'supervisor.sandbox_task_auth', title: 'Sandbox: autorizar tarea crítica', kind: 'sandbox_task', estimatedMinutes: 15, learningOutcome: 'Autorizar permiso de trabajo en sandbox', blockingForOperation: true },
];

const PREVENCIONISTA_STEPS: OnboardingStep[] = [
  { id: 'prev.normative_cl', title: 'Orientación normativa Chile (DS40, DS594, L16744)', kind: 'doc_read', estimatedMinutes: 25, learningOutcome: 'Citar normativa aplicable a faena', blockingForOperation: true },
  { id: 'prev.matrix_5x5', title: 'Matriz de riesgos 5×5', kind: 'live_demo', estimatedMinutes: 20, learningOutcome: 'Construir matriz IPER con probabilidad×severidad', blockingForOperation: true },
  { id: 'prev.diat_diep', title: 'Tutorial DIAT / DIEP', kind: 'doc_read', estimatedMinutes: 15, learningOutcome: 'Completar DIAT/DIEP correctamente', blockingForOperation: true },
  { id: 'prev.bowtie', title: 'Análisis Bowtie', kind: 'sandbox_task', estimatedMinutes: 25, learningOutcome: 'Mapear amenazas → controles → consecuencias', blockingForOperation: true },
  { id: 'prev.critical_control', title: 'Gestión de Controles Críticos', kind: 'doc_read', estimatedMinutes: 18, learningOutcome: 'Identificar y verificar controles críticos', blockingForOperation: true },
  { id: 'prev.review_roadmap', title: 'Roadmap de revisión mensual', kind: 'live_demo', estimatedMinutes: 12, learningOutcome: 'Programar auditoría interna mensual', blockingForOperation: false },
];

const ADMIN_STEPS: OnboardingStep[] = [
  { id: 'admin.tenant_setup', title: 'Setup del tenant', kind: 'live_demo', estimatedMinutes: 15, learningOutcome: 'Configurar tenant, branding, holding', blockingForOperation: true },
  { id: 'admin.roles', title: 'Gestión de roles y permisos', kind: 'doc_read', estimatedMinutes: 12, learningOutcome: 'Asignar roles RBAC a usuarios', blockingForOperation: true },
  { id: 'admin.integrations', title: 'Integraciones (SSO, MFA, ERP)', kind: 'doc_read', estimatedMinutes: 20, learningOutcome: 'Activar SSO + MFA + conectores ERP', blockingForOperation: true },
  { id: 'admin.dashboards', title: 'Configurar dashboards', kind: 'live_demo', estimatedMinutes: 15, learningOutcome: 'Personalizar dashboards por proyecto', blockingForOperation: false },
  { id: 'admin.audit_log', title: 'Revisión del audit log', kind: 'doc_read', estimatedMinutes: 10, learningOutcome: 'Filtrar y exportar audit log', blockingForOperation: true },
  { id: 'admin.first_backup', title: 'Verificar backup + DR runbook', kind: 'sandbox_task', estimatedMinutes: 12, learningOutcome: 'Confirmar backups y leer DR runbook', blockingForOperation: true },
];

const CPHS_STEPS: OnboardingStep[] = [
  { id: 'cphs.legal_structure', title: 'Estructura legal CPHS (DS54)', kind: 'doc_read', estimatedMinutes: 18, learningOutcome: 'Entender DS54 y representación', blockingForOperation: true },
  { id: 'cphs.agenda', title: 'Cómo construir la agenda', kind: 'live_demo', estimatedMinutes: 10, learningOutcome: 'Armar agenda con puntos obligatorios', blockingForOperation: true },
  { id: 'cphs.minutes', title: 'Minuta y acta legal', kind: 'doc_read', estimatedMinutes: 12, learningOutcome: 'Redactar minuta con quórum y firmas', blockingForOperation: true },
  { id: 'cphs.corrective_actions', title: 'Acciones correctivas y seguimiento', kind: 'sandbox_task', estimatedMinutes: 15, learningOutcome: 'Crear y asignar acción correctiva', blockingForOperation: true },
  { id: 'cphs.monthly_report', title: 'Reporte mensual CPHS', kind: 'doc_read', estimatedMinutes: 12, learningOutcome: 'Generar reporte mensual con indicadores', blockingForOperation: true },
  { id: 'cphs.training_obligation', title: 'Capacitación obligatoria a miembros', kind: 'video', estimatedMinutes: 20, learningOutcome: 'Completar capacitación legal CPHS', blockingForOperation: false },
];

const EXECUTIVE_STEPS: OnboardingStep[] = [
  { id: 'exec.dashboard', title: 'Dashboard ejecutivo', kind: 'live_demo', estimatedMinutes: 8, learningOutcome: 'Leer dashboard ejecutivo y KPIs clave', blockingForOperation: true },
  { id: 'exec.weekly_kpis', title: 'KPIs semanales y tendencias', kind: 'doc_read', estimatedMinutes: 10, learningOutcome: 'Interpretar tendencias de IF/IG/IGR', blockingForOperation: true },
  { id: 'exec.roi', title: 'ROI de prevención', kind: 'doc_read', estimatedMinutes: 12, learningOutcome: 'Entender modelo ROI y financialAnalytics', blockingForOperation: true },
  { id: 'exec.critical_decisions', title: 'Decisiones críticas: cuándo intervenir', kind: 'video', estimatedMinutes: 10, learningOutcome: 'Saber cuándo escalar y comprometer recursos', blockingForOperation: true },
  { id: 'exec.external_auditor', title: 'Trabajar con auditor externo', kind: 'doc_read', estimatedMinutes: 8, learningOutcome: 'Preparar evidencia para auditor externo', blockingForOperation: true },
  { id: 'exec.board_summary', title: 'Resumen para directorio', kind: 'sandbox_task', estimatedMinutes: 12, learningOutcome: 'Generar briefing ejecutivo para directorio', blockingForOperation: false },
];

const CONTRACTOR_STEPS: OnboardingStep[] = [
  { id: 'contractor.vendor_req', title: 'Requisitos vendor', kind: 'doc_read', estimatedMinutes: 12, learningOutcome: 'Cumplir requisitos de calificación vendor', blockingForOperation: true },
  { id: 'contractor.epp', title: 'EPP y entrega de equipamiento', kind: 'doc_read', estimatedMinutes: 10, learningOutcome: 'Recibir y registrar EPP', blockingForOperation: true },
  { id: 'contractor.emergency_protocol', title: 'Protocolo de emergencia en faena', kind: 'video', estimatedMinutes: 8, learningOutcome: 'Responder ante emergencia en faena cliente', blockingForOperation: true },
  { id: 'contractor.comms', title: 'Comunicaciones con mandante', kind: 'doc_read', estimatedMinutes: 8, learningOutcome: 'Usar canal oficial de comunicación', blockingForOperation: true },
  { id: 'contractor.check_in', title: 'Check-in / check-out diario', kind: 'sandbox_task', estimatedMinutes: 6, learningOutcome: 'Marcar check-in y check-out con geofencing', blockingForOperation: true },
  { id: 'contractor.acceptance_ack', title: 'Acuse de recibo: condiciones de faena', kind: 'sandbox_task', estimatedMinutes: 5, learningOutcome: 'Firmar acuse de condiciones específicas', blockingForOperation: true },
];

const TRACKS: Readonly<Record<UserRole, OnboardingTrack>> = Object.freeze({
  worker: buildTrack('worker', WORKER_STEPS),
  supervisor: buildTrack('supervisor', SUPERVISOR_STEPS),
  prevencionista: buildTrack('prevencionista', PREVENCIONISTA_STEPS),
  admin: buildTrack('admin', ADMIN_STEPS),
  cphs_member: buildTrack('cphs_member', CPHS_STEPS),
  executive: buildTrack('executive', EXECUTIVE_STEPS),
  contractor: buildTrack('contractor', CONTRACTOR_STEPS),
});

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el track calibrado para un rol dado. El objeto retornado es una
 * copia defensiva (no muta el catálogo interno).
 */
export function getTrackForRole(role: UserRole): OnboardingTrack {
  const t = TRACKS[role];
  if (!t) {
    throw new Error(`roleOnboardingTracks: unknown role "${role}"`);
  }
  return {
    role: t.role,
    trackId: t.trackId,
    steps: t.steps.map((s) => ({ ...s })),
    estimatedTotalMinutes: t.estimatedTotalMinutes,
    completionThresholdPct: t.completionThresholdPct,
  };
}

/**
 * Evalúa el progreso del usuario contra su track.
 *
 * Reglas:
 *   - `completedSteps` cuenta solo step IDs que existen en el track.
 *   - `canOperate = true` cuando TODOS los steps blocking están completos.
 *   - `nextRecommendedStepId`:
 *       1. primer step blocking pendiente
 *       2. si no hay, primer step no-blocking pendiente
 *       3. si todo completo, undefined.
 *   - `trackCompleted = true` cuando `completedPct >= completionThresholdPct`.
 */
export function evaluateProgress(
  progress: UserOnboardingProgress,
  track: OnboardingTrack,
): OnboardingStatus {
  if (progress.role !== track.role) {
    throw new Error(
      `roleOnboardingTracks.evaluateProgress: role mismatch (progress="${progress.role}", track="${track.role}")`,
    );
  }
  const validIds = new Set(track.steps.map((s) => s.id));
  const completedIds = new Set(
    progress.completedStepIds.filter((id) => validIds.has(id)),
  );
  const totalSteps = track.steps.length;
  const completedSteps = completedIds.size;

  const blockingSteps = track.steps.filter((s) => s.blockingForOperation);
  const blockedSteps = blockingSteps.filter((s) => !completedIds.has(s.id)).length;
  const canOperate = blockedSteps === 0;

  const remainingMinutes = track.steps
    .filter((s) => !completedIds.has(s.id))
    .reduce((acc, s) => acc + s.estimatedMinutes, 0);

  // Próximo recomendado: primero blocking pendiente, luego no-blocking pendiente
  const nextBlocking = track.steps.find(
    (s) => s.blockingForOperation && !completedIds.has(s.id),
  );
  const nextAny = nextBlocking
    ? nextBlocking
    : track.steps.find((s) => !completedIds.has(s.id));

  const completedPct =
    totalSteps === 0
      ? 0
      : Math.round((completedSteps / totalSteps) * 100);

  return {
    trackId: track.trackId,
    totalSteps,
    completedSteps,
    completedPct,
    blockedSteps,
    canOperate,
    remainingMinutes,
    nextRecommendedStepId: nextAny?.id,
    trackCompleted: completedPct >= track.completionThresholdPct,
  };
}

/**
 * Marca un step como completado. Es idempotente:
 *   - si el step ya estaba completado, devuelve el progreso sin cambios
 *   - si el step no pertenece al track del rol, lanza error
 *
 * No muta `progress`; retorna una copia nueva.
 *
 * Si al marcar el step se completan TODOS los pasos del track y `completedAt`
 * no estaba seteado, se setea con `nowIso` (parámetro inyectable para tests).
 */
export function markStepCompleted(
  progress: UserOnboardingProgress,
  stepId: string,
  nowIso: string = new Date().toISOString(),
): UserOnboardingProgress {
  const track = getTrackForRole(progress.role);
  const validIds = new Set(track.steps.map((s) => s.id));
  if (!validIds.has(stepId)) {
    throw new Error(
      `roleOnboardingTracks.markStepCompleted: step "${stepId}" no pertenece al track de "${progress.role}"`,
    );
  }
  if (progress.completedStepIds.includes(stepId)) {
    return { ...progress, completedStepIds: [...progress.completedStepIds] };
  }
  const completedStepIds = [...progress.completedStepIds, stepId];
  const allDone = track.steps.every((s) => completedStepIds.includes(s.id));
  return {
    ...progress,
    completedStepIds,
    completedAt: allDone && !progress.completedAt ? nowIso : progress.completedAt,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Catálogo (útil para tests y UI de admin)
// ────────────────────────────────────────────────────────────────────────

export const ROLE_ONBOARDING_ROLES: readonly UserRole[] = Object.freeze([
  'worker',
  'supervisor',
  'prevencionista',
  'admin',
  'cphs_member',
  'executive',
  'contractor',
]);
