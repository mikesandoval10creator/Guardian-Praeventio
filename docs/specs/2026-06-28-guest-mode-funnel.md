# Spec — Guest Mode + Embudo Freemium (Product-Led Growth)

**Fecha:** 2026-06-28 · **Autor:** Claude (sesión cowork) · **Estado:** propuesto
**Principio rector:** hacer REAL el embudo. Vida-segura SIEMPRE gratis (ADR 0021);
el gating es solo para gestión/escala. Sin clientes aún → libertad para cambiar.

## 1. Estrategia (el embudo, en palabras del fundador)

1. **Adquisición — usar sin login.** El visitante explora la app y se "enamora"
   ANTES de pedirle cuenta (como los juegos: probar primero).
2. **Activación — crear cuenta.** Solo al querer GUARDAR lo suyo o CREAR un
   proyecto se pide cuenta. Gratis hasta **3 personas / 1 proyecto**.
3. **Monetización por escala.** >3 personas o varios proyectos → suscripción.
   A ≥25 personas (gatillo legal CPHS) → plan **Plata** (Comité Paritario).
4. **Ciclo de vida.** Proyecto dura ~2 años → se CIERRA → se abre otro. Datos NO
   se pierden. Se cobra por proyectos **ACTIVOS**, no acumulados.

## 2. Estado real hoy (mapeo con archivo:línea)

| Pieza | Veredicto | Evidencia |
|---|---|---|
| Acceso invitado (sin login) | **NO EXISTE** | `App.tsx:387-397` gate landing/splash; el invitado termina en `/login`. RootLayout NO bloquea (`RootLayout.tsx:403` `<Outlet/>`), el rebote es por estado/auth — **pendiente clavar la línea exacta**. |
| `GuestSaveModal` (1→2) | **YA CABLEADO** (graphify) | `ProjectContext.tsx:7` importa + `:322` renderiza; `createProject()` `:199-203` abre el modal cuando `!user`. El embudo 1→2 funciona — solo falta que el invitado pueda ENTRAR a disparar el create. |
| Tiers/planes (2→3) | **IMPLEMENTADO** | `tiers.ts:79-173`: gratis(3w/1p,$0), cobre(72/3), **plata(99/10, banda CPHS ≥25 = Comité Paritario)**, oro(499/50), titanio(1999/100), platino(9999/500), diamante(∞). |
| Enforcement de límites | **REPORT-ONLY** | `scaleCaps.ts:93-110` evalúa pero no bloquea; `requireTier.ts:76` puede `enforce:false`; logs `tier_gate_would_block`. NO frena. |
| Cierre de proyecto | **IMPLEMENTADO** | `ProjectClosure.tsx` (initiate/finalize, datos retenidos). |
| Reabrir proyecto | **NO EXISTE** | — |
| Facturación por activos | **NO EXISTE** | conteo es TOTAL, no activos; cerrar NO libera cupo. |
| Gantt navegable | **HUÉRFANO** | `GanttProjectView.tsx` existe, no montado en `App.tsx` Routes. |
| Planes en landing vs reales | **DESALINEADO** | `LandingPage.tsx:37` muestra planes (Gratis/Comité/Empresa) que NO condicen con los 7 tiers de `tiers.ts`. |

## 3. Decisiones de diseño (cerradas con el fundador)

- Modo invitado = **Explorar + datos demo**: navega toda la app con un proyecto
  de demostración (datos de ejemplo). Al crear/guardar lo suyo → `GuestSaveModal`.
- **Vida-segura nunca se gatea** (SOS, emergencia, ManDown, reportar incidente) —
  accesible para invitado también.
- El proyecto demo es **read-only** para el invitado (no escribe Firestore prod).
- Fuente única de verdad de planes = `tiers.ts`. La landing consume de ahí.

## 4. Slices de implementación (un PR por slice, TDD estricto)

### Slice 1 — Acceso invitado (quitar el login forzado)
- **Investigar y clavar** el punto exacto que rebota al invitado a `/login`
  (trazar con browser limpio + código; candidatos: efecto en provider de auth,
  Splash, o estado `hasEntered`).
- Convertirlo para que el invitado entre al shell (`RootLayout` ya rinde `<Outlet/>`).
- Introducir un flag `guestMode` explícito (contexto liviano o derivado
  `hasEntered && !user`), NO romper el flujo autenticado.
- **Test:** routing test — invitado en `/` llega al Dashboard sin `/login`.
- **Aceptación:** clic en "Entrar" → Dashboard, sin login forzado.

### Slice 2 — Proyecto demo con datos
- Inyectar un proyecto demo (read-only) en `ProjectContext` cuando `guestMode`.
  Reusar `seedService`/datos demo existentes; NO escribir Firestore prod.
- **Test:** ProjectContext en guest expone el proyecto demo seleccionado.
- **Aceptación:** invitado ve dashboards/listas POBLADOS, no vacíos.

### Slice 3 — `GuestSaveModal` (1→2) — YA MAYORMENTE HECHO (graphify)
- `ProjectContext.createProject()` ya abre `GuestSaveModal` cuando `!user`
  (`ProjectContext.tsx:199-203`, modal en `:322`). FUNCIONA.
- Resta solo: extender el mismo patrón a otras acciones de guardado que hoy no
  lo hagan (agregar trabajador, iniciar proceso) si se confirma que faltan.
- **Test:** invitado intenta crear proyecto → modal visible (probablemente ya pasa).

### Slice 4 — Alinear planes de la landing con `tiers.ts`
- `LandingPage` y pricing consumen los 7 tiers reales desde `tiers.ts`
  (single source of truth). Usar skill `frontend-design` para el rediseño.
- **Test:** la landing renderiza los planes desde `tiers.ts` (no hardcode).
- **Aceptación:** los planes mostrados == los que la app realmente ofrece.

### Slice 5 (posterior) — Escala y ciclo de vida
- Flip enforcement report-only → bloqueo real (402) al exceder límites.
- Facturación por proyectos **activos**; cerrar libera cupo; reabrir.
- Montar `GanttProjectView` en navegación.

## 5. Guardarraíles (CLAUDE.md)
- TDD estricto (RED→GREEN→REFACTOR); tests junto al código.
- Cambios de estado → `audit_logs` (server estampa uid/tenant).
- Montar componentes huérfanos → regenerar baselines de connectivity/render
  (`--write`) en el mismo PR que los cablea.
- Vida-segura NUNCA gateada (ADR 0021). Gating solo gestión/escala.
- Copy en español-CL.

## 6. Orden sugerido
Slice 1 → 2 → 3 → 4 (embudo navegable y honesto) → 5 (monetización dura).
