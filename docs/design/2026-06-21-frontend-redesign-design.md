# Rediseño de Frontend — Praeventio Guard

**Fecha:** 2026-06-21 · **Estado:** borrador para revisión del fundador · **Tipo:** diseño (brainstorming → spec)

Origen: el backend funciona (app viva en Cloud Run, núcleo de vida real). El frontend se siente **abrumador** y poco pulido. Decisión del fundador: **evolucionar, no reescribir** — mantener los 4 modos y todas las features ya cableadas, y subir el frontend a nivel **Apple / Xiaomi (MIUI)**: calmado, elegante, fluido, navegable paso a paso.

Insumos: estudio comparativo (workflow `wql6vwb68`) del prototipo `praevium-guard` (shadcn/ui) vs. la app actual, + auditoría de problemas de UX con `file:line`, + decisión de usar `@chenglou/pretext` como motor de tipografía/layout.

---

## 1. Principios

1. **Evolucionar sobre la base existente.** El sistema de 4 modos vive en CSS-vars semánticas (`src/index.css`) — es requisito de fundador y NO se toca; todo el look se refina **encima** de esos tokens.
2. **Calma y jerarquía** (Apple/Xiaomi). Lo opuesto a lo actual (`font-black` ×2310, MAYÚS+tracking ×2607, fuentes 7–10px).
3. **Revelación progresiva.** Menú → submenú → sub-submenú. La persona entiende la app paso a paso, sin ver 107 ítems de golpe.
4. **Fluidez sin reflow** con `@chenglou/pretext` (medición/layout de texto sin tocar el DOM).
5. **Una sola fuente de verdad** de navegación (hoy `sidebarMenuGroups.ts` y `moduleGroups.ts` divergen).
6. **No romper lo que funciona:** features vida-safety cableadas, backend, audit-logs, tier-gating server-side.

---

## 2. Sistema visual

**Tokens (intactos):** `src/index.css` (`--bg-canvas/-surface/-elevated`, `--text-*`, `--accent-*`, `--border-*`, `--shadow-*`) por modo (`:root/.dark/.driving/.emergency`). Acento de marca: **teal `#14b8a6`** (favorito) + petróleo + dorado; coral solo alerta.

**Primitivos compartidos (nuevo `src/components/shared/ui/`):** construir set shadcn-like con `cn()` + tokens — `Button` (variantes default/secondary/ghost/destructive + size), `Input`, `Badge`, `Select`, `Tabs`. `Card.tsx` ya existe (nivel shadcn) → **promover su uso** (hoy solo ~14%). Patrón: CVA variante×size, `focus-visible:ring-2 ring-offset-2`, transiciones 200–300ms.

**Tipografía (cambio de alto impacto, bajo riesgo):** escala (display/title/body/caption con line-height); bajar default `font-black → font-semibold`; convertir MAYÚS+tracking en utilidad opt-in `.label-eyebrow`; **prohibir fuentes <12px** (erradicar `text-[7px]/[9px]/[10px]`). Mantener Inter con `opsz/cv11/ss01`.

**Elevación/forma:** sombras suaves tintadas (no negro plano) `--shadow-elegant` (long-throw) + `--shadow-glow` para énfasis sobre tarjetas `shadow-sm`; subir `--radius` a ~0.625–0.75rem.

**Motion:** estandarizar `tailwindcss-animate` (modal = fade+zoom-95, 200ms) + la micro-interacción GSAP de `Card` (respeta `prefers-reduced-motion`) + `framer-motion` para transición de página. Press feedback `scale 1.02/0.98`.

**Higiene:** unificar el doble theming (`AppModeContext` canónico + `ThemeContext` legacy escriben ambos `.dark`) → un solo dueño; codemod `dark:bg-zinc-*` → `bg-surface`, hex crudo → `var(--accent-*)` empezando por `RootLayout`/`Sidebar`/`Dashboard`.

---

## 3. Navegación / Arquitectura de información

**9 bloques** (fusionado "IA y Coach" + "Innovación"): Principal · Gestión Operativa · Prevención y Riesgos · Salud Ocupacional · Cumplimiento · Emergencias · Conocimiento · IA e Innovación · Administración.

**Patrón (del prototipo, adaptado):**
- **Sidebar = 9 bloques colapsables, anidados** (bloque → submenú → sub-submenú), acordeón **un-bloque-abierto-a-la-vez**. Reemplaza el grupo monolítico "Centro de Mando" (~107 ítems planos en `sidebarMenuGroups.ts`).
- **Fuente de verdad única:** un catálogo declarativo (`{label, icon, to, children[]}`) del que se derivan sidebar Y carrusel. Elimina la divergencia `sidebarMenuGroups.ts` ↔ `moduleGroups.ts`.
- **Buscador "¿qué necesitas?"** (cmdk-style) que salta a cualquier módulo — escape para usuarios expertos.
- **Acciones críticas en Sheet** (Emergencia, Fast Check) sin cambiar de ruta (no se pierde contexto).
- **Selector de modos en el header** (Claro/Oscuro/Conducir/Emergencia) — sacarlo del dock bottom-right que choca con el chat IA.
- **Home = hub priorizado por urgencia** (vital arriba: estado faena/emergencia/fast-check; catálogo después).

---

## 4. Integración de pretext (`@chenglou/pretext`)

Motor de medición/layout de texto sin reflow. Casos de uso en Praeventio:
- **Virtualización** de listas grandes (catálogo de módulos, inbox, historiales) — alturas exactas sin adivinar.
- **Labels que no se corten** — verificar en dev/CI que botones/menús (es-CL, textos largos) entren sin desbordarse (la queja directa del fundador).
- **Chat del Guardián en streaming + typewriter** — texto que fluye sin saltos.
- **Cero layout-shift** al cargar datos → sensación pulida.

Integración: `npm i @chenglou/pretext`; helper `src/lib/textMeasure.ts` que envuelve `prepare()/layout()` con la fuente/escala del design system; usar en virtualización + verificación de labels. Requiere `Intl.Segmenter` + Canvas 2D (OK en navegadores objetivo). Fuente nombrada (no `system-ui`).

---

## 5. Bugs de UX confirmados (a corregir en el mismo paquete)

| # | Problema | Fix | Ubicación |
|---|---|---|---|
| 1 | ISO 45001 enlaza a página de **compra** de iso.org | Vista de detalle propia (drawer) con guía/resumen de cada control; link externo secundario | `Iso45001Catalog` + `iso45001.ts` |
| 2 | Carrusel renderiza cada categoría **2 veces** (marquee `[...x, ...x]`) | `aria-hidden` en la copia o carrusel scroll-snap sin duplicar | `ModuleGroupsGrid` (Dashboard.tsx:539) |
| 3 | Selector de modos **choca** con chat IA (bottom-right z-50/z-40) | Modos al header; resolver z-index | `RootLayout` + `ModeSwitcher` |
| 4 | "Conducir" no navega → se ve "fuera de contexto" | Al activar driving, navegar a la page full-screen; consolidar 3 rutas (`/safe-driving`,`/driving-safety`,`/driving-incidents`) | `ModeSwitcher.tsx:48` + `Driving.tsx` |
| 5 | Clima bloqueado por **CSP** (open-meteo no en connect-src) | Agregar `api.open-meteo.com`+`air-quality-api.open-meteo.com` a `CONNECT_SRC_ORIGINS` (o proxy backend) | `securityHeaders` + `useWeather.ts` |
| 6 | Imágenes **unsplash** frágiles | Mover a assets locales servidos por `self` (mejor offline/PWA) | `SafetyFeed.tsx:175` y otros |
| 7 | Widgets del dashboard faltantes / carrusel "estaba abajo y ya no" | Restaurar/curar widgets + decidir posición del carrusel | `Dashboard.tsx` |

---

## 6. Rendimiento / carga

- pretext (no reflow) + virtualización → scroll fluido y menos jank.
- Lazy-load por bloque/ruta (ya hay 219 páginas lazy); revisar code-splitting del catálogo.
- Mover heroes/thumbnails a assets locales (PWA offline-friendly).
- Medir: Lighthouse / Web Vitals antes-después (LCP, CLS=0 objetivo).

---

## 7. Plan por fases (paso a paso)

- **F0 — Fundación visual.** Primitivos `ui/*` (Button/Input/Badge/Select), escala tipográfica, kill `font-black`/MAYÚS-default/<12px, unificar theming, subir `--radius`. *(sin cambiar features)*
- **F1 — Navegación.** Catálogo único → sidebar 9 bloques anidados (acordeón) + buscador + modos al header. Baja la carga cognitiva.
- **F2 — Home/Dashboard.** Hub priorizado, widgets curados, carrusel sin duplicado, acciones críticas en Sheet.
- **F3 — Bugs UX** (tabla §5).
- **F4 — pretext.** Helper + virtualización + verificación de labels + chat streaming.
- **F5 — Pulido.** Motion consistente, estados loading (shimmer), dark/driving/emergency revisados, a11y.

Cada fase: 1 PR, review adversarial, verificación en navegador (Playwright snapshot + screenshot), sin romper gates (connectivity/router-test/i18n/any).

---

## 8. Preparación de lanzamiento — Web · Android (Google) · iOS (Apple)

**Web** — ✅ vivo en Cloud Run (`/api/health` 200). Falta: este rediseño + fixes §5 + (opcional) App Check. Auto-deploy en CI-verde.

**Android (Google Play)** — Capacitor 8 ya envuelve la SPA. Pasos: build firmado (keystore) + `assetlinks.json` (fingerprint), Play Console (ficha, política privacidad), **claves cowork**: `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (hoy vacío `{}`), `GOOGLE_PLAY_RTDN_TOPIC` (Pub/Sub), `ANDROID_PACKAGE_NAME`. IAP solo tras publicar.

**iOS (Apple)** — **decisión: sí** entra. Pasos: Apple Developer Program ($99/año), App Store Connect, `AASA` (universal links), push APNs, **claves cowork**: `APPLE_BUNDLE_ID`, `APPLE_KEY_ID`, `APPLE_ISSUER_ID`, `APPLE_API_KEY_PATH` (.p8 App Store Connect API). Capacitor build iOS.

Estas claves son **cowork** (consola del proveedor) — se cablean cuando toque, separado del frontend. El frontend NO las necesita para verse bien.

---

## 9. Fuera de alcance / NO tocar

- El sistema de 4 modos (CSS-vars) — solo se refina encima.
- Backend, audit-logs, tier-gating server-side, features vida-safety cableadas.
- Deuda técnica de cowork (claves/secretos) — tracked en `docs/PENDIENTE.md`, track aparte.

---

## 10. Verificación

- Por fase: typecheck 0, lint touched 0, gates verdes, Playwright (snapshot + screenshot del antes/después), revisar los 4 modos.
- pretext: test de "labels no se cortan" (dev-time) sobre botones/menús clave.
- Sin merge a `main` sin review adversarial (rutas vida-safety).
