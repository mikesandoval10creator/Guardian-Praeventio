# Pendientes — Dashboard "una sola pantalla" + UX (2026-06-28)

Sesión de pulido del Dashboard guest/demo. Principio rector: **si no se ve, no
existe**. Objetivo: que en teléfono **todo el dashboard entre en una sola
pantalla** sin scroll para llegar a cualquier menú; dentro de cada módulo
(página dedicada) sí se puede deslizar.

## ✅ Hecho y verificado en vivo (Chrome DevTools)

- **Carrusel de módulos visible** — root cause: la `<section>` con
  `overflow:hidden` dentro de un `flex flex-col` colapsaba a `height:0`
  (`min-height:0`). Fix: `shrink-0` en la sección.
  `src/components/dashboard/ModuleGroupsGrid.tsx`. Medido: 0px → 168px.
- **Carrusel → página dedicada** — tocar un grupo navega a `/hub/:id`
  (ModuleHub), glove-friendly, sin cajón inline.
  `src/components/dashboard/ModuleGroupsGrid.tsx` + `.test.tsx`.
- **Mascota única en el hero** — se quitó la `GuardianMascot` suelta
  duplicada; queda la de `DashboardHero` (mood por hora + auto-emergencia).
  `src/pages/Dashboard.tsx`. La lógica `guardianMood` se PRESERVA para
  reusar el mood en más puntos del frontend.
- **KPIs en banda fina** — `grid-cols-2` → `grid-cols-4` (4 en una fila) +
  tipografía fluida + sub oculto en móvil. `src/components/dashboard/KpiRow.tsx`.
  Medido: 220px → 104px.
- **ISO 45001 reubicada** — fuera del dashboard, ahora en Normatives.
  `src/pages/Normatives.tsx` + `src/pages/Dashboard.tsx`.
- **EPP context-aware** — un solo widget para todos, rubro auto-detectado.

## 🔜 Próximo (orden sugerido, uno por uno + verificar en vivo)

1. **Fusionar los DOS widgets de faena** (confirmado por el fundador):
   - Mantener el verde limpio `faena-state-label` (`bg-emerald-500/15`,
     "Operativa · Faena operando normal").
   - Quitar el índigo redundante "Estado Operativo · Faena Normal"
     (`bg-indigo-500/5`) — **preservar** su snippet de Recomendación
     fusionándolo en el verde. Gana espacio + claridad.
2. **Franja crema → separador vivo ultra-fino**. Es un elemento con
   **gradiente animado** (por eso "se mueve y se ve bonita") que hoy ocupa
   espacio vacío sin función clara. Decisión del fundador: dejarlo **ultra-fino**
   (solo se ve el movimiento), como **separador elegante reutilizable** en las
   demás páginas. (Localizar el componente exacto que lo renderiza.)
3. **EPP compacto** — de 434px a ~220px (mascota + EPP en fila/chips,
   mantener el rubro visible). `src/components/epp/EppSelector.tsx`.
4. **Boletín climático: comparar y MEJORAR (no importar)**. El del prototipo
   (`WeatherBulletin.tsx`: NativeCompass + SunTracker + recomendaciones +
   ubicación limpia, grid 2-col) tiene buenas ideas. Tomar lo mejor de ambos
   para que producción tenga lo óptimo. NO copiar tal cual.
5. **Tipografía/padding fluido global** — `clamp()` con la skill
   `frontend-design` para afinar el resto sin que nada se rompa.
6. **Integrar `pretext`** (`npm i @chenglou/pretext`, repo
   github.com/chenglou/pretext) en las **páginas dedicadas de módulo** — flujo
   de texto alrededor de imágenes/mascota (estilo revista) + shrinkwrap de
   etiquetas. NO sirve para densidad del dashboard (eso es CSS).
7. **Persistir `hasEntered`** — hoy al recargar vuelve a la landing en vez de
   quedarse en el dashboard guest.
8. **"Cumplimiento" duplicado** — el KPI "Cumplimiento 100%" y la tarjeta
   "Nivel Óptimo 100%" muestran lo mismo. Consolidar.

## 🚩 Flags / cuidado

- **`public/.well-known/assetlinks.json` aparece modificado** (−5 líneas) sin
  que esta sesión lo tocara. Es el archivo de firma Android (seguridad, raíz del
  incidente #1039). **Revisar el diff aparte** y NO incluirlo en PRs de UI.
- `scripts/render-ratchet-baseline.json` cambió (regenerado al consolidar EPP).
  Tocar baselines dispara el scope-gate #24 (advisory).
- Artefactos sin trackear a ignorar (no commitear): `graphify-out/`, `.codex/`,
  `.opencode/`, `alpha/`, `audit_*.json`, `docs/reviews/`.

## Roadmap mayor (de antes, sigue pendiente)

- Embudo PLG: enforcement (report-only → bloqueo), facturación por proyectos
  ACTIVOS, reabrir proyectos sin perder datos.
- **Planes de la landing vs `tiers.ts`** — la landing muestra Gratuito $0/10,
  Comité $10/25, Departamento $30/100, Enterprise $50/250+. Verificar que
  condigan con `tiers.ts` (el fundador notó que no condicen).
- OAuth (Calendar/Fit), secrets → GCP Secret Manager, deploy Cloud Run, DNS
  app.praeventio.net, Play Store, App Store.
