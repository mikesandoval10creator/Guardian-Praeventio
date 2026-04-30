import {
  User, AlertTriangle, Shield, Cpu, FileText, Wrench, ClipboardCheck,
  DollarSign, Activity, CheckSquare, BookOpen, Stethoscope, Brain,
  HeartPulse, Search, Microscope, Folder, Zap, Box, Star, GraduationCap,
  Users, MapPin, Settings, Globe, Leaf, Lightbulb, MessageCircle,
  Truck, Package, TrendingUp, Bot, Layers, BarChart2
} from 'lucide-react';
import { NodeType } from '../types';

/** Canonical hex color for each NodeType — used in graphs, badges, and map pins. */
export const NODE_COLOR: Record<NodeType, string> = {
  // Block I — Identification
  [NodeType.WORKER]:            '#10b981', // emerald-500
  [NodeType.RISK]:              '#f43f5e', // rose-500
  [NodeType.NORMATIVE]:         '#8b5cf6', // violet-500
  [NodeType.EPP]:               '#3b82f6', // blue-500
  [NodeType.MACHINE]:           '#f59e0b', // amber-500
  [NodeType.HYGIENE]:           '#06b6d4', // cyan-500
  // Block II — Controls & Monitoring
  [NodeType.CONTROL]:           '#0ea5e9', // sky-500
  [NodeType.INSPECTION]:        '#f97316', // orange-500
  [NodeType.FINDING]:           '#f59e0b', // amber-500
  [NodeType.INCIDENT]:          '#ef4444', // red-500
  [NodeType.MEDICINE]:          '#ec4899', // pink-500
  [NodeType.ERGONOMICS]:        '#14b8a6', // teal-500
  [NodeType.PSYCHOSOCIAL]:      '#a855f7', // purple-500
  // Block III — Emergency & Assets
  [NodeType.EMERGENCY]:         '#dc2626', // red-600
  [NodeType.ASSET]:             '#78716c', // stone-500
  [NodeType.SAFE_ZONE]:         '#22c55e', // green-500
  // Block IV — Compliance & Knowledge
  [NodeType.AUDIT]:             '#06b6d4', // cyan-500
  [NodeType.PROJECT]:           '#10b981', // emerald-500
  [NodeType.TRAINING]:          '#6366f1', // indigo-500
  [NodeType.ATTENDANCE]:        '#84cc16', // lime-500
  [NodeType.REPORT]:            '#64748b', // slate-500
  [NodeType.COST]:              '#f59e0b', // amber-500
  [NodeType.TASK]:              '#3b82f6', // blue-500
  [NodeType.DOCUMENT]:          '#64748b', // slate-500
  // Block V — Collective Intelligence
  [NodeType.LESSON_LEARNED]:    '#059669', // emerald-600
  [NodeType.BEST_PRACTICE]:     '#16a34a', // green-600
  [NodeType.PEER_FEEDBACK]:     '#0284c7', // sky-600
  [NodeType.COMMUNITY_REPORT]:  '#7c3aed', // violet-600
  // Block VI — Enterprise Ecosystem
  [NodeType.CONTRACTOR]:        '#b45309', // amber-700
  [NodeType.SUPPLIER]:          '#d97706', // amber-600
  [NodeType.PROCUREMENT_RISK]:  '#dc2626', // red-600
  // Block VII — Regional / Environmental
  [NodeType.ENVIRONMENTAL_IMPACT]: '#15803d', // green-700
  [NodeType.REGIONAL_NORMATIVE]:   '#6d28d9', // violet-700
  // Block VIII — Advanced AI
  [NodeType.AI_PREDICTION]:     '#0891b2', // cyan-600
  [NodeType.DIGITAL_TWIN]:      '#2563eb', // blue-600
  [NodeType.BEHAVIORAL_PATTERN]:'#7c3aed', // violet-600
};

/** Canonical Lucide icon component for each NodeType. */
export const NODE_ICON: Record<NodeType, React.ComponentType<any>> = {
  [NodeType.WORKER]:             User,
  [NodeType.RISK]:               AlertTriangle,
  [NodeType.NORMATIVE]:          FileText,
  [NodeType.EPP]:                Shield,
  [NodeType.MACHINE]:            Cpu,
  [NodeType.HYGIENE]:            Microscope,
  [NodeType.CONTROL]:            Settings,
  [NodeType.INSPECTION]:         ClipboardCheck,
  [NodeType.FINDING]:            Search,
  [NodeType.INCIDENT]:           AlertTriangle,
  [NodeType.MEDICINE]:           Stethoscope,
  [NodeType.ERGONOMICS]:         HeartPulse,
  [NodeType.PSYCHOSOCIAL]:       Brain,
  [NodeType.EMERGENCY]:          Zap,
  [NodeType.ASSET]:              Box,
  [NodeType.SAFE_ZONE]:          MapPin,
  [NodeType.AUDIT]:              CheckSquare,
  [NodeType.PROJECT]:            Folder,
  [NodeType.TRAINING]:           GraduationCap,
  [NodeType.ATTENDANCE]:         Users,
  [NodeType.REPORT]:             FileText,
  [NodeType.COST]:               DollarSign,
  [NodeType.TASK]:               Activity,
  [NodeType.DOCUMENT]:           BookOpen,
  // Block V
  [NodeType.LESSON_LEARNED]:     Lightbulb,
  [NodeType.BEST_PRACTICE]:      Star,
  [NodeType.PEER_FEEDBACK]:      MessageCircle,
  [NodeType.COMMUNITY_REPORT]:   Globe,
  // Block VI
  [NodeType.CONTRACTOR]:         Wrench,
  [NodeType.SUPPLIER]:           Truck,
  [NodeType.PROCUREMENT_RISK]:   Package,
  // Block VII
  [NodeType.ENVIRONMENTAL_IMPACT]: Leaf,
  [NodeType.REGIONAL_NORMATIVE]:   Globe,
  // Block VIII
  [NodeType.AI_PREDICTION]:      BarChart2,
  [NodeType.DIGITAL_TWIN]:       Layers,
  [NodeType.BEHAVIORAL_PATTERN]: TrendingUp,
};

/** Tailwind badge class (bg + text + border) for a given NodeType. */
export function getNodeBadgeClass(type: NodeType): string {
  const colorMap: Partial<Record<NodeType, string>> = {
    [NodeType.WORKER]:            'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-700',
    [NodeType.RISK]:              'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-900/20 dark:border-rose-700',
    [NodeType.NORMATIVE]:         'text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-900/20 dark:border-violet-700',
    [NodeType.EPP]:               'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-700',
    [NodeType.MACHINE]:           'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-700',
    [NodeType.EMERGENCY]:         'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-700',
    [NodeType.TRAINING]:          'text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-900/20 dark:border-indigo-700',
    [NodeType.AUDIT]:             'text-cyan-600 bg-cyan-50 border-cyan-200 dark:text-cyan-400 dark:bg-cyan-900/20 dark:border-cyan-700',
    [NodeType.INCIDENT]:          'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-700',
    [NodeType.CONTROL]:           'text-sky-600 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-900/20 dark:border-sky-700',
    [NodeType.LESSON_LEARNED]:    'text-emerald-700 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-600',
    [NodeType.BEST_PRACTICE]:     'text-green-700 bg-green-50 border-green-300 dark:text-green-300 dark:bg-green-900/20 dark:border-green-600',
    [NodeType.CONTRACTOR]:        'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-600',
    [NodeType.ENVIRONMENTAL_IMPACT]: 'text-green-800 bg-green-50 border-green-300 dark:text-green-300 dark:bg-green-900/20 dark:border-green-600',
    [NodeType.AI_PREDICTION]:     'text-cyan-700 bg-cyan-50 border-cyan-300 dark:text-cyan-300 dark:bg-cyan-900/20 dark:border-cyan-600',
    [NodeType.DIGITAL_TWIN]:      'text-blue-700 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-900/20 dark:border-blue-600',
  };
  return colorMap[type] ?? 'text-zinc-600 bg-zinc-50 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700';
}

export function getNodeColor(type: NodeType): string {
  return NODE_COLOR[type] ?? '#71717a';
}

export function getNodeIcon(type: NodeType): React.ComponentType<any> {
  return NODE_ICON[type] ?? FileText;
}

/** Tailwind bg-class string for a given NodeType — used as className in map pins, dots, etc. */
export function getNodeBgClass(type: NodeType): string {
  const bgMap: Partial<Record<NodeType, string>> = {
    [NodeType.WORKER]:               'bg-emerald-500',
    [NodeType.RISK]:                 'bg-rose-500',
    [NodeType.NORMATIVE]:            'bg-violet-500',
    [NodeType.EPP]:                  'bg-blue-500',
    [NodeType.MACHINE]:              'bg-amber-500',
    [NodeType.HYGIENE]:              'bg-cyan-500',
    [NodeType.CONTROL]:              'bg-sky-500',
    [NodeType.INSPECTION]:           'bg-orange-500',
    [NodeType.FINDING]:              'bg-amber-500',
    [NodeType.INCIDENT]:             'bg-red-500',
    [NodeType.MEDICINE]:             'bg-pink-500',
    [NodeType.ERGONOMICS]:           'bg-teal-500',
    [NodeType.PSYCHOSOCIAL]:         'bg-purple-500',
    [NodeType.EMERGENCY]:            'bg-red-600',
    [NodeType.ASSET]:                'bg-stone-500',
    [NodeType.SAFE_ZONE]:            'bg-green-500',
    [NodeType.AUDIT]:                'bg-cyan-500',
    [NodeType.PROJECT]:              'bg-emerald-500',
    [NodeType.TRAINING]:             'bg-indigo-500',
    [NodeType.ATTENDANCE]:           'bg-lime-500',
    [NodeType.REPORT]:               'bg-slate-500',
    [NodeType.COST]:                 'bg-amber-500',
    [NodeType.TASK]:                 'bg-blue-500',
    [NodeType.DOCUMENT]:             'bg-slate-500',
    [NodeType.LESSON_LEARNED]:       'bg-emerald-600',
    [NodeType.BEST_PRACTICE]:        'bg-green-600',
    [NodeType.PEER_FEEDBACK]:        'bg-sky-600',
    [NodeType.COMMUNITY_REPORT]:     'bg-violet-600',
    [NodeType.CONTRACTOR]:           'bg-amber-700',
    [NodeType.SUPPLIER]:             'bg-amber-600',
    [NodeType.PROCUREMENT_RISK]:     'bg-red-600',
    [NodeType.ENVIRONMENTAL_IMPACT]: 'bg-green-700',
    [NodeType.REGIONAL_NORMATIVE]:   'bg-violet-700',
    [NodeType.AI_PREDICTION]:        'bg-cyan-600',
    [NodeType.DIGITAL_TWIN]:         'bg-blue-600',
    [NodeType.BEHAVIORAL_PATTERN]:   'bg-violet-600',
  };
  return bgMap[type] ?? 'bg-zinc-500';
}
