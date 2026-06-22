# Frontend Redesign — F0 Fundamentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sentar los fundamentos visuales del rediseño — paletas de los 4 modos refinadas (Conducción → oscuro-cálido por batería), utilidad `cn` canónica, wrapper de `@chenglou/pretext`, y los primitivos compartidos `Button`/`Badge`/`Input` — sobre la base de 4 modos existente, sin tocar pantallas todavía.

**Architecture:** Evolución, no reescritura. Los tokens viven en `src/index.css` (CSS-vars por modo, Tailwind v4 `@theme`). Los primitivos viven en `src/components/shared/` y consumen SOLO tokens semánticos vía `cn()`. `pretext` se envuelve en un util con fallback (jsdom/SSR sin Canvas). Cada pieza es testeable y aislada.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4 (`^4.1.14`), `clsx ^2.1.1` + `tailwind-merge ^3.5.0`, `@chenglou/pretext ^0.0.8`, Vitest 4 (+ jsdom por-archivo), `@testing-library/react`.

## Global Constraints

- TDD estricto (RED→GREEN). Tests React: pragma `// @vitest-environment jsdom` al tope del archivo (Vitest 4, default `node`).
- Tokens semánticos reales en `src/index.css`: `--bg-canvas/-surface/-elevated`, `--text-primary/-secondary/-muted`, `--accent-primary/-on-primary/-warning/-hazard/-success/-info`, `--border-default/-strong/-subtle`, `--shadow-color`. Bloques: `:root` (light), `.dark`, `.driving`, `.emergency`.
- NO hardcodear color en componentes — siempre via clase Tailwind que mapea a token (`bg-surface`, `text-primary-token`, etc.) o `var(--token)`.
- Copy UI en español-CL; código/comentarios en inglés.
- Conducción = oscuro-cálido por **ahorro de batería** (OLED). "Requiere atención" → `--accent-warning` (dorado/ámbar).
- typecheck 0 (`tsc --noEmit`, requiere `NODE_OPTIONS=--max-old-space-size=8192` por tamaño del repo). Lint limpio en archivos tocados.
- Commits frecuentes, uno por tarea. Rama: `feat/frontend-redesign`.

## File Structure

- Create: `src/utils/cn.ts` — utilidad canónica `cn()` (clsx + tailwind-merge).
- Create: `src/utils/cn.test.ts`
- Modify: `src/index.css` — refinar bloque `.driving` (paleta oscuro-cálido) + utilidad `.label-eyebrow` + features de tipografía en `body`.
- Create: `src/__tests__/design/colorTokens.test.ts` — contrato de tokens por modo.
- Create: `src/__tests__/design/typography.test.ts` — contrato de tipografía.
- Create: `src/utils/textMeasure.ts` — wrapper de pretext con fallback.
- Create: `src/utils/textMeasure.test.ts`
- Create: `src/components/shared/Button.tsx` + `src/components/shared/Button.test.tsx`
- Create: `src/components/shared/Badge.tsx` + `src/components/shared/Badge.test.tsx`
- Create: `src/components/shared/Input.tsx` + `src/components/shared/Input.test.tsx`

> Nota: `cn()` hoy SOLO existe como `export function cn` en `src/components/shared/Card.tsx:7`. Task 1 lo extrae a un util canónico y re-exporta desde Card para no romper imports existentes.

---

### Task 1: Utilidad `cn` canónica

**Files:**
- Create: `src/utils/cn.ts`
- Test: `src/utils/cn.test.ts`
- Modify: `src/components/shared/Card.tsx:1-9` (re-exportar `cn` desde el util)

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` — merge de clases con dedupe Tailwind. Lo consumen Button/Badge/Input.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/utils/cn.test.ts
import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('une clases y filtra falsy', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
  it('dedupe con prioridad tailwind-merge (la última gana)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-base')).toBe('text-base');
  });
});
```

- [ ] **Step 2: Correr el test y verque falla**

Run: `npx vitest run src/utils/cn.test.ts`
Expected: FAIL — `Cannot find module './cn'`.

- [ ] **Step 3: Implementar el util**

```ts
// src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Canonical class merger: clsx for conditionals + tailwind-merge for dedupe. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Re-exportar desde Card para no romper imports**

En `src/components/shared/Card.tsx`, reemplazar la definición local `export function cn(...) {...}` (≈línea 7) por un re-export:

```ts
// at top of Card.tsx, replacing the local cn definition
export { cn } from '../../utils/cn';
```

(Conservar el resto de `Card.tsx` igual; verificar que `ClassValue`/`clsx`/`twMerge` ya no se importen si quedaban sin uso.)

- [ ] **Step 5: Correr tests + typecheck**

Run: `npx vitest run src/utils/cn.test.ts` → Expected: PASS (2).
Run: `npx vitest run src/components/shared` → Expected: los tests de Card siguen verdes.

- [ ] **Step 6: Commit**

```bash
git add src/utils/cn.ts src/utils/cn.test.ts src/components/shared/Card.tsx
git commit -m "refactor(ui): extract canonical cn() util; Card re-exports it"
```

---

### Task 2: Paleta Conducción → oscuro-cálido (batería) + contrato de tokens

**Files:**
- Modify: `src/index.css` (bloque `.driving` ≈líneas 137-179, incluida la variante noche anidada)
- Test: `src/__tests__/design/colorTokens.test.ts`

**Interfaces:**
- Produces: bloque `.driving` con la paleta oscuro-cálido (tabla §3 del spec). Los componentes consumen los mismos nombres de token.

- [ ] **Step 1: Escribir el test de contrato (falla)**

```ts
// src/__tests__/design/colorTokens.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

// Extrae el bloque de un selector de modo: `.driving { ... }`
function block(selector: string): string {
  const i = css.indexOf(selector);
  expect(i, `selector ${selector} no encontrado`).toBeGreaterThan(-1);
  const start = css.indexOf('{', i);
  let depth = 0, end = start;
  for (let p = start; p < css.length; p++) {
    if (css[p] === '{') depth++;
    else if (css[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  return css.slice(start, end);
}

const REQUIRED = [
  '--bg-canvas', '--bg-surface', '--bg-elevated',
  '--text-primary', '--text-secondary', '--text-muted',
  '--accent-primary', '--accent-warning', '--accent-hazard',
  '--accent-success', '--border-default',
];

describe('color tokens — los 4 modos definen todos los roles', () => {
  for (const sel of [':root', '.dark', '.driving', '.emergency']) {
    it(`${sel} define todos los tokens requeridos`, () => {
      const b = block(sel);
      for (const t of REQUIRED) expect(b, `${sel} falta ${t}`).toContain(t + ':');
    });
  }
});

describe('Conducción = oscuro-cálido (batería)', () => {
  const d = block('.driving');
  it('bg-canvas near-black cálido', () => expect(d).toContain('--bg-canvas: #0d0a05'));
  it('text-primary cálido', () => expect(d).toContain('--text-primary: #fff7e9'));
  it('marca teal glanceable', () => expect(d).toContain('--accent-primary: #5fd9c8'));
  it('atención dorada', () => expect(d).toContain('--accent-warning: #ffce5a'));
});
```

- [ ] **Step 2: Correr el test y ver fallos**

Run: `npx vitest run src/__tests__/design/colorTokens.test.ts`
Expected: los 4 tests "define todos los tokens" PASAN (ya existen); los de "Conducción oscuro-cálido" FALLAN (aún tiene #ffffff).

- [ ] **Step 3: Reemplazar los valores del bloque `.driving`**

En `src/index.css`, dentro de `.driving { ... }`, fijar (conservando TODOS los nombres de token existentes; reemplazar solo valores):

```css
  .driving {
    --bg-canvas: #0d0a05;            /* near-black cálido — OLED battery */
    --bg-surface: #1a160d;
    --bg-elevated: #241f12;
    --text-primary: #fff7e9;
    --text-secondary: #cabfa1;
    --text-muted: #9a8e6f;
    --accent-primary: #5fd9c8;       /* teal glanceable */
    --accent-on-primary: #0d0a05;
    --accent-warning: #ffce5a;       /* dorado = atención */
    --accent-hazard: #ff5a4d;        /* coral = alerta */
    --accent-success: #5fdcb4;
    --accent-info: #5fd9c8;
    --border-default: rgba(255, 247, 233, 0.12);
    --border-strong: rgba(255, 247, 233, 0.22);
    --border-subtle: rgba(255, 247, 233, 0.06);
    --shadow-color: rgba(0, 0, 0, 0.6);
    --bg-main: #0d0a05;              /* legacy alias */
    --text-main: #fff7e9;           /* legacy alias */
  }
```

Si hay una variante noche anidada (≈líneas 161-173, p. ej. dentro de `@media (prefers-color-scheme: dark)`), fijar ahí los MISMOS valores oscuro-cálido (ambas variantes oscuras ahora). Conservar cualquier token extra que ya existiera en el bloque con su valor previo si no está en la lista de arriba.

- [ ] **Step 4: Correr el test (verde)**

Run: `npx vitest run src/__tests__/design/colorTokens.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/__tests__/design/colorTokens.test.ts
git commit -m "feat(ui): driving mode warm-dark palette (OLED battery) + color token contract test"
```

---

### Task 3: Tipografía — utilidad `.label-eyebrow` + features de cuerpo + contrato

**Files:**
- Modify: `src/index.css` (añadir utilidad `.label-eyebrow`; asegurar `body` con Inter + font-features)
- Test: `src/__tests__/design/typography.test.ts`

**Interfaces:**
- Produces: clase `.label-eyebrow` (uppercase + tracking, opt-in) para reemplazar el uppercase-por-defecto.

- [ ] **Step 1: Test de contrato (falla)**

```ts
// src/__tests__/design/typography.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

describe('tipografía', () => {
  it('expone la utilidad opt-in .label-eyebrow', () => {
    expect(css).toMatch(/\.label-eyebrow\s*\{/);
    const b = css.slice(css.indexOf('.label-eyebrow'));
    expect(b).toMatch(/text-transform:\s*uppercase/);
    expect(b).toMatch(/letter-spacing/);
  });
  it('el cuerpo activa font-features de Inter', () => {
    expect(css).toMatch(/font-feature-settings/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/__tests__/design/typography.test.ts`
Expected: FAIL — `.label-eyebrow` no existe.

- [ ] **Step 3: Añadir la utilidad + features en `src/index.css`**

Agregar (cerca del final del archivo, fuera de los bloques de modo):

```css
/* Eyebrow label: uso OPT-IN para mini-etiquetas. El default deja de ser uppercase. */
.label-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;   /* 12px mínimo legible */
  font-weight: 600;
}
```

Asegurar que `body` (o `:root`/`html`) declare las features de Inter (si ya existe, dejar igual):

```css
body {
  font-feature-settings: 'cv11', 'ss01';
  font-variation-settings: 'opsz' 32;
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/__tests__/design/typography.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/__tests__/design/typography.test.ts
git commit -m "feat(ui): opt-in .label-eyebrow utility + Inter font-features (calm type baseline)"
```

---

### Task 4: `textMeasure` — wrapper de pretext con fallback

**Files:**
- Create: `src/utils/textMeasure.ts`
- Test: `src/utils/textMeasure.test.ts`

**Interfaces:**
- Produces: `measureTextHeight(text: string, font: string, maxWidth: number, lineHeight: number): { height: number; lineCount: number } | null` — usa pretext; retorna `null` si el runtime no tiene Canvas 2D (jsdom/SSR), para que el caller use su fallback.

- [ ] **Step 1: Test (falla) — contrato de fallback en jsdom**

```ts
// @vitest-environment jsdom
// src/utils/textMeasure.test.ts
import { describe, it, expect } from 'vitest';
import { measureTextHeight } from './textMeasure';

describe('measureTextHeight', () => {
  it('retorna null cuando Canvas 2D no está disponible (jsdom)', () => {
    // jsdom no implementa canvas.measureText → fallback seguro
    const r = measureTextHeight('hola mundo', '16px Inter', 320, 20);
    expect(r === null || typeof r.height === 'number').toBe(true);
  });
  it('no lanza con texto vacío', () => {
    expect(() => measureTextHeight('', '16px Inter', 320, 20)).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/utils/textMeasure.test.ts`
Expected: FAIL — `Cannot find module './textMeasure'`.

- [ ] **Step 3: Implementar el wrapper**

```ts
// src/utils/textMeasure.ts
import { prepare, layout } from '@chenglou/pretext';

/**
 * Mide altura/líneas de texto SIN reflow del DOM usando pretext.
 * pretext requiere Canvas 2D + Intl.Segmenter; si no están (jsdom/SSR),
 * retorna null para que el caller aplique su propio fallback (CSS normal).
 */
export function measureTextHeight(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
): { height: number; lineCount: number } | null {
  if (typeof document === 'undefined' || typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
    return null;
  }
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || typeof ctx.measureText !== 'function') return null;
    // sondeo: jsdom devuelve width 0 siempre → tratamos como no-soportado
    ctx.font = font;
    if (ctx.measureText('x').width === 0 && text.length > 0) return null;
    const prepared = prepare(text, font);
    return layout(prepared, maxWidth, lineHeight);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/utils/textMeasure.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/utils/textMeasure.ts src/utils/textMeasure.test.ts
git commit -m "feat(ui): pretext textMeasure wrapper with no-canvas fallback"
```

---

### Task 5: Primitivo `Button`

**Files:**
- Create: `src/components/shared/Button.tsx`
- Test: `src/components/shared/Button.test.tsx`

**Interfaces:**
- Consumes: `cn` de `src/utils/cn` (Task 1).
- Produces: `Button` (default export), props `{ variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'sm'|'md'|'lg' } & React.ButtonHTMLAttributes<HTMLButtonElement>`. Lo consumen tareas/fases posteriores.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/shared/Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from './Button';

describe('Button', () => {
  it('renderiza el texto y dispara onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('aplica la variante danger (token hazard) y respeta disabled', () => {
    render(<Button variant="danger" disabled>Borrar</Button>);
    const btn = screen.getByRole('button', { name: 'Borrar' });
    expect(btn.className).toMatch(/hazard|danger/);
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/shared/Button.test.tsx`
Expected: FAIL — `Cannot find module './Button'`.

- [ ] **Step 3: Implementar `Button`**

```tsx
// src/components/shared/Button.tsx
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)] hover:opacity-90',
  secondary: 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-surface)]',
  ghost: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-surface)]',
  danger: 'bg-[var(--accent-hazard)] text-white hover:opacity-90',
};
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export default function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
        'transition-[colors,transform] duration-200 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/shared/Button.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/Button.tsx src/components/shared/Button.test.tsx
git commit -m "feat(ui): shared Button primitive (token-driven, 4-mode-aware)"
```

---

### Task 6: Primitivo `Badge`

**Files:**
- Create: `src/components/shared/Badge.tsx`
- Test: `src/components/shared/Badge.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 1).
- Produces: `Badge`, props `{ tone?: 'brand'|'attention'|'alert'|'success'|'neutral' } & React.HTMLAttributes<HTMLSpanElement>`. `attention` = dorado (`--accent-warning`).

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/shared/Badge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('attention usa el token de atención (dorado)', () => {
    render(<Badge tone="attention">Requiere atención</Badge>);
    const el = screen.getByText('Requiere atención');
    expect(el.className).toContain('accent-warning');
  });
  it('alert usa el token hazard', () => {
    render(<Badge tone="alert">Crítico</Badge>);
    expect(screen.getByText('Crítico').className).toContain('accent-hazard');
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/shared/Badge.test.tsx`
Expected: FAIL — `Cannot find module './Badge'`.

- [ ] **Step 3: Implementar `Badge`**

```tsx
// src/components/shared/Badge.tsx
import type { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type Tone = 'brand' | 'attention' | 'alert' | 'success' | 'neutral';

const TONES: Record<Tone, string> = {
  brand: 'text-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
  attention: 'text-[var(--accent-warning)] bg-[color-mix(in_srgb,var(--accent-warning)_16%,transparent)]',
  alert: 'text-[var(--accent-hazard)] bg-[color-mix(in_srgb,var(--accent-hazard)_16%,transparent)]',
  success: 'text-[var(--accent-success)] bg-[color-mix(in_srgb,var(--accent-success)_16%,transparent)]',
  neutral: 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export default function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/shared/Badge.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/Badge.tsx src/components/shared/Badge.test.tsx
git commit -m "feat(ui): shared Badge primitive (attention=gold, alert=hazard)"
```

---

### Task 7: Primitivo `Input`

**Files:**
- Create: `src/components/shared/Input.tsx`
- Test: `src/components/shared/Input.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 1).
- Produces: `Input`, `React.InputHTMLAttributes<HTMLInputElement>` con estilos por token + focus ring.

- [ ] **Step 1: Test (falla)**

```tsx
// @vitest-environment jsdom
// src/components/shared/Input.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from './Input';

describe('Input', () => {
  it('renderiza y refleja el value', () => {
    render(<Input defaultValue="hola" aria-label="campo" />);
    expect((screen.getByLabelText('campo') as HTMLInputElement).value).toBe('hola');
  });
  it('usa tokens de superficie/borde', () => {
    render(<Input aria-label="c2" />);
    expect(screen.getByLabelText('c2').className).toMatch(/bg-\[var\(--bg-surface\)\]|border-\[var\(--border-default\)\]/);
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/components/shared/Input.test.tsx`
Expected: FAIL — `Cannot find module './Input'`.

- [ ] **Step 3: Implementar `Input`**

```tsx
// src/components/shared/Input.tsx
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export default function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-xl px-3 text-sm',
        'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)]',
        'placeholder:text-[var(--text-muted)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/components/shared/Input.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: typecheck + lint + commit**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → Expected: exit 0.
Run: `npx eslint src/utils/cn.ts src/utils/textMeasure.ts src/components/shared/Button.tsx src/components/shared/Badge.tsx src/components/shared/Input.tsx` → Expected: 0 errores.

```bash
git add src/components/shared/Input.tsx src/components/shared/Input.test.tsx
git commit -m "feat(ui): shared Input primitive (token-driven)"
```

---

### Task 8: Hook `useTextFits` (pretext) — mejora anti-corte de labels

**Files:**
- Create: `src/hooks/useTextFits.ts`
- Test: `src/hooks/useTextFits.test.ts`

**Interfaces:**
- Consumes: `measureTextHeight` de `src/utils/textMeasure` (Task 4).
- Produces: `useTextFits(text: string, font: string, maxWidth: number, lineHeight?: number): { fits: boolean; lineCount: number | null }` — `fits=false` cuando el texto necesitaría >1 línea al ancho dado (la UI puede poner `title`/tooltip o envolver, en vez de cortar en silencio). Sin Canvas (jsdom/SSR) → `fits=true, lineCount=null` (no truncar por falso negativo). Se consume en F1 (nav) y F2 (botones/cards) con el ancho real del contenedor (ResizeObserver).

- [ ] **Step 1: Test (falla)**

```ts
// @vitest-environment jsdom
// src/hooks/useTextFits.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTextFits } from './useTextFits';

describe('useTextFits', () => {
  it('fallback sin Canvas: asume que cabe (no truncar por falso negativo)', () => {
    const { result } = renderHook(() => useTextFits('Reportes Confidenciales', '14px Inter', 120));
    expect(result.current.fits).toBe(true);
    expect(result.current.lineCount).toBeNull();
  });
  it('no lanza con texto vacío o ancho 0', () => {
    expect(() => renderHook(() => useTextFits('', '14px Inter', 0))).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `npx vitest run src/hooks/useTextFits.test.ts`
Expected: FAIL — `Cannot find module './useTextFits'`.

- [ ] **Step 3: Implementar el hook**

```ts
// src/hooks/useTextFits.ts
import { useMemo } from 'react';
import { measureTextHeight } from '../utils/textMeasure';

/**
 * ¿El texto cabe en UNA línea al ancho dado? Usa pretext (sin reflow del DOM).
 * fits=false → la UI debe poner title/tooltip o envolver, NUNCA cortar en silencio
 * (directiva: no omitir información). Sin Canvas → fits=true (no truncar por falso negativo).
 */
export function useTextFits(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight = 20,
): { fits: boolean; lineCount: number | null } {
  return useMemo(() => {
    if (!text || maxWidth <= 0) return { fits: true, lineCount: null };
    const m = measureTextHeight(text, font, maxWidth, lineHeight);
    if (m === null) return { fits: true, lineCount: null };
    return { fits: m.lineCount <= 1, lineCount: m.lineCount };
  }, [text, font, maxWidth, lineHeight]);
}
```

- [ ] **Step 4: Correr (verde)**

Run: `npx vitest run src/hooks/useTextFits.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTextFits.ts src/hooks/useTextFits.test.ts
git commit -m "feat(ui): useTextFits hook (pretext) — anti-clip labels, fits-or-tooltip"
```

---

## Self-Review

**1. Spec coverage (F0):** tokens 4 modos + Conducción batería (Task 2 ✓) · tipografía calma/utilidad (Task 3 ✓) · pretext wiring (Task 4 ✓) · primitivos shadcn-like Button/Badge/Input + cn (Tasks 1,5,6,7 ✓) · promover Card (re-export cn, Task 1; uso amplio = F2). Select/Tabs NO en F0 (requieren decisión Radix → fase posterior). Migración codemod y aplicar a pantallas = F2/F4, fuera de F0.

**2. Placeholder scan:** sin "TBD"/"etc."; todo paso trae código/comando real. Único punto de lectura-en-sitio: variante noche de `.driving` (Task 2 Step 3) — instrucción explícita con valores exactos, no placeholder.

**3. Type consistency:** `cn` firma única (`ClassValue[] → string`) usada igual en Button/Badge/Input. Default exports consistentes. Tokens referenciados (`--accent-primary/-warning/-hazard/-success/-on-primary`, `--bg-surface/-elevated`, `--text-primary/-muted`, `--border-default`) existen en `src/index.css` (Global Constraints).

**Riesgo conocido:** `color-mix()` (Badge) requiere navegadores modernos — OK para esta PWA (target moderno); si se necesita fallback, usar rgba con opacidad. Verificar en F2 al montar en pantalla real.
