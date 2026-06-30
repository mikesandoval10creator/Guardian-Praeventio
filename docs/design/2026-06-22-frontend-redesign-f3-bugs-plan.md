# Frontend Redesign — F3 Bugs (B1–B7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 7 bugs de UX del spec §9 (B1–B7) como parte del paquete del rediseño — sin tocar backend, sin romper features, evolucionando los archivos reales. Cada fix es calmado en estilo pero RICO en información (directiva del fundador: nunca omitir datos; progressive disclosure).

**Architecture:** Evolución, no reescritura. Reutilizamos los primitivos F0 (`Button`, `Badge` en `src/components/shared/`, `cn()` en `src/utils/cn.ts`) y el `Modal` existente (`src/components/shared/Modal.tsx`, token-aware + `AnimatePresence`). El modelo de datos ISO ya existe (`src/services/regulatory/iso45001.ts`, 10 controles). El theming canónico ya vive en `AppModeContext` (`.dark`/`.driving`/`.emergency` sobre `<html>`); `ThemeContext` es legacy y duplica la escritura de `.dark`.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4, React Router 7, framer-motion, Vitest 4 (+ jsdom por-archivo con `// @vitest-environment jsdom`), `@testing-library/react`, Express (CSP middleware server-side).

## Global Constraints

- TDD estricto (RED→GREEN). Tests de componente: pragma `// @vitest-environment jsdom` al tope (Vitest 4, default `node`).
- Copy UI en español-CL; código/comentarios/commits en inglés.
- NO hardcodear color — usar tokens semánticos (`bg-surface`, `text-primary-token`, `var(--accent-*)`) o los primitivos F0.
- NO tocar backend funcional salvo el único cambio server-side justificado: agregar 2 orígenes a la allow-list CSP `connect-src` (B5). Documentar inline con call-site real (igual que las entradas NASA/USGS existentes).
- Directiva fundador: nunca omitir información — B1 abre detalle propio en vez de mandar a comprar; el link externo queda secundario.
- typecheck 0 (`npm run typecheck`, internamente `tsc --noEmit`; el repo necesita `NODE_OPTIONS=--max-old-space-size=8192`). Lint limpio en archivos tocados.
- **Gates de conectividad/render (CLAUDE.md #21/#23):** un componente nuevo montado/renderizado o un huérfano baselined que se conecta requiere regenerar el baseline en el MISMO commit: `node scripts/check-connectivity-ratchet.cjs --write` (y, si el render-ratchet ya está activo, `node scripts/check-render-ratchet.cjs --write`). Aplica a B1 (nuevo `Iso45001ControlDetail`) y B2 (nuevo punto de montaje de `ModeSwitcher` en el header — re-verificar el ratchet).
- **PR scope gate (CLAUDE.md #24):** B5 toca `src/server/middleware/securityHeaders.ts` (config de seguridad). Va en su PROPIO commit con título claro `fix(csp): ...` — no mezclarlo con un commit `feat: mount`.
- Commits frecuentes, uno por tarea. Rama: `feat/frontend-redesign`.

## File Structure

- **B1** — Create: `src/components/regulatory/Iso45001ControlDetail.tsx` + `.test.tsx`; Modify: `src/components/regulatory/Iso45001Catalog.tsx` (link externo → secundario + abrir detalle); Modify: `src/services/regulatory/iso45001.ts` (agregar `summary`/`guidance` por control); Modify: `src/services/regulatory/types.ts` (campos opcionales en `ComplianceControl`).
- **B2** — Modify: `src/components/layout/RootLayout.tsx` (mover `<ModeSwitcher/>` del dock `fixed bottom-4 right-4 z-50` al header) + `src/components/layout/RootLayout.test.tsx` (o crear) para fijar que el dock flotante ya no existe.
- **B3** — Modify: `src/components/shared/ModeSwitcher.tsx` (al seleccionar `driving`, `setMode('driving')` + `navigate('/driving')`; al salir de driving navegar fuera) + `src/components/shared/ModeSwitcher.test.tsx`.
- **B4** — Modify: `src/components/dashboard/ModuleGroupsGrid.tsx` (la copia del marquee va `aria-hidden` + `inert`, sin duplicar semánticamente) + `src/components/dashboard/ModuleGroupsGrid.test.tsx` (o crear).
- **B5** — Modify: `src/server/middleware/securityHeaders.ts` (agregar `api.open-meteo.com` + `air-quality-api.open-meteo.com` a `CONNECT_SRC_ORIGINS`) + su test en `src/__tests__/server/securityHeaders.test.ts` (o el test existente del CSP).
- **B6** — Create: `public/heroes/` con assets locales; Modify: `src/pages/SafetyFeed.tsx:175`, `src/pages/Gamification.tsx` (thumbnails), `src/components/hygiene/MorningRoutine.tsx`, `src/components/gamification/FindTheGuardian.tsx:81`, `src/services/seedService.ts` (URLs unsplash → `/heroes/*`).
- **B7** — Modify: `src/contexts/ThemeContext.tsx` (reducir a shim: dejar de escribir `.dark` en `<html>`; derivar `isDarkMode` de `AppModeContext`); Modify: `src/index.css:221-234` (quitar el parche `!important` de bordes dark); Modify: `src/components/layout/RootLayout.tsx` (toggle de tema del header → `AppModeContext.setAppearance`).

> Nota orden: B5 (server, scope-gate) y B2/B3 (ModeSwitcher) son independientes; B7 depende de que B2/B3 ya usen `AppModeContext` para el selector. Recomendado: B5 → B1 → B4 → B6 → B3 → B2 → B7.

---

### Task 1 (B5): CSP — desbloquear Open-Meteo (clima + calidad de aire)

**Por qué primero:** el boletín climático (`WeatherBulletin.tsx:48` golpea `https://api.open-meteo.com`) hoy queda silenciosamente bloqueado por `connect-src` en prod. Cambio aislado, server-side, su propio PR por el scope-gate (CLAUDE.md #24).

**Files:**
- Modify: `src/server/middleware/securityHeaders.ts` (array `CONNECT_SRC_ORIGINS`, ≈líneas 69-108; export de test `__connectSrcOriginsForTests` ≈línea 253)
- Test: `src/__tests__/server/securityHeaders.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/__tests__/server/securityHeaders.test.ts  (agregar este describe; si el archivo no existe, crearlo con el import)
import { describe, it, expect } from 'vitest';
import {
  __connectSrcOriginsForTests,
  __buildCspStringForTests,
} from '../../server/middleware/securityHeaders';

describe('CSP connect-src — Open-Meteo (B5)', () => {
  it('incluye el host de clima de Open-Meteo', () => {
    expect(__connectSrcOriginsForTests).toContain('https://api.open-meteo.com');
  });
  it('incluye el host de calidad de aire de Open-Meteo', () => {
    expect(__connectSrcOriginsForTests).toContain('https://air-quality-api.open-meteo.com');
  });
  it('los hosts aparecen en el connect-src serializado', () => {
    const csp = __buildCspStringForTests('test-nonce');
    expect(csp).toContain('https://api.open-meteo.com');
    expect(csp).toContain('https://air-quality-api.open-meteo.com');
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/__tests__/server/securityHeaders.test.ts`
Expected: FAIL — los hosts no están en la allow-list.

- [ ] **Step 3: Agregar los orígenes**

En `src/server/middleware/securityHeaders.ts`, dentro de `const CONNECT_SRC_ORIGINS = [ ... ]`, justo después de la entrada `'https://earthquake.usgs.gov',` (≈línea 107), agregar:

```ts
  // 2026-06-22 (redesign F3 B5) — Open-Meteo clima + calidad de aire.
  //  - api.open-meteo.com: forecast actual (WeatherBulletin.tsx OPEN_METEO_URL)
  //  - air-quality-api.open-meteo.com: AQI (boletín — reemplaza el "Sin datos AQI")
  // Sin estas entradas el `fetch` del cliente quedaba bloqueado por CSP
  // connect-src en prod y el boletín climático perdía silenciosamente los
  // datos. Mismos call-site/rationale que las entradas NASA/USGS de arriba.
  'https://api.open-meteo.com',
  'https://air-quality-api.open-meteo.com',
```

- [ ] **Step 4: Correr el test (verde)**

Run: `npx vitest run src/__tests__/server/securityHeaders.test.ts` → Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/securityHeaders.ts src/__tests__/server/securityHeaders.test.ts
git commit -m "fix(csp): allow Open-Meteo weather + air-quality origins in connect-src (B5)"
```

---

### Task 2 (B1): ISO 45001 — vista de detalle in-app (datos enriquecidos del control)

**Files:**
- Modify: `src/services/regulatory/types.ts` (agregar campos opcionales `summary` + `guidance` a `ComplianceControl`)
- Modify: `src/services/regulatory/iso45001.ts` (poblar `summary`/`guidance` de los 10 controles)
- Create: `src/components/regulatory/Iso45001ControlDetail.tsx` + `Iso45001ControlDetail.test.tsx`
- Modify: `src/components/regulatory/Iso45001Catalog.tsx:57-87` (abrir el detalle al click; degradar el link externo a acción secundaria dentro del detalle)

**Interfaces:**
- Produces: `Iso45001ControlDetail` (named export) — modal token-aware que muestra cláusula, título, resumen, guía práctica, y un link externo SECUNDARIO. Consume `Modal` de `src/components/shared/Modal.tsx`.

- [ ] **Step 1: Extender el tipo + datos (sin test todavía — es modelo de datos puro)**

En `src/services/regulatory/types.ts`, en la interfaz `ComplianceControl`, agregar:

```ts
  /** Resumen en español-CL del propósito del control (1-2 frases). Opt-in. */
  summary?: string;
  /** Guía práctica breve: qué exige y cómo se evidencia. Opt-in. */
  guidance?: string;
```

En `src/services/regulatory/iso45001.ts`, agregar `summary` + `guidance` a cada uno de los 10 controles. Ejemplo para los 2 primeros (replicar el patrón para los 10, copy es-CL real, sin placeholders):

```ts
  {
    id: 'LEADERSHIP_COMMITMENT',
    title: 'Liderazgo y compromiso de la alta dirección',
    iso45001Clause: '5.1',
    summary:
      'La alta dirección debe asumir responsabilidad activa sobre el sistema de gestión de SST, no delegarlo solo al área de prevención.',
    guidance:
      'Evidencia: política de SST firmada por gerencia, recursos asignados en presupuesto, y revisión por la dirección documentada. En Chile se alinea con el rol del empleador en la Ley 16.744.',
    references: [
      isoRef('5.1', 'Liderazgo y compromiso de la alta dirección con el SST'),
    ],
  },
  {
    id: 'WORKER_PARTICIPATION',
    title: 'Consulta y participación de los trabajadores',
    iso45001Clause: '5.4',
    summary:
      'Los trabajadores y sus representantes deben participar en la identificación de peligros y en las decisiones de SST.',
    guidance:
      'Evidencia: actas del Comité Paritario (CPHS), mecanismos de consulta y reporte sin represalias. Conecta con el DS 44/2024 sobre participación.',
    references: [
      isoRef('5.4', 'Consulta y participación de trabajadores y representantes'),
    ],
  },
```

(Completar los 8 restantes con copy real basada en cada cláusula ya descrita en el archivo.)

- [ ] **Step 2: Escribir el test del detalle (falla)**

```tsx
// @vitest-environment jsdom
// src/components/regulatory/Iso45001ControlDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Iso45001ControlDetail } from './Iso45001ControlDetail';
import { ISO_45001_BY_ID } from '../../services/regulatory/iso45001';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

const control = ISO_45001_BY_ID['LEADERSHIP_COMMITMENT'];

describe('Iso45001ControlDetail (B1)', () => {
  it('muestra cláusula, título y guía en vez de mandar a comprar', () => {
    render(<Iso45001ControlDetail control={control} isOpen onClose={() => {}} />);
    expect(screen.getByText(/§5\.1/)).toBeInTheDocument();
    expect(screen.getByText(control.title)).toBeInTheDocument();
    expect(screen.getByText(control.guidance!)).toBeInTheDocument();
  });
  it('el link externo es secundario (presente pero no la acción primaria)', () => {
    render(<Iso45001ControlDetail control={control} isOpen onClose={() => {}} />);
    const ext = screen.getByRole('link', { name: /estándar oficial/i });
    expect(ext).toHaveAttribute('href', control.references[0].url);
    expect(ext).toHaveAttribute('target', '_blank');
  });
  it('cierra con el botón', () => {
    const onClose = vi.fn();
    render(<Iso45001ControlDetail control={control} isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Correr y ver fallo**

Run: `npx vitest run src/components/regulatory/Iso45001ControlDetail.test.tsx`
Expected: FAIL — `Cannot find module './Iso45001ControlDetail'`.

- [ ] **Step 4: Implementar el detalle**

```tsx
// src/components/regulatory/Iso45001ControlDetail.tsx
//
// Praeventio Guard — Redesign F3 B1: vista de detalle in-app de un control
// ISO 45001. Reemplaza el comportamiento previo (cada ítem enlazaba a la
// página de COMPRA de iso.org). Mostramos resumen + guía práctica del
// control; el link al estándar oficial queda como acción SECUNDARIA.
import { useTranslation } from 'react-i18next';
import { BookCheck, ExternalLink } from 'lucide-react';
import { Modal } from '../shared/Modal';
import type { ComplianceControl } from '../../services/regulatory/types';

interface Iso45001ControlDetailProps {
  control: ComplianceControl;
  isOpen: boolean;
  onClose: () => void;
}

export function Iso45001ControlDetail({
  control,
  isOpen,
  onClose,
}: Iso45001ControlDetailProps) {
  const { t } = useTranslation();
  const ext = control.references[0]?.url;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`ISO 45001:2018 §${control.iso45001Clause}`}
    >
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <BookCheck className="w-5 h-5 text-[var(--accent-primary)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <p className="label-eyebrow text-secondary-token">
              §{control.iso45001Clause}
            </p>
            <h3 className="text-base font-semibold text-primary-token">
              {control.title}
            </h3>
          </div>
        </div>

        {control.summary && (
          <section>
            <p className="label-eyebrow text-secondary-token mb-1">
              {t('iso45001.detail.summary', 'Propósito')}
            </p>
            <p className="text-sm text-primary-token">{control.summary}</p>
          </section>
        )}

        {control.guidance && (
          <section>
            <p className="label-eyebrow text-secondary-token mb-1">
              {t('iso45001.detail.guidance', 'Guía práctica')}
            </p>
            <p className="text-sm text-primary-token">{control.guidance}</p>
          </section>
        )}

        {ext && (
          <a
            href={ext}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-secondary-token hover:text-primary-token underline-offset-2 hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            {t('iso45001.detail.openStandard', 'Ver estándar oficial (iso.org)')}
          </a>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Correr (verde)**

Run: `npx vitest run src/components/regulatory/Iso45001ControlDetail.test.tsx` → Expected: PASS (3).

- [ ] **Step 6: Cablear el catálogo para abrir el detalle (link externo → secundario)**

En `src/components/regulatory/Iso45001Catalog.tsx`:

1. Imports + estado: agregar `useState`, `import { Iso45001ControlDetail } from './Iso45001ControlDetail';` y dentro del componente:

```tsx
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailControl = detailId
    ? ISO_45001_CONTROLS.find((c) => c.id === detailId) ?? null
    : null;
```

2. En el `onClick` del botón del ítem (≈línea 59), abrir el detalle ADEMÁS de notificar al caller:

```tsx
              <button
                type="button"
                onClick={() => {
                  setDetailId(c.id);
                  onControlClick?.(c.id);
                }}
                className="flex-1 text-left min-w-0"
                data-testid={`iso45001-btn-${c.id}`}
              >
```

3. ELIMINAR el `<a href={c.references[0].url} target="_blank" ...>` del listado (≈líneas 76-87) — el link externo ya no es la acción del ítem; vive secundario dentro del detalle.

4. Antes del cierre `</section>`, montar el modal:

```tsx
      {detailControl && (
        <Iso45001ControlDetail
          control={detailControl}
          isOpen={detailControl !== null}
          onClose={() => setDetailId(null)}
        />
      )}
```

- [ ] **Step 7: Regen ratchet (componente nuevo montado) + typecheck + commit**

`Iso45001ControlDetail` es un símbolo PascalCase nuevo; ahora se renderiza en `Iso45001Catalog.tsx`. Regenerar baselines para que no cuente como huérfano:

Run: `node scripts/check-connectivity-ratchet.cjs --write`
Run (si el render-ratchet está activo): `node scripts/check-render-ratchet.cjs --write`
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.
Run: `npx vitest run src/components/regulatory` → Expected: verdes (ajustar `Iso45001Catalog.test.tsx` si asertaba sobre el link externo del listado — ahora vive en el detalle).

```bash
git add src/services/regulatory/types.ts src/services/regulatory/iso45001.ts \
  src/components/regulatory/Iso45001ControlDetail.tsx \
  src/components/regulatory/Iso45001ControlDetail.test.tsx \
  src/components/regulatory/Iso45001Catalog.tsx \
  src/components/regulatory/Iso45001Catalog.test.tsx \
  scripts/connectivity-ratchet-baseline.json
git commit -m "feat(regulatory): in-app ISO 45001 control detail; demote iso.org buy-link to secondary (B1)"
```

---

### Task 3 (B4): Carrusel de módulos — no renderizar cada categoría 2 veces (semánticamente)

**Problema:** `[...moduleGroups, ...moduleGroups]` (`ModuleGroupsGrid.tsx:90`) duplica el array para el efecto marquee, pero la copia es totalmente interactiva y la leen lectores de pantalla → cada categoría aparece 2× para teclado/AT. El marquee necesita el doble de ancho, pero la copia debe ser `aria-hidden` + `inert` (no focusable, invisible a AT).

**Files:**
- Modify: `src/components/dashboard/ModuleGroupsGrid.tsx:84-113`
- Test: `src/components/dashboard/ModuleGroupsGrid.test.tsx`

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/dashboard/ModuleGroupsGrid.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModuleGroupsGrid } from './ModuleGroupsGrid';
import { moduleGroups } from './moduleGroups';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
import { vi } from 'vitest';

function renderGrid() {
  return render(
    <MemoryRouter>
      <ModuleGroupsGrid />
    </MemoryRouter>,
  );
}

describe('ModuleGroupsGrid carousel (B4)', () => {
  it('cada categoría aparece UNA sola vez para lectores de pantalla / teclado', () => {
    renderGrid();
    const first = moduleGroups[0];
    // The visible (non-aria-hidden) buttons = exactly one per group.
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.closest('[aria-hidden="true"]') === null);
    const matching = buttons.filter((b) =>
      b.textContent?.includes(first.title),
    );
    expect(matching).toHaveLength(1);
  });
  it('la copia del marquee está aria-hidden', () => {
    const { container } = renderGrid();
    const hidden = container.querySelector('[aria-hidden="true"][data-marquee-clone]');
    expect(hidden).not.toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/dashboard/ModuleGroupsGrid.test.tsx`
Expected: FAIL — hoy ambas copias son interactivas (2 botones por grupo, sin clon `aria-hidden`).

- [ ] **Step 3: Separar la fila real de la copia decorativa**

En `ModuleGroupsGrid.tsx`, reemplazar el bloque `{[...moduleGroups, ...moduleGroups].map(...)}` (líneas 90-112) por DOS renders: la fila real (interactiva) + un clon decorativo `aria-hidden`/`inert`. Extraer el render de la card a un helper interno para no duplicar JSX:

```tsx
        {(() => {
          const renderCard = (group: typeof moduleGroups[number], i: number, clone: boolean) => {
            const isActive = group.id === activeId && !clone;
            return (
              <button
                key={`${group.id}-${clone ? 'clone' : 'real'}-${i}`}
                onClick={clone ? undefined : () =>
                  setActiveId((prev) => (prev === group.id ? null : group.id))
                }
                aria-haspopup={clone ? undefined : 'menu'}
                aria-expanded={clone ? undefined : isActive}
                aria-controls={!clone && isActive ? `module-submenu-${group.id}` : undefined}
                tabIndex={clone ? -1 : undefined}
                className={`${group.color} shrink-0 w-[80px] sm:w-[120px] aspect-square rounded-xl sm:rounded-2xl p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 border ${
                  isActive ? 'border-white/40 ring-2 ring-white/30' : 'border-white/10'
                } active:scale-95 group relative overflow-hidden`}
              >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
                <group.icon className="w-6 h-6 sm:w-8 sm:h-8 shrink-0 relative z-10 text-white" />
                <h3 className="text-[8px] sm:text-xs font-black uppercase tracking-widest leading-tight text-center relative z-10 text-white">
                  {t(`module_groups.group_${group.id}`, group.title)}
                </h3>
              </button>
            );
          };
          return (
            <>
              {moduleGroups.map((g, i) => renderCard(g, i, false))}
              {/* Decorative marquee clone: needed for the seamless -50% scroll
                  but MUST be invisible to AT + keyboard so each category is
                  announced once (B4). `inert` removes it from the a11y tree
                  and tab order; `aria-hidden` is the fallback for older UAs. */}
              <span aria-hidden="true" data-marquee-clone className="contents" {...{ inert: '' }}>
                {moduleGroups.map((g, i) => renderCard(g, i, true))}
              </span>
            </>
          );
        })()}
```

> Nota TS: `inert` aún no está en los tipos JSX de React 19 en todos los `@types`; el spread `{...{ inert: '' }}` lo emite como atributo string sin error de tipo. El `@keyframes marquee` ya recorre `-50% - 4px` (index.css:65), así que el ancho total (real + clon) es el correcto.

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/dashboard/ModuleGroupsGrid.test.tsx` → Expected: PASS (2).

- [ ] **Step 5: typecheck + commit**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

```bash
git add src/components/dashboard/ModuleGroupsGrid.tsx src/components/dashboard/ModuleGroupsGrid.test.tsx
git commit -m "fix(dashboard): mark module marquee clone aria-hidden+inert (each category announced once) (B4)"
```

---

### Task 4 (B6): Imágenes Unsplash hardcodeadas → assets locales (offline-friendly PWA)

**Por qué:** las URLs `https://images.unsplash.com/...` fallan sin red (PWA en faena) y dependen de un tercero. Mover heroes/thumbnails a `public/heroes/` (servidos `self`, ya cubiertos por `img-src 'self'`).

**Files:**
- Create: `public/heroes/` con los assets locales (descargar una vez y commitear como `.webp`):
  - `safety-feed-hero.webp`, `find-the-guardian.webp`,
  - `gamification-{1..5}.webp`, `morning-routine-{1..4}.webp`
- Modify: `src/pages/SafetyFeed.tsx:175`, `src/pages/Gamification.tsx:187-231`, `src/services/seedService.ts:100-122`, `src/components/hygiene/MorningRoutine.tsx:83-107`, `src/components/gamification/FindTheGuardian.tsx:81`
- Test: `src/__tests__/design/noRemoteImages.test.ts` (guard de regresión)

- [ ] **Step 1: Test de regresión (falla)**

```ts
// src/__tests__/design/noRemoteImages.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'src/pages/SafetyFeed.tsx',
  'src/pages/Gamification.tsx',
  'src/services/seedService.ts',
  'src/components/hygiene/MorningRoutine.tsx',
  'src/components/gamification/FindTheGuardian.tsx',
];

describe('no remote hero/thumbnail images (B6)', () => {
  for (const f of FILES) {
    it(`${f} no referencia images.unsplash.com`, () => {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(src).not.toContain('images.unsplash.com');
    });
  }
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/__tests__/design/noRemoteImages.test.ts`
Expected: FAIL — los 5 archivos aún tienen `images.unsplash.com`.

- [ ] **Step 3: Descargar y commitear los assets locales**

Descargar cada URL unsplash una sola vez a `public/heroes/` como `.webp` (convertir con sharp/cwebp). Mapeo sugerido:

```bash
mkdir -p public/heroes
# Ejemplo (repetir por cada URL distinta encontrada en el grep):
#   photo-1504384308090... -> public/heroes/safety-feed-hero.webp
#   photo-1504307651254... -> public/heroes/find-the-guardian.webp
#   photo-1541888086425... -> public/heroes/gamification-1.webp   ... etc.
```

- [ ] **Step 4: Reemplazar las URLs por rutas locales**

En cada archivo, cambiar `'https://images.unsplash.com/<id>?...'` por la ruta local correspondiente, p.ej.:

- `src/pages/SafetyFeed.tsx:175` → `src="/heroes/safety-feed-hero.webp"`
- `src/components/gamification/FindTheGuardian.tsx:81` → `const imageUrl = "/heroes/find-the-guardian.webp";`
- `src/pages/Gamification.tsx` thumbnails/fallbackThumbnail → `/heroes/gamification-1.webp` … `/heroes/gamification-5.webp`
- `src/services/seedService.ts` thumbnails → mismas rutas `/heroes/gamification-*.webp`
- `src/components/hygiene/MorningRoutine.tsx:83-107` `image:` → `/heroes/morning-routine-1.webp` … `-4.webp`

(Conservar el patrón `thumbnail`/`fallbackThumbnail`: si antes ambos apuntaban a la misma URL, ambos apuntan al mismo asset local.)

- [ ] **Step 5: Correr (verde) + commit**

Run: `npx vitest run src/__tests__/design/noRemoteImages.test.ts` → Expected: PASS (5).
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

```bash
git add public/heroes src/pages/SafetyFeed.tsx src/pages/Gamification.tsx \
  src/services/seedService.ts src/components/hygiene/MorningRoutine.tsx \
  src/components/gamification/FindTheGuardian.tsx \
  src/__tests__/design/noRemoteImages.test.ts
git commit -m "fix(assets): move unsplash heroes/thumbnails to local public/heroes (offline PWA) (B6)"
```

---

### Task 5 (B3): Modo Conducción navega a la ruta full-screen al activarse

**Problema:** `ModeSwitcher` solo llama `setMode('driving')`; la página full-screen vive en `/driving` (`App.tsx:290`) y `Driving.tsx` redirige a `/` si `mode !== 'driving'`. Hoy activar Conducción cambia los tokens pero deja al usuario en la pantalla actual ("fuera de contexto"). Fix: al seleccionar Conducción, navegar también a `/driving`; al salir de Conducción estando en `/driving`, volver al inicio.

**Files:**
- Modify: `src/components/shared/ModeSwitcher.tsx`
- Test: `src/components/shared/ModeSwitcher.test.tsx`

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/shared/ModeSwitcher.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const setMode = vi.fn();
const setAppearance = vi.fn();
vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => ({
    mode: 'normal',
    appearance: 'light',
    setMode,
    setAppearance,
    dismissEmergency: vi.fn(),
  }),
  // re-export the type-only names used at runtime as no-ops
  AppMode: {},
  AppAppearance: {},
}));

import { ModeSwitcher } from './ModeSwitcher';

describe('ModeSwitcher driving navigation (B3)', () => {
  it('al activar Conducción setMode(driving) Y navega a /driving', () => {
    render(<ModeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /conducción/i }));
    expect(setMode).toHaveBeenCalledWith('driving');
    expect(navigate).toHaveBeenCalledWith('/driving');
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/shared/ModeSwitcher.test.tsx`
Expected: FAIL — `navigate` nunca se llama (y el componente aún no importa `useNavigate`).

- [ ] **Step 3: Implementar la navegación en `handleSelect`**

En `src/components/shared/ModeSwitcher.tsx`:

1. Agregar import: `import { useNavigate } from 'react-router-dom';`
2. Dentro de `ModeSwitcher`: `const navigate = useNavigate();`
3. Reemplazar `handleSelect` (líneas 43-50) por:

```tsx
  const handleSelect = (slot: SlotDef): void => {
    if (slot.mode === 'normal' && slot.appearance) {
      setAppearance(slot.appearance);
      setMode('normal');
      // Leaving driving while on the full-screen route → back to home so the
      // user is not stranded on a driving shell in pedestrian mode.
      if (mode === 'driving') navigate('/');
    } else {
      setMode(slot.mode);
      // Driving is a full-screen route experience (App.tsx /driving). Without
      // this navigation, setMode only swaps tokens and the user stays "out of
      // context" on the current page (B3). Emergency renders as an overlay, so
      // it does NOT navigate.
      if (slot.mode === 'driving') navigate('/driving');
    }
  };
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/shared/ModeSwitcher.test.tsx` → Expected: PASS.

- [ ] **Step 5: typecheck + commit**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

```bash
git add src/components/shared/ModeSwitcher.tsx src/components/shared/ModeSwitcher.test.tsx
git commit -m "fix(modes): driving mode navigates to /driving full-screen route on activate (B3)"
```

---

### Task 6 (B2): Mover el selector de modos al header (resuelve colisión z-index con el chat IA)

**Problema:** el dock de `ModeSwitcher` es `fixed bottom-4 right-4 z-50` (`RootLayout.tsx:427-430`) y el launcher del chat IA es `fixed bottom-...-6 right-...-6 z-40` (`AsesorChat.tsx:351`) → ambos pelean la esquina inferior derecha. Fix: montar el selector en el header (cluster derecho, junto a Notificaciones/Tema) y eliminar el dock flotante.

**Files:**
- Modify: `src/components/layout/RootLayout.tsx` (quitar el dock flotante líneas 427-430; montar `<ModeSwitcher/>` en el header, cluster `Right` ≈línea 276)
- Test: `src/components/layout/RootLayout.test.tsx` (crear si no existe — test mínimo de presencia/ausencia)

- [ ] **Step 1: Test (falla) — el selector NO está en un dock fixed bottom-right**

```tsx
// @vitest-environment jsdom
// src/components/layout/RootLayout.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Stub heavy children — we only assert the ModeSwitcher placement.
vi.mock('../shared/ModeSwitcher', () => ({
  ModeSwitcher: () => <div data-testid="mode-switcher" />,
}));
// ... (stub the other RootLayout imports as `() => null` per the repo's
// existing layout-test pattern; see sibling layout tests for the full set)

import { ModeSwitcher } from '../shared/ModeSwitcher';

describe('ModeSwitcher placement (B2)', () => {
  it('el selector ya no vive en un dock fixed bottom-right z-50', () => {
    // Regression guard at source level: the floating dock string is gone.
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/layout/RootLayout.tsx'),
      'utf8',
    );
    expect(src).not.toContain('fixed bottom-4 right-4 z-50');
    // And the switcher is still mounted somewhere in the shell.
    expect(src).toContain('<ModeSwitcher');
  });
});
```

> Nota: un test de fuente (lectura del archivo) es el patrón más barato y robusto aquí porque montar `RootLayout` entero arrastra ~20 contexts. Si el repo ya tiene un harness de layout-test con providers, preferirlo y asertar por DOM.

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/layout/RootLayout.test.tsx`
Expected: FAIL — el string del dock flotante todavía existe.

- [ ] **Step 3: Mover el selector al header**

En `src/components/layout/RootLayout.tsx`:

1. ELIMINAR el bloque del dock flotante (líneas 427-430):

```tsx
      {/* 4-mode UX dock — floating, post-login only (RootLayout never renders on landing). */}
      <div className="fixed bottom-4 right-4 z-50 pointer-events-auto">
        <ModeSwitcher />
      </div>
```

2. Montar `<ModeSwitcher/>` en el cluster derecho del header. Insertar antes del bloque de Notificaciones/Tema (≈línea 282, justo después del `NormativaSwitch`):

```tsx
          {/* 4-mode UX selector — moved from the floating bottom-right dock
              (z-50) which collided with the AI chat launcher (z-40). Lives in
              the header now; hidden on the narrowest viewports to preserve the
              icon row, where the dedicated /safe-driving link still reaches the
              driving experience. (B2) */}
          <div className="hidden lg:block">
            <ModeSwitcher />
          </div>
```

> El `ModeSwitcher` ya es un row horizontal compacto (`flex items-center gap-1.5`, botones 10×10) — encaja en el header. El hint "Auto día/noche" se apila debajo solo en modo driving; aceptable en el header.

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/layout/RootLayout.test.tsx` → Expected: PASS.

- [ ] **Step 5: Regen ratchet (nuevo punto de montaje) + typecheck + commit**

`ModeSwitcher` ya estaba montado (no es huérfano nuevo), pero el render-ratchet rastrea presencia de `<ModeSwitcher` en JSX — sigue presente, así que no debería cambiar. Regenerar por seguridad si el gate marca drift:

Run: `node scripts/check-connectivity-ratchet.cjs` (verificar verde; `--write` solo si reporta cambio)
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

```bash
git add src/components/layout/RootLayout.tsx src/components/layout/RootLayout.test.tsx
git commit -m "fix(layout): move ModeSwitcher from floating dock to header (resolve z-index clash with AI chat) (B2)"
```

---

### Task 7 (B7): Unificar theming en AppModeContext — ThemeContext a shim, quitar parche `!important`

**Problema:** dos contextos escriben `.dark` en `<html>`: `AppModeContext` (canónico — maneja los 4 modos, `AppModeContext.tsx:123-138`) y `ThemeContext` (legacy — `ThemeContext.tsx:36-46`). Pelean por la clase, y un parche `!important` en `index.css:221-234` fuerza bordes dorados sobre la inconsistencia. Fix: `ThemeContext` deja de escribir `<html>` y deriva su estado de `AppModeContext`; quitar el `!important`.

**Consumidores de `useTheme()`** (a respetar, no romper la API): `RootLayout.tsx`, `SLMProvider.tsx`, `SunTrackerContainer.tsx`, `WeatherBulletin.tsx`, `systemEngine/adapters/{index,themeContextAdapter}.ts`. La interfaz `{ isDarkMode, isDayTime, themeMode, toggleTheme, setThemeMode }` se mantiene.

**Files:**
- Modify: `src/contexts/ThemeContext.tsx` (shim sobre `AppModeContext`)
- Modify: `src/index.css:221-234` (quitar las 3 reglas `!important`)
- Modify: `src/components/layout/RootLayout.tsx:318-326` (toggle del header sigue usando `toggleTheme` del shim — sin cambio funcional)
- Test: `src/contexts/ThemeContext.test.tsx`

- [ ] **Step 1: Test (falla) — el shim NO escribe `<html>.dark`, deriva de AppMode**

```tsx
// @vitest-environment jsdom
// src/contexts/ThemeContext.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setAppearance = vi.fn();
let appearance = 'light';
vi.mock('./AppModeContext', () => ({
  useAppMode: () => ({
    appearance,
    mode: 'normal',
    setAppearance,
    setMode: vi.fn(),
  }),
}));

import { ThemeProvider, useTheme } from './ThemeContext';

function Probe() {
  const { isDarkMode, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme}>{isDarkMode ? 'dark' : 'light'}</button>
  );
}

describe('ThemeContext shim over AppModeContext (B7)', () => {
  it('no escribe la clase .dark en <html> (eso lo hace AppModeContext)', () => {
    document.documentElement.classList.remove('dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    // The shim must NOT add .dark itself.
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
  it('toggleTheme delega en AppModeContext.setAppearance', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(setAppearance).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/contexts/ThemeContext.test.tsx`
Expected: FAIL — el `ThemeContext` actual escribe `.dark` y no toca `AppModeContext`.

- [ ] **Step 3: Reescribir `ThemeContext` como shim**

Reemplazar el cuerpo de `src/contexts/ThemeContext.tsx` por un shim que delega en `AppModeContext` (mantiene la API pública; no escribe `<html>`):

```tsx
// src/contexts/ThemeContext.tsx
//
// Redesign F3 B7 — LEGACY SHIM. The canonical theming source is
// AppModeContext (it owns the 4 modes and the only writer of the .dark /
// .driving / .emergency classes on <html>). This shim keeps the historical
// `useTheme()` API alive for ~6 consumers while delegating all state to
// AppModeContext, so we no longer have two providers fighting over <html>.
import React, { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { useAppMode } from './AppModeContext';

type ThemeMode = 'light' | 'dark' | 'system' | 'auto';

interface ThemeContextValue {
  isDarkMode: boolean;
  isDayTime: boolean;
  themeMode: ThemeMode;
  toggleTheme: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getIsDayTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 20;
}

function resolveIsDark(appearance: 'light' | 'dark' | 'auto'): boolean {
  if (appearance === 'dark') return true;
  if (appearance === 'light') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { appearance, setAppearance, setMode } = useAppMode();
  const isDarkMode = resolveIsDark(appearance);

  // Map the legacy ThemeMode API onto AppModeContext's appearance + mode.
  const setThemeMode = useCallback(async (mode: ThemeMode): Promise<void> => {
    setMode('normal');
    setAppearance(mode === 'system' ? 'auto' : (mode as 'light' | 'dark' | 'auto'));
  }, [setAppearance, setMode]);

  const toggleTheme = useCallback(async (): Promise<void> => {
    setMode('normal');
    setAppearance(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setAppearance, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDarkMode,
      isDayTime: getIsDayTime(),
      themeMode: appearance === 'auto' ? 'system' : (appearance as ThemeMode),
      toggleTheme,
      setThemeMode,
    }),
    [isDarkMode, appearance, toggleTheme, setThemeMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
```

> `AppProviders.tsx:115-116` ya monta `<AppModeProvider>` por fuera de `<ThemeProvider>`, así que el shim resuelve `useAppMode()` sin reordenar. La API `idb-keyval` (`get`/`set` de `theme_preference`) sale: la persistencia ahora la maneja `AppModeContext` bajo `gp.appmode.v1`.

- [ ] **Step 4: Quitar el parche `!important` de bordes dark**

En `src/index.css`, eliminar las 3 reglas (líneas 221-234):

```css
  /* Global Dark Mode Border Overrides (Gold) */
  .dark .border-white\/10,
  .dark .border-white\/5,
  .dark .border-zinc-800 {
    border-color: rgba(212, 175, 55, 0.3) !important; /* Gold with opacity */
  }
  .dark .hover\:border-teal-400\/30:hover {
    border-color: rgba(212, 175, 55, 0.6) !important;
  }
  .dark .hover\:border-white\/20:hover {
    border-color: rgba(212, 175, 55, 0.5) !important;
  }
```

> El token `--border-default` del bloque `.dark` (index.css:118, `rgba(212,175,55,.30)`) ya entrega el borde dorado por la vía semántica; el parche `!important` era para componentes aún con `border-white/10` crudo y queda fuera de alcance de F4 (codemod). Quitar el `!important` evita que pelee con los modos driving/emergency.

- [ ] **Step 5: Correr (verde) + verificar consumidores**

Run: `npx vitest run src/contexts/ThemeContext.test.tsx` → Expected: PASS (2).
Run: `npx vitest run src/components/WeatherBulletin` `src/components/layout` → Expected: verdes (la API `useTheme` no cambió).
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/ThemeContext.tsx src/contexts/ThemeContext.test.tsx src/index.css \
  src/components/layout/RootLayout.tsx
git commit -m "refactor(theme): unify theming on AppModeContext; ThemeContext is a shim; drop !important dark-border patch (B7)"
```

---

### Task 8: Verificación integral de la fase

**Files:** ninguno (solo gates).

- [ ] **Step 1: Suite + gates**

Run: `npm run typecheck` → Expected: 0 errores.
Run: `npm run lint` (o eslint sobre los archivos tocados) → Expected: 0 errores.
Run: `npm run lint:connectivity` → Expected: verde (baselines regenerados en B1).
Run: `npx vitest run src/components/regulatory src/components/dashboard src/components/shared/ModeSwitcher.test.tsx src/contexts/ThemeContext.test.tsx src/__tests__/server/securityHeaders.test.ts src/__tests__/design/noRemoteImages.test.ts` → Expected: todo verde.

- [ ] **Step 2: Verificación manual (dev real, navegador)**

Run: `npm run dev` y verificar en `http://localhost:3000`:
- B1: click en un control ISO 45001 abre el detalle in-app (no iso.org); el link externo es secundario dentro del modal.
- B2: el selector de modos vive en el header; el launcher del chat IA (esquina inf-der) ya no choca.
- B3: activar Conducción navega a `/driving` (mapa full-screen); volver a Claro/Oscuro saca de `/driving`.
- B4: el carrusel sigue desplazándose suave; tab recorre cada categoría una sola vez.
- B5: el boletín climático carga datos (Network → 200 a `api.open-meteo.com`, sin violación CSP en consola).
- B6: heroes/thumbnails cargan offline (DevTools → Network offline).
- B7: cambiar tema desde el header alterna `.dark`; sin doble-escritura; bordes dorados se mantienen sin `!important`.

---

## Self-Review

**1. Spec coverage (§9 B1–B7):** B1 detalle in-app + link secundario (Task 2 ✓) · B2 modos al header + z-index (Task 6 ✓) · B3 driving navega (Task 5 ✓) · B4 carrusel sin doble render semántico (Task 3 ✓) · B5 CSP open-meteo (Task 1 ✓) · B6 assets locales (Task 4 ✓) · B7 theming unificado + sin `!important` (Task 7 ✓). El bloque `.driving` warm-dark y `.label-eyebrow` ya los entregó F0 (index.css:137-219) — F3 los CONSUME (B1 usa `.label-eyebrow` y `--accent-primary`), no los re-implementa.

**2. Placeholder scan:** sin "TBD"/"etc." accionables — la única expansión a completar por el implementador es (a) el copy es-CL de los 8 controles ISO restantes (Task 2 Step 1, patrón explícito dado para 2) y (b) la descarga/conversión de los assets de Unsplash (Task 4 Step 3, mapeo dado). Ningún paso difiere lógica ni deja stub.

**3. Type consistency:** `Iso45001ControlDetail` consume `ComplianceControl` (campos `summary`/`guidance` opcionales → back-compat con consumidores existentes de `iso45001.ts`). El shim de `ThemeContext` preserva la interfaz pública `ThemeContextValue` exacta, así que los 6 consumidores de `useTheme()` no cambian de firma. `ModeSwitcher` agrega `useNavigate` sin cambiar su export.

**4. Gates:** B1 monta un componente nuevo → regen `connectivity-ratchet` (+ render-ratchet si activo) en el mismo commit. B5 toca config de seguridad → commit propio `fix(csp): ...` (cumple scope-gate #24). Todos los commits TDD: RED documentado antes de GREEN.

**Riesgos conocidos:** (a) `inert` en JSX de React 19 puede no estar tipado — se emite vía spread string (Task 3 nota). (b) El test de fuente de `RootLayout` (Task 6) es un guard barato; si el repo ya tiene harness de layout con providers, preferir asertar por DOM. (c) B7 elimina la persistencia `idb-keyval` de `theme_preference`; la preferencia ahora persiste en `gp.appmode.v1` (AppModeContext) — comportamiento equivalente, una sola fuente de verdad. Verificar en F4/F5 que ningún código lea `theme_preference` directamente fuera del contexto.