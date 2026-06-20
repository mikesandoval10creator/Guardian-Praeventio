// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 §P2 (Sidebar refactor).
//
// Extracción de la configuración de menuGroups del Sidebar.tsx para
// reducir el archivo de UI de 609 LOC a ~380 LOC y dejar la estructura
// de navegación como dato puro testeable. La función `buildSidebarMenuGroups`
// es pura (toma `t` + `features` + `isAdmin`, retorna `MenuGroup[]`), lo
// que permite:
//
//   1. Tests unitarios sin renderizar el Sidebar
//   2. Atomicidad para agregar entries cuando Fase A merge los 13 paths
//      nuevos de Sprint K (stoppages, lone-worker, exceptions, etc.)
//   3. Otros componentes (Command Palette, búsqueda) pueden reutilizar
//      la misma lista sin duplicar el catálogo
//
// Comportamiento runtime: idéntico al inline previo. El Sidebar.tsx
// importa esta función y la llama con los mismos parámetros.

import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import {
  Activity,
  Lock,
  AlertOctagon,
  AlertTriangle,
  Award,
  BarChart3,
  Book,
  BookOpen,
  Brain,
  Briefcase,
  Calendar,
  Car,
  Crosshair,
  Construction,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Database,
  Droplet,
  Droplets,
  Ear,
  Hand,
  FileText,
  Folder,
  Gamepad2,
  HelpCircle,
  HeartPulse,
  Home,
  Inbox as InboxIcon,
  Key,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Map,
  MessageSquare,
  Moon,
  Mountain,
  Network,
  OctagonAlert,
  Printer,
  ScanLine,
  Scan,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Sun,
  GitCompare,
  Truck,
  User,
  UserCheck,
  Users,
  Wind,
  Wrench,
  Zap,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type MenuItem = {
  title: string;
  icon: LucideIcon;
  path: string;
  color: string;
  isBeta?: boolean;
};

export type MenuGroup = {
  title: string;
  icon: LucideIcon;
  items: MenuItem[];
};

/**
 * i18n translator — alias del `TFunction` de i18next para que matchee
 * exactamente el shape que `useTranslation().t` devuelve (tiene overloads
 * complejos que un simple `(key, fallback) => string` no satisface).
 * El builder solo usa la firma `t(key, fallback)` igual — el alias es
 * solo para que TS no proteste en el call-site del Sidebar.
 */
export type TFn = TFunction;

/** Sub-conjunto de features que el menú lee del SubscriptionContext. */
export interface SubscriptionFeatureGates {
  canUseExecutiveDashboard: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────

/**
 * Construye la lista de grupos del Sidebar. Función pura (sin hooks),
 * idempotente sobre los mismos params.
 *
 * @param t i18n translator
 * @param features feature gates de la suscripción del usuario
 * @param isAdmin admin role del usuario
 * @returns `MenuGroup[]` con los grupos visibles para este user
 */
export function buildSidebarMenuGroups(
  t: TFn,
  features: SubscriptionFeatureGates,
  isAdmin: boolean,
): MenuGroup[] {
  const commandCenterItems: MenuItem[] = [
    { title: t('nav.dashboard', 'Inicio'), icon: Home, path: '/', color: 'text-[#4db6ac]' },
    // Sprint 40 Fase F.8 — Bandeja del Prevencionista. Pendientes
    // de hoy agregados de múltiples feeds (corrective actions, SIF,
    // exceptions, etc.) en una vista única ordenada por urgencia.
    { title: t('nav.inbox', 'Bandeja'), icon: InboxIcon, path: '/inbox', color: 'text-teal-500' },
    // Fase 5 D2 slice 1 — /safe-driving = SafeDrivingMode (SOS driver
    // mode, life-safety). Copy fixed to es-CL (was hardcoded English).
    { title: t('nav.safe_driving_mode', 'Modo Conducción Segura'), icon: Car, path: '/safe-driving', color: 'text-blue-500' },
    { title: t('nav.safety_feed', 'Muro Social'), icon: Users, path: '/safety-feed', color: 'text-[#4db6ac]' },
    { title: t('nav.projects', 'Proyectos'), icon: Briefcase, path: '/projects', color: 'text-blue-500' },
    { title: t('nav.cuadrillas', 'Cuadrillas'), icon: Users, path: '/cuadrillas', color: 'text-[#4db6ac]' },
    // Sprint 41 Fase F.16 — Score de Preparación del Trabajador.
    { title: t('nav.worker_readiness', 'Preparación Trabajador'), icon: UserCheck, path: '/worker-readiness', color: 'text-teal-500' },
    // Sprint 28 Bucket B5 — CPHS formal module (audit hallazgo H29 P1).
    { title: t('nav.cphs', 'Comité Paritario (CPHS)'), icon: ShieldCheck, path: '/cphs', color: 'text-[#4db6ac]' },
    // Sprint K wire UI (2026-05-23) — Bitácora de Obra DS 76 con
    // folios consecutivos year-based + 12 kinds + status open→signed.
    { title: t('nav.site_book', 'Bitácora de Obra'), icon: Book, path: '/site-book', color: 'text-amber-600' },
    // Sprint K wire UI (2026-05-23) — Cambio de Turno + Handover.
    // Log cronológico + notas categorizadas con severidad + ack flow.
    { title: t('nav.shift_handover', 'Cambio de Turno'), icon: Clock, path: '/shift-handover', color: 'text-indigo-500' },
    // Fase 5 B8 — LOTO Digital (Lock-Out/Tag-Out).
    { title: t('nav.loto', 'LOTO'), icon: Lock, path: '/loto', color: 'text-rose-500' },
    // Sprint 40 Fase F.7 — sub-link al borrador mensual automático.
    { title: t('nav.cphs_draft', 'Minuta CPHS'), icon: FileText, path: '/cphs/draft-minute', color: 'text-teal-500' },
    { title: t('nav.mining_contractors', 'Contratistas Mineros'), icon: Mountain, path: '/mining-contractors', color: 'text-amber-500' },
    { title: t('nav.analytics', 'Reportabilidad'), icon: BarChart3, path: '/analytics', color: 'text-zinc-400' },
    // Sprint 40 Fase F.4 — Centro de Acciones Correctivas (PDCA).
    { title: t('nav.corrective_actions', 'Acciones Correctivas'), icon: ListChecks, path: '/corrective-actions', color: 'text-teal-500' },
    // Sprint K §131-138 — Cierre de Proyecto + Lecciones Transferibles.
    { title: t('nav.project_closure', 'Cierre de Proyecto'), icon: Briefcase, path: '/closure', color: 'text-violet-500' },
    // Sprint K §195-200 — Módulo PDCA + No Conformidades (ISO 45001 §10.2).
    { title: t('nav.pdca', 'PDCA + No Conformidades'), icon: Activity, path: '/pdca', color: 'text-teal-500' },
    // Sprint K §291-295 — Revisión Anual del SGI.
    { title: t('nav.annual_review', 'Revisión Anual SGI'), icon: ClipboardCheck, path: '/annual-review', color: 'text-violet-500' },
    // Sprint K §296-301 — Riesgo Residual + Aceptación Formal.
    { title: t('nav.residual_risk', 'Riesgo Residual'), icon: AlertOctagon, path: '/residual-risk', color: 'text-rose-500' },
    // Sprint K §90-91 — Calidad de Proveedores + Ranking de Riesgo.
    { title: t('nav.suppliers', 'Proveedores'), icon: Truck, path: '/suppliers', color: 'text-blue-500' },
    // Mantenimiento preventivo (horómetro) — mounts the orphan MaintenanceTaskList.
    { title: t('nav.maintenance_preventive', 'Mantenimiento'), icon: Wrench, path: '/mantenimiento-preventivo', color: 'text-teal-500' },
    // Sprint K §214-215 — Observaciones Positivas + Balance.
    { title: t('nav.positive_observations', 'Observaciones Positivas'), icon: Award, path: '/positive-observations', color: 'text-teal-500' },
    // Sprint 42 Fase F.6 — Modo Sin Señal para Inspecciones.
    { title: t('nav.inspections', 'Inspecciones'), icon: ClipboardCheck, path: '/inspections', color: 'text-blue-500' },
    // §42-44 — Inventario Controles de Ingeniería.
    { title: t('nav.engineering_controls', 'Controles de Ingeniería'), icon: Layers, path: '/engineering-controls', color: 'text-violet-500' },
    // Sprint K §61-63 — Cultura Preventiva (encuesta + índice).
    { title: t('nav.culture_pulse', 'Cultura Preventiva'), icon: HeartPulse, path: '/culture-pulse', color: 'text-rose-500' },
    // Sprint 40 Fase F.5 — Firma QR de Recepción.
    { title: t('nav.qr_signature', 'Firma QR'), icon: ScanLine, path: '/qr-signature', color: 'text-violet-500' },
    // Sprint 41 Fase F.26 — Índice de Madurez Preventiva.
    { title: t('nav.maturity_index', 'Índice de Madurez'), icon: Award, path: '/maturity-index', color: 'text-violet-500' },
    // Sprint 42 Fase F.15 — Centro de Permisos de Trabajo.
    { title: t('nav.work_permits', 'Permisos de Trabajo'), icon: ShieldCheck, path: '/work-permits', color: 'text-amber-500' },
    // Sprint 40 Fase F.12 — Biblioteca de Lecciones Aprendidas.
    { title: t('nav.lessons_learned', 'Lecciones Aprendidas'), icon: BookOpen, path: '/lessons', color: 'text-amber-500' },
    // Sprint K wire UI (2026-05-23) — Excepciones documentadas.
    // Service exceptionEngine.ts + panel ExceptionsAuditPanel.tsx existían
    // sin page. Cada excepción a un control normal requiere mitigación
    // alternativa + duración máx 168h + aprobador role-gate.
    { title: t('nav.exceptions', 'Excepciones'), icon: AlertOctagon, path: '/exceptions', color: 'text-amber-500' },
    // Sprint K wire UI (2026-05-23) — Auditor de consistencia entre módulos.
    // Service consistencyAuditor.ts (12 reglas determinísticas) + card
    // ConsistencyAuditCard.tsx existían sin page consumidor.
    { title: t('nav.consistency_audit', 'Auditor Consistencia'), icon: ShieldAlert, path: '/consistency-audit', color: 'text-rose-500' },
    // Sprint K wire UI (2026-05-23) — Calendario legal recurrente.
    // STANDARD_OBLIGATIONS: auditorías, mediciones, CPHS, simulacros,
    // exámenes ocupacionales, renovaciones documentos/permisos.
    { title: t('nav.legal_calendar', 'Calendario Legal'), icon: Calendar, path: '/legal-calendar', color: 'text-teal-500' },
    // Sprint K wire UI (2026-05-23) — Gestión de Cambios (MOC ISO 45001 §8.1.3).
    // Cada cambio operacional registra rationale + impacto + workers
    // afectados + ack flow. Revertible con motivo documentado.
    { title: t('nav.operational_changes', 'Gestión de Cambios'), icon: Network, path: '/operational-changes', color: 'text-violet-500' },
    // F5(changeMgmt) — Control de Cambios (MOC) adapter-backed: declarar →
    // cobertura de acknowledgment → banner de confirmación. Persistido en
    // /api/sprint-k (operationalChange.ts), distinto del store legacy de arriba.
    { title: t('nav.change_management', 'Control de Cambios'), icon: GitCompare, path: '/change-management', color: 'text-teal-500' },
    // Sprint K wire UI (2026-05-23) — Charlas diarias determinísticas.
    // suggestTalks scoring por triggers (riesgos, tareas, incidentes,
    // clima, newWorkers). Sin LLM, top 3 con rationale citando triggers.
    { title: t('nav.safety_talks', 'Charlas Diarias'), icon: MessageSquare, path: '/safety-talks', color: 'text-sky-500' },
    // Sprint K wire UI (2026-05-23) — Portales auditor externo.
    // Token 64-char hex + TTL 1-90d + scope modulos + revocable.
    // SUSESO / mutualidad / ISO / SEREMI / DT / mandante / cliente.
    { title: t('nav.audit_portals', 'Portales Auditor'), icon: ShieldCheck, path: '/audit-portals', color: 'text-emerald-500' },
    // Sprint K wire UI (2026-05-23) — Confirmación de lectura de documentos
    // críticos. Service readReceiptService.ts + card DocumentReadConfirmCard
    // existían sin page consumidor.
    { title: t('nav.document_read', 'Lectura de Documentos'), icon: FileText, path: '/document-read', color: 'text-sky-500' },
    // Sprint K vidas críticas wire (2026-05-22) — Controles críticos (HCA).
    // Service criticalControlsLibrary.ts + card BarrierAnalysisCard existían;
    // page /critical-controls cierra el gap. ISO 45001 §8.1.2.
    { title: t('nav.critical_controls', 'Controles Críticos'), icon: ShieldCheck, path: '/critical-controls', color: 'text-emerald-500' },
    // Línea de fuego (struck-by/caught-between) — self-assessment tool over the
    // real validateLineOfFire engine (mounts the orphan LineOfFireValidationCard).
    { title: t('nav.linea_de_fuego', 'Línea de Fuego'), icon: Crosshair, path: '/linea-de-fuego', color: 'text-rose-500' },
    // Calculadora de pandeo (Euler) — mounts the orphan BucklingCalculatorCard.
    { title: t('nav.calculadora_pandeo', 'Calculadora de Pandeo'), icon: Construction, path: '/calculadora-pandeo', color: 'text-amber-500' },
    // Checklist pre-uso de vehículo — mounts the orphan VehiclePreOpChecklistCard.
    { title: t('nav.checklist_vehiculo', 'Pre-Uso Vehículo'), icon: Truck, path: '/checklist-vehiculo', color: 'text-sky-500' },
    // Matriz IPER 5x5 — mounts the orphan IperMatrixCard over the real calculateIper engine.
    { title: t('nav.iper_matrix', 'Matriz IPER'), icon: LayoutGrid, path: '/matriz-iper', color: 'text-violet-500' },
    // Auditoría 5S — mounts the orphan FiveSAuditForm over the real buildFiveSAuditReport engine.
    { title: t('nav.five_s_audit', 'Auditoría 5S'), icon: ClipboardList, path: '/auditoria-5s', color: 'text-emerald-500' },
    // Sprint K vidas críticas wire (2026-05-22) — Causa raíz no-blame.
    // Service rootCauseClassifier.ts (5 porqués + ILO taxonomía) +
    // card RootCauseClassifierCard existían sin page. ISO 45001 §10.2.
    { title: t('nav.root_cause', 'Causa Raíz'), icon: Network, path: '/root-cause', color: 'text-indigo-500' },
    // Sprint 40 Fase F.21 — Panel de Riesgo por Turno (pre-turno).
    { title: t('nav.pre_shift_risk', 'Pre-turno'), icon: Sun, path: '/pre-shift-risk', color: 'text-amber-500' },
    // Sprint 40 Fase F.13 — Radar de Riesgos Repetidos.
    { title: t('nav.repeating_risks', 'Patrones de Riesgo'), icon: AlertTriangle, path: '/repeating-risks', color: 'text-rose-500' },
    // Sprint 41 Fase F.20 — Gestor de Simulacros (DS 132 / DS 594).
    { title: t('nav.drills', 'Gestor de Simulacros'), icon: ShieldAlert, path: '/drills', color: 'text-amber-500' },
    // Sprint K §74-78 — Brigada de Emergencia + Inventario de Recursos.
    { title: t('nav.emergency_brigade', 'Brigada Emergencia'), icon: ShieldAlert, path: '/emergency-brigade', color: 'text-amber-500' },
    // Phase 5 "make real" wire — Mapa de Primer Respondedor (FirstResponderDispatchPanel
    // estaba construido pero huérfano: feed real de cobertura + despacho del más apto).
    { title: t('nav.first_responder_map', 'Primer Respondedor'), icon: HeartPulse, path: '/first-responder-map', color: 'text-rose-500' },
    // Sprint K vidas críticas wire — Tablero de Evacuación.
    { title: t('nav.evacuation_dashboard', 'Tablero Evacuación'), icon: AlertTriangle, path: '/evacuation-dashboard', color: 'text-rose-500' },
    // Sprint K vidas críticas wire (2026-05-22) — Paralizaciones / stop-work
    // authority + reanudación controlada. Service stoppage/stoppageEngine.ts
    // + adapter Firestore + card StoppageSummaryCard ya existían. Page
    // /stoppages cierra el gap. Cualquier worker puede declarar
    // detencion_voluntaria; categorías superiores exigen role superior.
    { title: t('nav.stoppages', 'Paralizaciones'), icon: OctagonAlert, path: '/stoppages', color: 'text-rose-500' },
    // OLA 1 — SIF (Serious Injury/Fatality) precursor review page.
    { title: t('nav.sif_precursors', 'Precursores SIF'), icon: AlertOctagon, path: '/sif', color: 'text-rose-500' },
    // Sprint K vidas críticas wire (2026-05-23) — Trabajo solitario.
    // Service loneWorkerService.ts + card LoneWorkerCard.tsx existían
    // pero faltaba la page. Check-in periódico + escalamiento.
    { title: t('nav.lone_worker', 'Trabajo Solitario'), icon: UserCheck, path: '/lone-worker', color: 'text-teal-500' },
    // OLA 1 (2026-06-14) — worker-facing check-in surface (big-button + Android
    // FGS) at /lone-worker/check-in, distinct from the supervisor monitor above
    // (was shadowed by it — same path collision).
    { title: t('nav.lone_worker_checkin', 'Mi Check-in Solitario'), icon: ClipboardCheck, path: '/lone-worker/check-in', color: 'text-teal-500' },
    // OLA 1 — restricted-zone editor (map-draw) → activates geofence→SOS.
    { title: t('nav.restricted_zones', 'Zonas Restringidas'), icon: OctagonAlert, path: '/restricted-zones', color: 'text-rose-500' },
    // OLA 1 (VIDA visible) — worker surface: see zones on a map + register an
    // informed entry (ZoneEntryGate + RestrictedZonesMapOverlay, never blocks).
    { title: t('nav.zone_entry', 'Ingreso a Zonas'), icon: OctagonAlert, path: '/zone-entry', color: 'text-rose-500' },
    // Sprint K §276-277 — Bitácora de Decisiones de Supervisión.
    { title: t('nav.leadership_decisions', 'Decisiones Supervisión'), icon: User, path: '/leadership-decisions', color: 'text-blue-500' },
    // Sprint K §69-71 — Conducción Segura + Rutas Críticas.
    { title: t('nav.driving_safety', 'Conducción Segura'), icon: Car, path: '/driving-safety', color: 'text-blue-500' },
    // Fase 5 D2 slice 1 (2026-06-11) — SafeDriving.tsx (reporte de
    // incidentes de conducción + checklist pre-conducción) era
    // inalcanzable por la colisión de ruta en /safe-driving. Re-pathed
    // a /driving-incidents y expuesto acá para que deje de ser isla.
    { title: t('nav.driving_incidents', 'Incidentes de Conducción'), icon: Car, path: '/driving-incidents', color: 'text-amber-500' },
    // Sprint K §211-213 — Reportes Confidenciales (Ley Karin 21.643).
    { title: t('nav.confidential_reports', 'Reportes Confidenciales'), icon: ShieldAlert, path: '/confidential-reports', color: 'text-rose-500' },
    // Sprint 55 Fase F.14 — Mapa de Calor de Hallazgos.
    { title: t('nav.findings_heatmap', 'Mapa Calor Hallazgos'), icon: Map, path: '/findings-heatmap', color: 'text-rose-500' },
    // Sprint 55 Fase F.17 — Centro de Bloqueos Soft.
    { title: t('nav.soft_blocks', 'Bloqueos Soft'), icon: ShieldAlert, path: '/soft-blocks', color: 'text-amber-500' },
    // Sprint 55 Fase F.24 — Cadena de Custodia.
    { title: t('nav.custody_chain', 'Cadena de Custodia'), icon: Shield, path: '/custody-chain', color: 'text-violet-500' },
    // Sprint 55 Fase F.27 — Comparador de Proyectos.
    { title: t('nav.projects_compare', 'Comparar Proyectos'), icon: BarChart3, path: '/projects-compare', color: 'text-blue-500' },
    // F.29 — Tendencia de Incidentes + Leading Indicators.
    { title: t('nav.incident_trends', 'Tendencia Incidentes'), icon: BarChart3, path: '/incident-trends', color: 'text-amber-500' },
    // Épica B1 capa 2 — Simulador cotización adicional DS 67 (siniestralidad → $).
    { title: t('nav.ds67_simulator', 'Simulador DS 67'), icon: BarChart3, path: '/ds67-simulator', color: 'text-teal-500' },
    // Sprint K §244-250 — Aprendices + Mentoría + Autorización Progresiva.
    { title: t('nav.apprenticeship', 'Aprendices y Mentores'), icon: UserCheck, path: '/apprenticeship', color: 'text-teal-500' },
    // Sprint 42 Fase F.18 — Historial Profesional Portátil del Trabajador.
    { title: t('nav.portable_history', 'Historial Portátil'), icon: User, path: '/portable-history', color: 'text-blue-500' },
  ];
  if (features.canUseExecutiveDashboard) {
    commandCenterItems.push({
      title: t('nav.executive_dashboard', 'Dashboard Ejecutivo'),
      icon: BarChart3,
      path: '/executive-dashboard',
      color: 'text-violet-500',
    });
  }

  const groups: MenuGroup[] = [
    {
      title: t('nav.command_center', 'Centro de Mando'),
      icon: Home,
      items: commandCenterItems,
    },
    {
      title: t('nav.ai_group', 'Inteligencia Artificial'),
      icon: Brain,
      items: [
        { title: t('nav.ai_hub', 'AI Hub'), icon: Zap, path: '/ai-hub', color: 'text-violet-500' },
        { title: 'Coach de Seguridad', icon: Brain, path: '/safety-coach', color: 'text-[#4db6ac]' },
        { title: t('nav.zettelkasten', 'Zettelkasten'), icon: Database, path: '/zettelkasten', color: 'text-blue-500' },
        { title: t('nav.knowledge_base', 'Base de Conocimiento'), icon: Database, path: '/knowledge-base', color: 'text-violet-500' },
        // Sprint K §104 — Panel de Confianza de Datos (calidad para IA).
        { title: t('nav.data_confidence', 'Confianza de Datos'), icon: Database, path: '/data-confidence', color: 'text-violet-500' },
        { title: 'Pizarra', icon: LayoutDashboard, path: '/pizarra', color: 'text-indigo-400' },
        { title: t('nav.academic_processor', 'Procesador Académico'), icon: BookOpen, path: '/academic-processor', color: 'text-violet-500' },
        { title: t('nav.ocr_motor', 'Motor OCR'), icon: Scan, path: '/document-ocr', color: 'text-violet-400' },
        { title: 'Rastreador Solar', icon: Sun, path: '/sun-tracker', color: 'text-amber-500' },
        // Sprint 29 Bucket AA F-A — hub de las 12 calculadoras Bernoulli/Euler.
        { title: 'Calculadoras Especializadas', icon: Wrench, path: '/calculators', color: 'text-[#4db6ac]' },
      ],
    },
    {
      title: t('nav.ops_group', 'Módulos Operativos'),
      icon: LayoutGrid,
      items: [
        { title: t('nav.ops_mgmt', 'Gestión Operativa'), icon: Briefcase, path: '/hub/operations', color: 'text-blue-500' },
        { title: t('nav.risk_network', 'Prevención y Riesgos'), icon: ShieldAlert, path: '/hub/risks', color: 'text-violet-500' },
        { title: t('nav.health', 'Salud y Bienestar'), icon: HeartPulse, path: '/hub/health', color: 'text-rose-500' },
        { title: t('nav.emergencies', 'Entorno y Emergencias'), icon: AlertTriangle, path: '/hub/emergencies', color: 'text-amber-500' },
        { title: t('nav.compliance', 'Cumplimiento Legal'), icon: ClipboardCheck, path: '/hub/compliance', color: 'text-[#4db6ac]' },
        { title: t('nav.culture', 'Talento y Cultura'), icon: Users, path: '/hub/training', color: 'text-indigo-500' },
        { title: t('nav.afiches', 'Afiches de Seguridad'), icon: Printer, path: '/afiches-seguridad', color: 'text-blue-400' },
        { title: t('nav.digital_twin', 'Gemelo Digital 3D'), icon: Layers, path: '/hub/operations/digital-twin', color: 'text-cyan-400' },
      ],
    },
    {
      title: t('nav.occupational_health_group', 'Salud Ocupacional'),
      icon: Stethoscope,
      items: [
        { title: t('nav.human_body_viewer', 'Visor Corporal DIAT'), icon: Activity, path: '/human-body', color: 'text-rose-500' },
        { title: t('nav.medicine', 'Medicina'), icon: HeartPulse, path: '/medicine', color: 'text-rose-400' },
        { title: t('nav.hygiene', 'Higiene Industrial'), icon: Droplets, path: '/hygiene', color: 'text-blue-400' },
        { title: t('nav.ergonomics', 'Ergonomía'), icon: UserCheck, path: '/ergonomics', color: 'text-amber-400' },
        // B-protocols — TMERT-EESS + PREXOR + PLANESI con UI propia (gestión MINSAL).
        { title: t('nav.tmert', 'TMERT-EESS'), icon: Hand, path: '/tmert', color: 'text-amber-400' },
        { title: t('nav.prexor', 'PREXOR Ruido'), icon: Ear, path: '/prexor', color: 'text-sky-400' },
        { title: t('nav.planesi', 'PLANESI Sílice'), icon: Wind, path: '/planesi', color: 'text-orange-400' },
        // Sprint K vidas críticas wire — Monitor de Fatiga.
        { title: t('nav.fatigue', 'Monitor de Fatiga'), icon: Moon, path: '/fatigue', color: 'text-violet-500' },
        // Carga mental (NASA-TLX) — autoevaluación on-device (mounts the orphan MentalLoadSurveyForm).
        { title: t('nav.carga_mental', 'Carga Mental'), icon: Brain, path: '/carga-mental', color: 'text-emerald-500' },
      ],
    },
    {
      title: t('nav.settings_group', 'Configuración'),
      icon: Settings,
      items: [
        { title: t('nav.profile', 'Mi Perfil'), icon: User, path: '/profile', color: 'text-zinc-400' },
        // Sprint 23 Bucket FF — Ley 19.628 data-subject control center.
        { title: t('nav.my_data', 'Mis datos'), icon: ShieldCheck, path: '/my-data', color: 'text-[#4db6ac]' },
        { title: t('nav.settings', 'Ajustes'), icon: Settings, path: '/settings', color: 'text-zinc-400' },
        { title: t('nav.pricing', 'Planes y Facturación'), icon: Key, path: '/pricing', color: 'text-zinc-400' },
        { title: t('nav.help', 'Ayuda y Soporte'), icon: HelpCircle, path: '/help', color: 'text-zinc-400' },
      ],
    },
  ];

  // Sprint 23 Bucket CC — Admin group, only visible to admin role.
  if (isAdmin) {
    groups.push({
      title: t('nav.admin_group', 'Admin'),
      icon: ShieldCheck,
      items: [
        { title: t('nav.b2d_admin', 'Panel B2D'), icon: Key, path: '/admin/b2d', color: 'text-[#d4af37]' },
      ],
    });
  }

  return groups;
}
