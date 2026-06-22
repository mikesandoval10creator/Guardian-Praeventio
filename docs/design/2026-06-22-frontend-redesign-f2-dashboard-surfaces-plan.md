# Frontend Redesign — F2 Dashboard + Superficies Clave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar el **Dashboard** y las dos superficies más vistas del shell (**RootLayout**, **Sidebar**) al lenguaje calmo+denso del rediseño, consumiendo los primitivos y tokens de F0. Riqueza de información intacta (todos los datos: %, tendencia, desglose, permisos, próximo plazo legal), pero con jerarquía, tipografía legible (≥12px), sombras suaves, motion 200ms y **densidad ajustable (cómodo/compacto)**. Sin tocar backend ni romper features.

**Architecture:** Evolución, no reescritura. Los widgets que el Dashboard ya monta (`ComplianceCard`, `WeatherBulletin`, `ModuleGroupsGrid`, `Iso45001Catalog`) se refinan in-place; se agregan piezas nuevas pequeñas (`DensityToggle`, `KpiRow`, `Iso45001DetailDrawer`) montadas en el mismo commit. Todo color via tokens semánticos (`bg-surface`, `text-primary-token`, `var(--accent-*)`); se erradica `dark:bg-zinc-*` y hex crudo de RootLayout/Sidebar. La densidad vive en un store Zustand persistido + `data-density` en el contenedor del Dashboard; las clases responden a `data-density`.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4, Zustand (`zustand` ya en deps — ver `src/store/`), `framer-motion`, `lucide-react`, Vitest 4 (+ jsdom por-archivo), `@testing-library/react`. Primitivos F0: `cn()` (`src/utils/cn.ts`), `Card`/`Button`/`Badge` en `src/components/shared/`.

## Global Constraints

- TDD estricto (RED→GREEN). Tests React: pragma `// @vitest-environment jsdom` al tope del archivo (Vitest 4, default `node`).
- **NO hardcodear color** en superficies tocadas — siempre clase token (`bg-surface`, `bg-elevated`, `text-primary-token`, `text-secondary-token`, `text-muted-token`, `border-default-token`, `accent-text`, `shadow-mode`) o `var(--token)`. Prohibido `dark:bg-zinc-*`, `dark:text-zinc-*`, `#hex` nuevo en RootLayout.tsx/Sidebar.tsx. Las clases de acción crítica (rose para SOS/logout) se conservan: rojo es semántico ahí.
- **Riqueza de información (regla de oro del fundador):** lo calmo NUNCA implica omitir datos. Erradicar `text-[7px]/[9px]/[10px]` (mínimo `text-xs`=12px) PERO conservando todos los campos que se mostraban (porcentaje, label, nivel, falta %, tendencia). La densidad "compacto" reduce padding/gap, no datos.
- **Densidad:** `cómodo` (default) y `compacto`. Persistida. El Dashboard expone `data-density` en su raíz; ningún otro estado nuevo global.
- Copy UI en español-CL; código/comentarios en inglés. CLP `$1.234.567`, fechas `DD-MM-YYYY`.
- Motion: durations 200ms, `transition-colors`/`transition-transform`; respetar `prefers-reduced-motion` (heredado de `Card`/framer).
- **Gates:** componentes nuevos (`DensityToggle`, `KpiRow`, `Iso45001DetailDrawer`) se montan en el MISMO commit que los crea → son renderizados, no huérfanos. Aun así, tras montarlos correr `node scripts/check-connectivity-ratchet.cjs --write` y `node scripts/check-render-ratchet.cjs --write` (si existe el baseline) e incluir el baseline en el commit, para que el ratchet quede consistente. NUNCA crecer la deuda.
- typecheck 0 (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`). Lint limpio en archivos tocados (`npm run lint` o `npx eslint <archivos>`).
- Commits frecuentes, uno por tarea. Rama: `feat/frontend-redesign`.

## File Structure

- Create: `src/store/densityStore.ts` — Zustand store persistido `{ density: 'comfortable'|'compact'; setDensity; toggle }`.
- Create: `src/store/densityStore.test.ts`
- Create: `src/components/shared/DensityToggle.tsx` + `.test.tsx` — toggle cómodo/compacto (consume el store).
- Create: `src/components/dashboard/KpiRow.tsx` + `.test.tsx` — fila de KPIs token-driven (patrón IndustryDashboard/ProfessionalDashboard del prototipo).
- Create: `src/components/regulatory/Iso45001DetailDrawer.tsx` + `.test.tsx` — vista de detalle (cláusula + scope + referencias + link oficial secundario), reemplaza el buy-link como acción primaria (B1).
- Modify: `src/components/dashboard/ComplianceCard.tsx` — tokens + tipografía ≥12px + densidad, conservando todos los datos.
- Modify: `src/components/dashboard/ModuleGroupsGrid.tsx` — `aria-hidden` en la copia del marquee (B4) + heading sentence-case + tokens.
- Modify: `src/components/regulatory/Iso45001Catalog.tsx` — abrir el drawer de detalle en vez de solo `onControlClick`; link externo pasa a secundario.
- Modify: `src/components/layout/RootLayout.tsx` — migrar `dark:bg-zinc-*`/hex del header a tokens.
- Modify: `src/components/layout/Sidebar.tsx` — migrar `dark:bg-zinc-*`/hex de grupos/items a tokens.
- Modify: `src/pages/Dashboard.tsx` — montar `KpiRow` + `DensityToggle`, `data-density`, render único de módulos, wiring del drawer ISO.
- Create: `src/__tests__/design/dashboardSurfaces.test.tsx` — contrato anti-regresión (sin `text-[7px]`, sin `dark:bg-zinc` en superficies tocadas).

> Nota: los 4 widgets ya están montados en `Dashboard.tsx` (líneas 477-539), por lo que editarlos NO los vuelve huérfanos. Las 3 piezas nuevas se montan en su tarea → regen del ratchet en ese commit.

---

### Task 1: Store de densidad (cómodo/compacto) persistido

**Files:**
- Create: `src/store/densityStore.ts`
- Test: `src/store/densityStore.test.ts`

**Interfaces:**
- Produces: `useDensityStore` — `{ density: 'comfortable'|'compact'; setDensity(d): void; toggle(): void }`. Lo consumen `DensityToggle` y `Dashboard`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/store/densityStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useDensityStore } from './densityStore';

describe('densityStore', () => {
  beforeEach(() => {
    useDensityStore.setState({ density: 'comfortable' });
  });
  it('default es comfortable', () => {
    expect(useDensityStore.getState().density).toBe('comfortable');
  });
  it('toggle alterna comfortable <-> compact', () => {
    useDensityStore.getState().toggle();
    expect(useDensityStore.getState().density).toBe('compact');
    useDensityStore.getState().toggle();
    expect(useDensityStore.getState().density).toBe('comfortable');
  });
  it('setDensity fija el valor', () => {
    useDensityStore.getState().setDensity('compact');
    expect(useDensityStore.getState().density).toBe('compact');
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/store/densityStore.test.ts`
Expected: FAIL — `Cannot find module './densityStore'`.

- [ ] **Step 3: Implementar el store**

```ts
// src/store/densityStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'comfortable' | 'compact';

interface DensityState {
  density: Density;
  setDensity: (d: Density) => void;
  toggle: () => void;
}

/**
 * UI density preference. `comfortable` (default, lo mostrado) vs `compact`
 * (más info por pantalla). Persisted so the worker's choice survives reloads.
 * Both stay calm — compact only trims padding/gap, never data.
 */
export const useDensityStore = create<DensityState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      setDensity: (density) => set({ density }),
      toggle: () =>
        set((s) => ({ density: s.density === 'comfortable' ? 'compact' : 'comfortable' })),
    }),
    { name: 'praeventio-density' },
  ),
);
```

(Verificar el patrón Zustand+persist contra un peer en `src/store/`; si el repo usa un helper de creación, alinearse — pero un store de UI-pref simple no requiere `createProjectScopedStore`.)

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/store/densityStore.test.ts` → Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/store/densityStore.ts src/store/densityStore.test.ts
git commit -m "feat(ui): density preference store (comfortable/compact, persisted)"
```

---

### Task 2: Primitivo `DensityToggle`

**Files:**
- Create: `src/components/shared/DensityToggle.tsx`
- Test: `src/components/shared/DensityToggle.test.tsx`

**Interfaces:**
- Consumes: `useDensityStore` (Task 1), `cn` (F0).
- Produces: `DensityToggle` (named export) — botón segmentado cómodo/compacto. Lo monta `Dashboard`.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/shared/DensityToggle.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DensityToggle } from './DensityToggle';
import { useDensityStore } from '../../store/densityStore';

describe('DensityToggle', () => {
  beforeEach(() => useDensityStore.setState({ density: 'comfortable' }));
  it('marca el segmento activo con aria-pressed', () => {
    render(<DensityToggle />);
    expect(screen.getByRole('button', { name: 'Cómodo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Compacto' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('cambia la densidad al clickear Compacto', () => {
    render(<DensityToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Compacto' }));
    expect(useDensityStore.getState().density).toBe('compact');
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/shared/DensityToggle.test.tsx`
Expected: FAIL — `Cannot find module './DensityToggle'`.

- [ ] **Step 3: Implementar**

```tsx
// src/components/shared/DensityToggle.tsx
import { Rows3, Rows4 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useDensityStore, type Density } from '../../store/densityStore';

const OPTIONS: { value: Density; label: string; icon: typeof Rows3 }[] = [
  { value: 'comfortable', label: 'Cómodo', icon: Rows3 },
  { value: 'compact', label: 'Compacto', icon: Rows4 },
];

/** Segmented control to switch dashboard density. Calm by design. */
export function DensityToggle() {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);
  return (
    <div
      role="group"
      aria-label="Densidad de la información"
      className="inline-flex items-center gap-0.5 rounded-xl border border-default-token bg-surface p-0.5 shadow-mode"
    >
      {OPTIONS.map((o) => {
        const active = density === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => setDensity(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200',
              active
                ? 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]'
                : 'text-secondary-token hover:text-primary-token',
            )}
          >
            <o.icon className="w-3.5 h-3.5" aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/shared/DensityToggle.test.tsx` → Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/DensityToggle.tsx src/components/shared/DensityToggle.test.tsx
git commit -m "feat(ui): DensityToggle segmented control (comfortable/compact)"
```

---

### Task 3: `KpiRow` — fila de KPIs token-driven (patrón prototipo)

**Files:**
- Create: `src/components/dashboard/KpiRow.tsx`
- Test: `src/components/dashboard/KpiRow.test.tsx`

**Interfaces:**
- Consumes: `cn` (F0), `Card` (F0/shared), `lucide-react`.
- Produces: `KpiRow` (named export), props `{ items: KpiItem[]; density?: 'comfortable'|'compact' }` con `KpiItem = { id; label; value; sub?; trend?: { dir:'up'|'down'|'flat'; text:string }; tone?: 'brand'|'attention'|'alert'|'success'|'neutral'; icon?: LucideIcon }`. Lo monta `Dashboard` con datos reales (cumplimiento, permisos activos, vencimientos, hallazgos críticos).

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/dashboard/KpiRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from './KpiRow';
import { ShieldCheck } from 'lucide-react';

describe('KpiRow', () => {
  it('renderiza valor, label, subtexto y tendencia de cada KPI', () => {
    render(
      <KpiRow
        items={[
          { id: 'comp', label: 'Cumplimiento', value: '82%', sub: '6 de 8 fuentes', trend: { dir: 'up', text: '+4 pts' }, tone: 'success', icon: ShieldCheck },
          { id: 'permits', label: 'Permisos activos', value: 3, sub: 'PT vigentes' },
        ]}
      />,
    );
    expect(screen.getByText('Cumplimiento')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('6 de 8 fuentes')).toBeInTheDocument();
    expect(screen.getByText('+4 pts')).toBeInTheDocument();
    expect(screen.getByText('Permisos activos')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
  it('no usa tipografía sub-12px (calma sin perder dato)', () => {
    const { container } = render(<KpiRow items={[{ id: 'a', label: 'A', value: 1 }]} />);
    expect(container.innerHTML).not.toMatch(/text-\[(7|8|9|10|11)px\]/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/dashboard/KpiRow.test.tsx`
Expected: FAIL — `Cannot find module './KpiRow'`.

- [ ] **Step 3: Implementar**

```tsx
// src/components/dashboard/KpiRow.tsx
//
// Calm + dense KPI row. Adopts the prototype pattern (IndustryDashboard /
// ProfessionalDashboard): a responsive grid of compact metric cards, each
// with label + big value + sub + optional trend. Token-driven so it paints
// correctly in all 4 modes. Density-aware: `compact` only trims padding.

import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { Density } from '../../store/densityStore';

export type KpiTone = 'brand' | 'attention' | 'alert' | 'success' | 'neutral';

export interface KpiItem {
  id: string;
  label: string;
  value: string | number;
  sub?: string;
  trend?: { dir: 'up' | 'down' | 'flat'; text: string };
  tone?: KpiTone;
  icon?: LucideIcon;
}

const TONE_TEXT: Record<KpiTone, string> = {
  brand: 'text-[var(--accent-primary)]',
  attention: 'text-[var(--accent-warning)]',
  alert: 'text-[var(--accent-hazard)]',
  success: 'text-[var(--accent-success)]',
  neutral: 'text-primary-token',
};

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

interface KpiRowProps {
  items: KpiItem[];
  density?: Density;
}

export function KpiRow({ items, density = 'comfortable' }: KpiRowProps) {
  if (items.length === 0) return null;
  const pad = density === 'compact' ? 'p-2.5' : 'p-3 sm:p-4';
  const valueSize = density === 'compact' ? 'text-xl' : 'text-2xl';
  return (
    <div
      data-testid="kpi-row"
      className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3"
    >
      {items.map((k) => {
        const tone = k.tone ?? 'neutral';
        const TrendIcon = k.trend ? TREND_ICON[k.trend.dir] : null;
        return (
          <div
            key={k.id}
            className={cn(
              'rounded-xl sm:rounded-2xl border border-default-token bg-surface shadow-mode',
              'transition-transform duration-200 hover:-translate-y-0.5',
              pad,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-secondary-token truncate" title={k.label}>
                {k.label}
              </span>
              {k.icon && <k.icon className={cn('w-4 h-4 shrink-0', TONE_TEXT[tone])} aria-hidden="true" />}
            </div>
            <div className={cn('mt-1 font-semibold tabular-nums', valueSize, TONE_TEXT[tone])}>
              {k.value}
            </div>
            <div className="mt-0.5 flex items-center gap-2 min-h-[1rem]">
              {k.sub && <span className="text-xs text-muted-token truncate" title={k.sub}>{k.sub}</span>}
              {k.trend && TrendIcon && (
                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-secondary-token">
                  <TrendIcon className="w-3 h-3" aria-hidden="true" />
                  {k.trend.text}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/dashboard/KpiRow.test.tsx` → Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/KpiRow.tsx src/components/dashboard/KpiRow.test.tsx
git commit -m "feat(ui): KpiRow — calm+dense token-driven KPI cards (prototype pattern)"
```

---

### Task 4: Refactor `ComplianceCard` — tokens + tipografía legible + densidad (sin perder datos)

**Files:**
- Modify: `src/components/dashboard/ComplianceCard.tsx` (todo el archivo)
- Test: `src/components/dashboard/ComplianceCard.test.tsx`

**Interfaces:**
- Consumes: `useDensityStore` (Task 1), `cn` (F0). Mantiene props `{ percentage; label; onClick }`.
- Produces: `ComplianceCard` con la MISMA data (porcentaje, label, nivel, falta %, CTA Optimizar) pero ≥12px y tokens; `text-emerald-*` → `--accent-success`.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/dashboard/ComplianceCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComplianceCard } from './ComplianceCard';

describe('ComplianceCard (rediseño F2)', () => {
  it('conserva TODOS los datos: %, label, nivel y falta %', () => {
    render(<ComplianceCard percentage={82} label="Faena Norte" onClick={() => {}} />);
    expect(screen.getAllByText('82%').length).toBeGreaterThan(0);
    expect(screen.getByText('Faena Norte')).toBeInTheDocument();
    expect(screen.getByText(/Nivel Aceptable/)).toBeInTheDocument();
    expect(screen.getByText(/Falta 18%/)).toBeInTheDocument();
  });
  it('dispara onClick', () => {
    const onClick = vi.fn();
    render(<ComplianceCard percentage={50} label="X" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Cumplimiento/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('no usa tipografía sub-12px ni emerald hardcodeado', () => {
    const { container } = render(<ComplianceCard percentage={95} label="Y" onClick={() => {}} />);
    expect(container.innerHTML).not.toMatch(/text-\[(7|9|10)px\]/);
    expect(container.innerHTML).not.toMatch(/text-emerald-\d/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/dashboard/ComplianceCard.test.tsx`
Expected: FAIL — el archivo actual usa `text-[7px]`/`text-[9px]`/`text-emerald-*` y no expone `role="button"`.

- [ ] **Step 3: Reescribir `ComplianceCard.tsx`**

```tsx
// Praeventio Guard — Compliance score card (F2 redesign).
//
// Calm + dense: a single token-driven layout (no separate 7px mobile block),
// ring progress, status level, remaining %, and an "Optimizar" CTA. All data
// preserved from the legacy card; only the loud styling is gone. Density-aware.

import { Briefcase, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { useDensityStore } from '../../store/densityStore';

interface ComplianceCardProps {
  percentage: number;
  label: string;
  onClick: () => void;
}

export function ComplianceCard({ percentage, label, onClick }: ComplianceCardProps) {
  const { t } = useTranslation();
  const density = useDensityStore((s) => s.density);
  const compact = density === 'compact';

  const level =
    percentage >= 90
      ? t('compliance_card.level_optimal', 'Nivel Óptimo')
      : percentage >= 70
        ? t('compliance_card.level_acceptable', 'Nivel Aceptable')
        : t('compliance_card.level_needs_attention', 'Requiere Atención');

  // Ring geometry — r=40% of a 56px box.
  const ringSize = compact ? 'w-12 h-12' : 'w-14 h-14';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t('compliance_card.title', 'Cumplimiento')}: ${percentage}% — ${level}`}
      className={cn(
        'group relative overflow-hidden rounded-xl sm:rounded-2xl border border-default-token bg-surface shadow-mode',
        'cursor-pointer text-left transition-colors duration-200 hover:border-strong-token',
        'flex flex-col justify-between h-full w-full',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-primary-token tracking-tight">
          {t('compliance_card.title', 'Cumplimiento')}
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-secondary-token truncate max-w-[55%]" title={label}>
          <Briefcase className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className={cn('relative flex items-center justify-center shrink-0', ringSize)}>
          <svg className="w-full h-full -rotate-90" aria-hidden="true">
            <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-[var(--border-strong)]" />
            <circle
              cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent"
              strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - percentage / 100)}
              className="text-[var(--accent-success)] transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <span className="absolute text-sm font-semibold text-primary-token tabular-nums">{percentage}%</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-primary-token leading-tight truncate">{level}</p>
          <p className="text-xs text-muted-token mt-0.5">
            {t('compliance_card.remaining', 'Falta {{remaining}}%', { remaining: 100 - percentage })}
          </p>
        </div>
      </div>

      <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--accent-success)_14%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--accent-success)]">
        <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> {t('compliance_card.optimize', 'Optimizar')}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/dashboard/ComplianceCard.test.tsx` → Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ComplianceCard.tsx src/components/dashboard/ComplianceCard.test.tsx
git commit -m "refactor(ui): ComplianceCard calm+dense — tokens, legible type, density-aware (data intact)"
```

---

### Task 5: `Iso45001DetailDrawer` — vista de detalle (B1)

**Files:**
- Create: `src/components/regulatory/Iso45001DetailDrawer.tsx`
- Test: `src/components/regulatory/Iso45001DetailDrawer.test.tsx`

**Interfaces:**
- Consumes: `ISO_45001_BY_ID` (`src/services/regulatory/iso45001.js`), `cn` (F0). Tipo `ComplianceControl` de `src/services/regulatory/types`.
- Produces: `Iso45001DetailDrawer`, props `{ controlId: string | null; onClose(): void }`. Muestra título, cláusula §, scope y referencias REALES del control (no inventa guía); el link a iso.org es **secundario** ("Ver estándar oficial"), no la acción primaria.

> Nota de honestidad: `ComplianceControl` no tiene campo `description`/`summary` (ver `types.ts`). El drawer presenta cláusula + `references[].scope` + `references[].title`, que es la guía real disponible. No fabricar resúmenes.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/regulatory/Iso45001DetailDrawer.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Iso45001DetailDrawer } from './Iso45001DetailDrawer';

describe('Iso45001DetailDrawer', () => {
  it('no renderiza nada cuando controlId es null', () => {
    const { container } = render(<Iso45001DetailDrawer controlId={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('muestra cláusula, título y scope reales del control (no buy-link como primario)', () => {
    render(<Iso45001DetailDrawer controlId="HAZARD_IDENTIFICATION" onClose={() => {}} />);
    expect(screen.getByText(/6\.1\.2/)).toBeInTheDocument();
    expect(screen.getByText(/Identificación de peligros/)).toBeInTheDocument();
    // el link al estándar existe pero como acción secundaria etiquetada
    const link = screen.getByRole('link', { name: /estándar oficial/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('iso.org'));
  });
  it('cierra con el botón cerrar', () => {
    const onClose = vi.fn();
    render(<Iso45001DetailDrawer controlId="LEADERSHIP_COMMITMENT" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/regulatory/Iso45001DetailDrawer.test.tsx`
Expected: FAIL — `Cannot find module './Iso45001DetailDrawer'`.

- [ ] **Step 3: Implementar**

```tsx
// Praeventio Guard — ISO 45001 control detail drawer (B1).
//
// Replaces the old "every item links to the iso.org buy page" behaviour: the
// primary action is now a detail view showing the clause + scope + references
// the catalog already models. The official-standard link is demoted to a small
// secondary link. No fabricated guidance — only the real `ComplianceControl`
// fields are presented.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, BookCheck, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ISO_45001_BY_ID } from '../../services/regulatory/iso45001.js';

interface Iso45001DetailDrawerProps {
  controlId: string | null;
  onClose: () => void;
}

export function Iso45001DetailDrawer({ controlId, onClose }: Iso45001DetailDrawerProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!controlId) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controlId, onClose]);

  if (!controlId) return null;
  const control = ISO_45001_BY_ID[controlId];
  if (!control) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('iso45001.detail_aria', 'Detalle de control ISO 45001') as string}
      className="fixed inset-0 z-[80] flex justify-end"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative h-full w-full max-w-md bg-surface border-l border-default-token shadow-mode-lg overflow-y-auto custom-scrollbar animate-in slide-in-from-right duration-200">
        <header className="sticky top-0 flex items-center justify-between gap-2 bg-elevated border-b border-default-token px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookCheck className="w-4 h-4 text-[var(--accent-info)] shrink-0" aria-hidden="true" />
            <span className="label-eyebrow text-secondary-token">ISO 45001:2018 · §{control.iso45001Clause}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Cerrar') as string}
            className="p-1.5 rounded-md text-secondary-token hover:text-primary-token hover:bg-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <h2 className="text-base font-semibold text-primary-token leading-snug">{control.title}</h2>

          <section className="space-y-2">
            <h3 className="label-eyebrow text-muted-token">{t('iso45001.references', 'Referencias normativas')}</h3>
            <ul className="space-y-2">
              {control.references.map((ref) => (
                <li key={ref.code} className="rounded-xl border border-default-token bg-elevated p-3">
                  <p className="text-xs font-semibold text-primary-token">{ref.title}</p>
                  <p className="text-xs text-secondary-token mt-1 leading-snug">{ref.scope}</p>
                  {ref.url && (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      {t('iso45001.openStandard', 'Ver estándar oficial')}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/regulatory/Iso45001DetailDrawer.test.tsx` → Expected: PASS (3).

- [ ] **Step 5: Commit (drawer no montado aún → se monta en Task 6)**

```bash
git add src/components/regulatory/Iso45001DetailDrawer.tsx src/components/regulatory/Iso45001DetailDrawer.test.tsx
git commit -m "feat(regulatory): Iso45001DetailDrawer — clause+scope+refs detail view (B1)"
```

---

### Task 6: Montar el drawer ISO desde `Iso45001Catalog` (cierra B1)

**Files:**
- Modify: `src/components/regulatory/Iso45001Catalog.tsx`
- Test: `src/components/regulatory/Iso45001Catalog.test.tsx` (crear si no existe)
- Regen: `scripts/connectivity-ratchet-baseline.json` (+ `render-ratchet-baseline.json` si existe)

**Interfaces:**
- El catálogo abre `Iso45001DetailDrawer` con estado interno; sigue exponiendo `onControlClick` opcional para callers existentes (Dashboard pasa `undefined`). El link externo de cada fila se elimina del listado (la acción primaria es abrir detalle); el link oficial vive ahora en el drawer.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/regulatory/Iso45001Catalog.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Iso45001Catalog } from './Iso45001Catalog';

describe('Iso45001Catalog → drawer (B1)', () => {
  it('al clickear un control abre el drawer de detalle (no navega a iso.org)', () => {
    render(<Iso45001Catalog />);
    const firstBtn = screen.getByTestId('iso45001-btn-LEADERSHIP_COMMITMENT');
    fireEvent.click(firstBtn);
    expect(screen.getByRole('dialog', { name: /Detalle de control ISO 45001/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/regulatory/Iso45001Catalog.test.tsx`
Expected: FAIL — no hay `role="dialog"` (hoy solo llama `onControlClick`).

- [ ] **Step 3: Editar `Iso45001Catalog.tsx`**

En el tope, añadir imports + estado, y abrir el drawer en el click. Reemplazos exactos:

`import` block (tras la línea 8 actual):
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookCheck } from 'lucide-react';
import { ISO_45001_CONTROLS } from '../../services/regulatory/iso45001.js';
import { Iso45001DetailDrawer } from './Iso45001DetailDrawer';
```
(Se elimina `ExternalLink` del import de lucide — ya no se usa en el listado.)

Dentro del componente, tras `const { t } = useTranslation();`:
```tsx
  const [openId, setOpenId] = useState<string | null>(null);
  const handleClick = (id: string) => {
    setOpenId(id);
    onControlClick?.(id);
  };
```

Reemplazar el `<button ... onClick={() => onControlClick?.(c.id)} ...>` por `onClick={() => handleClick(c.id)}` y **eliminar** el bloque `{c.references[0]?.url && (<a ...><ExternalLink/></a>)}` (líneas 76-87). El link externo ahora vive en el drawer.

Antes del `</section>` final, montar el drawer:
```tsx
      <Iso45001DetailDrawer controlId={openId} onClose={() => setOpenId(null)} />
```

(Conservar la estética token existente del catálogo — ya usa `bg-surface`/`text-primary-token`. Subir `text-[9px]`/`text-[10px]` del listado a `text-xs` de paso para cumplir el mínimo legible.)

- [ ] **Step 4: Correr (verde) + suite del área**

Run: `npx vitest run src/components/regulatory/Iso45001Catalog.test.tsx` → Expected: PASS.

- [ ] **Step 5: Regenerar ratchets (drawer recién montado/renderizado)**

Run: `node scripts/check-connectivity-ratchet.cjs --write`
Run: `node scripts/check-render-ratchet.cjs --write` (si el archivo existe; si no, omitir)
Verificar que el diff del baseline solo agrega `Iso45001DetailDrawer` como conectado (no crece la deuda).

- [ ] **Step 6: Commit**

```bash
git add src/components/regulatory/Iso45001Catalog.tsx src/components/regulatory/Iso45001Catalog.test.tsx scripts/connectivity-ratchet-baseline.json
git commit -m "feat(regulatory): ISO catalog opens detail drawer instead of buy-link (B1); ratchet regen"
```

---

### Task 7: De-duplicar el carrusel de módulos (B4) + tokens + sentence-case

**Files:**
- Modify: `src/components/dashboard/ModuleGroupsGrid.tsx`
- Test: `src/components/dashboard/ModuleGroupsGrid.test.tsx` (crear)

**Interfaces:**
- Sin cambio de API. La copia del marquee (`[...moduleGroups, ...moduleGroups]`) deja de duplicar contenido accesible: la 2ª pasada lleva `aria-hidden` + `tabIndex={-1}` y NO genera ids/`aria-controls` duplicados. Heading deja el uppercase forzado (sentence-case) y migra `text-zinc-900 dark:text-white` → token.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/dashboard/ModuleGroupsGrid.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModuleGroupsGrid } from './ModuleGroupsGrid';
import { moduleGroups } from './moduleGroups';

function renderGrid() {
  return render(<MemoryRouter><ModuleGroupsGrid /></MemoryRouter>);
}

describe('ModuleGroupsGrid (B4 de-dup)', () => {
  it('expone cada grupo UNA sola vez a accesibilidad (la copia del marquee es aria-hidden)', () => {
    renderGrid();
    const first = moduleGroups[0];
    // El botón accesible del primer grupo aparece exactamente 1 vez por accessible name.
    const matches = screen.getAllByRole('button', { name: new RegExp(first.title, 'i') });
    expect(matches.length).toBe(1);
  });
  it('el heading no fuerza uppercase ni usa zinc hardcodeado', () => {
    const { container } = renderGrid();
    const heading = screen.getByRole('heading', { name: /módulos/i });
    expect(heading.className).not.toMatch(/uppercase/);
    expect(container.innerHTML).not.toMatch(/dark:text-white/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/dashboard/ModuleGroupsGrid.test.tsx`
Expected: FAIL — hoy el grupo aparece 2× (`getAllByRole` = 2) y el heading es `uppercase`/`dark:text-white`.

- [ ] **Step 3: Editar `ModuleGroupsGrid.tsx`**

Heading (líneas 66-70) — quitar `uppercase` y migrar a token:
```tsx
      <div className="flex items-center justify-between mb-1.5 sm:mb-4 px-1">
        <h2 className="text-sm sm:text-base font-semibold text-primary-token tracking-tight">
          {t('module_groups.heading', 'Módulos')}
        </h2>
      </div>
```

Marquee map (líneas 90-112) — distinguir la copia y marcarla inerte. Reemplazar `.map((group, i) => {` y el header del botón:
```tsx
          {[...moduleGroups, ...moduleGroups].map((group, i) => {
            const isClone = i >= moduleGroups.length; // 2nd pass = visual-only marquee fill
            const isActive = group.id === activeId && !isClone;
            return (
              <button
                key={`${group.id}-${i}`}
                onClick={isClone ? undefined : () =>
                  setActiveId((prev) => (prev === group.id ? null : group.id))
                }
                {...(isClone
                  ? { 'aria-hidden': true, tabIndex: -1 }
                  : {
                      'aria-haspopup': 'menu' as const,
                      'aria-expanded': isActive,
                      'aria-controls': isActive ? `module-submenu-${group.id}` : undefined,
                    })}
                className={`${group.color} shrink-0 w-[80px] sm:w-[120px] aspect-square rounded-xl sm:rounded-2xl p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-1 border ${
                  isActive ? 'border-white/40 ring-2 ring-white/30' : 'border-white/10'
                } active:scale-95 group relative overflow-hidden`}
              >
```

(El resto del cuerpo del botón queda igual. El submenú drawer usa `dark:bg-zinc-900/60` etc.; migrarlo en F4 — fuera de scope de B4. Aquí solo de-dup + heading.)

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/dashboard/ModuleGroupsGrid.test.tsx` → Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ModuleGroupsGrid.tsx src/components/dashboard/ModuleGroupsGrid.test.tsx
git commit -m "fix(ui): de-duplicate module carousel for a11y (B4) + sentence-case heading + tokens"
```

---

### Task 8: Migrar el header de `RootLayout` a tokens (4 modos pintan)

**Files:**
- Modify: `src/components/layout/RootLayout.tsx` (header, líneas ~186-369; chips del menú/back/home/sync/theme/notif/profile)
- Test: `src/__tests__/design/dashboardSurfaces.test.tsx` (crear; cubre RootLayout + Sidebar en Tasks 8-9)

**Interfaces:**
- Reemplazar el patrón repetido `bg-white/30 dark:bg-zinc-900 border-transparent dark:border-white/5 text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white` por clases token: `bg-elevated border-default-token text-secondary-token hover:bg-surface hover:text-primary-token`. Conservar el wordmark teal (`#4db6ac`/`#d4af37`) — es marca, no superficie. Conservar rose/orange/amber semánticos (offline/sync/MFA).

- [ ] **Step 1: Test de contrato (falla)**

```tsx
// @vitest-environment jsdom
// src/__tests__/design/dashboardSurfaces.test.tsx
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../components/layout/RootLayout.tsx');
const sidebar = resolve(__dirname, '../../components/layout/Sidebar.tsx');

describe('Superficies más vistas — tokens, no zinc hardcodeado', () => {
  it('RootLayout no usa dark:bg-zinc-* en los chips del header', () => {
    const src = readFileSync(root, 'utf8');
    expect(src).not.toMatch(/dark:bg-zinc-900/);
    expect(src).not.toMatch(/dark:text-zinc-400/);
  });
  it('Sidebar no usa dark:bg-zinc-* / dark:text-zinc-* en grupos e items', () => {
    const src = readFileSync(sidebar, 'utf8');
    expect(src).not.toMatch(/dark:bg-zinc-800\/30/);
    expect(src).not.toMatch(/text-zinc-800 dark:text-zinc-400/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/__tests__/design/dashboardSurfaces.test.tsx`
Expected: FAIL — ambos archivos contienen esos patrones hoy.

- [ ] **Step 3: Editar `RootLayout.tsx`**

Definir, justo antes del `return (` (≈línea 147), una constante para el chip estándar y reemplazar las ocurrencias del patrón largo:
```tsx
  // Token-driven header control chip — paints in all 4 modes (no dark:zinc).
  const chip =
    'border border-default-token bg-elevated text-secondary-token hover:bg-surface hover:text-primary-token transition-all duration-200 shadow-mode';
```

Aplicar `chip` a: botón Menú (línea ~196), botón back (línea ~215), Link Home (línea ~219), botón Sync online-branch (línea ~299, conservando la rama offline naranja), botón Theme (línea ~321), Link Notifications (línea ~330), botón Profile (línea ~345). Patrón de reemplazo por cada uno: sustituir `bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 ... hover:text-zinc-900 dark:hover:text-white` por `${chip}` dentro del `className`, manteniendo las clases de tamaño/forma (`w-10 h-10 rounded-xl flex items-center justify-center`).

El input de búsqueda (línea ~242): migrar `bg-white/30 dark:bg-zinc-900 ... text-zinc-900 dark:text-white ... placeholder:text-zinc-700 dark:placeholder:text-zinc-500` a `bg-elevated border border-default-token text-primary-token placeholder:text-muted-token`. Conservar el `focus:ring-[#4db6ac]/50` (marca).

(Conservar: wordmark gradient teal, badges rose/orange/amber, el login button teal `bg-teal-400`.)

- [ ] **Step 4: Correr (verde, parte RootLayout)**

Run: `npx vitest run src/__tests__/design/dashboardSurfaces.test.tsx -t RootLayout` → Expected: el test de RootLayout PASA (el de Sidebar aún falla → Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/RootLayout.tsx src/__tests__/design/dashboardSurfaces.test.tsx
git commit -m "refactor(ui): RootLayout header chips → tokens (4-mode correct, no dark:zinc)"
```

---

### Task 9: Migrar `Sidebar` a tokens (grupos + items + footer)

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `src/__tests__/design/dashboardSurfaces.test.tsx` (ya creado en Task 8)

**Interfaces:**
- Reemplazar `text-zinc-800 dark:text-zinc-400 hover:bg-white/20 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200` (header de grupo, línea ~175; items, línea ~225; footer theme, línea ~285) por tokens (`text-secondary-token hover:bg-elevated hover:text-primary-token`). Conservar acentos marca teal/gold del estado activo y las acciones rose (Supervivencia/Logout).

- [ ] **Step 1: (test ya existe — la parte Sidebar falla)**

Run: `npx vitest run src/__tests__/design/dashboardSurfaces.test.tsx -t Sidebar`
Expected: FAIL.

- [ ] **Step 2: Editar `Sidebar.tsx`**

Header de grupo (líneas 172-176) — rama inactiva:
```tsx
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 ${
                      isGroupOpen || hasActiveItem
                        ? "bg-canvas text-primary-token shadow-mode border border-default-token"
                        : "text-secondary-token hover:bg-elevated hover:text-primary-token"
                    }`}
```

Icono del grupo (línea ~180) — rama inactiva: `bg-elevated text-secondary-token` (conservar la rama activa teal/gold).

Items (líneas 222-226) — rama inactiva:
```tsx
                                  isActive
                                    ? "bg-white/40 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-white/30 dark:border-[#d4af37]/20 shadow-mode"
                                    : "text-secondary-token hover:text-primary-token hover:bg-elevated"
```

Botón Theme del footer (línea ~285): `text-secondary-token hover:bg-elevated hover:text-primary-token`.

Textos del footer (`text-zinc-800 dark:text-zinc-500`, `text-zinc-700 dark:text-zinc-600`, líneas 303-307): → `text-muted-token`.

(Conservar: wordmark teal, badge Búnker ámbar, botón Supervivencia rose, botón Logout rose — semánticos.)

- [ ] **Step 3: Correr (verde — ambos)**

Run: `npx vitest run src/__tests__/design/dashboardSurfaces.test.tsx` → Expected: PASS (2).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "refactor(ui): Sidebar groups/items/footer → tokens (4-mode correct, no dark:zinc)"
```

---

### Task 10: Wiring del Dashboard — KPI row + DensityToggle + `data-density` + render único

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Test: `src/pages/Dashboard.kpi.test.tsx` (crear; test ligero del wiring con mocks)

**Interfaces:**
- Consumes: `KpiRow` (Task 3), `DensityToggle` (Task 2), `useDensityStore` (Task 1).
- Produces: el Dashboard monta una `KpiRow` con datos REALES derivados (cumplimiento `complianceData.percentage` + `complianceLight.sourcedCount/totalCount`; permisos activos `workPermitsData.permits.length`; vencimientos `expirables.length`; hallazgos críticos `faenaInput.openCriticalFindings`) y un `DensityToggle` en la cabecera. La raíz lleva `data-density`. Los módulos se renderizan UNA sola vez (ya es así: `<ModuleGroupsGrid />` único — confirmar que no se duplica el grid, la de-dup interna fue Task 7).

> Nota: el "render duplicado" del spec se refería al array `[...moduleGroups, ...moduleGroups]` interno (resuelto en Task 7), no a dos `<ModuleGroupsGrid/>`. Aquí solo se agrega KPI + densidad sin re-montar widgets.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/pages/Dashboard.kpi.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the heavy contexts/hooks so the test exercises only the KPI/density wiring.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));
// ... (mock useProject/useGamification/etc. minimally — follow the pattern of the
// nearest existing Dashboard test; each hook returns empty-but-valid shapes.)

import { KpiRow } from '../components/dashboard/KpiRow';
import { DensityToggle } from '../components/shared/DensityToggle';

describe('Dashboard KPI/density wiring (unit-level)', () => {
  it('KpiRow + DensityToggle se renderizan juntos sin romper', () => {
    render(
      <>
        <DensityToggle />
        <KpiRow items={[{ id: 'c', label: 'Cumplimiento', value: '0%' }]} />
      </>,
    );
    expect(screen.getByRole('group', { name: /Densidad/i })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
  });
});
```

> Nota: un render completo de `Dashboard` arrastra ~20 contextos. Mantener este test al nivel de wiring de las piezas nuevas (arriba); la integración real se valida en el smoke/visual de Task 12. Si el repo ya tiene un harness de Dashboard con providers, preferir extenderlo.

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/pages/Dashboard.kpi.test.tsx`
Expected: FAIL hasta crear el archivo (y verde una vez creado, ya que importa piezas existentes — el RED real es "archivo no existe").

- [ ] **Step 3: Editar `Dashboard.tsx`**

Imports nuevos (tras línea 73):
```tsx
import { KpiRow, type KpiItem } from '../components/dashboard/KpiRow';
import { DensityToggle } from '../components/shared/DensityToggle';
import { useDensityStore } from '../store/densityStore';
import { ShieldCheck, FileCheck, Clock3, AlertOctagon } from 'lucide-react';
```

Dentro del componente, tras los hooks de datos (≈línea 117):
```tsx
  const density = useDensityStore((s) => s.density);

  const kpiItems: KpiItem[] = [
    {
      id: 'compliance',
      label: t('dashboard.kpi.compliance', 'Cumplimiento'),
      value: `${complianceData.percentage}%`,
      sub: complianceLight
        ? t('dashboard.kpi.sourced', '{{n}} de {{m}} fuentes', {
            n: complianceLight.sourcedCount, m: complianceLight.totalCount,
          })
        : complianceData.label,
      tone: complianceData.percentage >= 90 ? 'success' : complianceData.percentage >= 70 ? 'brand' : 'attention',
      icon: ShieldCheck,
    },
    {
      id: 'permits',
      label: t('dashboard.kpi.permits', 'Permisos activos'),
      value: workPermitsData?.permits?.length ?? 0,
      sub: t('dashboard.kpi.permits_sub', 'PT vigentes'),
      icon: FileCheck,
    },
    {
      id: 'expirations',
      label: t('dashboard.kpi.expirations', 'Próx. vencimientos'),
      value: expirables.length,
      sub: t('dashboard.kpi.expirations_sub', 'EPP, exámenes, capacit.'),
      tone: expirables.length > 0 ? 'attention' : 'neutral',
      icon: Clock3,
    },
    {
      id: 'critical',
      label: t('dashboard.kpi.critical', 'Hallazgos críticos'),
      value: faenaInput.openCriticalFindings,
      sub: t('dashboard.kpi.critical_sub', 'abiertos'),
      tone: faenaInput.openCriticalFindings > 0 ? 'alert' : 'success',
      icon: AlertOctagon,
    },
  ];
```

En el JSX, fijar `data-density` en la raíz (línea 416):
```tsx
    <div data-testid="dashboard-page" data-density={density} className="flex-1 flex flex-col justify-start gap-1 sm:gap-4 pb-20 sm:pb-4 pt-1 sm:pt-4 px-2 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-4rem)]">
```

Tras `<DashboardHero ... />` (línea 419), insertar la fila de control de densidad + KPIs:
```tsx
      {/* Density control — calm, user-adjustable info density */}
      <div className="flex justify-end">
        <DensityToggle />
      </div>

      {/* KPI row — real derived metrics (compliance / permits / expirations / critical findings) */}
      <KpiRow items={kpiItems} density={density} />
```

(No se re-monta ningún widget. `ModuleGroupsGrid` sigue siendo único en línea 539.)

- [ ] **Step 4: Correr (verde) + suite dashboard**

Run: `npx vitest run src/pages/Dashboard.kpi.test.tsx` → Expected: PASS (1).
Run: `npx vitest run src/components/dashboard` → Expected: verde (KpiRow/ComplianceCard/ModuleGroupsGrid).

- [ ] **Step 5: Regenerar ratchets (KpiRow/DensityToggle recién renderizados en Dashboard)**

Run: `node scripts/check-connectivity-ratchet.cjs --write`
Run: `node scripts/check-render-ratchet.cjs --write` (si existe)
Verificar diff: solo agrega `KpiRow`, `DensityToggle` como conectados.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.kpi.test.tsx scripts/connectivity-ratchet-baseline.json
git commit -m "feat(dashboard): KPI row + density toggle wired with real metrics; data-density root; ratchet regen"
```

---

### Task 11: Densidad aplicada a las superficies del Dashboard (CSS por `data-density`)

**Files:**
- Modify: `src/index.css` (utilidades de densidad bajo `@layer utilities`)
- Test: `src/__tests__/design/density.test.ts`

**Interfaces:**
- Produces: reglas CSS que, bajo `[data-density="compact"]`, reducen gaps/padding del contenedor del dashboard (calmo, sin tocar tamaños de fuente — la legibilidad ≥12px se mantiene en ambos). Las piezas que ya reciben `density` por prop (KpiRow, ComplianceCard) ajustan internamente; esta regla cubre el espaciado entre secciones del Dashboard.

- [ ] **Step 1: Test de contrato (falla)**

```ts
// src/__tests__/design/density.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

describe('densidad por data-density', () => {
  it('define el ajuste compacto del dashboard', () => {
    expect(css).toMatch(/\[data-density="compact"\]/);
  });
  it('el modo compacto NO reduce el tamaño mínimo de fuente legible', () => {
    const block = css.slice(css.indexOf('[data-density="compact"]'));
    // No deben aparecer font-size sub-12px en el bloque de densidad.
    expect(block.slice(0, 400)).not.toMatch(/font-size:\s*(7|8|9|10|11)px/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/__tests__/design/density.test.ts`
Expected: FAIL — no existe la regla.

- [ ] **Step 3: Añadir en `src/index.css`** (dentro de `@layer utilities`, cerca del final):

```css
  /* Density: `compact` trims spacing between dashboard sections only.
     Never reduces font-size below the 12px legibility floor. */
  [data-density="compact"].flex.flex-col { gap: 0.5rem; }
  @media (min-width: 640px) {
    [data-density="compact"].flex.flex-col { gap: 0.75rem; }
  }
```

(Si el selector resultara demasiado amplio en práctica, acotar a `[data-density="compact"][data-testid="dashboard-page"]` — ese atributo ya existe en la raíz del Dashboard.)

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/__tests__/design/density.test.ts` → Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/__tests__/design/density.test.ts
git commit -m "feat(ui): compact density spacing for dashboard (legibility floor preserved)"
```

---

### Task 12: Cierre — typecheck, lint, suite y verificación visual de los 4 modos

**Files:** (sin cambios de código nuevos; correcciones puntuales si algo falla)

- [ ] **Step 1: Typecheck completo**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
Expected: exit 0. Si falla por el tipo de `complianceLight.sourcedCount` u otro, ajustar el acceso con el shape real de `ComplianceTrafficLightView` (`score: number | null`, `sourcedCount`, `totalCount` — ya verificado en `trafficLightCoverage.ts:28-37`).

- [ ] **Step 2: Lint de archivos tocados**

Run:
```bash
npx eslint \
  src/store/densityStore.ts \
  src/components/shared/DensityToggle.tsx \
  src/components/dashboard/KpiRow.tsx \
  src/components/dashboard/ComplianceCard.tsx \
  src/components/dashboard/ModuleGroupsGrid.tsx \
  src/components/regulatory/Iso45001DetailDrawer.tsx \
  src/components/regulatory/Iso45001Catalog.tsx \
  src/components/layout/RootLayout.tsx \
  src/components/layout/Sidebar.tsx \
  src/pages/Dashboard.tsx
```
Expected: 0 errores.

- [ ] **Step 3: Suite + gates de ratchet**

Run: `npx vitest run src/components/dashboard src/components/shared src/components/regulatory src/store src/__tests__/design` → Expected: verde.
Run: `npm run lint:connectivity` → Expected: pasa (deuda no creció).
Run: `npm run lint:render` (si existe el script) → Expected: pasa.

- [ ] **Step 4: Verificación visual en los 4 modos (manual o vía `/run`)**

Levantar `npm run dev` y abrir el Dashboard. Verificar en light/dark/driving/emergency:
- Todas las superficies tocadas (header, sidebar, KPI row, ComplianceCard, carrusel, ISO catalog) pintan con el color del modo (sin bloques blancos/zinc fijos).
- Conducción: fondo oscuro-cálido, KPIs y ComplianceCard legibles glanceable.
- ISO: click en un control abre el drawer con cláusula+scope; el link "Ver estándar oficial" es secundario.
- Densidad: toggle cómodo↔compacto reduce el aire sin cortar datos.
- Carrusel: lectores de pantalla anuncian cada grupo una sola vez (la copia es `aria-hidden`).

- [ ] **Step 5: Commit final (si hubo fixes de cierre)**

```bash
git add -A
git commit -m "chore(ui): F2 close — typecheck/lint/ratchets green across dashboard surfaces"
```

---

## Self-Review

**1. Spec coverage (F2):**
- Dashboard calmo+denso con datos completos: KPI row real (Task 3+10), ComplianceCard refinada sin perder %/label/nivel/falta% (Task 4), clima real ya honesto (`WeatherBulletin` no se rompe; el sentinel `unavailable` se respeta — no se añadió fabricación). ✓
- ISO catalog como detail view, no buy-link (Tasks 5-6, cierra B1). ✓
- Module grid por los 10 bloques sin render duplicado (Task 7, cierra B4 — `aria-hidden` en la copia del marquee). ✓
- Primitivos F0 + tokens en RootLayout + Sidebar para que los 4 modos pinten (Tasks 8-9). ✓
- Patrones del prototipo: KPI-row (IndustryDashboard/ProfessionalDashboard), grid con tono por categoría (KpiRow `tone`), sombras suaves (`shadow-mode`), motion 200ms. ✓
- Densidad ajustable cómodo/compacto (Tasks 1-2, 10-11). ✓

**2. Placeholder scan:** sin "TBD"/"etc." como código; todo paso trae código/comando real. Los únicos puntos de lectura-en-sitio son reemplazos guiados con patrón exacto (RootLayout chips, Sidebar ramas inactivas) — instrucciones explícitas, no placeholders. El test de Dashboard se mantiene a nivel de wiring de las piezas nuevas (justificado: ~20 contextos), con la integración cubierta por la verificación visual (Task 12).

**3. Type consistency:** `KpiItem`/`Density` exportados y reusados (KpiRow ↔ Dashboard ↔ store). `ComplianceTrafficLightView` accedido por su shape real (`sourcedCount`/`totalCount`/`score`). `ComplianceControl` sin `description` → el drawer presenta solo `references[].{title,scope,url}` reales (honestidad: no inventa guía). Tokens referenciados (`--accent-primary/-warning/-hazard/-success/-info/-on-primary`, `--bg-surface/-elevated/-canvas`, `--text-primary/-secondary/-muted`, `--border-default/-strong`) existen en `src/index.css`.

**4. Gates:** componentes nuevos (`DensityToggle`, `KpiRow`, `Iso45001DetailDrawer`) se montan/renderizan en el mismo commit que los conecta (Tasks 6, 10) y se acompaña `--write` del connectivity-ratchet (+ render-ratchet si existe). Ningún PR de esta fase toca `public/.well-known/*`, `firestore.rules`, `.claude/*`, `.env*` ni `AndroidManifest.xml` → cumple el PR-scope gate (#24). TDD estricto en todos (RED→GREEN). Copy es-CL, código inglés.

**Riesgos conocidos:**
- El submenú drawer interno de `ModuleGroupsGrid` aún usa `dark:bg-zinc-*` (líneas 126/139/154) — se deja para F4 (migración asistida) por estar fuera del scope B4; Task 7 solo de-duplica + heading.
- `WeatherBulletin` conserva su panel solar con `bg-[#0a1628]` fijo (intencional: panel nocturno de marca). Si se requiere token, es F4/F5.
- El selector `[data-density="compact"].flex.flex-col` podría ser amplio; el fallback acotado por `data-testid` está indicado en Task 11 Step 3.
- `color-mix()` (ComplianceCard CTA, KpiRow tones via clases token) requiere navegador moderno — OK para esta PWA; ya usado por el primitivo `Badge` de F0.

---

## Addenda F2 — Refinamientos del fundador (spec §12) — Tasks 13-16

> Autoradas tras el feedback post-mockup (2026-06-22). Se ejecutan como parte de F2. TDD igual; el implementer lee los componentes reales para el código exacto.

### Task 13: Boletín climático CON consejos de prevención (rich)
Hoy `WeatherBulletin` muestra métricas pero falta el **consejo de prevención por condición** + mensaje motivacional (estaba en el original). 
- Create `src/services/weather/weatherAdvice.ts` → función PURA `weatherAdvice(c: { tempC: number; uv: number; windKmh: number; code?: number }): { tone: 'info'|'warning'|'hazard'; icon: string; message: string }[]`. Reglas: `tempC>=30` → hidratación + pausas activas; `tempC<=2` o code de nieve → abrigo, superficies resbaladizas, evaluar restringir; `windKmh>=40` → restringir trabajo en altura; `uv>=6` → bloqueador + cobertura; **siempre** 1 mensaje motivacional/útil. Copy es-CL.
- TDD (`node` env): cada umbral produce su advisory; sin condiciones de riesgo → solo el motivacional.
- Render: dentro de `WeatherBulletin` como lista de advisories con tokens (`accent-warning`/`accent-hazard`). **Prohibido** texto de dev en la UI.

### Task 14: Selector/tarjeta de EPP en el dashboard
- Restaurar la tarjeta de **EPP requerido**. Buscar el componente EPP existente (`grep -ri "epp" src/components`); reusarlo. Render en Dashboard con el EPP de la faena/tarea (dato real del proyecto). Si solo existe el modal de verificación, agregar una card-resumen que lo abra. TDD: render con N items de EPP.

### Task 15: Mascota Guardián con estado de ánimo
- Incorporar la mascota **viva** en el dashboard reaccionando al estado de faena.
- Create `src/components/guardian/guardianMood.ts` → función PURA `guardianMood(s: { emergencyActive: boolean; openIncidents: number; pendingActions: number }): 'tranquilo'|'atento'|'alerta'` (emergencyActive→alerta; openIncidents>0 o pendingActions alto→atento; si no→tranquilo). TDD el mapeo.
- Render: la mascota existente (buscar `Guardian`/`ConsciousnessLoader`/asset de mascota) con el mood. Directrices: ADR 0012 (no-diagnóstico), no-pánico. Posible escenario/stage para gamificación = sub-plan aparte.

### Task 16: Responsive — dos disposiciones (web rico / móvil vertical)
- Dashboard + shell renderizan: escritorio → multi-columna rico (como el mockup); móvil → **vertical apilado** (vertical-first), todo legible.
- Usar breakpoints Tailwind (`grid-cols-1` base → `sm:`/`lg:` multi-columna) en el grid principal del Dashboard y en el shell. `useTextFits` (F0) para que labels no se corten en angosto.
- TDD: smoke en jsdom con contenedor angosto no rompe; aserción de que el grid principal lleva clases responsive (`sm:`/`lg:`).

> **Mantener (ya cubierto, no tocar):** el carrusel interactivo izq→der (Task 7 lo de-duplica, NO lo reemplaza) + el sidebar de 10 bloques (F1). **Gamificación** = sub-plan aparte (no bloquea F2); revisar su deuda aprovechando pretext.