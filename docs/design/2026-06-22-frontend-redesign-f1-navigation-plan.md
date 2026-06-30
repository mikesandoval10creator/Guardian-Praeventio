# Frontend Redesign — F1 Navegación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matar la queja "la app abruma". Unificar la navegación en UNA sola fuente de verdad de **10 bloques** (hoy el sidebar tiene un grupo plano "Centro de Mando" de ~83 ítems en `src/components/layout/sidebarMenuGroups.ts`, mientras el carrusel ya tiene 10 categorías limpias en `src/components/dashboard/moduleGroups.ts` que el sidebar ignora). Sidebar = acordeón con **un solo bloque abierto a la vez**; **buscador** arriba ("¿qué necesitas?") que salta a cualquier módulo; **selector de 4 modos al header** (hoy flota bottom-right y choca con el chat IA + SOS); **acciones críticas (Emergencia, Fast Check) en un Sheet lateral** sin cambiar de ruta.

**Architecture:** Evolución, no reescritura. Se crea un catálogo único `src/navigation/navCatalog.ts` (10 bloques, dato puro testeable) que CONSOLIDA los ~107 ítems del sidebar + las 10 categorías del carrusel mapeando cada ítem a su bloque, preservando TODAS las rutas ya cableadas (ningún módulo se pierde). El `Sidebar` y el carrusel pasan a derivar de ahí (cierra la divergencia sidebar↔carrusel). El buscador y el `ModeSwitcher`-en-header consumen el mismo catálogo + los primitivos de F0 (`cn`, `useTextFits`). El `Sheet` se construye sobre `framer-motion` (ya instalado) imitando el patrón del prototipo (`_prototype-praevium-guard/src/components/ui/sheet.tsx`) SIN añadir `@radix-ui/react-dialog` (el repo solo tiene `@radix-ui/react-tooltip`), reusando el patrón overlay del `Modal.tsx` existente. Riesgo bajo, impacto alto.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4, `framer-motion ^12.38.0`, `lucide-react ^0.546.0`, i18next, React Router 7, Vitest 4 (+ jsdom por-archivo), `@testing-library/react`. Consume F0: `src/utils/cn.ts`, `src/hooks/useTextFits.ts`, primitivos `src/components/shared/{Button,Badge,Input}.tsx`.

## Global Constraints

- TDD estricto (RED→GREEN). Tests React: pragma `// @vitest-environment jsdom` al tope del archivo (Vitest 4, default `node`). Tests de dato puro corren en `node`.
- Copy UI en español-CL; código/comentarios/commits en inglés. Botones/menús **no se cortan** — usar `useTextFits` (F0) donde un label pueda clip; cuando `fits=false`, poner `title=` (tooltip nativo accesible) en vez de truncar en silencio (directiva: no omitir información).
- NO hardcodear color nuevo — usar tokens (`bg-surface`, `text-primary-token`, `border-default-token`, `var(--accent-*)`) igual que el código vecino. El `color` por-ítem del catálogo se conserva tal cual (ya existe en el repo).
- **NO romper rutas existentes.** Cada `path:` del catálogo nuevo debe existir hoy en sidebar o carrusel — no inventar rutas. Preservar el gate `canUseExecutiveDashboard` (oro+) y el gate `isAdmin` (Panel B2D).
- **Selector de 4 modos vive en el header** (`RootLayout`), no flotando. Resolver el choque z-index con el chat IA (`AsesorChatLazy`, `open-ai-chat`) y `SOSButton`.
- **Acciones críticas en Sheet** = sin `navigate()` (no cambio de ruta): Emergencia → activa `setMode('emergency')` + abre overlay; Fast Check → abre `FastCheckModal` ya existente (`src/components/FastCheckModal.tsx`).
- **Connectivity ratchet (CLAUDE.md #21).** Cada componente/hook nuevo que quede montado/ruteado NO debe crear un orphan nuevo. Como SE montan en el shell, regenerar baseline en el MISMO commit: `node scripts/check-connectivity-ratchet.cjs --write` y stagear `scripts/connectivity-ratchet-baseline.json`. Correr `npm run lint:connectivity` antes de commitear.
- typecheck 0 (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`). Lint limpio en archivos tocados (`npx eslint <files>`).
- Commits frecuentes, uno por tarea. Rama: `feat/frontend-redesign`.

## File Structure

- Create: `src/navigation/navCatalog.ts` — catálogo único de 10 bloques (dato puro). Fuente de verdad de la navegación.
- Create: `src/navigation/navCatalog.test.ts`
- Create: `src/navigation/searchNav.ts` — fuzzy/substring search sobre el catálogo plano.
- Create: `src/navigation/searchNav.test.ts`
- Modify: `src/components/layout/sidebarMenuGroups.ts` — `buildSidebarMenuGroups` deriva del catálogo (preserva firma + gates).
- Modify: `src/components/layout/sidebarMenuGroups.test.ts` — actualizar expectativas a 10 bloques.
- Create: `src/components/shared/Sheet.tsx` + `src/components/shared/Sheet.test.tsx` — Sheet lateral framer-motion (token-driven, focus-trap básico, Escape).
- Create: `src/components/layout/NavSearch.tsx` + `src/components/layout/NavSearch.test.tsx` — buscador "¿qué necesitas?" (consume `searchNav` + `useTextFits`).
- Create: `src/components/layout/HeaderModeSwitcher.tsx` + `src/components/layout/HeaderModeSwitcher.test.tsx` — wrapper compacto del `ModeSwitcher` para el header (popover).
- Create: `src/components/layout/CriticalActionsSheet.tsx` + `src/components/layout/CriticalActionsSheet.test.tsx` — Sheet con Emergencia + Fast Check.
- Modify: `src/components/layout/RootLayout.tsx` — montar `HeaderModeSwitcher` en header, `NavSearch` en la barra de búsqueda, `CriticalActionsSheet`, y **quitar** el `<div className="fixed bottom-4 right-4 z-50">` que envuelve a `ModeSwitcher`.
- Modify: `src/components/dashboard/ModuleGroupsGrid.tsx` — derivar del catálogo único (consolida la divergencia carrusel↔sidebar). (Edición mínima; el fix de duplicación B4 es de F3.)

> Nota: El catálogo conserva el shape `MenuItem`/`MenuGroup` que el Sidebar ya consume, para que el render del Sidebar no cambie en F1 (solo cambia la DATA: de 5-6 grupos gigantes a 10 bloques balanceados). El re-skin del shell es F2.

---

### Task 1: Catálogo único de navegación — 10 bloques (dato puro)

**Files:**
- Create: `src/navigation/navCatalog.ts`
- Test: `src/navigation/navCatalog.test.ts`

**Interfaces:**
- Produces: `buildNavCatalog(t, features, isAdmin): NavBlock[]` con EXACTAMENTE 10 bloques en orden: `Principal · Gestión Operativa · Prevención y Riesgos · Salud Ocupacional · Cumplimiento · Emergencias · Conocimiento · IA y Coach · Innovación · Administración`. `NavBlock = { id; title; icon; items: NavItem[] }`, `NavItem = { title; icon; path; color; isBeta? }` (mismo shape que `MenuItem` de hoy). Lo consumen Sidebar (Task 3), buscador (Task 2), carrusel (Task 8).
- Mapeo: cada uno de los ~107 ítems hoy en `sidebarMenuGroups.ts` (grupo plano "Centro de Mando" + grupos AI/Ops/Health/Settings/Admin) se ubica en su bloque por dominio. Las 10 categorías del carrusel (`moduleGroups.ts`) son la columna vertebral; donde el sidebar tiene un módulo más específico (ruta real cableada), gana el del sidebar.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/navigation/navCatalog.test.ts
import { describe, it, expect } from 'vitest';
import { buildNavCatalog, type NavBlock } from './navCatalog';

const tStub: any = (_k: string, fallback?: string): string => fallback ?? _k;
const FREE = { canUseExecutiveDashboard: false };
const ORO = { canUseExecutiveDashboard: true };

const EXPECTED_ORDER = [
  'Principal', 'Gestión Operativa', 'Prevención y Riesgos', 'Salud Ocupacional',
  'Cumplimiento', 'Emergencias', 'Conocimiento', 'IA y Coach', 'Innovación', 'Administración',
];

describe('buildNavCatalog — fuente única de 10 bloques', () => {
  it('retorna 10 bloques en orden estable (no-admin)', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    expect(cat.map((b) => b.title)).toEqual(EXPECTED_ORDER);
  });

  it('cada bloque tiene id, icon e items[] no-vacío', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    for (const b of cat) {
      expect(typeof b.id).toBe('string');
      expect(b.id.length).toBeGreaterThan(0);
      expect(b.icon).toBeDefined();
      expect(Array.isArray(b.items)).toBe(true);
      expect(b.items.length).toBeGreaterThan(0);
    }
  });

  it('cada item tiene title + icon + path absoluto + color', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    for (const b of cat) {
      for (const it of b.items) {
        expect(it.title.length).toBeGreaterThan(0);
        expect(it.icon).toBeDefined();
        expect(it.path.startsWith('/')).toBe(true);
        expect(typeof it.color).toBe('string');
      }
    }
  });

  it('no hay rutas duplicadas dentro del mismo bloque', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    for (const b of cat) {
      const paths = b.items.map((i) => i.path);
      expect(new Set(paths).size, `bloque ${b.title} tiene rutas duplicadas`).toBe(paths.length);
    }
  });

  it('Administración crece con isAdmin (Panel B2D)', () => {
    const cat = buildNavCatalog(tStub, FREE, true);
    const admin = cat.find((b) => b.title === 'Administración')!;
    expect(admin.items.some((i) => i.path === '/admin/b2d')).toBe(true);
  });

  it('Dashboard Ejecutivo aparece solo con el feature oro+', () => {
    const free = buildNavCatalog(tStub, FREE, false).flatMap((b) => b.items.map((i) => i.path));
    const oro = buildNavCatalog(tStub, ORO, false).flatMap((b) => b.items.map((i) => i.path));
    expect(free).not.toContain('/executive-dashboard');
    expect(oro).toContain('/executive-dashboard');
  });

  it('preserva módulos vida-safety clave (no se pierden en el remapeo)', () => {
    const all = buildNavCatalog(tStub, ORO, true).flatMap((b) => b.items.map((i) => i.path));
    for (const p of ['/sif', '/lone-worker', '/stoppages', '/evacuation-dashboard',
                     '/emergency-brigade', '/restricted-zones', '/first-responder-map']) {
      expect(all, `falta la ruta vida-safety ${p}`).toContain(p);
    }
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/navigation/navCatalog.test.ts`
Expected: FAIL — `Cannot find module './navCatalog'`.

- [ ] **Step 3: Implementar el catálogo**

Crear `src/navigation/navCatalog.ts`. Reusa el `type TFn`, `SubscriptionFeatureGates`, y todos los íconos lucide ya importados en `sidebarMenuGroups.ts`. Mapeo de los ~107 ítems a los 10 bloques (cada `path` es una ruta REAL que hoy existe en sidebar o carrusel):

```ts
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
  Briefcase, Calculator, Calendar, Car, ClipboardCheck, ClipboardList, Clock, Cog,
  Compass, Construction, Crosshair, Database, Droplets, Ear, Eye, Factory, FileCheck,
  FileText, Folder, Gamepad2, GitBranch, GitCompare, Grid, Hand, HeartPulse, HelpCircle,
  Home, Inbox as InboxIcon, Key, Layers, LayoutDashboard, LayoutGrid, Lightbulb, ListChecks,
  Lock, Map, MessageSquare, Moon, Mountain, Network, OctagonAlert, Printer, Radio, Recycle,
  Scan, ScanLine, Settings as SettingsIcon, Shield, ShieldAlert, ShieldCheck, Siren,
  Stethoscope, Sun, SunMedium, Truck, User, UserCheck, Users, Wind, Wrench, Zap,
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
    { title: t('nav.change_management', 'Control de Cambios'), icon: GitCompare, path: '/change-management', color: 'text-teal-500' },
    { title: t('nav.afiches', 'Afiches de Seguridad'), icon: Printer, path: '/afiches-seguridad', color: 'text-blue-400' },
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
  ];

  // ── 9. INNOVACIÓN — gemelo digital, AR, mesh ─────────────────────────
  const innovacion: NavItem[] = [
    { title: t('nav.digital_twin', 'Gemelo Digital 3D'), icon: Layers, path: '/hub/operations/digital-twin', color: 'text-cyan-400' },
    { title: t('nav.projects_compare', 'Comparar Proyectos'), icon: BarChart3, path: '/projects-compare', color: 'text-blue-500' },
    { title: t('nav.project_closure', 'Cierre de Proyecto'), icon: Briefcase, path: '/closure', color: 'text-violet-500' },
    { title: t('nav.leadership_decisions', 'Decisiones Supervisión'), icon: User, path: '/leadership-decisions', color: 'text-blue-500' },
  ];

  // ── 10. ADMINISTRACIÓN — cuenta, facturación, ajustes ────────────────
  const administracion: NavItem[] = [
    { title: t('nav.profile', 'Mi Perfil'), icon: User, path: '/profile', color: 'text-zinc-400' },
    { title: t('nav.my_data', 'Mis datos'), icon: ShieldCheck, path: '/my-data', color: TEAL },
    { title: t('nav.settings', 'Ajustes'), icon: SettingsIcon, path: '/settings', color: 'text-zinc-400' },
    { title: t('nav.pricing', 'Planes y Facturación'), icon: Key, path: '/pricing', color: 'text-zinc-400' },
    { title: t('nav.help', 'Ayuda y Soporte'), icon: HelpCircle, path: '/help', color: 'text-zinc-400' },
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
```

> Nota de mapeo: este catálogo cubre los ítems del sidebar previo. Ítems del carrusel `moduleGroups.ts` con rutas NO presentes en el sidebar (p. ej. `/workers`, `/documents`, `/risks`, `/findings`, `/epp`, `/training`, `/emergency`, `/hazmat-map`, `/digital-twin`, etc.) se incorporan en Task 8 al derivar el carrusel del catálogo: para no romper el carrusel se mantienen esas rutas en su bloque. En F1 el catálogo prioriza las rutas del sidebar (más específicas); el reconciliado fino carrusel↔catálogo cierra en Task 8 con un test de cobertura de rutas.

- [ ] **Step 4: Correr el test (verde)**

Run: `npx vitest run src/navigation/navCatalog.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: typecheck del archivo nuevo aislado**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0 (los íconos importados existen en `lucide-react`; `Gamepad2`/`Radio`/`Folder`/`Lightbulb`/`GitBranch`/`Eye`/`Grid`/`Compass`/`SunMedium`/`FileCheck`/`Cog` se usan en Task 8 — si TS marca import sin uso, dejarlos para Task 8 o quitarlos ahora y reañadir en Task 8).

- [ ] **Step 6: Commit**

```bash
git add src/navigation/navCatalog.ts src/navigation/navCatalog.test.ts
git commit -m "feat(nav): single nav catalog of 10 blocks (consolidates sidebar + carousel)"
```

---

### Task 2: Buscador de navegación — `searchNav` (dato puro)

**Files:**
- Create: `src/navigation/searchNav.ts`
- Test: `src/navigation/searchNav.test.ts`

**Interfaces:**
- Consumes: `NavBlock` (Task 1).
- Produces: `searchNav(blocks: NavBlock[], query: string, limit?: number): NavSearchResult[]` donde `NavSearchResult = { item: NavItem; blockTitle: string }`. Substring case/acento-insensible sobre `title` + `blockTitle`. Lo consume `NavSearch.tsx` (Task 5).

- [ ] **Step 1: Test (falla)**

```ts
// src/navigation/searchNav.test.ts
import { describe, it, expect } from 'vitest';
import { searchNav } from './searchNav';
import { buildNavCatalog } from './navCatalog';

const tStub: any = (_k: string, fallback?: string): string => fallback ?? _k;
const cat = buildNavCatalog(tStub, { canUseExecutiveDashboard: true }, true);

describe('searchNav', () => {
  it('encuentra por substring del título', () => {
    const r = searchNav(cat, 'iper');
    expect(r.some((x) => x.item.path === '/matriz-iper')).toBe(true);
  });
  it('es insensible a mayúsculas y acentos', () => {
    const r = searchNav(cat, 'BITACORA');
    expect(r.some((x) => x.item.path === '/site-book')).toBe(true);
  });
  it('matchea por nombre de bloque (categoría)', () => {
    const r = searchNav(cat, 'emergencias');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.blockTitle.length > 0)).toBe(true);
  });
  it('query vacío retorna []', () => {
    expect(searchNav(cat, '   ')).toEqual([]);
  });
  it('respeta el limit', () => {
    expect(searchNav(cat, 'a', 3).length).toBeLessThanOrEqual(3);
  });
  it('prioriza match de prefijo del título sobre match interno', () => {
    const r = searchNav(cat, 'co'); // "Controles…", "Conducción…", "Comparar…", "Coach…"
    expect(r.length).toBeGreaterThan(0);
    // el primer resultado empieza con la query (prefijo) si existe alguno
    const anyPrefix = r.some((x) => normalizeStart(x.item.title));
    function normalizeStart(s: string): boolean {
      return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith('co');
    }
    if (anyPrefix) {
      expect(normalizeStart(r[0].item.title)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/navigation/searchNav.test.ts`
Expected: FAIL — `Cannot find module './searchNav'`.

- [ ] **Step 3: Implementar**

```ts
// src/navigation/searchNav.ts
import type { NavBlock, NavItem } from './navCatalog';

export interface NavSearchResult {
  item: NavItem;
  blockTitle: string;
}

/** Lowercase + strip diacritics for accent/case-insensitive matching. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Busca módulos en el catálogo por substring de título o bloque.
 * Orden: prefijo-de-título > substring-de-título > substring-de-bloque.
 */
export function searchNav(
  blocks: NavBlock[],
  query: string,
  limit = 8,
): NavSearchResult[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: Array<NavSearchResult & { score: number }> = [];
  for (const block of blocks) {
    const fb = fold(block.title);
    for (const item of block.items) {
      const ft = fold(item.title);
      let score = -1;
      if (ft.startsWith(q)) score = 3;
      else if (ft.includes(q)) score = 2;
      else if (fb.includes(q)) score = 1;
      if (score >= 0) scored.push({ item, blockTitle: block.title, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit).map(({ item, blockTitle }) => ({ item, blockTitle }));
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/navigation/searchNav.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/navigation/searchNav.ts src/navigation/searchNav.test.ts
git commit -m "feat(nav): searchNav — accent-insensitive module search over the catalog"
```

---

### Task 3: Sidebar deriva del catálogo (10 bloques, acordeón un-a-la-vez)

**Files:**
- Modify: `src/components/layout/sidebarMenuGroups.ts` (re-implementar `buildSidebarMenuGroups` sobre el catálogo)
- Modify: `src/components/layout/sidebarMenuGroups.test.ts` (10 bloques)

**Interfaces:**
- Conserva la firma EXACTA `buildSidebarMenuGroups(t, features, isAdmin): MenuGroup[]` que `Sidebar.tsx:51` ya consume — el render del Sidebar NO cambia en F1 (el acordeón "uno abierto a la vez" ya existe en `Sidebar.tsx:53-72`, `openGroup` single-string). Solo cambia la DATA: de 5-6 grupos (uno gigante) a 10 balanceados.

- [ ] **Step 1: Actualizar el test del builder (RED)**

Reemplazar el bloque `describe('estructura básica', ...)` en `src/components/layout/sidebarMenuGroups.test.ts` (≈líneas 27-48) para esperar 10 grupos en el orden del catálogo:

```ts
  describe('estructura básica', () => {
    it('retorna 10 bloques para user no-admin sin features', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      expect(groups.map((g) => g.title)).toEqual([
        'Principal', 'Gestión Operativa', 'Prevención y Riesgos', 'Salud Ocupacional',
        'Cumplimiento', 'Emergencias', 'Conocimiento', 'IA y Coach', 'Innovación', 'Administración',
      ]);
    });

    it('admin no agrega un bloque nuevo — extiende Administración', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, true);
      expect(groups).toHaveLength(10);
      const admin = groups.find((g) => g.title === 'Administración')!;
      expect(admin.items.some((i) => i.path === '/admin/b2d')).toBe(true);
    });

    it('cada grupo tiene title + icon + items[] no-vacío', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      for (const g of groups) {
        expect(g.title.length).toBeGreaterThan(0);
        expect(g.icon).toBeDefined();
        expect(g.items.length).toBeGreaterThan(0);
      }
    });

    it('cada item tiene title + icon + path + color', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      for (const g of groups) {
        for (const it of g.items) {
          expect(it.title.length).toBeGreaterThan(0);
          expect(it.icon).toBeDefined();
          expect(it.path.startsWith('/')).toBe(true);
          expect(typeof it.color).toBe('string');
        }
      }
    });
  });
```

(Conservar el resto del archivo de test que valida `canUseExecutiveDashboard` — ahora el Dashboard Ejecutivo vive en el bloque "IA y Coach", ajustar cualquier assert que lo buscaba en "Centro de Mando".)

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/layout/sidebarMenuGroups.test.ts`
Expected: FAIL — todavía retorna 5-6 grupos con "Centro de Mando".

- [ ] **Step 3: Re-implementar el builder sobre el catálogo**

Reemplazar TODO el cuerpo de `src/components/layout/sidebarMenuGroups.ts` por un adaptador delgado (conserva los `export type MenuItem/MenuGroup/TFn/SubscriptionFeatureGates` para no romper imports externos):

```ts
// SPDX-License-Identifier: MIT
// Praeventio Guard — F1 Navegación (2026-06-22).
//
// El catálogo de navegación se unificó en `src/navigation/navCatalog.ts`
// (10 bloques, fuente única compartida con el carrusel y el buscador).
// Este módulo ahora es un adaptador delgado: re-expone el catálogo con el
// shape `MenuGroup[]` que `Sidebar.tsx` ya consume, preservando la firma
// pública `buildSidebarMenuGroups(t, features, isAdmin)`.

import type { LucideIcon } from 'lucide-react';
import { buildNavCatalog, type TFn, type SubscriptionFeatureGates } from '../../navigation/navCatalog';

export type { TFn, SubscriptionFeatureGates };

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
 * Construye los grupos del Sidebar derivándolos del catálogo único.
 * Función pura. El render del Sidebar (acordeón un-bloque-abierto) no cambia.
 */
export function buildSidebarMenuGroups(
  t: TFn,
  features: SubscriptionFeatureGates,
  isAdmin: boolean,
): MenuGroup[] {
  return buildNavCatalog(t, features, isAdmin).map((block) => ({
    title: block.title,
    icon: block.icon,
    items: block.items,
  }));
}
```

- [ ] **Step 4: Correr tests (verde) — builder + Sidebar consumidor**

Run: `npx vitest run src/components/layout/sidebarMenuGroups.test.ts` → Expected: PASS.
Run: `npx vitest run src/navigation` → Expected: PASS (catálogo + search siguen verdes).

- [ ] **Step 5: typecheck + commit**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

```bash
git add src/components/layout/sidebarMenuGroups.ts src/components/layout/sidebarMenuGroups.test.ts
git commit -m "feat(nav): sidebar derives from the single 10-block catalog (kills the ~83-item flat group)"
```

---

### Task 4: Primitivo `Sheet` (panel lateral, framer-motion)

**Files:**
- Create: `src/components/shared/Sheet.tsx`
- Test: `src/components/shared/Sheet.test.tsx`

**Interfaces:**
- Consumes: `cn` de `src/utils/cn` (F0), `framer-motion` (ya instalado).
- Produces: `Sheet` (default export), props `{ isOpen: boolean; onClose: () => void; title: string; side?: 'left'|'right'; children: ReactNode }`. Cierra con Escape + click en overlay; `role="dialog"` `aria-modal="true"`. Construido sobre framer-motion (NO `@radix-ui/react-dialog`, que no está instalado), reusando el patrón de `src/components/shared/Modal.tsx`.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/shared/Sheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sheet from './Sheet';

describe('Sheet', () => {
  it('no renderiza contenido cuando isOpen=false', () => {
    render(<Sheet isOpen={false} onClose={() => {}} title="Acciones">contenido</Sheet>);
    expect(screen.queryByText('contenido')).toBeNull();
  });
  it('renderiza título + contenido y es un dialog modal cuando abre', () => {
    render(<Sheet isOpen onClose={() => {}} title="Acciones">contenido</Sheet>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Acciones')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
  it('Escape dispara onClose', () => {
    const onClose = vi.fn();
    render(<Sheet isOpen onClose={onClose} title="Acciones">x</Sheet>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('el botón cerrar dispara onClose', () => {
    const onClose = vi.fn();
    render(<Sheet isOpen onClose={onClose} title="Acciones">x</Sheet>);
    fireEvent.click(screen.getByLabelText('Cerrar panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/shared/Sheet.test.tsx`
Expected: FAIL — `Cannot find module './Sheet'`.

- [ ] **Step 3: Implementar el Sheet**

```tsx
// src/components/shared/Sheet.tsx
import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  side?: 'left' | 'right';
  children: ReactNode;
}

/**
 * Side panel built on framer-motion (the repo has @radix-ui/react-tooltip
 * only — no react-dialog). Mirrors the prototype's Sheet pattern and the
 * existing Modal.tsx overlay. Token-driven so it holds contrast in the 4
 * modes. Used for critical actions WITHOUT a route change (keeps context).
 */
export default function Sheet({ isOpen, onClose, title, side = 'right', children }: SheetProps) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="sheet-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80]"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div
            onClick={onClose}
            aria-hidden="true"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={cn(
              'absolute top-0 bottom-0 w-[88%] max-w-md flex flex-col',
              'bg-elevated border-default-token shadow-mode-lg',
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            )}
          >
            <div className="p-4 sm:p-5 border-b border-default-token flex items-center justify-between bg-surface shrink-0">
              <h2 className="text-base sm:text-lg font-semibold text-primary-token truncate pr-4">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar panel"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-muted-token hover:text-primary-token hover:bg-canvas transition-colors shrink-0"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 text-primary-token">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/shared/Sheet.test.tsx`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/Sheet.tsx src/components/shared/Sheet.test.tsx
git commit -m "feat(ui): shared Sheet primitive (framer-motion side panel, token-driven, no route change)"
```

---

### Task 5: `NavSearch` — buscador "¿qué necesitas?"

**Files:**
- Create: `src/components/layout/NavSearch.tsx`
- Test: `src/components/layout/NavSearch.test.tsx`

**Interfaces:**
- Consumes: `buildNavCatalog` (Task 1), `searchNav` (Task 2), `useTextFits` (F0), `Input` (F0), `useSubscription`, `useFirebase`, `useNavigate`.
- Produces: `NavSearch` (named export). Input con placeholder "¿qué necesitas?"; al teclear muestra resultados; click/Enter navega (`navigate(path)`) y limpia. Cada resultado con label que podría cortarse usa `useTextFits` → `title=` si `fits=false`.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/layout/NavSearch.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ features: { canUseExecutiveDashboard: false } }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => ({ isAdmin: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, f?: string) => f ?? _k }) }));

import { NavSearch } from './NavSearch';

describe('NavSearch', () => {
  it('muestra resultados al teclear y navega al elegir', () => {
    render(<NavSearch />);
    const input = screen.getByPlaceholderText('¿Qué necesitas?');
    fireEvent.change(input, { target: { value: 'iper' } });
    const result = screen.getByText('Matriz IPER');
    fireEvent.click(result);
    expect(navigateMock).toHaveBeenCalledWith('/matriz-iper');
  });
  it('sin query no muestra resultados', () => {
    render(<NavSearch />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/layout/NavSearch.test.tsx`
Expected: FAIL — `Cannot find module './NavSearch'`.

- [ ] **Step 3: Implementar**

```tsx
// src/components/layout/NavSearch.tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { buildNavCatalog } from '../../navigation/navCatalog';
import { searchNav } from '../../navigation/searchNav';
import { useTextFits } from '../../hooks/useTextFits';
import { cn } from '../../utils/cn';

/**
 * NavSearch — "¿qué necesitas?" jump-to-module search over the single nav
 * catalog. Atajo a los 80+ módulos sin recorrer el acordeón. Labels que
 * podrían cortarse muestran `title=` (tooltip) en vez de truncar en
 * silencio (directiva: no omitir información).
 */
export function NavSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { features } = useSubscription();
  const { isAdmin } = useFirebase();
  const [query, setQuery] = useState('');

  const catalog = useMemo(() => buildNavCatalog(t, features, isAdmin), [t, features, isAdmin]);
  const results = useMemo(() => searchNav(catalog, query, 8), [catalog, query]);

  const go = (path: string): void => {
    navigate(path);
    setQuery('');
  };

  return (
    <div className="relative w-full">
      <div className="relative flex items-center group">
        <Search className="absolute left-4 w-4 h-4 text-muted-token group-focus-within:text-[#4db6ac] transition-colors" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].item.path);
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder={t('nav.search_placeholder', '¿Qué necesitas?')}
          aria-label={t('nav.search_placeholder', '¿Qué necesitas?')}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="nav-search-results"
          className="w-full rounded-2xl py-2.5 pl-11 pr-4 text-sm bg-surface text-primary-token border border-default-token placeholder:text-muted-token focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] transition-all"
        />
      </div>
      {results.length > 0 && (
        <ul
          id="nav-search-results"
          role="listbox"
          className="absolute z-[90] mt-2 w-full max-h-80 overflow-y-auto custom-scrollbar rounded-2xl bg-elevated border border-default-token shadow-mode-lg py-1"
        >
          {results.map(({ item, blockTitle }) => (
            <NavSearchResultRow
              key={item.path}
              title={item.title}
              blockTitle={blockTitle}
              Icon={item.icon}
              color={item.color}
              onSelect={() => go(item.path)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NavSearchResultRow({
  title, blockTitle, Icon, color, onSelect,
}: {
  title: string;
  blockTitle: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  onSelect: () => void;
}) {
  // ~280px de ancho útil de fila menos íconos/padding ≈ 200px para el label.
  const { fits } = useTextFits(title, '14px Inter', 200);
  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors',
          'hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        <Icon className={cn('w-4 h-4 shrink-0', color)} />
        <span className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-primary-token truncate" title={fits ? undefined : title}>
            {title}
          </span>
          <span className="text-xs text-muted-token truncate">{blockTitle}</span>
        </span>
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/layout/NavSearch.test.tsx`
Expected: PASS (2). (`useTextFits` retorna `fits=true` en jsdom sin Canvas — F0.)

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/NavSearch.tsx src/components/layout/NavSearch.test.tsx
git commit -m "feat(nav): NavSearch jump-to-module (¿qué necesitas?) over the catalog + anti-clip labels"
```

---

### Task 6: `HeaderModeSwitcher` — selector de 4 modos en el header (popover)

**Files:**
- Create: `src/components/layout/HeaderModeSwitcher.tsx`
- Test: `src/components/layout/HeaderModeSwitcher.test.tsx`

**Interfaces:**
- Consumes: `useAppMode` (`src/contexts/AppModeContext`), `ModeSwitcher` existente (`src/components/shared/ModeSwitcher.tsx`), `cn`.
- Produces: `HeaderModeSwitcher` (named export). Botón en el header con ícono del modo activo; al abrir muestra el `ModeSwitcher` en un popover anclado. Reusa la lógica de modos existente — NO duplica `setMode`. Esto mueve el selector del bottom-right (donde choca con chat z-50 + SOS) al header (z-40).

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/layout/HeaderModeSwitcher.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({
    mode: 'normal', appearance: 'light',
    setMode: vi.fn(), setAppearance: vi.fn(), dismissEmergency: vi.fn(),
    emergencyAutoExpiresAt: null, emergencyAutoEvent: null,
  }),
  AppMode: {}, AppAppearance: {},
}));

import { HeaderModeSwitcher } from './HeaderModeSwitcher';

describe('HeaderModeSwitcher', () => {
  it('renderiza el botón trigger cerrado por defecto', () => {
    render(<HeaderModeSwitcher />);
    expect(screen.getByLabelText('Cambiar modo de visualización')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Selector de modo de UX' })).toBeNull();
  });
  it('abre el popover con los 4 modos al click', () => {
    render(<HeaderModeSwitcher />);
    fireEvent.click(screen.getByLabelText('Cambiar modo de visualización'));
    expect(screen.getByRole('group', { name: 'Selector de modo de UX' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/layout/HeaderModeSwitcher.test.tsx`
Expected: FAIL — `Cannot find module './HeaderModeSwitcher'`.

- [ ] **Step 3: Implementar**

```tsx
// src/components/layout/HeaderModeSwitcher.tsx
import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Car, AlertOctagon } from 'lucide-react';
import { useAppMode } from '../../contexts/AppModeContext';
import { ModeSwitcher } from '../shared/ModeSwitcher';
import { cn } from '../../utils/cn';

/**
 * HeaderModeSwitcher — moves the 4-mode selector OUT of the floating
 * bottom-right dock (which collided with the AI chat launcher z-50 + SOS
 * button) INTO the header. Reuses the existing ModeSwitcher (no duplicated
 * setMode logic); renders it inside an anchored popover.
 */
export function HeaderModeSwitcher() {
  const { mode, appearance } = useAppMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ActiveIcon =
    mode === 'driving' ? Car
    : mode === 'emergency' ? AlertOctagon
    : appearance === 'dark' ? Moon
    : Sun;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Cambiar modo de visualización"
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm',
          'bg-surface border border-default-token text-secondary-token hover:text-primary-token hover:bg-canvas',
        )}
      >
        <ActiveIcon className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-50">
          <ModeSwitcher />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/layout/HeaderModeSwitcher.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/HeaderModeSwitcher.tsx src/components/layout/HeaderModeSwitcher.test.tsx
git commit -m "feat(nav): HeaderModeSwitcher — 4-mode selector moves to header (resolves B2 chat z-index clash)"
```

---

### Task 7: `CriticalActionsSheet` — Emergencia + Fast Check sin cambiar de ruta

**Files:**
- Create: `src/components/layout/CriticalActionsSheet.tsx`
- Test: `src/components/layout/CriticalActionsSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet` (Task 4), `Button` (F0), `useAppMode` (Emergencia → `setMode('emergency')`), `FastCheckModal` (`src/components/FastCheckModal.tsx`, existente).
- Produces: `CriticalActionsSheet` (named export), props `{ isOpen; onClose }`. Dentro: botón "Activar Emergencia" → `setMode('emergency')` + `onClose()` (el `EmergencyOverlay`/`SOSButton` ya montados en RootLayout reaccionan al modo; NO hay `navigate`). Botón "Fast Check" → abre `FastCheckModal` inline (sin route change). Directiva: nunca pánico — copy sereno, rojo solo en la acción crítica.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/layout/CriticalActionsSheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setModeMock = vi.fn();
vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({ setMode: setModeMock, mode: 'normal', appearance: 'light' }),
}));
// FastCheckModal pulls heavy hooks — stub it for this unit test.
vi.mock('../FastCheckModal', () => ({
  FastCheckModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>fast-check-modal</div> : null,
}));

import { CriticalActionsSheet } from './CriticalActionsSheet';

describe('CriticalActionsSheet', () => {
  it('Activar Emergencia llama setMode(emergency) sin navegar y cierra', () => {
    const onClose = vi.fn();
    render(<CriticalActionsSheet isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Activar Emergencia/i }));
    expect(setModeMock).toHaveBeenCalledWith('emergency');
    expect(onClose).toHaveBeenCalled();
  });
  it('Fast Check abre el modal inline (sin route change)', () => {
    render(<CriticalActionsSheet isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Fast Check/i }));
    expect(screen.getByText('fast-check-modal')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/layout/CriticalActionsSheet.test.tsx`
Expected: FAIL — `Cannot find module './CriticalActionsSheet'`.

- [ ] **Step 3: Implementar**

```tsx
// src/components/layout/CriticalActionsSheet.tsx
import { useState } from 'react';
import { AlertOctagon, Zap } from 'lucide-react';
import Sheet from '../shared/Sheet';
import Button from '../shared/Button';
import { useAppMode } from '../../contexts/AppModeContext';
import { FastCheckModal } from '../FastCheckModal';

/**
 * CriticalActionsSheet — acciones críticas en panel lateral SIN cambio de
 * ruta (no se pierde el contexto de la pantalla actual):
 *   • Emergencia  → setMode('emergency'); el EmergencyOverlay/SOSButton ya
 *                   montados en RootLayout reaccionan al modo (no navigate).
 *   • Fast Check  → abre el FastCheckModal inline.
 * Directiva fundador: nunca pánico — copy sereno, rojo solo en la acción
 * crítica de emergencia.
 */
export function CriticalActionsSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { setMode } = useAppMode();
  const [fastCheckOpen, setFastCheckOpen] = useState(false);

  const activateEmergency = (): void => {
    setMode('emergency');
    onClose();
  };

  return (
    <>
      <Sheet isOpen={isOpen} onClose={onClose} title="Acciones rápidas">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary-token">
            Acceso directo a lo crítico sin salir de esta pantalla.
          </p>

          <Button variant="danger" size="lg" onClick={activateEmergency} className="justify-start">
            <AlertOctagon aria-hidden="true" />
            Activar Emergencia
          </Button>

          <Button variant="secondary" size="lg" onClick={() => setFastCheckOpen(true)} className="justify-start">
            <Zap aria-hidden="true" />
            Fast Check
          </Button>

          <p className="text-xs text-muted-token">
            La emergencia activa el modo de alta visibilidad. Puedes cancelarla cuando quieras.
          </p>
        </div>
      </Sheet>

      <FastCheckModal isOpen={fastCheckOpen} onClose={() => setFastCheckOpen(false)} />
    </>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/layout/CriticalActionsSheet.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/CriticalActionsSheet.tsx src/components/layout/CriticalActionsSheet.test.tsx
git commit -m "feat(nav): CriticalActionsSheet — Emergencia + Fast Check in a side panel, no route change"
```

---

### Task 8: Carrusel deriva del catálogo (consolida divergencia)

**Files:**
- Modify: `src/components/dashboard/ModuleGroupsGrid.tsx` (importar del catálogo en vez de `moduleGroups.ts`)
- Modify: `src/navigation/navCatalog.test.ts` (test de cobertura: el catálogo cubre todas las rutas del carrusel previo)

**Interfaces:**
- Hace que el carrusel y el sidebar usen la MISMA fuente (cierra la divergencia que el spec §7 pide eliminar). El shape de `moduleGroups` (`{ id, title, icon, color, items }`) y el del catálogo (`{ id, title, icon, items }`) difieren solo en el `color` de bloque — se añade un mapa de color por `id` para no perder el acento del carrusel.

> Importante: `moduleGroups.ts` contiene rutas que el sidebar previo NO tenía (`/site-map`, `/mural`, `/calendar`, `/focus-agenda`, `/workers`, `/documents`, `/attendance`, `/telemetry`, `/assets`, `/risks`, `/findings`, `/epp`, `/matrix`, `/pts`, `/controls-materials`, `/psychosocial`, `/bio-analysis`, `/normatives`, `/minsal-protocols`, `/reglamentos`, `/audits`, `/audit-trail`, `/suseso`, `/comite-paritario`, `/emergency`, `/emergencia-avanzada`, `/evacuation`, `/evacuation-routes`, `/emergency-generator`, `/hazmat-map`, `/hazmat-storage`, `/volcanic-eruption`, `/coastal-emergency`, `/national-parks`, `/mountain-refuges`, `/dea-zones`, `/training`, `/gamification`, `/glossary`, `/risk-network`, `/curriculum`, `/predictive-guard`, `/diagnostico`, `/knowledge-ingestion`, `/digital-twin`, `/digital-twin/ar`, `/blueprint-viewer`, `/autocad`, `/climate-routes`, `/inhospitable-guide`, `/light-pollution`, `/security-shield`, `/erp-integration`). Para no romper el carrusel, primero AÑADIR estas rutas a sus bloques en `navCatalog.ts` (cada una a su bloque por dominio), de modo que el catálogo sea superconjunto. Esto convierte al catálogo en la fuente real y completa.

- [ ] **Step 1: Añadir las rutas exclusivas del carrusel a `navCatalog.ts`**

En `src/navigation/navCatalog.ts`, agregar a cada bloque sus ítems faltantes (todos provienen del `moduleGroups.ts` actual; usar el mismo `title`/`icon`/`color` que el carrusel ya define). Ejemplos por bloque:

```ts
  // principal — agregar:
    { title: 'Mapa de Sitio', icon: Map, path: '/site-map', color: 'text-emerald-500' },
    { title: 'Mural', icon: MessageSquare, path: '/mural', color: 'text-emerald-500' },
    { title: 'Calendario', icon: Calendar, path: '/calendar', color: 'text-emerald-500' },
    { title: 'Focus Agenda', icon: ClipboardList, path: '/focus-agenda', color: 'text-emerald-500' },

  // operativa — agregar:
    { title: 'Trabajadores', icon: Users, path: '/workers', color: 'text-blue-500' },
    { title: 'Documentos', icon: Folder, path: '/documents', color: 'text-blue-500' },
    { title: 'Asistencia', icon: UserCheck, path: '/attendance', color: 'text-blue-500' },
    { title: 'Telemetría', icon: Activity, path: '/telemetry', color: 'text-blue-500' },
    { title: 'Activos', icon: Wrench, path: '/assets', color: 'text-blue-500' },

  // riesgos — agregar:
    { title: 'Riesgos', icon: AlertOctagon, path: '/risks', color: 'text-violet-500' },
    { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-violet-500' },
    { title: 'EPP', icon: Shield, path: '/epp', color: 'text-violet-500' },
    { title: 'Matriz', icon: Grid, path: '/matrix', color: 'text-violet-500' },
    { title: 'PTS', icon: FileText, path: '/pts', color: 'text-violet-500' },
    { title: 'Controles + Mat.', icon: Layers, path: '/controls-materials', color: 'text-violet-500' },

  // salud — agregar:
    { title: 'Psicosocial', icon: Brain, path: '/psychosocial', color: 'text-rose-500' },
    { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-rose-500' },

  // cumplimiento — agregar:
    { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-amber-500' },
    { title: 'Protocolos MINSAL', icon: ShieldCheck, path: '/minsal-protocols', color: 'text-amber-500' },
    { title: 'Reglamentos', icon: FileCheck, path: '/reglamentos', color: 'text-amber-500' },
    { title: 'Auditorías', icon: ClipboardList, path: '/audits', color: 'text-amber-500' },
    { title: 'Trazabilidad', icon: Database, path: '/audit-trail', color: 'text-amber-500' },
    { title: 'Reportes SUSESO', icon: FileText, path: '/suseso', color: 'text-amber-500' },
    { title: 'Comité Paritario', icon: Users, path: '/comite-paritario', color: 'text-amber-500' },

  // emergencias — agregar:
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

  // conocimiento — agregar:
    { title: 'Capacitaciones', icon: BookOpen, path: '/training', color: 'text-cyan-500' },
    { title: 'Gamificación', icon: Gamepad2, path: '/gamification', color: 'text-cyan-500' },
    { title: 'Glosario', icon: Book, path: '/glossary', color: 'text-cyan-500' },
    { title: 'Red Neuronal', icon: Network, path: '/risk-network', color: 'text-cyan-500' },
    { title: 'Curriculum', icon: ClipboardList, path: '/curriculum', color: 'text-cyan-500' },

  // ia-coach — agregar:
    { title: 'Guardia Predict.', icon: Lightbulb, path: '/predictive-guard', color: 'text-violet-500' },
    { title: 'Diagnóstico', icon: Brain, path: '/diagnostico', color: 'text-violet-500' },
    { title: 'Knowledge Ing.', icon: Database, path: '/knowledge-ingestion', color: 'text-violet-500' },

  // innovacion — agregar:
    { title: 'Digital Twin', icon: Box, path: '/digital-twin', color: 'text-fuchsia-500' },
    { title: 'Digital Twin AR', icon: Eye, path: '/digital-twin/ar', color: 'text-fuchsia-500' },
    { title: 'Blueprint Viewer', icon: Layers, path: '/blueprint-viewer', color: 'text-fuchsia-500' },
    { title: 'AutoCAD', icon: Grid, path: '/autocad', color: 'text-fuchsia-500' },
    { title: 'Climate Routes', icon: Compass, path: '/climate-routes', color: 'text-fuchsia-500' },
    { title: 'Inhospitable G.', icon: Map, path: '/inhospitable-guide', color: 'text-fuchsia-500' },
    { title: 'Light Pollution', icon: Eye, path: '/light-pollution', color: 'text-fuchsia-500' },

  // administracion — agregar:
    { title: 'Security Shield', icon: ShieldCheck, path: '/security-shield', color: 'text-zinc-400' },
    { title: 'ERP Integration', icon: GitBranch, path: '/erp-integration', color: 'text-zinc-400' },
```

(Insertar cada grupo en su arreglo `NavItem[]` respectivo. Mantener el invariante "sin rutas duplicadas dentro del bloque" del test de Task 1 — `/projects` ya está en Principal; no re-agregar en Administración.)

- [ ] **Step 2: Test de cobertura de rutas del carrusel (RED)**

Agregar a `src/navigation/navCatalog.test.ts`:

```ts
import { moduleGroups } from '../components/dashboard/moduleGroups';

describe('el catálogo es superconjunto del carrusel previo', () => {
  it('cubre toda ruta de moduleGroups.ts', () => {
    const catPaths = new Set(
      buildNavCatalog(tStub, ORO, true).flatMap((b) => b.items.map((i) => i.path)),
    );
    const missing = moduleGroups
      .flatMap((g) => g.items.map((i) => i.path))
      .filter((p) => !catPaths.has(p));
    expect(missing, `rutas del carrusel ausentes del catálogo: ${missing.join(', ')}`).toEqual([]);
  });
});
```

Run: `npx vitest run src/navigation/navCatalog.test.ts` → Expected: FAIL hasta completar Step 1; luego PASS.

- [ ] **Step 3: Derivar el carrusel del catálogo**

En `src/components/dashboard/ModuleGroupsGrid.tsx`, reemplazar el import `import { moduleGroups } from './moduleGroups';` (línea 26) por una derivación del catálogo. Como `ModuleGroupsGrid` es un componente, usar los hooks ahí (verificar que ya use `useTranslation`/`useSubscription`/`useFirebase`; si no, importarlos) y construir:

```tsx
import { buildNavCatalog } from '../../navigation/navCatalog';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useFirebase } from '../../contexts/FirebaseContext';

// color de fondo por bloque (preserva el acento del carrusel previo)
const BLOCK_BG: Record<string, string> = {
  main: 'bg-emerald-500', operations: 'bg-blue-500', risks: 'bg-[#A855F7]',
  health: 'bg-[#EF4444]', compliance: 'bg-[#F59E0B]', emergencies: 'bg-rose-600',
  knowledge: 'bg-cyan-600', 'ai-coach': 'bg-violet-600', innovation: 'bg-fuchsia-600',
  administration: 'bg-zinc-600',
};
```

Dentro del componente:

```tsx
  const { t } = useTranslation();
  const { features } = useSubscription();
  const { isAdmin } = useFirebase();
  const moduleGroups = useMemo(
    () => buildNavCatalog(t, features, isAdmin).map((b) => ({
      id: b.id,
      title: b.title,
      icon: b.icon,
      color: BLOCK_BG[b.id] ?? 'bg-zinc-600',
      items: b.items,
    })),
    [t, features, isAdmin],
  );
```

Mantener intacto el resto del render (incluida la línea 90 `[...moduleGroups, ...moduleGroups]` — el fix de la duplicación visible B4 es de F3, fuera de scope F1). El `moduleGroups.ts` legacy se conserva en disco SOLO como fuente de datos del test de cobertura (Step 2) hasta que F3 lo retire.

- [ ] **Step 4: Correr tests + typecheck**

Run: `npx vitest run src/navigation/navCatalog.test.ts` → Expected: PASS (incl. cobertura).
Run: `npx vitest run src/components/dashboard` → Expected: PASS (los tests del grid siguen verdes).
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/navigation/navCatalog.ts src/navigation/navCatalog.test.ts src/components/dashboard/ModuleGroupsGrid.tsx
git commit -m "feat(nav): carousel derives from the single catalog (one source of truth, sidebar↔carousel reconciled)"
```

---

### Task 9: Montar todo en `RootLayout` (header search + mode selector + critical Sheet) + regen ratchet

**Files:**
- Modify: `src/components/layout/RootLayout.tsx`

**Interfaces:**
- Monta `NavSearch` (reemplaza el `<input>` de búsqueda inline de las líneas 227-258 — que hoy dispara `open-ai-chat`), `HeaderModeSwitcher` en el cluster derecho del header, un trigger de `CriticalActionsSheet`, y **elimina** el dock flotante `ModeSwitcher` (líneas 427-430). El AI chat sigue accesible vía el botón Sparkles (queda) + atajo de teclado existente.

> Decisión de scope: el buscador de header pasa de "Buscar o preguntar a la IA" (que abría el chat) a NavSearch (salto a módulos). El botón Sparkles a la derecha del input se conserva para seguir abriendo el chat IA (`open-ai-chat`). Así separamos "navegar" (NavSearch) de "preguntar a la IA" (Sparkles), sin perder ninguna capacidad.

- [ ] **Step 1: Añadir imports**

En `src/components/layout/RootLayout.tsx`, junto a los imports de `./` agregar:

```ts
import { NavSearch } from './NavSearch';
import { HeaderModeSwitcher } from './HeaderModeSwitcher';
import { CriticalActionsSheet } from './CriticalActionsSheet';
```

Y añadir el ícono `Zap` a la importación de `lucide-react` de la línea 5 (para el trigger de acciones rápidas).

- [ ] **Step 2: Estado del Sheet de acciones críticas**

Junto al resto de `useState` (≈línea 76-84) agregar:

```ts
  const [isCriticalOpen, setIsCriticalOpen] = useState(false);
```

- [ ] **Step 3: Reemplazar el input de búsqueda por NavSearch**

En el bloque `{/* Middle: Global Search & AI Help */}` (líneas 226-273), reemplazar el `<input>` de navegación (el desktop, líneas 228-258) por `NavSearch`, conservando el botón Sparkles para el chat IA. Estructura resultante del contenedor desktop:

```tsx
        <div className="flex flex-1 max-w-xl mx-4 relative justify-end sm:justify-center">
          <div className="relative w-full max-w-[300px] sm:max-w-full hidden sm:flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <NavSearch />
            </div>
            <button
              onClick={() => {
                if (!isOnline) return;
                window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { query: '' } }));
              }}
              disabled={!isOnline}
              aria-label="Preguntar a la IA"
              className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm ${
                !isOnline
                  ? 'bg-surface border border-default-token text-muted-token cursor-not-allowed'
                  : 'bg-[#4db6ac]/10 border border-[#4db6ac]/20 text-[#2a8a81] dark:text-[#4db6ac] hover:scale-105'
              }`}
              title={!isOnline ? 'Requiere conexión a internet' : 'Preguntar a Gemini AI'}
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Mobile: AI chat button (unchanged) */}
          <button
            onClick={() => {
              if (!isOnline) return;
              window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { query: '' } }));
            }}
            disabled={!isOnline}
            aria-label="Preguntar a la IA"
            className={`sm:hidden w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm ${
              !isOnline ? 'bg-surface border border-default-token text-muted-token cursor-not-allowed' : 'bg-[#4db6ac]/10 border border-[#4db6ac]/20 text-[#2a8a81] dark:text-[#4db6ac]'
            }`}
          >
            <Sparkles className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
```

(El estado `searchQuery` y su `onKeyDown` que disparaba `open-ai-chat` quedan sin uso para el input desktop — eliminar `searchQuery`/`setSearchQuery` si ya no se referencian, o dejarlos si el mobile los usa; verificar con typecheck.)

- [ ] **Step 4: Montar HeaderModeSwitcher + trigger de acciones críticas en el cluster derecho**

En `{/* Right: Notifications, Theme & Profile */}` (≈línea 276), agregar al inicio del cluster (antes del Tooltip de Conducción):

```tsx
          {/* 4-mode selector — moved here from the floating bottom-right dock (B2). */}
          <HeaderModeSwitcher />

          {/* Critical actions — open in a side Sheet, no route change. */}
          <Tooltip content="Acciones rápidas (Emergencia, Fast Check)">
            <button
              type="button"
              onClick={() => setIsCriticalOpen(true)}
              aria-label="Acciones rápidas"
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface border border-default-token text-secondary-token hover:text-primary-token hover:bg-canvas transition-all shadow-sm"
            >
              <Zap className="w-5 h-5" aria-hidden="true" />
            </button>
          </Tooltip>
```

- [ ] **Step 5: Quitar el dock flotante + montar el Sheet**

Eliminar el bloque (líneas 427-430):

```tsx
      {/* 4-mode UX dock — floating, post-login only (RootLayout never renders on landing). */}
      <div className="fixed bottom-4 right-4 z-50 pointer-events-auto">
        <ModeSwitcher />
      </div>
```

Quitar también el import ahora sin uso `import { ModeSwitcher } from '../shared/ModeSwitcher';` (línea 49) — `ModeSwitcher` ahora se consume solo dentro de `HeaderModeSwitcher`.

Cerca del final del shell (junto a `<SOSButton />`) montar:

```tsx
      <CriticalActionsSheet isOpen={isCriticalOpen} onClose={() => setIsCriticalOpen(false)} />
```

- [ ] **Step 6: typecheck + lint**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0 (resolver cualquier `searchQuery` sin uso).
Run: `npx eslint src/components/layout/RootLayout.tsx src/components/layout/NavSearch.tsx src/components/layout/HeaderModeSwitcher.tsx src/components/layout/CriticalActionsSheet.tsx src/components/shared/Sheet.tsx src/navigation/navCatalog.ts src/navigation/searchNav.ts` → Expected: 0 errores.

- [ ] **Step 7: Regenerar el connectivity ratchet (CLAUDE.md #21)**

Los nuevos componentes (`NavSearch`, `HeaderModeSwitcher`, `CriticalActionsSheet`, `Sheet`) ahora están renderizados en el shell, así que NO deben ser orphans. Regenerar baseline para que el gate quede consistente:

Run: `node scripts/check-connectivity-ratchet.cjs --write`
Run: `npm run lint:connectivity` → Expected: PASS (count solo puede shrink, nunca crecer).

- [ ] **Step 8: Smoke de render del shell**

Run: `npx vitest run src/components/layout` → Expected: PASS (todos los tests de layout, incl. los nuevos).

- [ ] **Step 9: Commit (incluye baseline regen)**

```bash
git add src/components/layout/RootLayout.tsx scripts/connectivity-ratchet-baseline.json
git commit -m "feat(nav): wire NavSearch + HeaderModeSwitcher + CriticalActionsSheet into RootLayout; drop floating mode dock (B2)"
```

---

### Task 10: Claves i18n de navegación (es reference + en + pt-BR, parity)

**Files:**
- Modify: `src/i18n/locales/es/common.json`
- Modify: `src/i18n/locales/en/common.json`
- Modify: `src/i18n/locales/pt-BR/common.json`

**Interfaces:**
- El catálogo usa nuevas claves `nav.block_*` y `nav.search_placeholder`. CLAUDE.md #18 exige paridad es/en/pt-BR — un `es` key nuevo sin traducción en `en`/`pt-BR` rompe el gate `lint:i18n`. (Las demás `nav.*` ya existen porque venían del sidebar/carrusel; solo las `block_*` y `search_placeholder` son nuevas.)

- [ ] **Step 1: Verificar qué claves faltan**

Run: `node -e "const es=require('./src/i18n/locales/es/common.json'); ['nav.block_principal','nav.block_operativa','nav.block_riesgos','nav.block_salud','nav.block_cumplimiento','nav.block_emergencias','nav.block_conocimiento','nav.block_ia_coach','nav.block_innovacion','nav.block_administracion','nav.search_placeholder'].forEach(k=>{const p=k.split('.');console.log(k, p.reduce((o,x)=>o&&o[x],es)??'MISSING')})"`
Expected: la mayoría `MISSING`.

- [ ] **Step 2: Añadir las claves en los 3 locales**

En `src/i18n/locales/es/common.json`, bajo el objeto `nav` agregar:

```json
      "block_principal": "Principal",
      "block_operativa": "Gestión Operativa",
      "block_riesgos": "Prevención y Riesgos",
      "block_salud": "Salud Ocupacional",
      "block_cumplimiento": "Cumplimiento",
      "block_emergencias": "Emergencias",
      "block_conocimiento": "Conocimiento",
      "block_ia_coach": "IA y Coach",
      "block_innovacion": "Innovación",
      "block_administracion": "Administración",
      "search_placeholder": "¿Qué necesitas?"
```

En `src/i18n/locales/en/common.json` (mismo objeto `nav`):

```json
      "block_principal": "Main",
      "block_operativa": "Operations",
      "block_riesgos": "Risk Prevention",
      "block_salud": "Occupational Health",
      "block_cumplimiento": "Compliance",
      "block_emergencias": "Emergencies",
      "block_conocimiento": "Knowledge",
      "block_ia_coach": "AI & Coach",
      "block_innovacion": "Innovation",
      "block_administracion": "Administration",
      "search_placeholder": "What do you need?"
```

En `src/i18n/locales/pt-BR/common.json` (mismo objeto `nav`):

```json
      "block_principal": "Principal",
      "block_operativa": "Gestão Operacional",
      "block_riesgos": "Prevenção de Riscos",
      "block_salud": "Saúde Ocupacional",
      "block_cumplimiento": "Conformidade",
      "block_emergencias": "Emergências",
      "block_conocimiento": "Conhecimento",
      "block_ia_coach": "IA e Coach",
      "block_innovacion": "Inovação",
      "block_administracion": "Administração",
      "search_placeholder": "Do que você precisa?"
```

(Respetar la coma/estructura JSON real de cada archivo; añadir las claves dentro del objeto `nav` existente, no en la raíz.)

- [ ] **Step 3: Validar paridad i18n**

Run: `npm run lint:i18n` → Expected: PASS (paridad es/en/pt-BR).
Run: `npx vitest run src/__tests__/scripts/i18nParity.test.ts` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/es/common.json src/i18n/locales/en/common.json src/i18n/locales/pt-BR/common.json
git commit -m "i18n(nav): add nav.block_* + search_placeholder keys (es/en/pt-BR parity)"
```

---

### Task 11: Verificación de fase + green run

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa de navegación**

Run: `npx vitest run src/navigation src/components/layout src/components/shared/Sheet.test.tsx src/components/dashboard` → Expected: PASS.

- [ ] **Step 2: typecheck + lint + gates**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → exit 0.
Run: `npm run lint:connectivity` → PASS.
Run: `npm run lint:i18n` → PASS.

- [ ] **Step 3: Smoke**

Run: `npm run smoke` → Expected: PASS (o el subconjunto que aplique sin servicios externos).

- [ ] **Step 4: Commit de cierre (si quedó algo sin stagear)**

```bash
git add -A
git commit -m "chore(nav): F1 navigation phase verification green" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage (F1, §7):**
- Fuente única de navegación → `navCatalog.ts` (Task 1); sidebar deriva (Task 3); carrusel deriva (Task 8) — cierra la divergencia sidebar↔carrusel. ✓
- 10 bloques colapsables, uno abierto a la vez → el acordeón single-`openGroup` ya existe en `Sidebar.tsx:53-72`; solo cambia la data a 10 bloques (Task 3). ✓
- Buscador "¿qué necesitas?" → `searchNav` (Task 2) + `NavSearch` (Task 5), montado en header (Task 9), con `useTextFits` anti-corte. ✓
- Selector de 4 modos al header → `HeaderModeSwitcher` (Task 6), montado + dock flotante eliminado (Task 9) — resuelve B2 (choque z-index chat/SOS). ✓
- Acciones críticas en Sheet sin route change → `Sheet` (Task 4) + `CriticalActionsSheet` (Task 7): Emergencia=`setMode('emergency')` (no navigate), Fast Check=`FastCheckModal` inline. ✓

**2. Reuso F0:** `cn` (Sheet, NavSearch, HeaderModeSwitcher), `useTextFits` (NavSearch), `Button` (CriticalActionsSheet). No se reimplementa nada de F0. ✓

**3. No se rompe nada cableado:** cada `path` del catálogo proviene del sidebar o del carrusel previos; Task 8 añade test de cobertura (`moduleGroups.ts` ⊆ catálogo) que falla si se pierde una ruta. Gates `canUseExecutiveDashboard` (oro+) e `isAdmin` (B2D) preservados (tests en Task 1/3). Módulos vida-safety verificados explícitamente (test Task 1). ✓

**4. Gates del repo:** connectivity-ratchet regen en el mismo commit que monta los componentes (Task 9 Step 7, CLAUDE.md #21); i18n parity es/en/pt-BR (Task 10, CLAUDE.md #18). El PR-scope gate (#24) no se viola: no se tocan `.well-known`, `firestore.rules`, `.claude/*`, `.env*`, AndroidManifest, ni `*-baseline.json` salvo el connectivity baseline (legítimo y justificado por el título). ✓

**5. Placeholder scan:** sin "TBD"/"etc." — todo paso trae código/comando real. Únicos puntos de lectura-en-sitio: el JSON real de cada locale (Task 10, estructura conocida) y la inserción de ítems del carrusel por bloque (Task 8 Step 1, lista exhaustiva dada). No son placeholders.

**6. Riesgo conocido — no radix-dialog:** el repo solo tiene `@radix-ui/react-tooltip`, así que el `Sheet` se construye sobre `framer-motion` (ya instalado) imitando el prototipo + `Modal.tsx`. Sin focus-trap completo (Escape + overlay-click + botón cerrar sí); si F5 exige focus-trap WCAG estricto, migrar a un primitivo focus-trap entonces. El `searchQuery` legacy en RootLayout puede quedar sin uso tras Task 9 — typecheck lo detecta y se limpia en el mismo paso.

**7. Decisión de scope deliberada:** la duplicación visible del carrusel (`[...moduleGroups, ...moduleGroups]`, B4) y el re-skin visual del shell (F2) y el modo Conducción que navega (B3) NO son F1 — F1 es puramente arquitectura de información + plomería de navegación. Task 8 deja el array duplicado intacto a propósito.
