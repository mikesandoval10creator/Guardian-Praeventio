# Handoff a Claude Code — PR Sprint E2E-99

> Este archivo es un traspaso para que **Claude Code** (corriendo localmente en
> esta máquina, con acceso a git nativo y a las credenciales de GitHub del
> usuario) cree el Pull Request. El asistente de Cowork ya aplicó los cambios de
> código en el working tree pero NO puede hacer commit/push (su sandbox no puede
> escribir en `.git` de la unidad D: y no tiene las credenciales de GitHub).

## Instrucción para Claude Code (pégala como prompt)

> "Lee `CLAUDE_CODE_PR_HANDOFF.md` y ejecútalo: borra el index.lock si existe,
> haz commit SOLO de los archivos listados, push de la rama y abre el PR contra
> `main`. No incluyas los `*.router.test.ts` no relacionados."

## Estado actual del repo

- Rama de trabajo: **`feat/e2e-coverage-99-percent`** (ya creada; debería estar activa).
- Repo: `https://github.com/mikesandoval10creator/Guardian-Praeventio.git`
- Base del PR: `main`
- Los cambios de código YA están en el working tree (sin commitear).

## ⚠️ Bloqueo conocido: index.lock

Quedó un `.git/index.lock` huérfano (creado por el sandbox de Cowork, que no
pudo borrarlo por permisos). **Bórralo primero**, o cualquier comando git fallará:

```bat
del ".git\index.lock"
```

## Paso 1 — Verificar rama

```bat
git rev-parse --abbrev-ref HEAD
:: Si no estás en feat/e2e-coverage-99-percent:
git checkout feat/e2e-coverage-99-percent  ::  o  git checkout -b feat/e2e-coverage-99-percent
```

## Paso 2 — Stage SOLO estos 11 archivos del Sprint E2E-99

NO incluir los archivos `src/server/routes/*.router.test.ts` (son trabajo no
relacionado que estaba untracked en el repo).

```bat
git add ^
  tests/e2e/sos-button.spec.ts ^
  tests/e2e/process-lifecycle.spec.ts ^
  tests/e2e/offline-resilience.spec.ts ^
  tests/e2e/fixtures/navigation.ts ^
  tests/e2e/landing-smoke.spec.ts ^
  tests/e2e/smoke-pages.spec.ts ^
  src/components/emergency/SOSButton.tsx ^
  src/pages/Findings.tsx ^
  src/pages/CuadrillasDashboard.tsx ^
  src/pages/Dashboard.tsx ^
  src/pages/Emergency.tsx
```

## Paso 3 — Commit

```bat
git commit -F COMMIT_MSG_E2E99.txt
```

(El mensaje de commit completo está en `COMMIT_MSG_E2E99.txt`, junto a este archivo.)

## Paso 4 — Push

```bat
git push -u origin feat/e2e-coverage-99-percent
```

## Paso 5 — Crear el PR

Con GitHub CLI:

```bat
gh pr create --base main --head feat/e2e-coverage-99-percent ^
  --title "feat(e2e): un-fixme 3 specs + smoke tests + data-testid (Sprint E2E-99)" ^
  --body-file COMMIT_MSG_E2E99.txt
```

Si no hay `gh`, el `git push` imprime una URL "Create a pull request" — ábrela.

---

## Qué contiene este cambio (resumen)

### 1. Un-fixme de 3 specs E2E (rutas corregidas a nivel raíz)
- `tests/e2e/sos-button.spec.ts` — `/projects/:id/emergency` → `/emergency`; locator
  del tel corregido a `page.locator('a[href^="tel:"]')` (el `getByRole('link',
  {name:/SAMU|Bomberos/})` NO matchea: el nombre accesible del enlace es el número
  131/132, no el rótulo).
- `tests/e2e/process-lifecycle.spec.ts` — `/projects/:id/gantt` → `/cuadrillas`.
- `tests/e2e/offline-resilience.spec.ts` — `/projects/:id/findings/new` → `/findings`
  + abrir el modal con el botón (`data-testid="new-finding-button"`).

### 2. data-testid en 5 componentes
- `SOSButton.tsx` → `sos-button`, `sos-toast`
- `Findings.tsx` → `new-finding-button`
- `CuadrillasDashboard.tsx` → `start-process-button`
- `Dashboard.tsx` → `dashboard-page`
- `Emergency.tsx` → `emergency-contacts-list`

### 3. 3 archivos de tests nuevos
- `tests/e2e/fixtures/navigation.ts` — helper `navigateAuthenticated()`.
- `tests/e2e/landing-smoke.spec.ts` — 3 tests (sin auth, sin gate).
- `tests/e2e/smoke-pages.spec.ts` — 12 smoke tests (gated por `E2E_FULL_STACK=1`).

### Verificación ya hecha
- Las rutas `/emergency`, `/findings`, `/cuadrillas` son rutas reales de primer
  nivel (confirmado en `src/App.tsx`, `src/routes/EmergencyRoutes.tsx`,
  `src/routes/RiskRoutes.tsx`). No existen `/projects/:id/...` ni `/gantt`.
- Los 11 archivos pasan chequeo de sintaxis (esbuild). Falta correr `npm run
  typecheck` y los tests en CI.

---

## Próxima tanda (pendiente, NO en este PR)

MiMo Claw está generando un segundo set de mejoras de calidad de código. Cuando
estén, irán en un PR separado:
- Reemplazar `console.error/warn` por `logger` en: Calendar, Emergency, Telemetry,
  ClawMachine, PoolGame, SunTracker, WebXR.
- Quitar `dangerouslySetInnerHTML` en `RiskNetwork.tsx`.
- Añadir `useTranslation` en `Onboarding.tsx`.
