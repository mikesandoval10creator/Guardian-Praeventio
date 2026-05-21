// Praeventio Guard — §12.7.2: Acciones contextuales para nodos del grafo.
//
// Cuando el usuario hace click en un nodo del RiskNetwork visualizer,
// le mostramos botones inline contextuales según el tipo de nodo:
//   - Worker → "Asignar capacitación", "Ver historial médico", "Reconocer"
//   - Risk → "Generar PTS", "Ver normativa", "Iniciar IPER"
//   - Training → "Ver lecciones aprendidas", "Asignar a equipo"
//   - EPP → "Ver inventario", "Solicitar OC", "Inspeccionar"
//   - Document → "Ver versión actual", "Solicitar firma", "Audit log"
//
// Determinístico — input es node type + node metadata + permisos del
// caller. Output es lista de acciones renderizable por la UI.

export type NodeKind =
  | 'worker'
  | 'risk'
  | 'control'
  | 'training'
  | 'epp'
  | 'document'
  | 'incident'
  | 'lesson'
  | 'equipment'
  | 'permit'
  | 'inspection'
  | 'project';

export type CallerRole = 'worker' | 'supervisor' | 'auditor' | 'admin';

export type ActionCategory = 'view' | 'create' | 'mutate' | 'export' | 'delete';

export interface ContextualAction {
  /** ID estable (para tracking analytics + i18n). */
  id: string;
  /** Etiqueta human-readable (i18n key opcional via i18nKey). */
  label: string;
  /** Key para react-i18next si el caller quiere localizar. */
  i18nKey?: string;
  /** Icon hint (lucide-react o nombre genérico). */
  icon: string;
  /** Categoría (view/create/mutate/export/delete) para color UI. */
  category: ActionCategory;
  /** Path destino (router-link) o función URL builder. */
  href?: string;
  /** Si requiere confirmación adicional antes ejecutar. */
  requiresConfirm?: boolean;
  /** Tooltip explicativo opcional. */
  tooltip?: string;
}

export interface NodeContext {
  /** ID único del nodo. */
  nodeId: string;
  /** Tipo de nodo. */
  kind: NodeKind;
  /** Metadata adicional para context-aware actions. */
  metadata?: Record<string, unknown>;
  /** Project + tenant scoping. */
  projectId: string;
  tenantId: string;
}

const ACTION_REGISTRY: Record<NodeKind, Array<(ctx: NodeContext, role: CallerRole) => ContextualAction[]>> = {
  worker: [
    () => [
      {
        id: 'worker.view_profile',
        label: 'Ver perfil',
        i18nKey: 'graph.actions.worker.view_profile',
        icon: 'user',
        category: 'view',
      },
    ],
    (ctx, role) =>
      role !== 'worker'
        ? [
            {
              id: 'worker.assign_training',
              label: 'Asignar capacitación',
              i18nKey: 'graph.actions.worker.assign_training',
              icon: 'book-open',
              category: 'mutate',
              href: `/workers/${ctx.nodeId}/training/assign`,
            },
          ]
        : [],
    () => [
      {
        id: 'worker.give_recognition',
        label: 'Dar reconocimiento',
        i18nKey: 'graph.actions.worker.recognition',
        icon: 'award',
        category: 'create',
        href: `/wall/recognize`,
      },
    ],
    (ctx, role) =>
      role === 'supervisor' || role === 'admin'
        ? [
            {
              id: 'worker.view_medical',
              label: 'Ver historial médico',
              i18nKey: 'graph.actions.worker.view_medical',
              icon: 'heart-pulse',
              category: 'view',
              href: `/medical/worker/${ctx.nodeId}`,
              tooltip: 'Requiere consentimiento explícito (Ley 19.628 art. 12)',
            },
          ]
        : [],
  ],
  risk: [
    (ctx) => [
      {
        id: 'risk.generate_pts',
        label: 'Generar PTS',
        i18nKey: 'graph.actions.risk.generate_pts',
        icon: 'file-text',
        category: 'create',
        href: `/risk/${ctx.nodeId}/pts/new`,
      },
      {
        id: 'risk.view_normative',
        label: 'Ver normativa aplicable',
        i18nKey: 'graph.actions.risk.normative',
        icon: 'gavel',
        category: 'view',
        href: `/normatives?risk=${ctx.nodeId}`,
      },
      {
        id: 'risk.start_iper',
        label: 'Iniciar IPER',
        i18nKey: 'graph.actions.risk.iper',
        icon: 'clipboard-check',
        category: 'create',
        href: `/iper/new?riskId=${ctx.nodeId}`,
      },
    ],
  ],
  control: [
    (ctx, role) => [
      {
        id: 'control.view',
        label: 'Ver detalle control',
        i18nKey: 'graph.actions.control.view',
        icon: 'shield',
        category: 'view',
        href: `/controls/${ctx.nodeId}`,
      },
      ...(role === 'supervisor' || role === 'admin'
        ? [
            {
              id: 'control.mark_implemented',
              label: 'Marcar implementado',
              i18nKey: 'graph.actions.control.mark_implemented',
              icon: 'check-circle',
              category: 'mutate' as const,
              requiresConfirm: true,
            },
          ]
        : []),
    ],
  ],
  training: [
    (ctx) => [
      {
        id: 'training.view_lessons',
        label: 'Ver lecciones aprendidas',
        i18nKey: 'graph.actions.training.lessons',
        icon: 'lightbulb',
        category: 'view',
        href: `/training/${ctx.nodeId}/lessons`,
      },
      {
        id: 'training.assign_team',
        label: 'Asignar a equipo',
        i18nKey: 'graph.actions.training.assign_team',
        icon: 'users',
        category: 'mutate',
        href: `/training/${ctx.nodeId}/assign`,
      },
    ],
  ],
  epp: [
    (ctx, role) => [
      {
        id: 'epp.view_inventory',
        label: 'Ver inventario',
        i18nKey: 'graph.actions.epp.inventory',
        icon: 'package',
        category: 'view',
        href: `/epp/${ctx.nodeId}/inventory`,
      },
      ...(role !== 'worker'
        ? [
            {
              id: 'epp.request_oc',
              label: 'Solicitar OC',
              i18nKey: 'graph.actions.epp.request_oc',
              icon: 'shopping-cart',
              category: 'create' as const,
              href: `/epp/${ctx.nodeId}/oc/new`,
            },
          ]
        : []),
      {
        id: 'epp.inspect',
        label: 'Inspeccionar',
        i18nKey: 'graph.actions.epp.inspect',
        icon: 'eye',
        category: 'create',
        href: `/epp/${ctx.nodeId}/inspect`,
      },
    ],
  ],
  document: [
    (ctx, role) => [
      {
        id: 'document.view_current',
        label: 'Ver versión actual',
        i18nKey: 'graph.actions.document.view',
        icon: 'file',
        category: 'view',
        href: `/documents/${ctx.nodeId}`,
      },
      ...(role !== 'worker'
        ? [
            {
              id: 'document.request_signature',
              label: 'Solicitar firma',
              i18nKey: 'graph.actions.document.sign',
              icon: 'pen-tool',
              category: 'mutate' as const,
              href: `/documents/${ctx.nodeId}/sign`,
            },
          ]
        : []),
      ...(role === 'auditor' || role === 'admin'
        ? [
            {
              id: 'document.audit_log',
              label: 'Audit log',
              i18nKey: 'graph.actions.document.audit',
              icon: 'history',
              category: 'view' as const,
              href: `/documents/${ctx.nodeId}/audit`,
            },
          ]
        : []),
    ],
  ],
  incident: [
    (ctx) => [
      {
        id: 'incident.view',
        label: 'Ver detalle',
        i18nKey: 'graph.actions.incident.view',
        icon: 'alert-triangle',
        category: 'view',
        href: `/incidents/${ctx.nodeId}`,
      },
      {
        id: 'incident.investigate',
        label: 'Investigar causa raíz',
        i18nKey: 'graph.actions.incident.investigate',
        icon: 'search',
        category: 'create',
        href: `/incidents/${ctx.nodeId}/investigate`,
      },
    ],
  ],
  lesson: [
    (ctx) => [
      {
        id: 'lesson.share',
        label: 'Compartir con equipo',
        i18nKey: 'graph.actions.lesson.share',
        icon: 'share-2',
        category: 'create',
        href: `/lessons/${ctx.nodeId}/share`,
      },
    ],
  ],
  equipment: [
    (ctx, role) => [
      {
        id: 'equipment.view_qr',
        label: 'Ver QR',
        i18nKey: 'graph.actions.equipment.qr',
        icon: 'qr-code',
        category: 'view',
        href: `/equipment/${ctx.nodeId}/qr`,
      },
      ...(role !== 'worker'
        ? [
            {
              id: 'equipment.schedule_maintenance',
              label: 'Agendar mantención',
              i18nKey: 'graph.actions.equipment.maintenance',
              icon: 'wrench',
              category: 'create' as const,
              href: `/equipment/${ctx.nodeId}/maintenance/new`,
            },
          ]
        : []),
    ],
  ],
  permit: [
    (ctx) => [
      {
        id: 'permit.view',
        label: 'Ver permiso',
        i18nKey: 'graph.actions.permit.view',
        icon: 'file-check',
        category: 'view',
        href: `/permits/${ctx.nodeId}`,
      },
    ],
  ],
  inspection: [
    (ctx) => [
      {
        id: 'inspection.view',
        label: 'Ver inspección',
        i18nKey: 'graph.actions.inspection.view',
        icon: 'clipboard',
        category: 'view',
        href: `/inspections/${ctx.nodeId}`,
      },
    ],
  ],
  project: [
    (ctx) => [
      {
        id: 'project.dashboard',
        label: 'Dashboard',
        i18nKey: 'graph.actions.project.dashboard',
        icon: 'layout-dashboard',
        category: 'view',
        href: `/projects/${ctx.nodeId}/dashboard`,
      },
    ],
  ],
};

/**
 * Build contextual actions list for a node + caller role.
 *
 * Determinístico — mismo input → misma lista.
 */
export function buildContextualActions(
  context: NodeContext,
  role: CallerRole,
): ContextualAction[] {
  const generators = ACTION_REGISTRY[context.kind] ?? [];
  return generators.flatMap((gen) => gen(context, role));
}

/**
 * Filter actions by category (e.g. show only "create" actions in a
 * floating speed-dial menu).
 */
export function filterActionsByCategory(
  actions: ContextualAction[],
  categories: ActionCategory[],
): ContextualAction[] {
  return actions.filter((a) => categories.includes(a.category));
}

/**
 * Group actions by category for UI rendering (e.g. tabs in modal).
 */
export function groupActionsByCategory(
  actions: ContextualAction[],
): Record<ActionCategory, ContextualAction[]> {
  const groups: Record<ActionCategory, ContextualAction[]> = {
    view: [],
    create: [],
    mutate: [],
    export: [],
    delete: [],
  };
  for (const a of actions) {
    groups[a.category].push(a);
  }
  return groups;
}
