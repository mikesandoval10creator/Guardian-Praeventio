# 🧭 Roadmap maestro — Praeventio Guard

**Única fuente de verdad de pendientes.** Actualizado: 2026-06-28.
Visión: app **real end-to-end** → producción (app.praeventio.net) → tiendas.
Principio: *si no se ve, no existe* · *no eliminar, conectar* · *nada se pierde sin revisar*.

---

## 👉 EL PRÓXIMO PASO (siempre mirá acá primero)

1. **Push del trabajo de hoy** (dashboard + análisis de ramas) — comandos al final.
2. **Dashboard P1** → fusionar los 2 widgets de faena + franja crema = separador vivo.
3. **Ramas P2** → conectar `drain-features-bundle` (6 features rescatadas).

---

## ✅ Hecho y verificado en vivo (hoy)

- Carrusel de módulos **visible** (fix `shrink-0`) + navega a página dedicada `/hub/:id`.
- **KPIs en banda fina** (4 en una fila): 220px → 104px.
- **Mascota única** en el hero (sin duplicado); `guardianMood` preservado.
- **EPP context-aware** por rubro; ISO 45001 reubicada a Normativas.
- **Análisis de 629 ramas**: 306 ya en main, 321 a revisar (ver `docs/audits/branch-review/`).

---

## 🟦 PRIORIDAD 1 — Dashboard "una sola pantalla" (en curso)

Meta: en teléfono todo entra sin scroll para llegar a un menú. Detalle:
`docs/PENDIENTE-DASHBOARD-2026-06-28.md`. Contenido total hoy ~1437px (objetivo ~760).

1. **Fusionar los 2 widgets de faena** — mantener el verde `faena-state-label`,
   absorber la recomendación del índigo "Estado Operativo". Gana espacio + claridad.
2. **Franja crema → separador vivo ultra-fino** (gradiente animado) reutilizable en otras páginas.
3. **EPP compacto** 434px → ~220px.
4. **Boletín climático: comparar y MEJORAR** (NO importar). Tomar lo mejor del
   prototipo (NativeCompass + SunTracker + recomendaciones) + lo nuestro.
5. **Tipografía/padding fluido global** con `clamp()` (skill `frontend-design`).
6. **"Cumplimiento" duplicado** (KPI + tarjeta "Nivel Óptimo") → consolidar.
7. **Persistir `hasEntered`** — al recargar no volver a la landing.
8. **Integrar `pretext`** (github.com/chenglou/pretext) en páginas de módulo
   (texto fluido alrededor de imágenes). NO sirve para densidad del dashboard.

## 🟩 PRIORIDAD 2 — Consolidar 629 ramas (en curso)

Resumen y plan: `docs/audits/branch-review/SUMMARY-2026-06-28.md`.
Regenerar análisis: `scripts/branch-review-analyze.ps1`.

- **Conectar bundles (~17)** — ya son consolidaciones curadas. Orden sugerido:
  `drain-features-bundle` (6 features) · `integration/sprint-k-fase-abcd` (EPP
  detector real) · `feat/frontend-redesign-f0-f1` · `legal-blindaje-bundle` ·
  `drain-vidalegal-bundle` · resto. Cada uno: verificar vigencia + gates antes de mergear.
- **Cluster seguridad (64)** — conectar lo único (no en main); 19+ ya están a salvo.
- **Features sueltas de alto valor** — FallDetectionMonitor, driving lifecycle,
  createProjectScopedStore, digital-twin-ui-honesty.
- **Limpieza** — borrar las 306 ya-en-main + 40 ya-merged + dependabot (regenerables).

## 🟨 PRIORIDAD 3 — Embudo PLG / freemium

- Guest mode (slice 2 hecho: invitado ve Faena Demo). Falta: enforcement
  (report-only → bloqueo), facturación por proyectos **activos**, reabrir proyectos sin perder datos.
- **Landing vs `tiers.ts`** — la landing muestra Gratuito $0/10, Comité $10/25,
  Departamento $30/100, Enterprise $50/250+. Verificar que condigan con el código real.

## 🟥 PRIORIDAD 4 — Camino a producción

- E2E harness: resolver blocker `action-balance-card` (query projects-list denegada por reglas).
- Claves prod (4/5 ok) → secrets a **GCP Secret Manager**.
- Deploy **Cloud Run** → DNS **app.praeventio.net**.
- **Play Store** (Android) + **App Store** (iOS) vía Capacitor.

---

## 🚩 Flags / cuidado operativo

- `public/.well-known/assetlinks.json` modificado sin que esta sesión lo tocara
  (firma Android, seguridad). **Revisar diff aparte**, no incluir en PRs de UI.
- Editar archivos por Python/heredoc (la herramienta Edit corrompe en este host).
- Git masivo se cuelga en el sandbox → usar el script local PowerShell.
- No commitear: `graphify-out/`, `.codex/`, `.opencode/`, `alpha/`, `audit_*.json`.

---

## 💾 Push pendiente del trabajo de hoy

```
git add docs/ scripts/branch-review-analyze.ps1 scripts/branch-review-analyze.sh src/components/dashboard/KpiRow.tsx src/components/dashboard/ModuleGroupsGrid.tsx src/components/dashboard/ModuleGroupsGrid.test.tsx src/pages/Dashboard.tsx
git commit -m "feat(dashboard): KPIs banda + carrusel shrink-0/nav + mascota unica; docs: roadmap maestro + revision 629 ramas"
git push
```
(No agregar `assetlinks.json` ni lo no-trackeado.)
