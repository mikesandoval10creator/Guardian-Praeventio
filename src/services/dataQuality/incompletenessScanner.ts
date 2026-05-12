// Praeventio Guard — Sprint 40 Fase F.9: Detector de Datos Incompletos.
//
// Cierra Plan F.9 "Detector de Datos Incompletos (calidad de datos
// pre-IA)".
//
// Detecta entradas con campos críticos faltantes en los dominios
// principales del producto. Sirve para:
//   1. Pre-validar antes de pasar al RAG/contextual assistant (datos
//      incompletos producen recomendaciones malas).
//   2. Feed a la Inbox del Prevencionista (F.8) con quick-fix links.
//   3. Score "confiabilidad" de la base de datos.
//
// Determinístico, sin LLM. Reglas duras + heurísticas legibles.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type GapDomain =
  | 'worker'
  | 'project'
  | 'epp_assignment'
  | 'document'
  | 'incident'
  | 'machine'
  | 'training';

export type GapSeverity = 'low' | 'medium' | 'high';

export interface Gap {
  /** ID del documento que tiene el gap. */
  docId: string;
  domain: GapDomain;
  /** Campo faltante o inválido. */
  field: string;
  /** Razón legible. */
  reason: string;
  severity: GapSeverity;
  /** Sugerencia de quick-fix. */
  quickFixHint: string;
}

// ────────────────────────────────────────────────────────────────────────
// Domain shapes — campos mínimos que el scanner necesita.
//
// Codex P1 PR #98: aceptar AMBOS shapes (documentado y real persistido)
// para evitar falsos positivos. Los aliases reflejan lo que el app
// realmente guarda (`Worker.name/role`, `EPPAssignment.assignedAt`,
// `TrainingSession.attendees`, `Project.coordinates`, `ProjectDocument.name`).
// ────────────────────────────────────────────────────────────────────────

export interface WorkerLike {
  id: string;
  fullName?: string;
  /** Alias real del modelo `Worker`. */
  name?: string;
  cargo?: string;
  /** Alias real del modelo `Worker`. */
  role?: string;
  rut?: string;
  industry?: string;
  joinDate?: string;
}

export interface ProjectLike {
  id: string;
  name?: string;
  industry?: string;
  workersCount?: number;
  /** Documentado por el scanner. */
  location?: { lat?: number; lng?: number } | string;
  /** Alias real (`ProjectContext`). */
  coordinates?: { lat?: number; lng?: number };
  /** Otro alias del campo geo. */
  geo?: { lat?: number; lng?: number };
}

export interface EppAssignmentLike {
  id: string;
  workerUid?: string;
  eppLabel?: string;
  deliveredAt?: string;
  /** Alias real del modelo `EPPAssignment`. */
  assignedAt?: string;
  expiresAt?: string;
}

export interface DocumentLike {
  id: string;
  title?: string;
  /** Alias real del modelo `ProjectDocument` + EPP acta writer. */
  name?: string;
  approvedByUid?: string;
  approvedAt?: string;
  kind?: string;
}

export interface IncidentLike {
  id: string;
  description?: string;
  severity?: string;
  occurredAt?: string;
  rootCauseCategory?: string;
}

export interface MachineLike {
  id: string;
  code?: string;
  type?: string;
  status?: string;
  nextMaintenanceAt?: string;
}

export interface TrainingLike {
  id: string;
  title?: string;
  expiresAt?: string;
  participants?: string[];
  /** Alias real del modelo `TrainingSession`. */
  attendees?: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

// ────────────────────────────────────────────────────────────────────────
// Per-domain scanners
// ────────────────────────────────────────────────────────────────────────

export function scanWorkers(workers: WorkerLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const w of workers) {
    // Codex P1 PR #98: acepta fullName ó name (alias real del modelo Worker).
    if (!isNonEmpty(w.fullName) && !isNonEmpty(w.name)) {
      gaps.push({
        docId: w.id,
        domain: 'worker',
        field: 'fullName',
        reason: 'Trabajador sin nombre completo registrado',
        severity: 'high',
        quickFixHint: 'Completar nombre + apellidos en /workers/' + w.id,
      });
    }
    // Codex P1 PR #98: acepta cargo ó role (alias real del modelo Worker).
    if (!isNonEmpty(w.cargo) && !isNonEmpty(w.role)) {
      gaps.push({
        docId: w.id,
        domain: 'worker',
        field: 'cargo',
        reason: 'Sin cargo asignado — bloquea IPER per puesto y EPP automático',
        severity: 'high',
        quickFixHint: 'Asignar cargo desde catálogo en /workers/' + w.id,
      });
    }
    if (!isNonEmpty(w.industry)) {
      gaps.push({
        docId: w.id,
        domain: 'worker',
        field: 'industry',
        reason: 'Sin industria — afecta reglas legales sectoriales',
        severity: 'medium',
        quickFixHint: 'Heredar de proyecto o setear manual',
      });
    }
    if (w.rut !== undefined && !isNonEmpty(w.rut)) {
      gaps.push({
        docId: w.id,
        domain: 'worker',
        field: 'rut',
        reason: 'Campo rut presente pero vacío',
        severity: 'medium',
        quickFixHint: 'Validar RUT o limpiar campo',
      });
    }
  }
  return gaps;
}

export function scanProjects(projects: ProjectLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const p of projects) {
    if (!isNonEmpty(p.name)) {
      gaps.push({
        docId: p.id,
        domain: 'project',
        field: 'name',
        reason: 'Proyecto sin nombre',
        severity: 'high',
        quickFixHint: 'Setear nombre amigable en /projects/' + p.id,
      });
    }
    if (!isNonEmpty(p.industry)) {
      gaps.push({
        docId: p.id,
        domain: 'project',
        field: 'industry',
        reason: 'Sin industria — bloquea aplicación de reglas legales sectoriales',
        severity: 'high',
        quickFixHint: 'Elegir industria del wizard PYME',
      });
    }
    // Codex P2 PR #98: reject negative workersCount como inválido.
    if (!isFiniteNumber(p.workersCount) || (p.workersCount as number) < 0) {
      gaps.push({
        docId: p.id,
        domain: 'project',
        field: 'workersCount',
        reason: 'Sin dotación válida — afecta umbrales legales (≥25 → CPHS)',
        severity: 'medium',
        quickFixHint: 'Declarar dotación inicial (entero ≥0)',
      });
    }
    // Codex P2 PR #98: acepta location object O coordinates/geo (aliases reales).
    const geoCandidate =
      typeof p.location === 'object' && p.location !== null
        ? (p.location as { lat?: number; lng?: number })
        : p.coordinates ?? p.geo;
    if (!geoCandidate || !isFiniteNumber(geoCandidate.lat) || !isFiniteNumber(geoCandidate.lng)) {
      gaps.push({
        docId: p.id,
        domain: 'project',
        field: 'location',
        reason: 'Sin geolocalización — bloquea EONET/USGS alertas + ruta evacuación',
        severity: 'medium',
        quickFixHint: 'Setear coords desde Google Maps picker',
      });
    }
  }
  return gaps;
}

export function scanEppAssignments(assignments: EppAssignmentLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const a of assignments) {
    // Codex P2 PR #98: acepta deliveredAt ó assignedAt (alias real del modelo EPPAssignment).
    if (!a.deliveredAt && !a.assignedAt) {
      gaps.push({
        docId: a.id,
        domain: 'epp_assignment',
        field: 'deliveredAt',
        reason: 'EPP asignado sin fecha de entrega',
        severity: 'medium',
        quickFixHint: 'Registrar firma de recepción QR (F.5)',
      });
    }
    if (!a.expiresAt) {
      gaps.push({
        docId: a.id,
        domain: 'epp_assignment',
        field: 'expiresAt',
        reason: 'EPP sin vencimiento — no se podrá generar alerta de renovación',
        severity: 'high',
        quickFixHint: 'Calcular expiresAt = deliveredAt + lifespan del catálogo EPP',
      });
    }
  }
  return gaps;
}

export function scanDocuments(docs: DocumentLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const d of docs) {
    // Codex P2 PR #98: acepta title ó name (alias real ProjectDocument).
    if (!isNonEmpty(d.title) && !isNonEmpty(d.name)) {
      gaps.push({
        docId: d.id,
        domain: 'document',
        field: 'title',
        reason: 'Documento sin título',
        severity: 'high',
        quickFixHint: 'Setear título descriptivo',
      });
    }
    if (!isNonEmpty(d.approvedByUid)) {
      gaps.push({
        docId: d.id,
        domain: 'document',
        field: 'approvedByUid',
        reason: 'Documento sin aprobador — sin trazabilidad de firma',
        severity: 'medium',
        quickFixHint: 'Asignar prevencionista/responsable',
      });
    }
  }
  return gaps;
}

export function scanIncidents(incidents: IncidentLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const i of incidents) {
    if (!isNonEmpty(i.description)) {
      gaps.push({
        docId: i.id,
        domain: 'incident',
        field: 'description',
        reason: 'Incidente sin descripción',
        severity: 'high',
        quickFixHint: 'Completar relato del incidente',
      });
    }
    if (!isNonEmpty(i.rootCauseCategory)) {
      gaps.push({
        docId: i.id,
        domain: 'incident',
        field: 'rootCauseCategory',
        reason: 'Incidente sin causa raíz clasificada',
        severity: 'high',
        quickFixHint: 'Lanzar wizard RootCauseClassifier',
      });
    }
  }
  return gaps;
}

export function scanMachines(machines: MachineLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const m of machines) {
    if (!isNonEmpty(m.code)) {
      gaps.push({
        docId: m.id,
        domain: 'machine',
        field: 'code',
        reason: 'Máquina sin código de inventario',
        severity: 'medium',
        quickFixHint: 'Asignar código tipo MAQ-XXX o usar QR existente',
      });
    }
    if (!isNonEmpty(m.type)) {
      gaps.push({
        docId: m.id,
        domain: 'machine',
        field: 'type',
        reason: 'Sin tipo de máquina — bloquea checklist pre-uso',
        severity: 'high',
        quickFixHint: 'Elegir tipo del catálogo (grúahorquilla, soldadora, ...)',
      });
    }
    if (!m.nextMaintenanceAt) {
      gaps.push({
        docId: m.id,
        domain: 'machine',
        field: 'nextMaintenanceAt',
        reason: 'Sin próxima mantención — no se podrá emitir alerta horómetro',
        severity: 'medium',
        quickFixHint: 'Setear desde policy de mantenimiento por tipo',
      });
    }
  }
  return gaps;
}

export function scanTrainings(trainings: TrainingLike[]): Gap[] {
  const gaps: Gap[] = [];
  for (const t of trainings) {
    if (!isNonEmpty(t.title)) {
      gaps.push({
        docId: t.id,
        domain: 'training',
        field: 'title',
        reason: 'Capacitación sin título',
        severity: 'high',
        quickFixHint: 'Asignar título descriptivo',
      });
    }
    if (!t.expiresAt) {
      gaps.push({
        docId: t.id,
        domain: 'training',
        field: 'expiresAt',
        reason: 'Capacitación sin expiración — alertas de renovación no funcionarán',
        severity: 'high',
        quickFixHint: 'Setear vencimiento (2 años default normativa CL)',
      });
    }
    // Codex P2 PR #98: acepta participants ó attendees (alias real TrainingSession).
    const peopleCount =
      (Array.isArray(t.participants) ? t.participants.length : 0) +
      (Array.isArray(t.attendees) ? t.attendees.length : 0);
    if (peopleCount === 0) {
      gaps.push({
        docId: t.id,
        domain: 'training',
        field: 'participants',
        reason: 'Sin participantes registrados',
        severity: 'medium',
        quickFixHint: 'Registrar asistencia (QR F.5 o lista manual)',
      });
    }
  }
  return gaps;
}

// ────────────────────────────────────────────────────────────────────────
// Aggregator + scoring
// ────────────────────────────────────────────────────────────────────────

export interface ScanInputs {
  workers?: WorkerLike[];
  projects?: ProjectLike[];
  eppAssignments?: EppAssignmentLike[];
  documents?: DocumentLike[];
  incidents?: IncidentLike[];
  machines?: MachineLike[];
  trainings?: TrainingLike[];
}

export interface DataQualityReport {
  gaps: Gap[];
  totalGaps: number;
  byDomain: Partial<Record<GapDomain, number>>;
  bySeverity: Record<GapSeverity, number>;
  /** Score 0-100. 100 = sin gaps; baja con cada gap ponderado por severity. */
  qualityScore: number;
}

const SEVERITY_WEIGHT: Record<GapSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function scanAll(inputs: ScanInputs): DataQualityReport {
  const gaps: Gap[] = [];
  if (inputs.workers) gaps.push(...scanWorkers(inputs.workers));
  if (inputs.projects) gaps.push(...scanProjects(inputs.projects));
  if (inputs.eppAssignments) gaps.push(...scanEppAssignments(inputs.eppAssignments));
  if (inputs.documents) gaps.push(...scanDocuments(inputs.documents));
  if (inputs.incidents) gaps.push(...scanIncidents(inputs.incidents));
  if (inputs.machines) gaps.push(...scanMachines(inputs.machines));
  if (inputs.trainings) gaps.push(...scanTrainings(inputs.trainings));

  const byDomain: Partial<Record<GapDomain, number>> = {};
  const bySeverity: Record<GapSeverity, number> = { high: 0, medium: 0, low: 0 };
  let totalWeight = 0;
  for (const g of gaps) {
    byDomain[g.domain] = (byDomain[g.domain] ?? 0) + 1;
    bySeverity[g.severity] += 1;
    totalWeight += SEVERITY_WEIGHT[g.severity];
  }

  // Total docs scanned para denominador
  const totalDocs =
    (inputs.workers?.length ?? 0) +
    (inputs.projects?.length ?? 0) +
    (inputs.eppAssignments?.length ?? 0) +
    (inputs.documents?.length ?? 0) +
    (inputs.incidents?.length ?? 0) +
    (inputs.machines?.length ?? 0) +
    (inputs.trainings?.length ?? 0);

  // Quality: 100 si totalDocs=0. Sino 100 - clamp(totalWeight / (totalDocs * 3) * 100).
  // Multiplicador *3 viene del peso máximo (high) por doc.
  let qualityScore = 100;
  if (totalDocs > 0) {
    const ratio = totalWeight / (totalDocs * 3);
    qualityScore = Math.max(0, Math.round((1 - Math.min(1, ratio)) * 100));
  }

  return {
    gaps,
    totalGaps: gaps.length,
    byDomain,
    bySeverity,
    qualityScore,
  };
}

/**
 * Top-N gaps priorizados por severity para mostrar en F.8 Inbox.
 */
export function pickTopGaps(report: DataQualityReport, n = 10): Gap[] {
  const SEVERITY_ORDER: Record<GapSeverity, number> = { high: 3, medium: 2, low: 1 };
  return [...report.gaps]
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
    .slice(0, n);
}
