// src/navigation/navCatalog.ts
// Praeventio Guard — F1 Navegación (2026-06-22). Fuente ÚNICA de navegación.
//
// Consolida los ~107 ítems del sidebar plano "Centro de Mando"
// (sidebarMenuGroups.ts) + las 10 categorías del carrusel
// (components/dashboard/moduleGroups.ts), que hasta ahora divergían, en
// 10 bloques balanceados por dominio. El Sidebar, el carrusel y el
// buscador derivan TODOS de aquí. Función pura, testeable sin render.
//
// Regla: cada `path` es una ruta ya cableada (verificada contra el
// sidebar/carrusel previos). Ningún módulo se pierde en el remapeo.

import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import {
  Activity, AlertOctagon, AlertTriangle, Award, BarChart3, Book, BookOpen, Box, Brain,
  Briefcase, Calculator, Calendar, Car, ClipboardCheck, ClipboardList, Clock, Compass,
  Construction, Crosshair, Database, Droplets, Ear, Eye, Factory, FileCheck,
  FileText, Folder, Gamepad2, GitBranch, Grid, Hand, HeartPulse, HelpCircle,
  Home, Inbox as InboxIcon, Key, Layers, LayoutDashboard, LayoutGrid, Lightbulb, ListChecks,
  Lock, Map, MessageSquare, Moon, Mountain, Network, OctagonAlert, Printer, Recycle,
  Scan, ScanLine, Settings as SettingsIcon, Shield, ShieldAlert, ShieldCheck, Siren,
  Stethoscope, Sun, Truck, User, UserCheck, Users, Wind, Wrench, Zap,
} from 'lucide-react';

export type TFn = TFunction;

export interface SubscriptionFeatureGates {
  canUseExecutiveDashboard: boolean;
}

export type NavItem = {
  title: string;
  icon: LucideIcon;
  path: string;
  color: string;
  isBeta?: boolean;
};

export type NavBlock = {
  id: string;
  title: string;
  icon: LucideIcon;
  items: NavItem[];
};

const TEAL = 'text-[#4db6ac]';

/**
 * Construye el catálogo de 10 bloques. Pura (sin hooks), idempotente.
 * @param t i18n translator (`t(key, fallback)`)
 * @param features feature gates de la suscripción
 * @param isAdmin admin role
 */
export function buildNavCatalog(
  t: TFn,
  features: SubscriptionFeatureGates,
  isAdmin: boolean,
): NavBlock[] {
  // ── 1. PRINCIPAL — entradas top-level + hub ──────────────────────────
  const principal: NavItem[] = [
    { title: t('nav.dashboard', 'Inicio'), icon: Home, path: '/', color: TEAL },
    { title: t('nav.inbox', 'Bandeja'), icon: InboxIcon, path: '/inbox', color: 'text-teal-500' },
    { title: t('nav.safety_feed', 'Muro Social'), icon: Users, path: '/safety-feed', color: TEAL },
    { title: t('nav.projects', 'Proyectos'), icon: Briefcase, path: '/projects', color: 'text-blue-500' },
    { title: t('nav.project_setup', 'Configurar Industria'), icon: Factory, path: '/project-setup', color: 'text-teal-500' },
    { title: t('nav.cuadrillas', 'Cuadrillas'), icon: Users, path: '/cuadrillas', color: TEAL },
    { title: t('nav.worker_readiness', 'Preparación Trabajador'), icon: UserCheck, path: '/worker-readiness', color: 'text-teal-500' },
    { title: 'Pizarra', icon: LayoutDashboard, path: '/pizarra', color: 'text-indigo-400' },
    { title: 'Mapa de Sitio', icon: Map, path: '/site-map', color: 'text-emerald-500' },
    { title: 'Mural', icon: MessageSquare, path: '/mural', color: 'text-emerald-500' },
    { title: 'Calendario', icon: Calendar, path: '/calendar', color: 'text-emerald-500' },
    { title: 'Focus Agenda', icon: ClipboardList, path: '/focus-agenda', color: 'text-emerald-500' },
  ];

  // ── 2. GESTIÓN OPERATIVA — día a día de la operación ─────────────────
  const operativa: NavItem[] = [
    { title: t('nav.ops_mgmt', 'Gestión Operativa'), icon: Briefcase, path: '/hub/operations', color: 'text-blue-500' },
    { title: t('nav.site_book', 'Bitácora de Obra'), icon: Book, path: '/site-book', color: 'text-amber-600' },
    { title: t('nav.shift_handover', 'Cambio de Turno'), icon: Clock, path: '/shift-handover', color: 'text-indigo-500' },
    { title: t('nav.loto', 'LOTO'), icon: Lock, path: '/loto', color: 'text-rose-500' },
    { title: t('nav.work_permits', 'Permisos de Trabajo'), icon: ShieldCheck, path: '/work-permits', color: 'text-amber-500' },
    { title: t('nav.maintenance_preventive', 'Mantenimiento'), icon: Wrench, path: '/mantenimiento-preventivo', color: 'text-teal-500' },
    { title: t('nav.inspections', 'Inspecciones'), icon: ClipboardCheck, path: '/inspections', color: 'text-blue-500' },
    { title: t('nav.checklist_vehiculo', 'Pre-Uso Vehículo'), icon: Truck, path: '/checklist-vehiculo', color: 'text-sky-500' },
    { title: t('nav.driving_safety', 'Conducción Segura'), icon: Car, path: '/driving-safety', color: 'text-blue-500' },
    { title: t('nav.driving_incidents', 'Incidentes de Conducción'), icon: Car, path: '/driving-incidents', color: 'text-amber-500' },
    { title: t('nav.mining_contractors', 'Contratistas Mineros'), icon: Mountain, path: '/mining-contractors', color: 'text-amber-500' },
    { title: t('nav.suppliers', 'Proveedores'), icon: Truck, path: '/suppliers', color: 'text-blue-500' },
    { title: t('nav.operational_changes', 'Gestión de Cambios'), icon: Network, path: '/operational-changes', color: 'text-violet-500' },
    { title: t('nav.change_management', 'Control de Cambios'), icon: GitBranch, path: '/change-management', color: 'text-teal-500' },
    { title: t('nav.afiches', 'Afiches de Seguridad'), icon: Printer, path: '/afiches-seguridad', color: 'text-blue-400' },
    { title: 'Trabajadores', icon: Users, path: '/workers', color: 'text-blue-500' },
    { title: 'Documentos', icon: Folder, path: '/documents', color: 'text-blue-500' },
    { title: 'Asistencia', icon: UserCheck, path: '/attendance', color: 'text-blue-500' },
    { title: 'Telemetría', icon: Activity, path: '/telemetry', color: 'text-blue-500' },
    { title: 'Activos', icon: Wrench, path: '/assets', color: 'text-blue-500' },
  ];

  // ── 3. PREVENCIÓN Y RIESGOS — identificación + mitigación ────────────
  const riesgos: NavItem[] = [
    { title: t('nav.risk_network', 'Prevención y Riesgos'), icon: ShieldAlert, path: '/hub/risks', color: 'text-violet-500' },
    { title: t('nav.iper_matrix', 'Matriz IPER'), icon: LayoutGrid, path: '/matriz-iper', color: 'text-violet-500' },
    { title: t('nav.critical_controls', 'Controles Críticos'), icon: ShieldCheck, path: '/critical-controls', color: 'text-emerald-500' },
    { title: t('nav.engineering_controls', 'Controles de Ingeniería'), icon: Layers, path: '/engineering-controls', color: 'text-violet-500' },
    { title: t('nav.linea_de_fuego', 'Línea de Fuego'), icon: Crosshair, path: '/linea-de-fuego', color: 'text-rose-500' },
    { title: t('nav.calculadora_pandeo', 'Calculadora de Pandeo'), icon: Construction, path: '/calculadora-pandeo', color: 'text-amber-500' },
    { title: t('nav.five_s_audit', 'Auditoría 5S'), icon: ClipboardList, path: '/auditoria-5s', color: 'text-emerald-500' },
    { title: t('nav.root_cause', 'Causa Raíz'), icon: Network, path: '/root-cause', color: 'text-indigo-500' },
    { title: t('nav.pre_shift_risk', 'Pre-turno'), icon: Sun, path: '/pre-shift-risk', color: 'text-amber-500' },
    { title: t('nav.repeating_risks', 'Patrones de Riesgo'), icon: AlertTriangle, path: '/repeating-risks', color: 'text-rose-500' },
    { title: t('nav.findings_heatmap', 'Mapa Calor Hallazgos'), icon: Map, path: '/findings-heatmap', color: 'text-rose-500' },
    { title: t('nav.residual_risk', 'Riesgo Residual'), icon: AlertOctagon, path: '/residual-risk', color: 'text-rose-500' },
    { title: t('nav.soft_blocks', 'Bloqueos Soft'), icon: ShieldAlert, path: '/soft-blocks', color: 'text-amber-500' },
    { title: t('nav.corrective_actions', 'Acciones Correctivas'), icon: ListChecks, path: '/corrective-actions', color: 'text-teal-500' },
    { title: t('nav.positive_observations', 'Observaciones Positivas'), icon: Award, path: '/positive-observations', color: 'text-teal-500' },
    { title: t('nav.safety_talks', 'Charlas Diarias'), icon: MessageSquare, path: '/safety-talks', color: 'text-sky-500' },
    { title: 'Riesgos', icon: AlertOctagon, path: '/risks', color: 'text-violet-500' },
    { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-violet-500' },
    { title: 'EPP', icon: Shield, path: '/epp', color: 'text-violet-500' },
    { title: 'Matriz', icon: Grid, path: '/matrix', color: 'text-violet-500' },
    { title: 'PTS', icon: FileText, path: '/pts', color: 'text-violet-500' },
    { title: 'Controles + Mat.', icon: Layers, path: '/controls-materials', color: 'text-violet-500' },
  ];

  // ── 4. SALUD OCUPACIONAL ─────────────────────────────────────────────
  const salud: NavItem[] = [
    { title: t('nav.health', 'Salud y Bienestar'), icon: HeartPulse, path: '/hub/health', color: 'text-rose-500' },
    { title: t('nav.human_body_viewer', 'Visor Corporal DIAT'), icon: Activity, path: '/human-body', color: 'text-rose-500' },
    { title: t('nav.medicine', 'Medicina'), icon: HeartPulse, path: '/medicine', color: 'text-rose-400' },
    { title: t('nav.hygiene', 'Higiene Industrial'), icon: Droplets, path: '/hygiene', color: 'text-blue-400' },
    { title: t('nav.ergonomics', 'Ergonomía'), icon: UserCheck, path: '/ergonomics', color: 'text-amber-400' },
    { title: t('nav.tmert', 'TMERT-EESS'), icon: Hand, path: '/tmert', color: 'text-amber-400' },
    { title: t('nav.prexor', 'PREXOR Ruido'), icon: Ear, path: '/prexor', color: 'text-sky-400' },
    { title: t('nav.planesi', 'PLANESI Sílice'), icon: Wind, path: '/planesi', color: 'text-orange-400' },
    { title: t('nav.fatigue', 'Monitor de Fatiga'), icon: Moon, path: '/fatigue', color: 'text-violet-500' },
    { title: t('nav.carga_mental', 'Carga Mental'), icon: Brain, path: '/carga-mental', color: 'text-emerald-500' },
    { title: t('nav.culture_pulse', 'Cultura Preventiva'), icon: HeartPulse, path: '/culture-pulse', color: 'text-rose-500' },
    { title: t('nav.waste_inventory', 'Residuos Ambientales'), icon: Recycle, path: '/waste-inventory', color: 'text-emerald-500' },
    { title: 'Psicosocial', icon: Brain, path: '/psychosocial', color: 'text-rose-500' },
    { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-rose-500' },
  ];

  // ── 5. CUMPLIMIENTO — regulatorio + auditoría ────────────────────────
  const cumplimiento: NavItem[] = [
    { title: t('nav.compliance', 'Cumplimiento Legal'), icon: ClipboardCheck, path: '/hub/compliance', color: TEAL },
    { title: t('nav.cphs', 'Comité Paritario (CPHS)'), icon: ShieldCheck, path: '/cphs', color: TEAL },
    { title: t('nav.cphs_draft', 'Minuta CPHS'), icon: FileText, path: '/cphs/draft-minute', color: 'text-teal-500' },
    { title: t('nav.legal_calendar', 'Calendario Legal'), icon: Calendar, path: '/legal-calendar', color: 'text-teal-500' },
    { title: t('nav.pdca', 'PDCA + No Conformidades'), icon: Activity, path: '/pdca', color: 'text-teal-500' },
    { title: t('nav.annual_review', 'Revisión Anual SGI'), icon: ClipboardCheck, path: '/annual-review', color: 'text-violet-500' },
    { title: t('nav.maturity_index', 'Índice de Madurez'), icon: Award, path: '/maturity-index', color: 'text-violet-500' },
    { title: t('nav.audit_portals', 'Portales Auditor'), icon: ShieldCheck, path: '/audit-portals', color: 'text-emerald-500' },
    { title: t('nav.consistency_audit', 'Auditor Consistencia'), icon: ShieldAlert, path: '/consistency-audit', color: 'text-rose-500' },
    { title: t('nav.document_read', 'Lectura de Documentos'), icon: FileText, path: '/document-read', color: 'text-sky-500' },
    { title: t('nav.qr_signature', 'Firma QR'), icon: ScanLine, path: '/qr-signature', color: 'text-violet-500' },
    { title: t('nav.custody_chain', 'Cadena de Custodia'), icon: Shield, path: '/custody-chain', color: 'text-violet-500' },
    { title: t('nav.confidential_reports', 'Reportes Confidenciales'), icon: ShieldAlert, path: '/confidential-reports', color: 'text-rose-500' },
    { title: t('nav.exceptions', 'Excepciones'), icon: AlertOctagon, path: '/exceptions', color: 'text-amber-500' },
    { title: t('nav.analytics', 'Reportabilidad'), icon: BarChart3, path: '/analytics', color: 'text-zinc-400' },
    { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-amber-500' },
    { title: 'Protocolos MINSAL', icon: ShieldCheck, path: '/minsal-protocols', color: 'text-amber-500' },
    { title: 'Reglamentos', icon: FileCheck, path: '/reglamentos', color: 'text-amber-500' },
    { title: 'Auditorías', icon: ClipboardList, path: '/audits', color: 'text-amber-500' },
    { title: 'Trazabilidad', icon: Database, path: '/audit-trail', color: 'text-amber-500' },
    { title: 'Reportes SUSESO', icon: FileText, path: '/suseso', color: 'text-amber-500' },
    { title: 'Comité Paritario', icon: Users, path: '/comite-paritario', color: 'text-amber-500' },
  ];

  // ── 6. EMERGENCIAS — respuesta a incidentes + vida-safety ────────────
  const emergencias: NavItem[] = [
    { title: t('nav.emergencies', 'Entorno y Emergencias'), icon: AlertTriangle, path: '/hub/emergencies', color: 'text-amber-500' },
    { title: t('nav.drills', 'Gestor de Simulacros'), icon: ShieldAlert, path: '/drills', color: 'text-amber-500' },
    { title: t('nav.emergency_brigade', 'Brigada Emergencia'), icon: ShieldAlert, path: '/emergency-brigade', color: 'text-amber-500' },
    { title: t('nav.first_responder_map', 'Primer Respondedor'), icon: HeartPulse, path: '/first-responder-map', color: 'text-rose-500' },
    { title: t('nav.evacuation_dashboard', 'Tablero Evacuación'), icon: AlertTriangle, path: '/evacuation-dashboard', color: 'text-rose-500' },
    { title: t('nav.stoppages', 'Paralizaciones'), icon: OctagonAlert, path: '/stoppages', color: 'text-rose-500' },
    { title: t('nav.sif_precursors', 'Precursores SIF'), icon: AlertOctagon, path: '/sif', color: 'text-rose-500' },
    { title: t('nav.lone_worker', 'Trabajo Solitario'), icon: UserCheck, path: '/lone-worker', color: 'text-teal-500' },
    { title: t('nav.lone_worker_checkin', 'Mi Check-in Solitario'), icon: ClipboardCheck, path: '/lone-worker/check-in', color: 'text-teal-500' },
    { title: t('nav.restricted_zones', 'Zonas Restringidas'), icon: OctagonAlert, path: '/restricted-zones', color: 'text-rose-500' },
    { title: t('nav.zone_entry', 'Ingreso a Zonas'), icon: OctagonAlert, path: '/zone-entry', color: 'text-rose-500' },
    { title: t('nav.safe_driving_mode', 'Modo Conducción Segura'), icon: Car, path: '/safe-driving', color: 'text-blue-500' },
    { title: 'Emergencia', icon: Siren, path: '/emergency', color: 'text-rose-600' },
    { title: 'Emergencia Avzd.', icon: AlertOctagon, path: '/emergencia-avanzada', color: 'text-rose-600' },
    { title: 'Evacuación', icon: Map, path: '/evacuation', color: 'text-rose-600' },
    { title: 'Rutas de Evac.', icon: Compass, path: '/evacuation-routes', color: 'text-rose-600' },
    { title: 'Simulador', icon: Zap, path: '/emergency-generator', color: 'text-rose-600' },
    { title: 'Hazmat Map', icon: AlertTriangle, path: '/hazmat-map', color: 'text-rose-600' },
    { title: 'Hazmat Storage', icon: Layers, path: '/hazmat-storage', color: 'text-rose-600' },
    { title: 'Erupción Volcán.', icon: AlertOctagon, path: '/volcanic-eruption', color: 'text-rose-600' },
    { title: 'Emerg. Costera', icon: AlertTriangle, path: '/coastal-emergency', color: 'text-rose-600' },
    { title: 'Parques Nac.', icon: Map, path: '/national-parks', color: 'text-rose-600' },
    { title: 'Refugios', icon: Home, path: '/mountain-refuges', color: 'text-rose-600' },
    { title: 'Zonas DEA', icon: HeartPulse, path: '/dea-zones', color: 'text-rose-600' },
  ];

  // ── 7. CONOCIMIENTO — capacitación + biblioteca ──────────────────────
  const conocimiento: NavItem[] = [
    { title: t('nav.culture', 'Talento y Cultura'), icon: Users, path: '/hub/training', color: 'text-indigo-500' },
    { title: t('nav.lessons_learned', 'Lecciones Aprendidas'), icon: BookOpen, path: '/lessons', color: 'text-amber-500' },
    { title: t('nav.knowledge_base', 'Base de Conocimiento'), icon: Database, path: '/knowledge-base', color: 'text-violet-500' },
    { title: t('nav.zettelkasten', 'Zettelkasten'), icon: Database, path: '/zettelkasten', color: 'text-blue-500' },
    { title: t('nav.academic_processor', 'Procesador Académico'), icon: BookOpen, path: '/academic-processor', color: 'text-violet-500' },
    { title: t('nav.data_confidence', 'Confianza de Datos'), icon: Database, path: '/data-confidence', color: 'text-violet-500' },
    { title: t('nav.apprenticeship', 'Aprendices y Mentores'), icon: UserCheck, path: '/apprenticeship', color: 'text-teal-500' },
    { title: t('nav.portable_history', 'Historial Portátil'), icon: User, path: '/portable-history', color: 'text-blue-500' },
    { title: 'Capacitaciones', icon: BookOpen, path: '/training', color: 'text-cyan-500' },
    { title: 'Gamificación', icon: Gamepad2, path: '/gamification', color: 'text-cyan-500' },
    { title: 'Glosario', icon: Book, path: '/glossary', color: 'text-cyan-500' },
    { title: 'Red Neuronal', icon: Network, path: '/risk-network', color: 'text-cyan-500' },
    { title: 'Curriculum', icon: ClipboardList, path: '/curriculum', color: 'text-cyan-500' },
  ];

  // ── 8. IA Y COACH — Gemini + on-device ───────────────────────────────
  const iaCoach: NavItem[] = [
    { title: t('nav.ai_hub', 'AI Hub'), icon: Zap, path: '/ai-hub', color: 'text-violet-500' },
    { title: 'Coach de Seguridad', icon: Brain, path: '/safety-coach', color: TEAL },
    { title: t('nav.ocr_motor', 'Motor OCR'), icon: Scan, path: '/document-ocr', color: 'text-violet-400' },
    { title: 'Calculadoras Especializadas', icon: Wrench, path: '/calculators', color: TEAL },
    { title: t('nav.ds67_simulator', 'Simulador DS 67'), icon: BarChart3, path: '/ds67-simulator', color: 'text-teal-500' },
    { title: t('nav.cost_scenarios', 'Escenarios de Costo'), icon: Calculator, path: '/cost-scenarios', color: 'text-teal-500' },
    { title: t('nav.safety_metrics', 'Métricas SST (TRIR/LTIFR)'), icon: BarChart3, path: '/safety-metrics', color: 'text-teal-500' },
    { title: t('nav.incident_flow', 'Flujo de Incidentes'), icon: ListChecks, path: '/incident-flow', color: 'text-teal-500' },
    { title: t('nav.incident_trends', 'Tendencia Incidentes'), icon: BarChart3, path: '/incident-trends', color: 'text-amber-500' },
    { title: 'Rastreador Solar', icon: Sun, path: '/sun-tracker', color: 'text-amber-500' },
    { title: 'Guardia Predict.', icon: Lightbulb, path: '/predictive-guard', color: 'text-violet-500' },
    { title: 'Diagnóstico', icon: Brain, path: '/diagnostico', color: 'text-violet-500' },
    { title: 'Knowledge Ing.', icon: Database, path: '/knowledge-ingestion', color: 'text-violet-500' },
  ];

  // ── 9. INNOVACIÓN — gemelo digital, AR, mesh ─────────────────────────
  const innovacion: NavItem[] = [
    { title: t('nav.digital_twin', 'Gemelo Digital 3D'), icon: Layers, path: '/digital-twin', color: 'text-cyan-400' },
    { title: t('nav.projects_compare', 'Comparar Proyectos'), icon: BarChart3, path: '/projects-compare', color: 'text-blue-500' },
    { title: t('nav.project_closure', 'Cierre de Proyecto'), icon: Briefcase, path: '/closure', color: 'text-violet-500' },
    { title: t('nav.leadership_decisions', 'Decisiones Supervisión'), icon: User, path: '/leadership-decisions', color: 'text-blue-500' },
    { title: 'Digital Twin AR', icon: Eye, path: '/digital-twin/ar', color: 'text-fuchsia-500' },
    { title: 'Blueprint Viewer', icon: Layers, path: '/blueprint-viewer', color: 'text-fuchsia-500' },
    { title: 'AutoCAD', icon: Grid, path: '/autocad', color: 'text-fuchsia-500' },
    { title: 'Climate Routes', icon: Compass, path: '/climate-routes', color: 'text-fuchsia-500' },
    { title: 'Inhospitable G.', icon: Map, path: '/inhospitable-guide', color: 'text-fuchsia-500' },
    { title: 'Light Pollution', icon: Eye, path: '/light-pollution', color: 'text-fuchsia-500' },
  ];

  // ── 10. ADMINISTRACIÓN — cuenta, facturación, ajustes ────────────────
  const administracion: NavItem[] = [
    { title: t('nav.profile', 'Mi Perfil'), icon: User, path: '/profile', color: 'text-zinc-400' },
    { title: t('nav.my_data', 'Mis datos'), icon: ShieldCheck, path: '/my-data', color: TEAL },
    { title: t('nav.settings', 'Ajustes'), icon: SettingsIcon, path: '/settings', color: 'text-zinc-400' },
    { title: t('nav.pricing', 'Planes y Facturación'), icon: Key, path: '/pricing', color: 'text-zinc-400' },
    { title: t('nav.help', 'Ayuda y Soporte'), icon: HelpCircle, path: '/help', color: 'text-zinc-400' },
    { title: 'Security Shield', icon: ShieldCheck, path: '/security-shield', color: 'text-zinc-400' },
    { title: 'ERP Integration', icon: GitBranch, path: '/erp-integration', color: 'text-zinc-400' },
  ];

  // Feature/role-gated items (preserva el gating actual del sidebar).
  if (features.canUseExecutiveDashboard) {
    iaCoach.push({
      title: t('nav.executive_dashboard', 'Dashboard Ejecutivo'),
      icon: BarChart3, path: '/executive-dashboard', color: 'text-violet-500',
    });
  }
  if (isAdmin) {
    administracion.push({
      title: t('nav.b2d_admin', 'Panel B2D'), icon: Key, path: '/admin/b2d', color: 'text-[#d4af37]',
    });
  }

  return [
    { id: 'main', title: t('nav.block_principal', 'Principal'), icon: Home, items: principal },
    { id: 'operations', title: t('nav.block_operativa', 'Gestión Operativa'), icon: Briefcase, items: operativa },
    { id: 'risks', title: t('nav.block_riesgos', 'Prevención y Riesgos'), icon: ShieldAlert, items: riesgos },
    { id: 'health', title: t('nav.block_salud', 'Salud Ocupacional'), icon: Stethoscope, items: salud },
    { id: 'compliance', title: t('nav.block_cumplimiento', 'Cumplimiento'), icon: ClipboardCheck, items: cumplimiento },
    { id: 'emergencies', title: t('nav.block_emergencias', 'Emergencias'), icon: Siren, items: emergencias },
    { id: 'knowledge', title: t('nav.block_conocimiento', 'Conocimiento'), icon: BookOpen, items: conocimiento },
    { id: 'ai-coach', title: t('nav.block_ia_coach', 'IA y Coach'), icon: Brain, items: iaCoach },
    { id: 'innovation', title: t('nav.block_innovacion', 'Innovación'), icon: Box, items: innovacion },
    { id: 'administration', title: t('nav.block_administracion', 'Administración'), icon: SettingsIcon, items: administracion },
  ];
}
