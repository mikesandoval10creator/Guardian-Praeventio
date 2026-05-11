// Praeventio Guard — Sprint 39 Fase J.4: Modos por Rol (Jefe Terreno / Trabajador / Gerencia).
//
// Cierra: Documento usuario "Recomendaciones nuevas §94, §95, §96"
//
// Cada rol ve algo distinto en su home:
//   - Jefe Terreno: qué está vencido + hoy + bloqueado + por aprobar
//   - Trabajador: mis tareas + mis EPP + mis capacitaciones + reportar
//   - Gerencia: cumplimiento + riesgo + tendencia + costo + ROI
//
// Servicio puro que recibe el estado consolidado y devuelve "tarjetas"
// específicas por rol. El frontend renderiza tarjetas estructuradas.

export type UserRole = 'worker' | 'site_chief' | 'prevention' | 'management';

export type CardSeverity = 'info' | 'action_required' | 'urgent';

export interface RoleCard {
  id: string;
  title: string;
  body: string;
  /** Acción primaria (deeplink/route). */
  primaryAction?: { label: string; route: string };
  severity: CardSeverity;
  /** Categoría para agrupación visual. */
  category: string;
  /** Conteo si aplica (ej: "3 acciones vencidas"). */
  count?: number;
}

export interface RoleViewState {
  userUid: string;
  userRole: UserRole;
  // Datos consolidados que pueden alimentar cards
  overdueActions: number;
  pendingApprovals: number;
  todaysTasks: number;
  myEppExpiringSoon: number;
  myTrainingExpiringSoon: number;
  myUnreadDocuments: number;
  criticalIncidentsLast7d: number;
  faenaState: 'operativa' | 'restringida' | 'parcialmente_detenida' | 'detenida' | 'emergencia';
  complianceScore?: number; // 0-100
  totalActiveWorkers?: number;
  totalActiveProjects?: number;
  preventiveROIClpMonth?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Builders por rol
// ────────────────────────────────────────────────────────────────────────

export function buildRoleView(state: RoleViewState): RoleCard[] {
  switch (state.userRole) {
    case 'worker':
      return buildWorkerCards(state);
    case 'site_chief':
      return buildSiteChiefCards(state);
    case 'prevention':
      return buildPreventionCards(state);
    case 'management':
      return buildManagementCards(state);
  }
}

function buildWorkerCards(s: RoleViewState): RoleCard[] {
  const cards: RoleCard[] = [];
  if (s.todaysTasks > 0) {
    cards.push({
      id: 'w-tasks',
      title: `Mis tareas hoy (${s.todaysTasks})`,
      body: 'Revisa el día y confirma asistencia',
      primaryAction: { label: 'Ver tareas', route: '/me/tasks' },
      severity: 'action_required',
      category: 'tasks',
      count: s.todaysTasks,
    });
  }
  if (s.myEppExpiringSoon > 0) {
    cards.push({
      id: 'w-epp',
      title: `EPP por renovar (${s.myEppExpiringSoon})`,
      body: 'Tu EPP vence pronto — coordina entrega',
      primaryAction: { label: 'Ver EPP', route: '/me/epp' },
      severity: 'action_required',
      category: 'epp',
      count: s.myEppExpiringSoon,
    });
  }
  if (s.myTrainingExpiringSoon > 0) {
    cards.push({
      id: 'w-train',
      title: `Capacitaciones por renovar (${s.myTrainingExpiringSoon})`,
      body: 'Algunas capacitaciones críticas vencen',
      primaryAction: { label: 'Ver cursos', route: '/me/trainings' },
      severity: 'action_required',
      category: 'training',
      count: s.myTrainingExpiringSoon,
    });
  }
  if (s.myUnreadDocuments > 0) {
    cards.push({
      id: 'w-docs',
      title: `Documentos por leer (${s.myUnreadDocuments})`,
      body: 'Tienes procedimientos nuevos sin confirmar lectura',
      primaryAction: { label: 'Confirmar lectura', route: '/me/documents' },
      severity: 'action_required',
      category: 'documents',
      count: s.myUnreadDocuments,
    });
  }
  // Botón rápido fijo para SOS
  cards.push({
    id: 'w-sos',
    title: 'Reportar emergencia',
    body: 'SOS, condición insegura o accidente',
    primaryAction: { label: 'Activar', route: '/emergency' },
    severity: 'urgent',
    category: 'emergency',
  });
  return cards;
}

function buildSiteChiefCards(s: RoleViewState): RoleCard[] {
  const cards: RoleCard[] = [];
  if (s.faenaState === 'emergencia' || s.faenaState === 'detenida') {
    cards.push({
      id: 'sc-state',
      title: `Faena en estado: ${s.faenaState.toUpperCase()}`,
      body: 'Atención inmediata requerida',
      primaryAction: { label: 'Centro mando', route: '/operations' },
      severity: 'urgent',
      category: 'operations',
    });
  }
  if (s.overdueActions > 0) {
    cards.push({
      id: 'sc-overdue',
      title: `Acciones vencidas (${s.overdueActions})`,
      body: 'Cerrar acciones correctivas o reasignar',
      primaryAction: { label: 'Ver acciones', route: '/corrective-actions' },
      severity: 'action_required',
      category: 'actions',
      count: s.overdueActions,
    });
  }
  if (s.pendingApprovals > 0) {
    cards.push({
      id: 'sc-approve',
      title: `Por aprobar (${s.pendingApprovals})`,
      body: 'Permisos, documentos y workers esperan tu visto bueno',
      primaryAction: { label: 'Bandeja', route: '/approvals' },
      severity: 'action_required',
      category: 'approvals',
      count: s.pendingApprovals,
    });
  }
  if (s.criticalIncidentsLast7d > 0) {
    cards.push({
      id: 'sc-incidents',
      title: `Incidentes críticos 7d (${s.criticalIncidentsLast7d})`,
      body: 'Revisa investigaciones abiertas',
      primaryAction: { label: 'Investigaciones', route: '/incidents' },
      severity: 'urgent',
      category: 'incidents',
      count: s.criticalIncidentsLast7d,
    });
  }
  return cards;
}

function buildPreventionCards(s: RoleViewState): RoleCard[] {
  // Prevencionista ve un superset de site_chief + datos de cumplimiento
  const cards = buildSiteChiefCards(s);
  if (s.complianceScore !== undefined) {
    cards.unshift({
      id: 'p-compliance',
      title: `Cumplimiento ${s.complianceScore}/100`,
      body: 'Score determinístico de semáforo F.2',
      primaryAction: { label: 'Detalle', route: '/compliance' },
      severity:
        s.complianceScore >= 80 ? 'info' : s.complianceScore >= 60 ? 'action_required' : 'urgent',
      category: 'compliance',
    });
  }
  return cards;
}

function buildManagementCards(s: RoleViewState): RoleCard[] {
  const cards: RoleCard[] = [];
  if (s.complianceScore !== undefined) {
    cards.push({
      id: 'mg-compliance',
      title: `Cumplimiento global ${s.complianceScore}/100`,
      body: 'Promedio de proyectos activos',
      primaryAction: { label: 'Reporte', route: '/reports/compliance' },
      severity: s.complianceScore >= 80 ? 'info' : 'action_required',
      category: 'compliance',
    });
  }
  if (s.totalActiveProjects !== undefined && s.totalActiveWorkers !== undefined) {
    cards.push({
      id: 'mg-overview',
      title: `${s.totalActiveProjects} proyectos · ${s.totalActiveWorkers} trabajadores`,
      body: 'Vista global de la operación',
      primaryAction: { label: 'Comparador', route: '/projects/compare' },
      severity: 'info',
      category: 'overview',
    });
  }
  if (s.preventiveROIClpMonth !== undefined) {
    cards.push({
      id: 'mg-roi',
      title: `ROI preventivo este mes: $${(s.preventiveROIClpMonth / 1_000_000).toFixed(1)}M CLP`,
      body: 'Ahorros estimados por prevención + automatización',
      primaryAction: { label: 'Detalle', route: '/reports/roi' },
      severity: 'info',
      category: 'finance',
    });
  }
  if (s.criticalIncidentsLast7d > 0) {
    cards.push({
      id: 'mg-incidents',
      title: `${s.criticalIncidentsLast7d} incidente(s) crítico(s) 7d`,
      body: 'Posible impacto reputacional / cliente mandante',
      primaryAction: { label: 'Ver', route: '/incidents' },
      severity: 'urgent',
      category: 'risk',
      count: s.criticalIncidentsLast7d,
    });
  }
  // Always-present: estado de la faena para gerencia.
  cards.push({
    id: 'mg-faena',
    title: `Estado faena: ${s.faenaState}`,
    body: 'Vista ejecutiva del estado operacional',
    primaryAction: { label: 'Dashboard', route: '/operations' },
    severity:
      s.faenaState === 'emergencia' || s.faenaState === 'detenida' ? 'urgent' : 'info',
    category: 'operations',
  });
  return cards;
}
