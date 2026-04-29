// Praeventio Guard — Module navigation taxonomy used by Dashboard's marquee.
// Extracted from src/pages/Dashboard.tsx in A11 R18 refactor.

import {
  Activity, AlertOctagon, AlertTriangle, Award, BarChart3, Book, BookOpen, Briefcase,
  Calendar, Car, ClipboardCheck, ClipboardList, Clock, Droplets, Eye, FileText, Folder,
  Grid, HeartPulse, Home, Map, Network, ShieldAlert, Shield, ShieldCheck, UserCheck,
  Users, Wrench, Brain, Zap,
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
  {
    id: 'main',
    title: 'Principal',
    icon: Home,
    color: 'bg-[#10B981]',
    items: [
      { title: 'Red Neuronal', icon: Network, path: '/risk-network', color: 'text-emerald-500' },
      { title: 'Proyectos', icon: Briefcase, path: '/projects', color: 'text-blue-500' },
      { title: 'AI Hub', icon: Zap, path: '/ai-hub', color: 'text-violet-500' },
      { title: 'Muro', icon: Users, path: '/safety-feed', color: 'text-emerald-500' },
    ],
  },
  {
    id: 'operations',
    title: 'Gestión Operativa',
    icon: Briefcase,
    color: 'bg-[#3B82F6]',
    items: [
      { title: 'Trabajadores', icon: Users, path: '/workers', color: 'text-violet-500' },
      { title: 'Documentos', icon: Folder, path: '/documents', color: 'text-violet-500' },
      { title: 'Asistencia', icon: UserCheck, path: '/attendance', color: 'text-zinc-400' },
      { title: 'Calendario', icon: Calendar, path: '/calendar', color: 'text-zinc-400' },
      { title: 'Telemetría', icon: Activity, path: '/telemetry', color: 'text-zinc-400' },
      { title: 'Activos', icon: Wrench, path: '/assets', color: 'text-zinc-400' },
      { title: 'Conducción', icon: Car, path: '/safe-driving', color: 'text-zinc-400' },
      { title: 'Mapa de Sitio', icon: Map, path: '/site-map', color: 'text-zinc-400' },
    ],
  },
  {
    id: 'risks',
    title: 'Prevención y Riesgos',
    icon: ShieldAlert,
    color: 'bg-[#A855F7]',
    items: [
      { title: 'Riesgos', icon: AlertOctagon, path: '/risks', color: 'text-violet-500' },
      { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-amber-500' },
      { title: 'EPP', icon: Shield, path: '/epp', color: 'text-violet-500' },
      { title: 'Matriz', icon: Grid, path: '/matrix', color: 'text-zinc-400' },
      { title: 'PTS', icon: FileText, path: '/pts', color: 'text-zinc-400' },
      { title: 'Guardia Predictivo', icon: Zap, path: '/predictive-guard', color: 'text-zinc-400' },
      { title: 'WebXR', icon: Eye, path: '/webxr', color: 'text-zinc-400' },
    ],
  },
  {
    id: 'health',
    title: 'Salud Ocupacional',
    icon: HeartPulse,
    color: 'bg-[#EF4444]',
    items: [
      { title: 'Higiene', icon: Droplets, path: '/hygiene', color: 'text-zinc-400' },
      { title: 'Medicina', icon: HeartPulse, path: '/medicine', color: 'text-zinc-400' },
      { title: 'Ergonomía', icon: UserCheck, path: '/ergonomics', color: 'text-zinc-400' },
      { title: 'Psicosocial', icon: Brain, path: '/psychosocial', color: 'text-zinc-400' },
      { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-zinc-400' },
    ],
  },
  {
    id: 'compliance',
    title: 'Cumplimiento',
    icon: ClipboardCheck,
    color: 'bg-[#F59E0B]',
    items: [
      { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-zinc-400' },
      { title: 'Protocolos MINSAL', icon: ShieldCheck, path: '/minsal-protocols', color: 'text-zinc-400' },
      { title: 'Auditorías', icon: ClipboardList, path: '/audits', color: 'text-zinc-400' },
      { title: 'Reportes SUSESO', icon: FileText, path: '/suseso', color: 'text-zinc-400' },
      { title: 'Glosario', icon: BookOpen, path: '/glossary', color: 'text-zinc-400' },
    ],
  },
  {
    id: 'emergencies',
    title: 'Emergencias',
    icon: AlertTriangle,
    color: 'bg-[#EF4444]',
    items: [
      { title: 'Emergencia', icon: AlertTriangle, path: '/emergency', color: 'text-rose-500' },
      { title: 'Evacuación', icon: Map, path: '/evacuation', color: 'text-zinc-400' },
      { title: 'Simulador', icon: Zap, path: '/emergency-generator', color: 'text-zinc-400' },
    ],
  },
  {
    id: 'training',
    title: 'Capacitación',
    icon: BookOpen,
    color: 'bg-[#3B82F6]',
    items: [
      { title: 'Capacitaciones', icon: BookOpen, path: '/training', color: 'text-zinc-400' },
      { title: 'Gamificación', icon: Award, path: '/gamification', color: 'text-zinc-400' },
      { title: 'Entrenamiento IA', icon: Zap, path: '/knowledge-ingestion', color: 'text-zinc-400' },
    ],
  },
  {
    id: 'reports',
    title: 'Reportes',
    icon: BarChart3,
    color: 'bg-[#10B981]',
    items: [
      { title: 'Reportabilidad', icon: BarChart3, path: '/analytics', color: 'text-zinc-400' },
      { title: 'Historia', icon: Clock, path: '/history', color: 'text-zinc-400' },
    ],
  },
];
