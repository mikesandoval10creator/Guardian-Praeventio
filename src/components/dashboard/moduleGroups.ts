// Praeventio Guard — Module navigation taxonomy used by Dashboard's marquee.
//
// Sprint B PR #521 (this): refactor from 8 → 10 buckets per user directive
// 2026-05-27: "pongamos menus y submenus donde corresponda de acuerdo a la
// categoría o clasificación de lo que estamos produciendo".
//
// New categories AI/Coach, Knowledge, Innovation, Administration split out
// of the legacy "main" bucket. Each new bucket aggregates pages from the
// real route table (`src/routes/*Routes.tsx`) — every `path:` below is a
// verified route. Pages that don't exist yet are NOT listed; they'll be
// added as their PRs land.
//
// Sidebar parity is intentionally NOT addressed here — keeping the change
// scoped to the carousel data. Sidebar refactor is a follow-up PR.

import {
  Activity, AlertOctagon, AlertTriangle, Award, BarChart3, Book, BookOpen, Briefcase,
  Calendar, Car, ClipboardCheck, ClipboardList, Clock, Cog, Compass, CreditCard, Box,
  Database, Droplets, Eye, FileCheck, FileText, Folder, GitBranch, Grid, HeartPulse, Home,
  Layers, Lightbulb, Map, MessageSquare, Network, Radio, Settings as SettingsIcon, ShieldAlert,
  Shield, ShieldCheck, Siren, SunMedium, UserCheck, Users, Wrench, Brain, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ModuleGroupItem {
  title: string;
  icon: LucideIcon;
  path: string;
  color: string;
}

export interface ModuleGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  color: string;
  items: ModuleGroupItem[];
}

export const moduleGroups: ModuleGroup[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 1. PRINCIPAL — hub navigation + top-level entry points
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'main',
    title: 'Principal',
    icon: Home,
    color: 'bg-emerald-500',
    items: [
      { title: 'Mapa de Sitio', icon: Map, path: '/site-map', color: 'text-emerald-500' },
      { title: 'Muro', icon: Users, path: '/safety-feed', color: 'text-emerald-500' },
      { title: 'Pizarra', icon: Layers, path: '/pizarra', color: 'text-emerald-500' },
      { title: 'Mural', icon: MessageSquare, path: '/mural', color: 'text-emerald-500' },
      { title: 'Calendario', icon: Calendar, path: '/calendar', color: 'text-emerald-500' },
      { title: 'Focus Agenda', icon: ClipboardList, path: '/focus-agenda', color: 'text-emerald-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 2. FIELD OPS — day-to-day operational surfaces
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'operations',
    title: 'Gestión Operativa',
    icon: Briefcase,
    color: 'bg-blue-500',
    items: [
      { title: 'Trabajadores', icon: Users, path: '/workers', color: 'text-blue-500' },
      { title: 'Documentos', icon: Folder, path: '/documents', color: 'text-blue-500' },
      { title: 'Asistencia', icon: UserCheck, path: '/attendance', color: 'text-blue-500' },
      { title: 'Telemetría', icon: Activity, path: '/telemetry', color: 'text-blue-500' },
      { title: 'Activos', icon: Wrench, path: '/assets', color: 'text-blue-500' },
      { title: 'Conducción', icon: Car, path: '/safe-driving', color: 'text-blue-500' },
      { title: 'Lone Worker', icon: Radio, path: '/lone-worker', color: 'text-blue-500' },
      { title: 'Cambio de Turno', icon: GitBranch, path: '/shift-handover', color: 'text-blue-500' },
      { title: 'Detenciones', icon: AlertTriangle, path: '/stoppages', color: 'text-blue-500' },
      { title: 'Libro de Obra', icon: Book, path: '/site-book', color: 'text-blue-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 3. SAFETY ENGINEERING — risk identification + mitigation
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'risks',
    title: 'Prevención y Riesgos',
    icon: ShieldAlert,
    color: 'bg-[#A855F7]',
    items: [
      { title: 'Riesgos', icon: AlertOctagon, path: '/risks', color: 'text-violet-500' },
      { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-violet-500' },
      { title: 'EPP', icon: Shield, path: '/epp', color: 'text-violet-500' },
      { title: 'Matriz IPER', icon: Grid, path: '/matrix', color: 'text-violet-500' },
      { title: 'PTS', icon: FileText, path: '/pts', color: 'text-violet-500' },
      { title: 'Controles Críticos', icon: ShieldCheck, path: '/critical-controls', color: 'text-violet-500' },
      { title: 'Controles + Mat.', icon: Layers, path: '/controls-materials', color: 'text-violet-500' },
      { title: 'Causa Raíz', icon: GitBranch, path: '/root-cause', color: 'text-violet-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. HEALTH VAULT — occupational health surfaces
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'health',
    title: 'Salud Ocupacional',
    icon: HeartPulse,
    color: 'bg-[#EF4444]',
    items: [
      { title: 'Higiene', icon: Droplets, path: '/hygiene', color: 'text-rose-500' },
      { title: 'Medicina', icon: HeartPulse, path: '/medicine', color: 'text-rose-500' },
      { title: 'Ergonomía', icon: UserCheck, path: '/ergonomics', color: 'text-rose-500' },
      { title: 'Psicosocial', icon: Brain, path: '/psychosocial', color: 'text-rose-500' },
      { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-rose-500' },
      { title: 'Fatiga', icon: Clock, path: '/fatigue', color: 'text-rose-500' },
      { title: 'Cuerpo Humano', icon: HeartPulse, path: '/human-body', color: 'text-rose-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 5. COMPLIANCE — regulatory + audit trails
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'compliance',
    title: 'Cumplimiento',
    icon: ClipboardCheck,
    color: 'bg-[#F59E0B]',
    items: [
      { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-amber-500' },
      { title: 'Protocolos MINSAL', icon: ShieldCheck, path: '/minsal-protocols', color: 'text-amber-500' },
      { title: 'Reglamentos', icon: FileCheck, path: '/reglamentos', color: 'text-amber-500' },
      { title: 'Auditorías', icon: ClipboardList, path: '/audits', color: 'text-amber-500' },
      { title: 'Portales Audit.', icon: Eye, path: '/audit-portals', color: 'text-amber-500' },
      { title: 'Trazabilidad', icon: Database, path: '/audit-trail', color: 'text-amber-500' },
      { title: 'Reportes SUSESO', icon: FileText, path: '/suseso', color: 'text-amber-500' },
      { title: 'Comité Paritario', icon: Users, path: '/comite-paritario', color: 'text-amber-500' },
      { title: 'CPHS', icon: ClipboardList, path: '/cphs', color: 'text-amber-500' },
      { title: 'Calendario Legal', icon: Calendar, path: '/legal-calendar', color: 'text-amber-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 6. EMERGENCY — incident response + alerting
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'emergencies',
    title: 'Emergencias',
    icon: Siren,
    color: 'bg-rose-600',
    items: [
      { title: 'Emergencia', icon: Siren, path: '/emergency', color: 'text-rose-600' },
      { title: 'Emergencia Avzd.', icon: AlertOctagon, path: '/emergencia-avanzada', color: 'text-rose-600' },
      { title: 'Evacuación', icon: Map, path: '/evacuation', color: 'text-rose-600' },
      { title: 'Rutas de Evac.', icon: Compass, path: '/evacuation-routes', color: 'text-rose-600' },
      { title: 'Dashboard Evac.', icon: BarChart3, path: '/evacuation-dashboard', color: 'text-rose-600' },
      { title: 'Simulador', icon: Zap, path: '/emergency-generator', color: 'text-rose-600' },
      { title: 'Hazmat Map', icon: AlertTriangle, path: '/hazmat-map', color: 'text-rose-600' },
      { title: 'Hazmat Storage', icon: Layers, path: '/hazmat-storage', color: 'text-rose-600' },
      { title: 'Erupción Volcán.', icon: AlertOctagon, path: '/volcanic-eruption', color: 'text-rose-600' },
      { title: 'Emerg. Costera', icon: AlertTriangle, path: '/coastal-emergency', color: 'text-rose-600' },
      { title: 'Parques Nac.', icon: Map, path: '/national-parks', color: 'text-rose-600' },
      { title: 'Refugios', icon: Home, path: '/mountain-refuges', color: 'text-rose-600' },
      { title: 'Zonas DEA', icon: HeartPulse, path: '/dea-zones', color: 'text-rose-600' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 7. KNOWLEDGE (NEW) — training, library, semantic knowledge
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'knowledge',
    title: 'Conocimiento',
    icon: BookOpen,
    color: 'bg-cyan-600',
    items: [
      { title: 'Capacitaciones', icon: BookOpen, path: '/training', color: 'text-cyan-500' },
      { title: 'Gamificación', icon: Award, path: '/gamification', color: 'text-cyan-500' },
      { title: 'Glosario', icon: Book, path: '/glossary', color: 'text-cyan-500' },
      { title: 'Red Neuronal', icon: Network, path: '/risk-network', color: 'text-cyan-500' },
      { title: 'Zettelkasten', icon: Database, path: '/zettelkasten', color: 'text-cyan-500' },
      { title: 'Charlas Seg.', icon: MessageSquare, path: '/safety-talks', color: 'text-cyan-500' },
      { title: 'Curriculum', icon: ClipboardList, path: '/curriculum', color: 'text-cyan-500' },
      { title: 'Procesador Acad.', icon: FileText, path: '/academic-processor', color: 'text-cyan-500' },
      { title: 'Afiches Seg.', icon: Award, path: '/afiches-seguridad', color: 'text-cyan-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 8. AI/COACH (NEW) — Gemini-powered + on-device assistants
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'ai-coach',
    title: 'IA y Coach',
    icon: Brain,
    color: 'bg-violet-600',
    items: [
      { title: 'AI Hub', icon: Zap, path: '/ai-hub', color: 'text-violet-500' },
      { title: 'Guardia Predict.', icon: Lightbulb, path: '/predictive-guard', color: 'text-violet-500' },
      { title: 'Diagnóstico', icon: Brain, path: '/diagnostico', color: 'text-violet-500' },
      { title: 'Knowledge Ing.', icon: Database, path: '/knowledge-ingestion', color: 'text-violet-500' },
      { title: 'Calculadoras', icon: Grid, path: '/calculators', color: 'text-violet-500' },
      { title: 'OCR Docs', icon: FileText, path: '/document-ocr', color: 'text-violet-500' },
      { title: 'Leer Docs', icon: FileText, path: '/document-read', color: 'text-violet-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 9. INNOVATION (NEW) — Digital Twin, AR, WebXR, mesh networking
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'innovation',
    title: 'Innovación',
    icon: Box,
    color: 'bg-fuchsia-600',
    items: [
      { title: 'Digital Twin', icon: Box, path: '/digital-twin', color: 'text-fuchsia-500' },
      { title: 'Digital Twin AR', icon: Eye, path: '/digital-twin/ar', color: 'text-fuchsia-500' },
      { title: 'Blueprint Viewer', icon: Layers, path: '/blueprint-viewer', color: 'text-fuchsia-500' },
      { title: 'AutoCAD', icon: Grid, path: '/autocad', color: 'text-fuchsia-500' },
      { title: 'Sun Tracker', icon: SunMedium, path: '/sun-tracker', color: 'text-fuchsia-500' },
      { title: 'Climate Routes', icon: Compass, path: '/climate-routes', color: 'text-fuchsia-500' },
      { title: 'Inhospitable G.', icon: Map, path: '/inhospitable-guide', color: 'text-fuchsia-500' },
      { title: 'Light Pollution', icon: Eye, path: '/light-pollution', color: 'text-fuchsia-500' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 10. ADMINISTRATION (NEW) — accounts, billing, projects, security
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'administration',
    title: 'Administración',
    icon: SettingsIcon,
    color: 'bg-zinc-600',
    items: [
      { title: 'Proyectos', icon: Briefcase, path: '/projects', color: 'text-zinc-400' },
      { title: 'Security Shield', icon: ShieldCheck, path: '/security-shield', color: 'text-zinc-400' },
      { title: 'ERP Integration', icon: GitBranch, path: '/erp-integration', color: 'text-zinc-400' },
      { title: 'Cambios Operac.', icon: Cog, path: '/operational-changes', color: 'text-zinc-400' },
      { title: 'Auditoría Consist.', icon: FileCheck, path: '/consistency-audit', color: 'text-zinc-400' },
      { title: 'Excepciones', icon: AlertTriangle, path: '/exceptions', color: 'text-zinc-400' },
    ],
  },
];
