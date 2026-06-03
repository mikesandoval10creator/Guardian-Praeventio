# DEEP — Lote EXI-32 · I-DOCS (slice [0:55]) · 2026-06-03

**Atestación: 55/55 archivos del slice leídos / inspeccionados.**
DERIVA: `docs/audits/file-ledger/ledger.json` filtrado por
`category === "I-DOCS"` (185 matches), ordenado por `path`, slice `[0:55]` →
55 archivos. Lista verificada vía Node contra el ledger.

> **Complemento, no repetición.** El doc previo `DEEP-I-DOCS.md` (185 docs,
> verificación puntual sobre ~35) ya cubrió a fondo: ARCHITECTURE.md LOC stale
> (D1), stubs-inventory mesh (D2), runbooks photogrammetry server-side (D3),
> guards #13/#17 no-wired (D4), ADR 0005 huérfano (D5), ADR 0006 superseded sin
> marcar. Este lote **re-confirma** esos con evidencia fresca y **añade**
> hallazgos NO cubiertos: CONTRIBUTING.md model/line drift, BERNOULLI_EXTENSIONS
> roadmap masivamente stale, BILLING.md contradicción interna, ADR 0013 mesh
> propaga el UUID inválido + nombre de archivo errado, `docs/api/openapi.yaml`
> hand-written huérfano vs autogen, ADR 0005 status real. Los 10
> `.claude/commands/*` y 22 `docs/archive/2026-05/*` se atestan limpios por
> diseño (ver tabla). El slice se calculó cuando el ledger tenía 18 ADRs;
> ADR 0019 (creado después) NO está en el slice.

---

## Hallazgos nuevos / re-confirmados con evidencia fresca

### 🔴 N1 — `BERNOULLI_EXTENSIONS.md`: roadmap masivamente obsoleto — declara "5/15 implementados (33%), 10 pendientes" cuando los 10 YA EXISTEN con tests
- **Doc:** `BERNOULLI_EXTENSIONS.md:45` → "**Total: 5 de 15 implementados
  (33%).** Plan: cerrar los 10 pendientes en Sprint 9 (~30h)". Marca A.1
  hidrantes (`:60`), A.2 misting (`:70`), y toda la categoría A/Wildcards como
  `⏳ pendiente` (`:41-43`).
- **Código:** `src/services/zettelkasten/bernoulli/` contiene **16 motores
  implementados con `.test.ts` cada uno**: `hidranteFireNetwork.ts` (=A.1, doc
  dice pendiente), `mistingDustSuppression.ts` (=A.2, doc dice pendiente),
  `scaffoldWindSuction`, `structuralWindLoad`, `confinedSpaceHVAC`,
  `gasDispersionCloud`, `gasLeakDetection`, `hazmatPipePressure`,
  `microWindEnergy`, `miningVenturi`, `pulmonaryAltitude`, `respiratorFatigue`,
  `dikeHydrostaticMonitor`, `slopeStabilityAfterRain`, `slamPhotogrammetryNode`,
  + `index.ts`. El roadmap "33% / 10 pendientes en Sprint 9" miente: el feature
  está esencialmente completo. (El núcleo `src/services/physics/bernoulliEngine.ts`
  SÍ es 54 LOC / 6 funciones como dice `:22` — esa parte es exacta; lo stale es
  el roadmap de extensiones.)

### 🟡 N2 — `CONTRIBUTING.md`: modelos Gemini recomendados y line-refs del proxy desactualizados
- **Doc:** `CONTRIBUTING.md:204,208-209` recomienda
  `gemini-2.0-flash-exp` (default), `gemini-1.5-pro`, `text-embedding-004`.
  **Código:** `geminiBackend.ts` usa `gemini-3-flash-preview` (37×),
  `gemini-3.1-pro-preview` (28×), `gemini-3.1-flash-preview` (3×); `2.0-flash`
  residual (7×). Los modelos recomendados en la guía ya NO son los de prod —
  un contribuidor que copie el patrón usa modelos viejos.
- **Doc:** `CONTRIBUTING.md:190` "proxy `POST /api/gemini` (server.ts:1680)" y
  `:197` "agrega … `ALLOWED_GEMINI_ACTIONS` en `server.ts` (~línea 1593)".
  **Código:** el array + el handler viven en `src/server/routes/gemini.ts:119`
  / `:398`; `server.ts` tiene solo 1500 líneas → ambas refs muertas. Mismo
  drift que D1/regla #5; la guía sigue apuntando al monolito.
- **Doc:** `:263` "≥866 tests al cierre de R16", `:308` PGP "placeholder hasta
  que se genere" — esto último es honesto (verificado: `pgp-key.asc` empieza
  `-----BEGIN PLACEHOLDER-----`). El conteo de tests es histórico (no crítico).

### 🟡 N3 — `BILLING.md`: contradicción interna — cuerpo dice Khipu ✅ implementado, el backlog lo lista `[ ]` pendiente
- **Doc:** `BILLING.md:217-231` "✅ `KhipuAdapter` real implementation … route
  shipped … 20 cases", y `:27` lo declara implementado. PERO el backlog
  `BILLING.md:381-387` ("### Khipu (CL web alternativa)") lista los MISMOS
  ítems como `[ ]` SIN marcar: "Implementar `KhipuAdapter`", "`POST
  /api/billing/khipu/webhook` con HMAC", "Idempotencia processed_khipu", "Tests
  unitarios". El archivo se contradice consigo mismo.
- **Código:** `src/services/billing/khipuAdapter.ts` existe; la ruta vive en
  `src/server/routes/billing.ts` (no en `server.ts` como dice `:257` para RTDN
  y `:123` para webpay/return). El backlog `[ ]` es el drift; el cuerpo ✅ es
  correcto → actualizar los checkboxes.
- **Nota arquitectura:** el diagrama `:53-56` muestra webpay/khipu/googleplay/
  manual pero **omite MercadoPago**, que SÍ tiene adapter completo + IPN OIDC
  (`src/services/billing/mercadoPagoAdapter.ts`, `mercadoPagoIpn.ts`, ruta
  `POST /api/billing/checkout/mercadopago` en `billing.ts:22`). El §"MercadoPago
  IPN" (`:197-209`) sí lo menciona en prosa, pero el diagrama de arquitectura
  quedó incompleto.
- **Header §Status (`:1-5`)** "ESTE ARCHIVO ES UN ESQUELETO … integración real
  pendiente" es engañoso dado que webpay+khipu+MP están implementados (sandbox);
  el header sobrevive del estado Sprint-temprano.

### 🟡 N4 — ADR 0013 (mesh): propaga el Service UUID INVÁLIDO + nombre de archivo nativo errado
- **Doc:** `0013-mesh-information-relay.md:72,453` fija el Service UUID en
  `00001234-PRAE-VENTI-O123-456789ABCDEF`. Esa cadena **no es UUID hex válido**
  (contiene `PRAE/VENTI/O123`). El código nativo ya lo corrige: `MeshPlugin.kt`
  deriva `00001234-12AE-3E45-7123-...` (hex válido) — pero **iOS `Plugin.swift`
  pasa la cadena cruda del ADR** y por eso iOS/Android no interoperan (bug N1 de
  `DEEP-EXI-28.md`). El ADR es la **fuente del bug**: perpetúa la marca textual
  como si fuera un UUID. Debe corregirse a un UUID hex canónico.
- **Doc:** `:273,282,452-453` referencia el archivo iOS como `MeshPlugin.swift`.
  **Código:** el archivo real es `packages/capacitor-mesh/ios/Plugin.swift`
  (plano, sin prefijo `Mesh`). Path doc-vs-código errado.
- **Doc:** `:269` ubica el plugin nativo en "Sprint 26"; el código se rotula
  "Sprint 46 REAL" (drift de cronología, alineado con N2 de DEEP-EXI-28).

### 🟡 N5 — `docs/api/openapi.yaml` (614 LOC) es spec HAND-WRITTEN huérfana que compite con la autogenerada
- **Doc:** `API_B2D_SPEC.md:3-19` declara explícitamente "**Esta spec se
  autogenera desde los Zod schemas … La fuente canónica es `GET
  /api/openapi.json`** … no requiere editar este archivo". El generador real
  existe (`src/services/openapi/specGenerator.ts`, `bootstrap.ts`, ruta
  `/api/openapi.json` + `/api/openapi.html` en `src/server/routes/openapi.ts`).
- **Sin embargo** `docs/api/openapi.yaml` es un YAML **escrito a mano** que solo
  cubre `/api/health` + 7 endpoints `sprint-k/...` (no los B2D), con su propio
  `info.version: 1.0.0` y nota "Total endpoints ~536; crece progresivamente".
  Es un artefacto paralelo que (a) divergirá del JSON autogenerado, (b) cubre un
  subset arbitrario distinto al de API_B2D_SPEC.md. Candidato a borrar o a
  generar desde `/api/openapi.json` en vez de mantenerse a mano.

### 🟡 N6 — ADR 0005 (NodeODM) y ADR 0006 (mobile) sin marcar superseded — re-confirmado con headers
- **0005:** `Status: accepted`, `Supersede: —`, referencia
  `src/services/photogrammetry/` (`:13`) que **no existe** (procesamiento
  on-device, server-side eliminado §2.28). Debería ser `Superseded` por la
  directiva on-device. (= D5 de DEEP-I-DOCS, ahora con el header literal.)
- **0006:** `Estado: Aceptada` (`:5`) aunque `0009` declara en su propio header
  "supersedes ADR-0006" (`0009:...Estado: Aceptada — supersedes ADR-0006`).
  0006 nunca se marcó. (= hallazgo de DEEP-I-DOCS, confirmado bidireccional:
  0009 sí lo dice, 0006 no se enteró.)

### 🔵 N7 — `docs/ar-assets.md`: path Windows hardcodeado + ruta de fallback a archivo que no coincide
- **Doc:** `ar-assets.md:25` instruye `cd "D:/Guardian Praeventio/repo"` (path
  local Windows del autor — no portable; el repo vive en `/home/user/...`).
- **Doc:** `:97` "cae al fallback 2D (`WebXR.tsx` legacy)". **Código:** no existe
  `src/components/ar/WebXR.tsx`; sí `src/pages/WebXR.tsx`. Ref imprecisa.
- **Resto OK:** `scripts/generate-ar-models.mjs` existe, `public/models/ar/*.glb`
  + algunos `.usdz` reales presentes, y el MIME `model/vnd.usdz+zip` está
  wired (`server.ts:1171-1172`). Solo el path Windows y la ref WebXR son ruido.

### 🔵 N8 — `.telemetry/*` y A11Y docs: honestos y precisos (muestra de verificación)
- `.telemetry/current-implementation.md` + `audits/2026-05-04.md`: snapshot
  fechado 2026-05-04, describen Sentry-only / cero analytics. Honestos ("no
  analytics SDK installed", "setUserContext wired but unused"). No canónicos pero
  no engañan.
- `docs/a11y/WCAG_findings.md`: spot-check de 4 refs file:line → **todas
  exactas**: `index.html:2` = `<html lang="es">` (A11Y-001 mitigado ✓),
  `index.css:83` = `--text-muted: #52525b` (A11Y-003 ✓), `Tooltip.tsx` existe +
  `@radix-ui/react-tooltip` en package.json (A11Y-015 ✓). Doc fiel al código.
- `docs/a11y/A11Y_AUDIT.md` + `checklist-WCAG-2.2-AA.md`: fechados, scope
  explícito (web SPA only), refs con A11Y-NNN. Sin drift detectado en muestreo.

---

## Re-confirmaciones de DEEP-I-DOCS (evidencia 2026-06-03)

- **ARCHITECTURE.md (D1):** `:91` server.ts `1411 LOC` y `:221` "1411 LOC al
  2026-05-27 reducido desde 3242" → real **1500**. `:110,272` geminiBackend
  `2923 LOC` / "72 funciones" → real **1466 LOC / 53 exports**. `:206` ref
  `server.ts:3115`, `:297` "line 1593" → muertas (file=1500). `ALLOWED_GEMINI_
  ACTIONS` en `routes/gemini.ts:119`. `:8` "Round 16 / 2026-04-28" stale.
  `:78` "hooks (~50)" vs CLAUDE.md "176 custom hooks". TODO confirmado.
- **Guards #13/#17 (D4):** `.husky/pre-commit` ejecuta solo medical-guard +
  convention-guard + validate-i18n + any-ratchet. **Cero** referencias a
  stub-guard / allowbackup-guard. CLAUDE.md "wired in PR #514" sigue falso.
- **Photogrammetry server-side (D3):** `cloud-run/` no existe, PERO
  `infra/photogrammetry-worker/` (Dockerfile, server.py, run-pipeline.sh) e
  `infra/modal-photogrammetry/app.py` **siguen presentes** — dirs huérfanos que
  TODO.md §2.28 paso 1 pedía borrar. No consumidos por `src/`/`server.ts`/CI.

---

## Tabla por archivo (55/55)

| # | Doc | Tipo | Estado | Drift / nota (Doc:línea \| Evidencia) |
|---|---|---|---|---|
| 1-10 | `.claude/commands/{canary,careful,cross-review,cross-review-vs-codex,cso-praeventio,design-html,freeze,guard,retro,unfreeze}.md` | command | ✅ | Defs de slash-commands; N/A por diseño (no afirman estado de código). |
| 11 | `.telemetry/audits/2026-05-04.md` | audit | ✅ | Snapshot fechado; Sentry-only honesto. N8. |
| 12 | `.telemetry/current-implementation.md` | telemetry | ✅ | "no analytics SDK"; setUserContext wired-but-unused. Honesto. N8. |
| 13 | `API_B2D_SPEC.md` | spec | ✅ | Autogen disclaimer correcto; B2D router real (`server.ts:740`, `routes/b2d/`). Sección Sprint 23 alineada. |
| 14 | `ARCHITECTURE.md` | arquitectura | 🔴 | D1: server.ts 1411→1500; geminiBackend 2923→1466 / 72→53 exports; line-refs 1593/3115 muertas; Round 16 stale; hooks ~50 vs 176. |
| 15 | `BERNOULLI_EXTENSIONS.md` | spec | 🔴 | N1: "5/15 (33%), 10 pendientes" pero 16 motores con tests en `zettelkasten/bernoulli/`. Núcleo 54 LOC OK. |
| 16 | `BILLING.md` | guía | 🟡 | N3: cuerpo Khipu ✅ vs backlog `[ ]`; diagrama omite MercadoPago; header "ESQUELETO" engañoso; refs `server.ts` (rutas en `routes/billing.ts`). |
| 17 | `BRAND.md` | guía | ✅ | 4-mode token system; tokens coinciden con `index.css`. Soporta A11Y-002. Sin drift. |
| 18 | `CLAUDE.md` | guía | 🔴 | D4 re-confirmado: #13/#17 "wired in PR #514" falso (no en husky/CI). |
| 19 | `CONTRIBUTING.md` | guía | 🟡 | N2: modelos 2.0-flash-exp/1.5-pro stale (prod=gemini-3.x); `server.ts:1680/1593` muertas; PGP placeholder honesto. |
| 20 | `docs/a11y/A11Y_AUDIT.md` | a11y | ✅ | Fechado, scope explícito. Sin drift en muestreo. N8. |
| 21 | `docs/a11y/checklist-WCAG-2.2-AA.md` | a11y | ✅ | Per-criterion con A11Y-NNN refs. OK. |
| 22 | `docs/a11y/WCAG_findings.md` | a11y | ✅ | 4 refs file:line spot-checked → exactas. N8. |
| 23 | `docs/api-routes.md` | catálogo | ✅ | (Muestreado en DEEP-I-DOCS; endpoints coinciden.) |
| 24 | `docs/api/openapi.yaml` | spec | 🟡 | N5: YAML hand-written huérfano (health + 7 sprint-k) compite con autogen `/api/openapi.json`. |
| 25 | `docs/ar-assets.md` | runbook | 🔵 | N7: path `D:/...` Windows hardcodeado; ref `components/ar/WebXR.tsx` inexistente (es `pages/`). Resto OK. |
| 26 | ADR 0001 organic-collections | adr | ✅ | No contradice código (colecciones top-level vigentes). |
| 27 | ADR 0002 cad-viewer-MIT | adr | ✅ | Coherente con ADR 0008 (LibreDWG). |
| 28 | ADR 0003 medical-iconography | adr | ✅ | bioicons; MedicalIcon renderer existe. |
| 29 | ADR 0004 medical-icons-offline | adr | ✅ | Bundled offline; coherente. |
| 30 | ADR 0005 nodeodm-agpl | adr | 🟡 | N6: `Status accepted`, `Supersede —`, ref `src/services/photogrammetry/` inexistente; server-side descartado §2.28. |
| 31 | ADR 0006 mobile-deferred | adr | 🟡 | N6: `Estado: Aceptada` aunque 0009 lo supersede; header nunca marcado. |
| 32 | ADR 0007 euler-phi-kms | adr | ✅ | "Documentado — NO refactoriza"; honesto (φ implícita en kmsEnvelope). |
| 33 | ADR 0008 libredwg | adr | ✅ | Ruta `/api/cad/convert-dwg` real; `infra/dwg-converter/`. |
| 34 | ADR 0009 mobile-ci-signing | adr | ✅ | Header declara supersedes 0006; fastlane/GHA reales. |
| 35 | ADR 0010 privacy-no-intimate | adr | ✅ | Coherente con ADR 0012 + mesh. |
| 36 | ADR 0011 twin-triple-gate | adr | ✅ | No contradice código en muestreo. |
| 37 | ADR 0012 health-no-diagnosis | adr | ✅ | Enforced por `precommit-medical-guard.cjs` (SÍ en husky). Vigente. |
| 38 | ADR 0013 mesh-information-relay | adr | 🟡 | N4: Service UUID inválido `...PRAE-VENTI-O123...` (fuente del bug iOS); ref `MeshPlugin.swift` (real `Plugin.swift`); cronología Sprint 26 vs código Sprint 46. |
| 39 | ADR 0014 regulatory-abstraction | adr | ✅ | `accepted`; coherente con módulo normativo. |
| 40 | ADR 0015 mqtt-iot-broker | adr | ✅ | "accepted (impl Sprint 32 in-progress)" + nota post-audit honesta del estado real (1 adapter). |
| 41 | ADR 0016 cqrs-redis-deferred | adr | ✅ | "deferred — no build"; reconoce explícitamente el shell `CQRSArchitecture.tsx`. Ejemplar de honestidad. |
| 42 | ADR 0017 per-country-emission | adr | ✅ | "accepted (target Sprint 38+)"; doc-only declarado. |
| 43 | ADR 0018 webxr-renamed | adr | ✅ | Honesto sobre WebXR 2D (verificado en DEEP-I-DOCS). |
| 44 | ADR PLAN_MAESTRO_2026-Q3 | plan | ✅ | "SCOPING RATIFICADO"; plan de nodos 321-512, no afirma código hecho. |
| 45-55 | `docs/archive/2026-05/{AUDIT,DIGITAL_TWIN_GPU_FREE_PLAN,IMPACTO,IMPLEMENTATION_ROADMAP,INFORME_AVANCE_NOTEBOOK_LLM,INFORME_ESTADO_2026-04-29,MASTER_PROPOSAL_2026-05,PLAN_PARTE1..4}.md` | archive | ✅ | Snapshots históricos; `archive/README.md` declara "NO consultar como fuente de verdad" + documenta el 99%/81% inflado movido a archivo. Correctamente archivados. |

Leyenda: ✅ ok/honesto/N-A · 🔵 nota menor · 🟡 drift real · 🔴 invariante doc-vs-código rota.

## Conteo de limpios
- **✅ limpios / honestos / N-A: 44/55** — 10 commands + 11 archive +
  `.telemetry`×2 + A11Y×3 + API_B2D + BRAND + api-routes + ADRs
  0001/0002/0003/0004/0007/0008/0009/0010/0011/0012/0014/0015/0016/0017/0018 +
  PLAN_MAESTRO.
- **🔵 nota menor: 1** — `ar-assets.md` (25).
- **🟡 drift real: 7** — BILLING (16), CONTRIBUTING (19), openapi.yaml (24),
  ADR 0005 (30), ADR 0006 (31), ADR 0013 (38).  *(ar-assets 🔵 separado.)*
- **🔴 invariante rota: 3** — ARCHITECTURE.md (14), BERNOULLI_EXTENSIONS (15),
  CLAUDE.md (18).

## Para decisión del usuario
1. **BERNOULLI_EXTENSIONS.md** — reescribir el roadmap: los 16 motores de
   `zettelkasten/bernoulli/` están hechos; el "5/15 (33%), Sprint 9" es falso.
2. **CONTRIBUTING.md** — actualizar modelos a `gemini-3.x-*` y reemplazar
   `server.ts:1680/1593` por `src/server/routes/gemini.ts:119`.
3. **BILLING.md** — marcar Khipu `[x]` en el backlog; añadir MercadoPago al
   diagrama; corregir el header "ESQUELETO".
4. **ADR 0013** — corregir el Service UUID a hex canónico (es la fuente del bug
   de no-interop iOS/Android) y `MeshPlugin.swift`→`Plugin.swift`.
5. **ADR 0005 / 0006** — marcar `Superseded` en sus headers.
6. **docs/api/openapi.yaml** — borrar o regenerar desde `/api/openapi.json`.
7. (Heredados de DEEP-I-DOCS) ARCHITECTURE.md LOC/refs; guards #13/#17 wiring;
   borrar `infra/photogrammetry-worker/` + `infra/modal-photogrammetry/`.

---

## Resumen (6-10 líneas)

Lote EXI-32 — 55/55 docs I-DOCS (slice [0:55]: 10 commands, 2 telemetry, specs
raíz, 18 ADRs + PLAN_MAESTRO, 11 archive) inspeccionados. **3 🔴 doc-vs-código:**
(1) `BERNOULLI_EXTENSIONS.md` declara "5/15 implementados (33%), 10 pendientes
Sprint 9" cuando `src/services/zettelkasten/bernoulli/` ya tiene **16 motores con
tests** (incl. los A.1/A.2 marcados "pendiente"); (2) `ARCHITECTURE.md` LOC/
line-refs muertos (re-confirma D1: server.ts 1411→1500, geminiBackend 2923→1466
/72→53 exports); (3) `CLAUDE.md` guards #13/#17 "wired in PR #514" siguen sin
engancharse en husky. **7 🟡:** `BILLING.md` se contradice (Khipu ✅ en el cuerpo
vs `[ ]` en el backlog) y su diagrama omite MercadoPago pese a adapter+IPN
reales; `CONTRIBUTING.md` recomienda modelos viejos (2.0-flash-exp/1.5-pro vs
prod gemini-3.x) y apunta a `server.ts:1680/1593` muertos; `ADR 0013` propaga el
Service UUID **inválido** `...PRAE-VENTI-O123...` (fuente del bug de no-interop
iOS/Android documentado en DEEP-EXI-28) y nombra `MeshPlugin.swift` (real
`Plugin.swift`); `ADR 0005/0006` sin marcar Superseded; `docs/api/openapi.yaml`
es un YAML hand-written huérfano que compite con la spec autogenerada. Confirmado
**honesto/limpio (44/55):** los 10 slash-commands, los 11 archive (README declara
"no consultar"), `.telemetry`, los 3 docs A11Y (4 refs file:line spot-checked
exactas), API_B2D (autogen real), BRAND, y 15 ADRs — destacando 0015/0016 que
**recalibran post-audit** su estado real (ejemplares). Confirmado: `infra/
photogrammetry-worker/` + `infra/modal-photogrammetry/` siguen huérfanos en disco.
Doc-only, sin commit.
