# DEEP — I-DOCS: 185 documentos · 2026-06-02

**Archivos revisados:** 185 catalogados desde `ledger.json` (`category==="I-DOCS"`);
verificación doc-vs-código puntual sobre ~35 docs de estado/arquitectura/runbook.
Foco: detectar drift (doc miente respecto al código), obsoletos y huérfanos.

Método: extracción de la lista I-DOCS del ledger + grep dirigido sobre el código
(LOC reales, existencia de endpoints/dirs/scripts, wiring de husky/CI).

---

## 1. Inventario por tipo

| Tipo | Conteo | Notas |
|---|---|---|
| ADR (`docs/architecture-decisions/`) | 19 | 0001–0018 + PLAN_MAESTRO. |
| Runbook (`docs/runbooks/` + `*RUNBOOK*`) | 19 | Operacional (KMS, DR, secrets, mobile, photogrammetry…). |
| Audit (`docs/audits/`, `docs/audit/`) | 12 | Snapshots de auditoría (mayo 2026). |
| Sprint (`docs/sprints/`, SPRINT_*) | 5 | Specs de sprint (20, K, Euler). |
| Command (`.claude/commands/`) | 10 | Defs de slash-commands — OK por diseño, no auditados a fondo. |
| README | 7 | Root + infra + mcp + models/posters + archive. |
| Otro | 113 | Specs (Zettelkasten, API, Bernoulli), guías, tracking, security, archive (`docs/archive/2026-05/` = 22 snapshots históricos correctamente marcados). |

Total: **185**.

---

## 2. 🔴 Doc-drift: docs que CONTRADICEN el código

### D1 — `ARCHITECTURE.md` LOC counts gravemente desactualizados (viola Regla #20)
- **Doc:** `ARCHITECTURE.md:110` → `src/services/geminiBackend.ts # 2923 LOC`.
  **Código:** `geminiBackend.ts` real = **1466 LOC** (`wc -l`). Drift de −1457 LOC.
- **Doc:** `ARCHITECTURE.md:272` → "exporta 72 funciones (60 directas + 12…)".
  **Código:** `grep -c '^export'` en geminiBackend.ts = **28 exports**. Drift severo.
- **Doc:** `ARCHITECTURE.md:91` → `server.ts # 1411 LOC`; `:221` → "1411 LOC al 2026-05-27".
  **Código:** `server.ts` real = **1500 LOC**. Drift menor pero acumulando.
- **Doc:** referencias de línea `server.ts:1972`, `:2321`, `:2901`, `:3115`, `:3191`
  (líneas 127, 138, 191, 206, 379). **Código:** `server.ts` tiene **1500 líneas
  totales** → TODAS esas referencias apuntan más allá del fin del archivo. Stale.
- **Doc:** `ARCHITECTURE.md:297` → "`server.ts` line 1593 importa todas y agrupa en
  `ALLOWED_GEMINI_ACTIONS`". **Código:** `ALLOWED_GEMINI_ACTIONS` ahora vive en
  `src/server/routes/gemini.ts:119` (movido fuera del monolito). Drift de ubicación.

### D2 — `docs/stubs-inventory.md` describe el mesh nativo como stub; es BLE real
- **Doc:** `docs/stubs-inventory.md:73` → mesh nativo "solo loggea + fake events",
  "902 LOC stubs".
- **Código:** `packages/capacitor-mesh/android/.../MeshPlugin.kt` (552 LOC) es una
  implementación **real de BLE GATT**: importa y usa `BluetoothLeAdvertiser`,
  `BluetoothLeScanner`, `BluetoothGattServer` + `BluetoothGattServerCallback`
  (líneas 105–107, 373), escribe chunks reales a GATT (`MeshPlugin.kt:501`).
  El Swift (`ios/Plugin.swift`, 350 LOC) existe. La caracterización "fake events"
  ya no es cierta para Android. (El simulador web sí es real, eso está OK.)

### D3 — Runbooks de photogrammetry server-side describen infraestructura ELIMINADA
- **Doc:** `docs/runbooks/photogrammetry-deploy.md:1-10,60` despliega
  `cloud-run/photogrammetry-worker/` y dice "`POST /api/photogrammetry/jobs`
  dispatchará jobs"; referencia `colmapAdapter.ts` y `modalAdapter.ts`.
- **Código / fuente de verdad:**
  - `cloud-run/` **no existe** (todo el dir eliminado).
  - `src/services/digitalTwin/photogrammetry/` tiene solo `mockAdapter.ts` +
    `onDeviceAdapter.ts` + store — **NO** existen `colmapAdapter.ts` ni `modalAdapter.ts`.
  - `server.ts:65-69,643-646` documenta explícitamente: ruta `/api/photogrammetry`
    **removida** (§2.28, directiva on-device).
  - `TODO.md:598,630-634` confirma la eliminación con gate test
    `noServerSidePhotogrammetry.test.ts`.
- **También afectados (mismo tema, obsoletos):** `docs/photogrammetry-deploy.md`
  (COLMAP/Cloud Run) y `docs/photogrammetry-modal.md` (GPU branch Modal). Ambos
  describen el pipeline server-side descartado.

### D4 — CLAUDE.md afirma guards "wired in PR #514" que NO están enganchados
- **Doc:** CLAUDE.md conv. #13 → `scripts/precommit-stub-guard.cjs` "Enforced …
  wired in PR #514"; conv. #17 → `precommit-allowbackup-guard.cjs` "wired in PR #514".
- **Código:** ambos scripts **existen** (con sus `.test.cjs`) pero `.husky/pre-commit`
  solo ejecuta: `precommit-medical-guard.cjs`, `check-convention-guard.cjs`,
  `validate-i18n.cjs`, `check-any-ratchet.cjs`. `grep` en `.husky/` + `.github/` +
  `package.json` → **cero** referencias a stub-guard / allowbackup-guard fuera de
  sus propios tests. Claim "Enforced/wired" es **falso**: guards presentes pero
  no invocados por ningún hook ni CI. (Aplica también a security_spec / CONTRIBUTING
  si repiten el claim — verificar al actualizar.)

### D5 — ADR 0005 referencia ruta de código inexistente
- **Doc:** `0005-nodeodm-agpl-backend-only.md` referencia `src/services/photogrammetry/`
  (plan T-9.x), pipeline SfM/MVS server-side.
- **Código:** `src/services/photogrammetry/` **no existe**; el procesamiento es
  on-device (ver D3). El ADR quedó sin implementación correspondiente.

---

## 3. 🟡 Obsoletos / superseded / huérfanos (candidatos a archivar)

- **`docs/runbooks/photogrammetry-deploy.md`**, **`docs/photogrammetry-deploy.md`**,
  **`docs/photogrammetry-modal.md`** — describen worker server-side eliminado (D3).
  Mover a `docs/archive/` o reescribir como "histórico — superseded by on-device §2.28".
- **`infra/photogrammetry-worker/`** y **`infra/modal-photogrammetry/`** (no son
  I-DOCS pero relacionados) — dirs huérfanos: `grep` en `src/`, `server.ts`, `.github/`
  no los consume. Candidatos a borrado físico (TODO.md §2.28 paso 1 pedía eliminarlos).
- **ADR 0006** (`0006-mobile-deferred-to-local-build.md`) — Estado aún "Aceptada",
  pero **ADR 0009** lo supersede ("Mobile CI signing supersedes ADR-0006"). 0006
  debería marcarse `Superseded by 0009` en su header.
- **`docs/archive/2026-05/*` (22 docs)** — correctamente marcados como snapshots
  históricos por `docs/archive/README.md` ("no consultes para decisiones actuales").
  NO son drift; ya archivados. Mantener.
- **`.telemetry/audits/2026-05-04.md`** y demás audits de mayo 2026 — snapshots
  puntuales; no canónicos. OK como histórico.

---

## 4. ✅ Docs canónicos vigentes (reflejan el código)

- **`TODO.md`** — fuente única de verdad; §2.28 photogrammetry refleja exactamente
  el código (eliminación + gate test). Consistente.
- **`docs/api-routes.md`** — catálogo en prosa (no tabla); endpoints muestreados
  (`/api/health`, `/api/admin/revoke-access`, `/api/cad/convert-dwg`, billing,
  emergency) coinciden con rutas reales en `src/server/routes/`.
- **ADR 0008** (LibreDWG) — VÁLIDO: la ruta `/api/cad/convert-dwg` es real
  (`src/server/routes/cad.ts:69`, con tests `cad.test.ts`); el servicio aislado
  existe en `infra/dwg-converter/` (el ADR/dwgAdapter aún dicen "Cloud Run" pero
  el concepto y el código viven). Solo nota: path movió de `cloud-run/` a `infra/`.
- **ADR 0018** (WebXR → "Capacitación Interactiva") — preciso y honesto sobre el
  estado 2D del feature.
- **`docs/archive/README.md`** — disclaimer histórico correcto.
- **`docs/i18n-coverage.md`**, **`docs/testing/COVERAGE_BASELINE.md`** — fechados y
  con scope explícito; no se detectó drift en muestreo (revisión profunda en tanda I-TEST).
- **Scripts de guard referenciados que SÍ existen y SÍ están wired:**
  `precommit-medical-guard.cjs`, `check-convention-guard.cjs`, `validate-i18n.cjs`,
  `check-any-ratchet.cjs`, `check-frozen.cjs` — todos presentes y en husky.

---

## 5. Tabla por archivo significativo

| Doc | Tipo | Estado | Nota drift |
|---|---|---|---|
| `ARCHITECTURE.md` | arquitectura | 🔴 drift | geminiBackend 2923→1466 LOC; 72→28 exports; server.ts line-refs >1500 muertas; ALLOWED_GEMINI_ACTIONS movido a routes/gemini.ts |
| `docs/stubs-inventory.md` | audit | 🔴 drift | mesh nativo descrito "fake events"; MeshPlugin.kt es BLE GATT real (552 LOC) |
| `docs/runbooks/photogrammetry-deploy.md` | runbook | 🔴 obsoleto | despliega cloud-run/photogrammetry-worker (eliminado) + colmap/modal adapters (no existen) |
| `docs/photogrammetry-deploy.md` | runbook | 🔴 obsoleto | COLMAP/Cloud Run server-side descartado §2.28 |
| `docs/photogrammetry-modal.md` | runbook | 🔴 obsoleto | Modal GPU branch descartado §2.28 |
| `CLAUDE.md` (conv #13/#17) | guía | 🔴 drift | stub-guard/allowbackup-guard "wired in PR #514" pero NO en husky/CI |
| `docs/architecture-decisions/0005-nodeodm-agpl-backend-only.md` | adr | 🟡 huérfano | referencia src/services/photogrammetry/ (no existe); server-side descartado |
| `docs/architecture-decisions/0006-mobile-deferred-to-local-build.md` | adr | 🟡 superseded | superseded por ADR 0009 pero header sigue "Aceptada" |
| `docs/architecture-decisions/0008-libredwg-cloud-function-isolation.md` | adr | ✅ vigente | ruta + infra/dwg-converter reales; solo path cloud-run→infra |
| `docs/architecture-decisions/0018-webxr-renamed.md` | adr | ✅ vigente | honesto sobre WebXR 2D |
| `TODO.md` | estado | ✅ canónico | §2.28 alineado con código |
| `docs/api-routes.md` | catálogo | ✅ vigente | endpoints muestreados coinciden |
| `docs/archive/2026-05/*` (22) | archive | ✅ archivado | marcados históricos |
| `.claude/commands/*` (10) | command | ✅ N/A | defs de slash-commands |

---

## 6. Para decisión del usuario

1. **Actualizar `ARCHITECTURE.md`** (Regla #20): corregir LOC de geminiBackend
   (1466), conteo de exports (28), LOC de server.ts (1500), reemplazar las 5
   referencias de línea muertas (server.ts:1972/2321/2901/3115/3191) por las
   actuales, y mover ALLOWED_GEMINI_ACTIONS a `src/server/routes/gemini.ts:119`.
2. **Corregir `docs/stubs-inventory.md`**: el mesh Android ya NO es stub
   (BLE GATT real, 552 LOC). Reclasificar a PARTIAL-real o moverlo de la sección
   stubs; reverificar el estado real del Swift iOS antes de reclasificar.
3. **Archivar/reescribir los 3 runbooks de photogrammetry server-side** + decidir
   si se borran los dirs huérfanos `infra/photogrammetry-worker/` y
   `infra/modal-photogrammetry/` (TODO.md §2.28 paso 1 ya lo pedía).
4. **CLAUDE.md conv #13/#17**: o (a) enganchar stub-guard/allowbackup-guard en
   `.husky/pre-commit`/CI para que el claim "Enforced/wired" sea cierto, o
   (b) corregir la redacción a "scripts presentes, pendiente wiring".
5. **ADR 0006**: marcar header `Superseded by ADR 0009`. **ADR 0005**: marcar
   superseded por directiva on-device §2.28 (no hay backend NodeODM).

---

> Doc-only. Sin commits. Verificaciones hechas con grep/wc puntual al 2026-06-02.
