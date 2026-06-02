# DEEP — Infra: I-PLAT / I-BUILD / I-ASSETS · 2026-06-02

**Archivos revisados:** ~95 significativos (de 281; assets binarios PNG/SVG/GLB/woff/jar agrupados).
Distribución del ledger: I-BUILD 132 · I-ASSETS 77 · I-PLAT 72.

> Nota de método: el ledger reporta `loc:0` para muchos archivos reales (Dockerfiles,
> `*.tf`, `*.py`, `*.gradle`, `.env.example`). Es un hueco del contador del ledger (extensiones
> no contadas), NO archivos vacíos — verificado por `wc -c` (p.ej. `Dockerfile.api` 3465 B,
> `.env.example` 28.5 KB, `cloudrun.tf` 3.2 KB). No es deuda.

---

## 1. Lo que YA HACE (implementado y real)

- **Mesh nativo REAL en ambas plataformas (Sprint 46).** No es stub.
  - Android: `packages/capacitor-mesh/android/.../MeshPlugin.kt:1-90+` (553 LOC) — BLE GATT
    real: `BluetoothLeAdvertiser` + `BluetoothLeScanner` + `BluetoothGattServer`/`Gatt` client,
    chunks 512 B, dedupe, peer-lost 30 s, permission gating API 31+/≤30. UUID canónico no-hex
    `00001234-PRAE-VENTI-O123-…` se mapea determinísticamente a un UUID hex válido
    (`MeshPlugin.kt:21-86`).
  - iOS: `packages/capacitor-mesh/ios/Plugin.swift:1-32+` (351 LOC) — CoreBluetooth real
    (`CBPeripheralManager`/`CBCentralManager`/delegates), background modes BT central+peripheral.
  - Web fallback: `packages/capacitor-mesh/src/web.ts` (241 LOC).
- **`android:allowBackup="false"`** cumplido (Regla #17): `android/app/src/main/AndroidManifest.xml:5`.
- **Android hardening:** App Links `autoVerify="true"` host `praeventio.app`
  (`AndroidManifest.xml:30-38`), FileProvider, FGS con permisos explícitos
  (`FOREGROUND_SERVICE_LOCATION/HEALTH`, `AndroidManifest.xml:82-87`), `MainActivity` mínima.
- **assetlinks.json con SHA-256 REAL** ya commiteado (no placeholder):
  `public/.well-known/assetlinks.json:11`. `scripts/fill-android-assetlinks.mjs` (298 LOC) y
  `scripts/render-well-known.mjs` lo regeneran vía keytool/`ANDROID_SHA256` con validación.
- **AASA `TEAMID` = placeholder HONESTO por diseño.** `render-well-known.mjs:13-14,68` deja
  `TEAMID` con warning (no aborta) si `APPLE_TEAM_ID` no está; solo sustituye con team-id válido
  (`^[A-Z0-9]{10}$`). `scripts/fill-ios-aasa.mjs` valida que no quede el prefijo.
- **KMS prod enforced (cloud-kms).** `scripts/validate-env.cjs:59-74` rechaza cualquier
  `KMS_ADAPTER` ≠ `cloud-kms` en prod y exige `KMS_KEY_RESOURCE_NAME`; el boot también cierra
  vía `kmsPreflight.ts` (comentario L60-61). `deploy.yml:74-75` inyecta `KMS_ADAPTER=cloud-kms`.
  Terraform `infrastructure/terraform/kms.tf:27-39` crea la KEK con rotación configurable.
- **CI honesto — sin `continue-on-error` tramposo.**
  - `ci.yml` (222 LOC): jobs typecheck, test, validate-env, rules-tests (emulator + Java 21),
    firestore-stores (emulator), ADR-0012 medical guard (replay del hook, `ci.yml:166-200`), build.
  - **Mutation/Stryker AHORA bloqueante:** `mutation.yml:30-35` removió `continue-on-error`;
    `scripts/check-mutation-thresholds.cjs` (229 LOC) enforcea ratchet + floors auth/billing/safety
    post-hoc (Stryker 9.6.1 no soporta per-file). Thresholds `stryker.config.json:17` high80/low60/break50.
  - e2e `continue-on-error: false` (`e2e.yml:90`).
- **Dockerfiles endurecidos.** `Dockerfile.api` (multi-stage, `USER node`, HEALTHCHECK,
  secrets NO horneados → Secret Manager, `Dockerfile.api:65-77`). nginx con CSP/XFO/Permissions-Policy,
  `server_tokens off`, cache-control inmutable (`nginx.conf:38-70`).
- **Deploy seguro:** `deploy.yml` corre solo tras `workflow_run` CI exitoso (L4,26); todos los
  secretos vía Secret Manager `:latest` (GEMINI, SESSION, WEBPAY, KHIPU, etc.).
- **Mobile release real:** `mobile-release.yml` (253 LOC) decodifica keystore de secret base64,
  Fastlane → Play Store, detección de secretos disponibles con skip+warning si faltan.
- **Service worker FCM con guard de placeholders** (`public/firebase-messaging-sw.js`): no
  inicializa si `__VITE_FIREBASE_*__` sin sustituir; warning en vez de throw.
- **Guards de seguridad existentes y wired:** medical-guard, convention-guard, validate-i18n,
  any-ratchet en `.husky/pre-commit`; medical-guard también en CI. `check-frozen.cjs` en hook
  Claude PreToolUse (`.claude/settings.json`).
- **Storage rules estrictas** (`storage.rules`, 164 LOC): tenant/proyecto, quarantine→AV-scan,
  tipo/tamaño por categoría, default-deny cross-tenant.
- **Perf gates:** `.size-limit.json` (bundles 120-700 KB por chunk), `lighthouserc.json`.

---

## 2. Lo que está PENDIENTE (deuda)

- 🔴 **Guards documentados como wired pero NO invocados.** CLAUDE.md Reglas #13 (stub-guard)
  y #17 (allowbackup-guard) afirman "Enforced … (wired in PR #514)", pero:
  - `.husky/pre-commit` NO los llama (solo medical/convention/i18n/any-ratchet).
  - No aparecen en `.github/workflows/`, `package.json` ni en ningún script.
  - Los propios scripts lo admiten: `precommit-stub-guard.cjs:4` "NOT wired into .husky/pre-commit
    yet (PR #514's job)"; `precommit-allowbackup-guard.cjs:17` "PR #514 wires … THIS PR does NOT".
  → Las reglas #13/#15/#17 NO tienen enforcement automático real hoy. PR #514 nunca aterrizó el wiring.
- ⚠️ **Doc-vs-code: `firebase-applet-config.json`.** CLAUDE.md (sección Environment) dice que es
  el "Firebase Admin SA … gitignored y vive solo en Secret Manager". En realidad: es **web/client
  config** (sin `private_key`), está **tracked y NO gitignored** (verificado `git ls-files` /
  `git check-ignore`), con valores reales (`apiKey AIzaSy…`, `projectId praeventio-541ad`).
  Riesgo bajo (las web API keys de Firebase son client-exposed por diseño), pero la doc es incorrecta.
- ⚠️ **Inconsistencia de dominio en deep-links.** AASA + AndroidManifest usan host
  `praeventio.app` (`AndroidManifest.xml:37`), pero security.txt/canonical y Cloud Run usan
  `praeventio.net` / `app.praeventio.net` (`deploy.yml:76-77`, `security.txt`). Confirmar cuál es el
  dominio canónico de App/Universal Links antes del build de tienda o la verificación fallará.
- 🟡 **`pgp-key.asc` vacío** (`public/.well-known/pgp-key.asc`, 0 B) y security.txt tiene
  `# Encryption: TODO when PGP key published` — el bloque Encryption está comentado.
- 🟡 **`security.txt` Acknowledgments/Policy** apuntan a `github.com/mikesandoval10creator/…`
  mientras el dominio de producto es praeventio.net — verificar consistencia del repo público.
- 🟡 **Capacitor config doc drift:** `capacitor.config.ts:8` afirma "Native folders (android/,
  ios/) are NOT generated yet", pero `android/` e `ios/` ya existen en el ledger (Regla #20 doc-sync).
- 🟡 **AASA committed sigue con `TEAMID`** — esperado para estado de repo, pero recordar que el
  build iOS de tienda requiere `APPLE_TEAM_ID` o el AASA queda inservible (warning, no error).

---

## 3. Tabla por archivo (significativos; binarios agrupados)

| Archivo | Estado | Propósito + hallazgo file:line |
|---|---|---|
| `packages/capacitor-mesh/android/.../MeshPlugin.kt` | ✅ | BLE GATT real Sprint 46, 553 LOC. UUID no-hex→hex `:21-86` |
| `packages/capacitor-mesh/ios/Plugin.swift` | ✅ | CoreBluetooth real Sprint 46, 351 LOC `:1-32` |
| `packages/capacitor-mesh/src/web.ts` | ✅ | Fallback web del mesh (241 LOC) |
| `packages/capacitor-mesh/android/.../AndroidManifest.xml` | ✅ | Permisos BLE/Wi-Fi-Direct/FGS completos |
| `android/app/src/main/AndroidManifest.xml` | ✅ | `allowBackup=false :5`; App Links `praeventio.app :37`; FGS perms `:82-87` |
| `android/app/.../MainActivity.java` | ✅ | `BridgeActivity` mínima estándar Capacitor |
| `capacitor.config.ts` | 🟡 | Config correcta; comentario `:8` desactualizado (android/ios sí existen) |
| `fastlane/Fastfile`, `ios/App/fastlane/*` | 🔵 | Fastlane scaffolding (no inspeccionado a fondo; loc bajo) |
| `src/workers/forceGraphWorker.ts` | ✅ | d3-force off-thread para KnowledgeGraph >200 nodos (215 LOC) |
| `.github/workflows/ci.yml` | ✅ | 8 jobs reales, sin continue-on-error; medical guard replay `:166-200` |
| `.github/workflows/mutation.yml` | ✅ | Stryker bloqueante `:30-35`; check-thresholds `:60` |
| `.github/workflows/deploy.yml` | ✅ | workflow_run gated `:26`; KMS cloud-kms `:74`; secrets via SM |
| `.github/workflows/mobile-release.yml` | ✅ | Keystore base64→Play Store via Fastlane (253 LOC) |
| `.github/workflows/e2e.yml` | ✅ | continue-on-error=false `:90` |
| `.github/workflows/{codeql,ossar,perf,smoke,loadtest,dr-dryrun,firestore-backup,...}.yml` | ✅ | Cobertura CI amplia (SAST, perf, DR, backups) |
| `.husky/pre-commit` | 🔴 | Solo medical/convention/i18n/any-ratchet — falta stub+allowbackup guard |
| `scripts/precommit-allowbackup-guard.cjs` | 🏚️ | Lógica correcta (105 LOC) pero NO wired `:17` |
| `scripts/precommit-stub-guard.cjs` | 🏚️ | Enforcea reglas 13/14/15 pero NO wired `:4` |
| `scripts/precommit-medical-guard.cjs` | ✅ | Wired en husky + CI (ADR 0012) |
| `scripts/validate-env.cjs` | ✅ | KMS cloud-kms-only prod `:59-74`; rechaza placeholders |
| `scripts/check-mutation-thresholds.cjs` | ✅ | Ratchet + floors auth/billing/safety post-hoc (229 LOC) |
| `scripts/fill-android-assetlinks.mjs` | ✅ | keytool→SHA256 idempotente con validación (298 LOC) |
| `scripts/fill-ios-aasa.mjs` | ✅ | Sustituye TEAMID validando `^[A-Z0-9]{10}$` (204 LOC) |
| `scripts/render-well-known.mjs` | ✅ | prebuild; aborta si placeholder falso; TEAMID honesto `:13,68` |
| `scripts/{backup,restore}-firestore.cjs`, `test-backup-integrity.cjs` | ✅ | Backup/DR reales |
| `scripts/dr-{failover,simulate}.sh`, `rotate-secrets.sh`, `secrets-bootstrap.sh` | 🔵 | Ops shell (no ejecutado) |
| `Dockerfile.api` | ✅ | Multi-stage, USER node, HEALTHCHECK, secrets fuera de imagen `:65-77` |
| `Dockerfile`, `Dockerfile.frontend` | ✅ | Imágenes legacy/frontend (1-1.8 KB) |
| `infra/{dwg,usdz}-converter/*`, `infra/photogrammetry-worker/*` | 🟡 | Converters Python con bearer-token auth `server.py:64-70`; photogrammetry server-side DESCARTADO (deploy.yml comenta) |
| `nginx.conf` | ✅ | CSP/XFO/Permissions-Policy, server_tokens off `:38-70` |
| `cloudbuild.yaml` | ✅ | Build→Artifact Registry (121 LOC) |
| `firestore.rules` | ✅ | 1183 LOC default-deny (auditado en otra tanda) |
| `storage.rules` | ✅ | 164 LOC tenant/quarantine/tipo/tamaño |
| `firestore.indexes.json` | ✅ | 598 LOC índices |
| `infrastructure/terraform/{kms,cloudrun,iam,secrets,...}.tf` | ✅ | IaC GCP; KMS KEK rotación `kms.tf:27-39` |
| `infrastructure/cloud-scheduler.yaml` | ✅ | Cron jobs (207 LOC) |
| `vite.config.ts` | ✅ | 362 LOC; CSP nonce plugin + FCM SW config injector |
| `vitest*.config.ts` (5) | ✅ | default/rules/firestore/dr separados correctamente |
| `eslint.config.js`, `tsconfig.json`, `playwright.config.ts`, `stryker.config.json` | ✅ | Configs build/test |
| `package.json` / `package-lock.json` | ✅ | npm lockfile (Regla #lock); prebuild hook `:12` |
| `firebase-applet-config.json` | ⚠️ | Web config REAL tracked+no-ignored; doc lo llama "Admin SA gitignored" (incorrecto) |
| `firebase.json`, `firebase.emulator-tests.json`, `firebase-blueprint.json` | ✅ | Hosting headers XFO/nosniff; emuladores |
| `index.html` | ✅ | CSP nonce placeholder re-stampado por vite `:34-40` |
| `public/.well-known/assetlinks.json` | ✅ | SHA-256 real `:11` |
| `public/.well-known/apple-app-site-association` | 🟡 | `TEAMID` placeholder (honesto, fill en build) |
| `public/.well-known/security.txt` | 🟡 | Encryption TODO; ack/policy a repo `mikesandoval10creator` |
| `public/.well-known/pgp-key.asc` | 🏚️ | Vacío (0 B) |
| `public/firebase-messaging-sw.js` | ✅ | FCM SW con guard de placeholders no-sustituidos |
| `public/manifest.json`, `public/mascots/manifest.json` | ✅ | PWA manifests |
| `marketplace/manifest.json` | 🔵 | TEMPLATE Google Workspace Marketplace SDK (no es manifest ejecutable) |
| `public/data/guardian-offline-corpus.json` | ✅ | Corpus offline (257 LOC) |
| `public/icons/biology/*.svg` (≈30) | ✅ | Iconos médicos generados (binarios, agrupados) |
| `public/medallas/*.svg` (5), `public/mascots/*.png` (5), splash/launcher PNG (≈30) | ✅ | Assets gráficos (agrupados) |
| `public/models/ar/*.{glb,usdz}` (≈25) | 🔵 | Modelos AR (loc:0 en ledger — verificar bytes reales si crítico para AR) |
| `android/gradle/wrapper/gradle-wrapper.jar` + `*.gradle`/`*.pro` | ✅ | Gradle wrapper estándar Capacitor |

---

## 4. Para decisión del usuario (❓/⚠️)

1. ⚠️ **Wiring de guards (Reglas #13/#17).** ¿Aterrizar el wiring pendiente de "PR #514"
   agregando `precommit-stub-guard.cjs` y `precommit-allowbackup-guard.cjs` a `.husky/pre-commit`
   (y/o a `ci.yml` como replay, igual que el medical guard)? Hoy las reglas existen en doc y los
   scripts existen, pero **nada los ejecuta** — un commit con `allowBackup="true"` o un stub no
   inventariado pasaría sin bloqueo.
2. ⚠️ **`firebase-applet-config.json`.** ¿Corregir CLAUDE.md (es web config, no Admin SA, y está
   tracked intencionalmente) o cambiar la práctica? Riesgo cripto bajo, pero la doc miente sobre
   qué archivo es y su estado git.
3. ⚠️ **Dominio canónico de deep-links.** Resolver `praeventio.app` (AASA/AndroidManifest) vs
   `praeventio.net`/`app.praeventio.net` (security.txt/Cloud Run) antes de cualquier build de
   tienda — la auto-verificación de App/Universal Links fallará si el host no coincide con el sitio.
4. 🟡 **PGP key vacío + security.txt:** publicar la clave en `pgp-key.asc` y descomentar
   `Encryption:` o aceptar el estado y dejar nota explícita.
5. 🟡 **Doc-sync menor:** actualizar comentario `capacitor.config.ts:8` (android/ios ya generados).
