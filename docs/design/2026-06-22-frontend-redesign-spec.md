# Spec de diseño — Rediseño de frontend (2026-06-22)

> Estado: **APROBADO en dirección por el fundador** (sesión 2026-06-22, vía mockups).
> Pendiente: review final de este doc → luego plan por fases (`writing-plans`).
> Rama: `feat/frontend-redesign`. Backend NO se toca (funciona).

## 1. Objetivo y principio rector

Hacer el frontend **visualmente atractivo, profesional y elegante (tipo Apple)** y, sobre todo, **navegable** — hoy la app abruma (sidebar de ~107 ítems, acabado "gritón", info importante que no se ve bien).

**Principio rector: EVOLUCIONAR, no reescribir.** Se mantienen los 4 modos y TODAS las features ya cableadas. Encima se adoptan los patrones del prototipo `praevium-guard` (shadcn/ui) + `@chenglou/pretext` para tipografía. Riesgo bajo, impacto alto.

**Regla de oro (founder):** *calma en el estilo, riqueza en la información.* Lo calmado (peso, color, aire) NUNCA implica omitir datos importantes. La densidad se logra con **jerarquía + progressive disclosure**, no amontonando ni a gritos (referencia: apps Salud/Bolsa/Clima de Apple — densas pero serenas).

## 2. Base intocable — sistema de 4 modos

El requisito de fundador vive en CSS-vars semánticas (`src/index.css`) redefinidas por modo. **Esa capa NO se bota; se refina encima.** Los 4 modos:

1. **Light** — claro, calmado, frío suave.
2. **Dark** — oscuro frío (petróleo-verde).
3. **Conducción segura (driving)** — oscuro **cálido (grafito-ámbar)**, alto contraste, texto grande, glanceable al volante; auto día/noche.
4. **Emergencia** — autoridad serena: alto contraste, rojo SOLO para la acción crítica (directiva: nunca pánico).

Cross-cutting a preservar: `easy-reading`, `high-contrast`, `glove-friendly` (tap 44→56px), `low-connectivity`, focus-visible global. Viven en la misma capa de tokens.

## 3. Sistema de color — paleta por modo (DECISIÓN 2026-06-22)

**Light / Dark / Emergencia: MANTENER la paleta existente de `src/index.css`** (ya on-brand: teal + petróleo + oro + rojo) — solo refinar (contraste WCAG, "requiere atención" → dorado). **Conducción: CAMBIA** a oscuro-cálido para **AHORRO DE BATERÍA (OLED apaga píxeles negros)** + glanceable (el actual es blanco → quema batería en turno largo al volante).

Tokens semánticos reales (ya existen en `src/index.css`, bloques `:root`/`.dark`/`.driving`/`.emergency`): `--accent-primary` = marca · `--accent-warning` = atención (dorado/ámbar) · `--accent-hazard` = alerta/crítico · `--accent-success` · `--accent-info`.

| Token | Light (`:root`) | Dark (`.dark`) | **Conducción (`.driving`) — NUEVO** | Emergencia (`.emergency`) |
|---|---|---|---|---|
| `--bg-canvas` | `#fafafa` ✓ | `#061f2d` ✓ | `#0d0a05` (near-black cálido) | `#000000` ✓ |
| `--bg-surface` | `#ffffff` ✓ | `#0a2e42` ✓ | `#1a160d` | `#0a0a0a` ✓ |
| `--bg-elevated` | _(existente)_ ✓ | _(existente)_ ✓ | `#241f12` | _(existente)_ ✓ |
| `--text-primary` | `#18181b` ✓ | `#ffffff` ✓ | `#fff7e9` | `#ffffff` ✓ |
| `--text-secondary` | _(existente)_ ✓ | _(existente)_ ✓ | `#cabfa1` | _(existente)_ ✓ |
| `--accent-primary` (marca) | `#4db6ac` teal ✓ | `#d4af37` oro ✓ | `#5fd9c8` teal glanceable | `#dc2626` SOS ✓ |
| `--accent-warning` (atención) | `#f59e0b` ✓ | `#f59e0b` ✓ | `#ffce5a` | `#f59e0b` ✓ |
| `--accent-hazard` (alerta) | `#dc2626` ✓ | `#ef4444` ✓ | `#ff5a4d` | `#ffffff` (inv.) ✓ |
| `--border-default` | `rgba(24,24,27,.10)` ✓ | `rgba(212,175,55,.30)` ✓ | `rgba(255,247,233,.12)` | `rgba(220,38,38,.50)` ✓ |

`✓` = se mantiene; solo verificar contraste. **Únicamente la columna Conducción cambia de valores.**

Notas:
- **Conducción**: base oscura por **batería** (OLED) + escala tipográfica +~30%, indicadores gruesos, tap grande, mínima distracción. Variante día/noche: **ambas oscuras-cálidas** ahora (no blanco).
- **Emergencia**: negro ya es óptimo de batería; rojo solo para la acción crítica (SOS).
- "Requiere atención" → siempre `--accent-warning` (dorado/ámbar).
- Valores nuevos de Conducción = punto de partida; **calibrar contraste WCAG AA** (texto sobre acentos).

## 4. Tipografía

- **Una sola familia** como fuente de verdad (Inter con `font-feature-settings` cv11/ss01 + `opsz`, igual que el prototipo). Opcional: display secundario, pero sin la deriva de 3 fuentes del prototipo.
- **Escala**: `display` / `title` / `body` / `caption` con line-height definido.
- **Solo 2 pesos**: títulos `semibold` (600), cuerpo `regular` (400). **Eliminar `font-black`** como default (hoy ×2310).
- **Sentence case**. MAYÚSCULAS solo como utilidad opt-in `.label-eyebrow` (hoy uppercase+tracking ×2607 por defecto → fuera).
- **Mínimo legible 12px** — erradicar `text-[7px]/[9px]/[10px]`.
- **`@chenglou/pretext`** (v0.0.8, instalado): medir labels/párrafos sin reflow → (a) garantizar que botones/menús **no se corten** (queja directa del fundador), (b) virtualización de listas largas, (c) cero layout-shift. Capa de tipografía/precisión, no de componentes.

## 5. Componentes (shadcn-like sobre los tokens existentes)

Construir en `src/components/shared` el set mínimo, todos sobre las CSS-vars de los 4 modos:
- `Button` (variantes default/secondary/ghost/destructive + size), `Input`, `Badge`, `Select`, `Tabs`. **`Card` ya existe** (nivel shadcn) → promover su uso (hoy ~14% adopción).
- Recipes: `cn()` (twMerge+clsx), CVA variant×size, `focus-visible:ring-2 ring-offset-2`, radius unificado (subir a ~12-16px), **sombras suaves y largas** (drop tintado + glow de énfasis sobre cards `shadow-sm`).
- Esto da consistencia a escala **sin** rediseñar los ~430 componentes a mano; el resto migra con codemod/lint (`dark:bg-zinc-*`→`bg-surface`, hex crudo→token).

## 6. Movimiento

- Durations 200–300ms; easings nombrados (`cubic-bezier(0.4,0,0.2,1)` smooth + bounce).
- Reusar lo bueno ya presente: `framer-motion` (transición de página) + micro-interacción GSAP de `Card` (respeta `prefers-reduced-motion`). Estandarizar, no añadir variantes ad-hoc.
- Press feedback `scale 1.02/0.98`; modales `fade+zoom-95`; skeleton/shimmer para carga.

## 7. Navegación / Arquitectura de información

**Problema:** el grupo `Centro de Mando` del sidebar = ~107 ítems planos en un solo acordeón → "lista infinita". El carrusel **ya tiene 10 categorías limpias** (`moduleGroups.ts`) que el sidebar no usa.

**Solución:**
- **10 bloques colapsables** como columna vertebral (Principal · Gestión Operativa · Prevención y Riesgos · Salud Ocupacional · Cumplimiento · Emergencias · Conocimiento · IA y Coach · Innovación · Administración). Un solo grupo abierto a la vez.
- **Fuente única de navegación:** el sidebar deriva del MISMO dato que el carrusel (hoy `sidebarMenuGroups.ts` y `moduleGroups.ts` divergen). Unificar.
- **Buscador arriba** ("¿qué necesitas?") salta a cualquier módulo (atajo para los 80+).
- **Acciones críticas (Emergencia, Fast Check) en panel lateral (Sheet)** sin cambiar de ruta → no se pierde contexto.
- **Selector de 4 modos en el header** (hoy choca con el chat IA en bottom-right z-50/z-40).
- Hub/Home priorizado por urgencia (vital arriba), catálogo después.

## 8. Densidad

- Modo **cómodo** (default, lo mostrado) y modo **compacto** opcional (más info por pantalla) — densidad ajustable por el usuario, ambos calmados.

## 9. Bugs a corregir (parte del mismo paquete)

| # | Bug | Fix |
|---|---|---|
| B1 | ISO 45001: cada ítem enlaza a la **página de compra** de iso.org | Vista de detalle propia (drawer/modal) con guía/resumen de cada control (`iso45001.ts` ya modela 10); link externo secundario |
| B2 | Selector de modos **choca** con el chat IA (bottom-right) | Mover modos al header / colapsar a 1 toggle; resolver z-index |
| B3 | Modo Conducción "fuera de contexto" (setMode no navega) | Al activar Conducción, **navegar a la ruta full-screen** además de `setMode('driving')`; consolidar rutas dispersas |
| B4 | Carrusel renderiza cada categoría **2 veces** (`[...moduleGroups, ...moduleGroups]`) | `aria-hidden` en la copia del marquee, o scroll-snap sin duplicar el array |
| B5 | Boletín climático **bloqueado por CSP** (open-meteo no en `connect-src`) | Agregar `api.open-meteo.com` + `air-quality-api.open-meteo.com` a `CONNECT_SRC_ORIGINS` (o proxy backend) |
| B6 | Imágenes **unsplash** hardcodeadas fallan | Mover heroes/thumbnails a assets locales (`self`, offline-friendly PWA) |
| B7 | Doble theming: `AppModeContext` (canónico) + `ThemeContext` (legacy) ambos escriben `.dark` | Unificar en `AppModeContext`; retirar/reducir `ThemeContext` a shim; quitar `!important` parche |

## 10. Alcance y NO-objetivos

- **NO** se toca el backend (funciona) ni se rompen features.
- **NO** se rediseñan 430 componentes a mano → primitivos compartidos + codemod/lint asistido, empezando por las superficies más vistas (RootLayout, Sidebar, Dashboard).
- **NO** se bota el sistema de 4 modos ni los modos de accesibilidad.
- **NO** se adopta la paleta del prototipo (tiene bugs: fondo verde, 3 fuentes); solo sus **patrones**.

## 11. Plan por fases (resumen — detalle en `writing-plans`)

- **F0 — Fundamentos:** tokens de color (4 paletas, tabla §3) + escala tipográfica + primitivos shared (Button/Input/Badge/Select; promover Card) + wiring de pretext. Sin cambiar pantallas aún.
- **F1 — Navegación:** unificar fuente de navegación → 10 bloques colapsables + buscador + selector de modos al header + acciones críticas en Sheet. (Cierra la queja "abruma".)
- **F2 — Superficies clave al nuevo look:** RootLayout, Sidebar, Dashboard (widgets + carrusel sin duplicar), con calma+densidad.
- **F3 — Bugs B1–B7** + modo Conducción navega + ISO detail view.
- **F4 — Migración asistida** (codemod `dark:*`/hex→tokens) por superficie + unificar theming.
- **F5 — Pulido:** densidad compacta, movimiento estandarizado, verificación de contraste WCAG + no-overflow con pretext.

Cada fase: PR propio, review, sin romper lo verde.
