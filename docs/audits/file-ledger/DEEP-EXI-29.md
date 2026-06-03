# DEEP-EXI-29 — Pasada exhaustiva línea-por-línea (Lote #29, I-BUILD)

**Deriva:** `ledger.json` → `category === "I-BUILD"`, ordenado por `path`, slice `[0:55]`.
**Total I-BUILD en ledger:** 132. **Cubiertos en este lote:** 55/55.
**Scope:** scripts de CI (`.github/workflows/`), husky, Dockerfiles, `firestore.rules`,
`firestore.indexes.json`, configs raíz, infra (Python/sh converters), terraform, telemetry.

---

## Atestación de cobertura — 55/55

Cada archivo fue leído COMPLETO línea por línea (no muestreo).

| # | Archivo | Estado |
|---|---|---|
| 1 | `.claude/settings.json` | leído (16 L) |
| 2 | `.dockerignore` | leído (68 L) |
| 3 | `.env.example` | leído (667 L) |
| 4 | `.gcloudignore` | leído (70 L) |
| 5 | `.gitattributes` | leído (93 L) |
| 6 | `.github/workflows/check-mobile-signing.yml` | leído (125 L) |
| 7 | `.github/workflows/ci.yml` | leído (221 L) |
| 8 | `.github/workflows/codeql.yml` | leído (108 L) |
| 9 | `.github/workflows/deploy.yml` | leído (281 L) |
| 10 | `.github/workflows/dr-dryrun.yml` | leído (109 L) |
| 11 | `.github/workflows/e2e.yml` | leído (155 L) |
| 12 | `.github/workflows/firestore-backup.yml` | leído (119 L) |
| 13 | `.github/workflows/loadtest.yml` | leído (59 L) |
| 14 | `.github/workflows/mobile-build-check.yml` | leído (88 L) |
| 15 | `.github/workflows/mobile-release.yml` | leído (252 L) |
| 16 | `.github/workflows/mutation.yml` | leído (78 L) |
| 17 | `.github/workflows/ossar.yml` | leído (56 L) |
| 18 | `.github/workflows/perf.yml` | leído (67 L) |
| 19 | `.github/workflows/prepackage-slm.yml` | leído (104 L) |
| 20 | `.github/workflows/smoke.yml` | leído (22 L) |
| 21 | `.gitignore` | leído (66 L) |
| 22 | `.husky/pre-commit` | leído (5 L) |
| 23 | `.mcp.json` | leído (8 L) |
| 24 | `.npmrc` | leído (1 L) |
| 25 | `.size-limit.json` | leído (62 L) |
| 26 | `.telemetry/current-state.yaml` | leído (105 L) |
| 27 | `.telemetry/proposed-events.yaml` | leído (473 L) |
| 28 | `bin/mcp-server.mjs` | leído (133 L) |
| 29 | `cloudbuild.yaml` | leído (120 L) |
| 30 | `Dockerfile` | leído (36 L) |
| 31 | `Dockerfile.api` | leído (82 L) |
| 32 | `Dockerfile.frontend` | leído (43 L) |
| 33 | `eslint.config.js` | leído (133 L) |
| 34 | `firebase-applet-config.json` | leído (9 L) |
| 35 | `firebase-blueprint.json` | leído (384 L) |
| 36 | `firebase.emulator-tests.json` | leído (11 L) |
| 37 | `firebase.json` | leído (36 L) |
| 38 | `firestore.indexes.json` | leído (597 L) |
| 39 | `firestore.rules` | leído (1182 L) |
| 40 | `Gemfile` | leído (18 L) |
| 41 | `infra/dwg-converter/Dockerfile` | leído (63 L) |
| 42 | `infra/dwg-converter/server.py` | leído (179 L) |
| 43 | `infra/modal-photogrammetry/app.py` | leído (377 L) |
| 44 | `infra/photogrammetry-worker/Dockerfile` | leído (88 L) |
| 45 | `infra/photogrammetry-worker/ply-to-glb.py` | leído (42 L) |
| 46 | `infra/photogrammetry-worker/poisson-mesh.py` | leído (65 L) |
| 47 | `infra/photogrammetry-worker/run-pipeline.sh` | leído (96 L) |
| 48 | `infra/photogrammetry-worker/server.py` | leído (273 L) |
| 49 | `infra/usdz-converter/Dockerfile` | leído (92 L) |
| 50 | `infra/usdz-converter/glb_to_usdz.py` | leído (96 L) |
| 51 | `infra/usdz-converter/server.py` | leído (183 L) |
| 52 | `infrastructure/cloud-scheduler.yaml` | leído (206 L) |
| 53 | `infrastructure/terraform/.gitignore` | leído (30 L) |
| 54 | `infrastructure/terraform/cloudrun.tf` | leído (110 L) |
| 55 | `infrastructure/terraform/dashboards/business.json` | leído (179 L) |

---

## Hallazgos

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `.husky/pre-commit:1-5` | 🔴 | **stub-guard (#13) y allowbackup-guard (#17) NO wired.** El hook solo corre medical-guard, convention-guard, validate-i18n, check-any-ratchet. CLAUDE.md afirma que ambos guards fueron "wired in PR #514" — es FALSO. Los scripts existen (`scripts/precommit-stub-guard.cjs`, `scripts/precommit-allowbackup-guard.cjs`, ambos con `.test.cjs`) pero ningún hook ni workflow los invoca. Anti-stub-disfrazado y allowBackup quedan sin enforcement. | husky lista 4 scripts; `grep` de stub-guard/allowbackup en `.github` + `.husky` = 0 hits. |
| `.github/workflows/*` (todos) | 🔴 | **No existe job de lint en NINGÚN workflow CI.** CLAUDE.md: "CI runs typecheck, tests, validate-env, rules-tests, mobile-signing, lint, e2e, perf, codeql, ossar." No hay `npm run lint` en ningún `.github/workflows/*.yml`. ESLint solo corre localmente/manual → reglas (incl. `Math.random` custom rule de #15, react-hooks) no gatean PRs. | `grep -rl "npm run lint" .github/workflows` = sin resultados. |
| `firebase-applet-config.json:1-9` | 🟡 | **Config Firebase con apiKey real está git-trackeada** (`git ls-files` la lista). Contiene `apiKey`, `projectId`, `appId`, `storageBucket`, `firestoreDatabaseId`. Web apiKey de Firebase no es secreto cripto (se expone en el bundle), pero `.dockerignore`/`.gcloudignore`/`.gitignore` la excluyen explícitamente "porque contiene project credentials" — contradicción: el archivo SÍ está en git pese a los 3 ignore. Mantenerla en el repo derrota la intención documentada (H3). | archivo trackeado; `.gitignore:13` la excluye con comentario "contains project credentials". |
| `infra/dwg-converter/server.py:72` | 🟡 | **Comparación de bearer token NO constante.** `return auth[...] == EXPECTED_TOKEN` — vulnerable a timing oracle. El peer `photogrammetry-worker/server.py:91` usa `hmac.compare_digest` correctamente; este converter (y el usdz) no. | `server.py:72`. |
| `infra/usdz-converter/server.py:65` | 🟡 | **Mismo bug de comparación no constante** que dwg-converter. `return auth[...] == EXPECTED_TOKEN`. Inconsistencia con el patrón timing-safe del worker. | `server.py:65`. |
| `infra/modal-photogrammetry/app.py:197-203` | 🟡 | **SSRF latente.** `process_video` hace `requests.get(video_uri)` sobre cualquier URL si `videoUri` no empieza con `gs://`. `submit_job` (L303-305) valida presencia de `videoUri` pero NO que sea `gs://` (a diferencia del dwg/photogrammetry-worker que rechazan no-gs://). Caller comprometido o payload spoofeado puede forzar fetch a `169.254.169.254`/internos. Mitigado parcialmente: photogrammetry server-side fue DESCARTADO (deploy.yml §2.28) y este usa API Modal deprecada (`Stub`/`web_endpoint`) — código muerto pero presente. | `app.py:190-203` (rama `else: requests.get`). |
| `Dockerfile:1-36` | 🟡 | **Imagen legada corre como ROOT** (sin `USER node`, sin drop de privilegios) y arranca con `npx tsx server.ts` (puede intentar fetch de tsx en runtime). `Dockerfile.api` (el que deploy.yml realmente usa, L47-48) SÍ dropea a `node`. El header de deploy.yml referencia el Dockerfile legado en comentario; ambigüedad de cuál es canónico. | `Dockerfile:36` vs `Dockerfile.api:69-71`. |
| `infra/{dwg,usdz,photogrammetry-worker}/Dockerfile` | 🟡 | **Los 3 converters corren como root** (ningún `USER` directive). Imágenes single-purpose en Cloud Run aislado, pero sin hardening de privilegios. | dwg `Dockerfile:54-63`, usdz `:83-92`, photogrammetry `:67-88`. |
| `firestore.rules:1154-1178` (cphs_meetings update Caso B) | 🟡 | **Append-only de firmas más débil que audit_logs.** El Caso B exige `signatures.size() == resource.size()+1` y campos operativos idénticos, pero NO verifica que las firmas existentes se preserven como prefijo. Un cliente podría reemplazar el array completo por uno de size+1 (descartar un firmante legítimo y poner dos propias) sin violar la regla. | `firestore.rules:1175-1176`. |
| `firestore.indexes.json` (14 colecciones) | 🟡 | **14 colecciones top-level con índice compuesto pero SIN regla explícita** en firestore.rules → default-deny: `calendar_events, confidential_reports, culture_pulse, drills, incidents, inspections, invoices, photo_evidence, photogrammetry_jobs, quota_usage, sif_precursors, splat_captures, waste_records, work_permits`. Patrón TODO §17. Si alguna se consulta client-side, la query falla silenciosa; si es server-only (Admin SDK), falta documentar por qué tiene índice sin regla. `confidential_reports` y `photo_evidence` son sensibles (PII/evidencia). | cross-check índices↔rules: 14 NO RULE. |
| `.github/workflows/deploy.yml:65-71` | 🟡 | **Cloud Run desplegado `--allow-unauthenticated`** y los endpoints de jobs (`/api/admin/jobs/*`, `/api/maintenance/check-overdue`, `/api/admin/replicate-critical`) son públicamente alcanzables; dependen 100% de auth a nivel app. Además el scheduler se crea con OIDC (`--oidc-service-account-email`) pero `.env.example:330-333` documenta `SCHEDULER_SHARED_SECRET` + middleware `verifySchedulerToken` (header `x-scheduler-token`) — posible mismatch: el scheduler creado en deploy.yml NO envía ese header. Verificar que las rutas no rechacen el OIDC o no queden abiertas. | deploy.yml:67 `--allow-unauthenticated`; deploy.yml:195/207 OIDC; .env.example:330-333. |
| `.github/workflows/codeql.yml:86` | 🟡 | **CodeQL sin query packs extendidos.** `queries: security-extended,security-and-quality` está comentado → solo corre el set por defecto (más débil para una app de seguridad ocupacional con billing/PII). | codeql.yml:86 (línea comentada). |
| `.github/workflows/deploy.yml:53-56` | 🔵 | `docker push` duplicado (push de `:${SHA}` y `:latest` dos veces, L53-54 y L55-56). Inocuo pero sloppy. | deploy.yml:53-56. |
| `.github/workflows/deploy.yml:154` | 🔵 | Cloud Scheduler para climate-scan en `us-central1` mientras el comentario H16 declara data-residency Chile (`southamerica-west1`). Solo el trigger (no datos), pero rompe la coherencia de región declarada. | deploy.yml:154 `SCHEDULER_LOCATION="us-central1"`. |
| `.env.example:124-126,547-549` | 🔵 | **Drift de nombres de var.** Webpay tiene `WEBPAY_ENV=integration` (L126) y `WEBPAY_ENVIRONMENT=integration` (L549, "default production") — dos vars para lo mismo, valores/defaults distintos → riesgo de config divergente. Igual con `DTE_AUTO_ISSUE=true` (L252) marcado "Default unset = false" pero el ejemplo lo pone en true. | .env.example:126,252,549. |
| `firebase-blueprint.json:12,18` | 🔵 | **Doc drift.** `User.role` enum = `["admin","supervisor","worker"]` (real: 15 roles en roles.ts/firestore.rules); `subscription.planId` = `["free","basic","premium","enterprise"]` (no matchea los RANK_*/"Ilimitado" reales). Blueprint AI-Studio stale; no load-bearing pero engañoso. | firebase-blueprint.json:12,18. |
| `firebase.json:11-24` | 🔵 | Hosting headers sin `Content-Security-Policy` ni HSTS (solo X-Frame-Options/nosniff/Referrer-Policy). El serving real es Cloud Run/Express (este bloque hosting parece vestigial — rewrites apuntan a `function: api` que no existe en este stack), pero si Firebase Hosting se activa, faltaría CSP. | firebase.json:16-23. |
| `infra/*/server.py` (convert) | 🔵 | `outputBucket` (y `videoUri` bucket) vienen sin validar del body → un caller comprometido puede escribir/leer cualquier bucket alcanzable por el SA. Caller es el backend confiable + Cloud Run `--no-allow-unauthenticated`, por eso 🔵, no 🟡. | dwg `:159`, usdz `:159`, worker `:113-116`. |

---

## Archivos limpios (sin hallazgos accionables)

Conteo: **31 / 55** sin hallazgos.

`.claude/settings.json`, `.dockerignore`, `.gcloudignore`, `.gitattributes`, `.gitignore`,
`.mcp.json`, `.npmrc`, `.size-limit.json`, `.telemetry/current-state.yaml`,
`.telemetry/proposed-events.yaml`, `bin/mcp-server.mjs`, `cloudbuild.yaml`,
`Dockerfile.api`, `Dockerfile.frontend`, `eslint.config.js`, `firebase.emulator-tests.json`,
`Gemfile`, `infra/photogrammetry-worker/ply-to-glb.py`,
`infra/photogrammetry-worker/poisson-mesh.py`, `infra/photogrammetry-worker/run-pipeline.sh`,
`infra/photogrammetry-worker/server.py`, `infra/usdz-converter/glb_to_usdz.py`,
`infrastructure/cloud-scheduler.yaml`, `infrastructure/terraform/.gitignore`,
`infrastructure/terraform/cloudrun.tf`, `infrastructure/terraform/dashboards/business.json`,
`.github/workflows/check-mobile-signing.yml`, `.github/workflows/dr-dryrun.yml`,
`.github/workflows/firestore-backup.yml`, `.github/workflows/mutation.yml`,
`.github/workflows/prepackage-slm.yml`.

Notas positivas: `mutation.yml` y `e2e.yml` (full-stack) tienen `continue-on-error` removido
(gating real, no fingido); subprocess en todos los converters usa list-form args (sin shell →
sin command injection); `firestore.indexes.json` no tiene errores de schema; ningún
`Math.random`/`eval` en los scripts de este lote; `.env.example` es 100% placeholders (sin
secretos reales horneados); el SSRF de modal está en código descartado/muerto.

---

### Resumen ejecutivo

Dos 🔴 de gobernanza-CI: (1) los guards stub-disfrazado (#13) y allowBackup (#17) tienen
script + tests pero NO están wired en husky ni CI, pese a que CLAUDE.md los declara "wired in
PR #514"; (2) no existe job de lint en ningún workflow, así que ESLint (incl. la custom rule
anti-`Math.random` de #15 y react-hooks) no gatea PRs — contradice CLAUDE.md. Los 🟡 son:
`firebase-applet-config.json` con apiKey real git-trackeada (contra sus propios 3 ignore);
comparación de bearer token no-constante en dwg/usdz converters (timing oracle) mientras el
worker sí usa `hmac.compare_digest`; SSRF latente en el worker Modal (fetch de URL arbitraria
si no es gs://, en código descartado); Dockerfile legado + 3 converters corriendo como root;
append-only de firmas CPHS más débil que audit_logs (permite swap del array); 14 colecciones
con índice pero sin regla (default-deny / TODO §17); Cloud Run `--allow-unauthenticated` con
posible mismatch scheduler OIDC vs `verifySchedulerToken`; CodeQL sin query packs extendidos.
Los 🔵 son drift de nombres env (Webpay/DTE), doc stale (firebase-blueprint roles/plans),
hosting sin CSP y pushes docker duplicados. 31/55 limpios; gating de mutation/e2e es honesto.
