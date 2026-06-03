# DEEP-EXI-27 — Pasada exhaustiva línea-por-línea (Lote #27, categoría I-PLAT)

**Fecha:** 2026-06-03
**Auditor:** Claude (Opus 4.8, 1M ctx)
**Alcance:** `docs/audits/file-ledger/ledger.json` → `category === "I-PLAT"`, ordenado por `path`, slice `[0:55]`.
**Total I-PLAT en ledger:** 72 — este lote cubre los primeros 55 (android/* + capacitor.config.ts + fastlane/*).
**Tipo:** Doc-only. NO commit.

## Atestación

**55 / 55 archivos del slice leídos.**

Desglose:
- **Código/config leídos línea por línea (29):** `android/.gitignore`, `android/app/.gitignore`, `android/app/build.gradle`, `android/app/capacitor.build.gradle`, `android/app/proguard-rules.pro`, `android/app/src/androidTest/.../ExampleInstrumentedTest.java`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/praeventio/guard/MainActivity.java`, `android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml`, `android/app/src/main/res/drawable/ic_launcher_background.xml`, `android/app/src/main/res/layout/activity_main.xml`, `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, `.../ic_launcher_round.xml`, `android/app/src/main/res/values/ic_launcher_background.xml`, `.../values/strings.xml`, `.../values/styles.xml`, `.../xml/file_paths.xml`, `android/build.gradle`, `android/capacitor.settings.gradle`, `android/gradle.properties`, `android/gradle/wrapper/gradle-wrapper.properties`, `android/gradlew`, `android/gradlew.bat`, `android/settings.gradle`, `android/variables.gradle`, `capacitor.config.ts`, `fastlane/Appfile`, `fastlane/Fastfile`.
- **Binarios verificados por tipo/hash, no decompilados (1 grupo):** `android/gradle/wrapper/gradle-wrapper.jar` (Zip/JAR estándar 43764 bytes — wrapper Gradle canónico, sin payload sospechoso).
- **Assets gráficos PNG agrupados (25):** los 10 `splash.png` (land/port × densidades) + `drawable/splash.png` + los 14 `mipmap-*/ic_launcher*.png`. Imágenes binarias; sin contenido auditable de código.

## Hallazgos

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| capacitor.config.ts:39 / AndroidManifest.xml:33-37 / public/.well-known/assetlinks.json / apple-app-site-association | 🔴 | **Deep-link / WebAuthn domain mismatch.** Todo el deep-linking (manifest `android:host="praeventio.app"`, `main.tsx` listener `https://praeventio.app/...`, AASA, assetlinks) apunta al dominio **`praeventio.app`** (bare, sin subdominio). Pero el dominio web productivo real es **`app.praeventio.net`**: server WebAuthn RP ID = `app.praeventio.net` (`webauthnAssertion.ts:52-54`, `sitebookSignRoutes.ts:39-49`), emails `noreply@praeventio.net` (`backgroundTriggers.ts:255`), `APP_BASE_URL=https://app.praeventio.net` (.env.example:36). App Links/Universal Links nunca se verificarán contra el dominio que efectivamente sirve la app → deep links rotos en prod. | `AndroidManifest.xml:36` `android:host="praeventio.app"`; `main.tsx:27,57`; vs `.env.example:36 APP_BASE_URL=https://app.praeventio.net`, `webauthnAssertion.ts:54` |
| .env.example:36,328,589,594 | 🔴 | **Inconsistencia interna del propio template de dominios** (raíz del bug anterior). Coexisten cuatro valores: `APP_BASE_URL=https://app.praeventio.net`, `WEBAUTHN_RP_ID=praeventio.net`, `WEBAUTHN_RPID=<praeventio.app>`, `WEBAUTHN_ORIGIN=<https://app.praeventio.app>`. Tres dominios distintos (`app.praeventio.net`, `praeventio.net`, `praeventio.app`/`app.praeventio.app`) + duplicación `WEBAUTHN_RP_ID` vs `WEBAUTHN_RPID`. WebAuthn falla si RP ID no es sufijo registrable del origin. | `.env.example:36,328,589,594` |
| public/.well-known/apple-app-site-association | 🟡 | **AASA con placeholder `TEAMID` sin reemplazar.** `appID` y `webcredentials.apps` = `"TEAMID.com.praeventio.guard"`. Universal Links y WebAuthn web-credentials de iOS no funcionarán hasta sustituir por el Apple Team ID real (10 chars). Documentado como pendiente en `docs/deep-linking-runbook.md:39`, pero el archivo se sirve tal cual desde `public/`. | `apple-app-site-association` líneas `appID` / `webcredentials` |
| android/app/build.gradle:21 | 🟡 | **Release build sin ofuscación ni shrink.** `minifyEnabled false` en `buildTypes.release` (único en todo el proyecto), sin `shrinkResources`. R8/ProGuard desactivado → nombres de clases/métodos del bundle JS-bridge expuestos, APK/AAB mayor, sin protección anti-tampering básica para una app de cumplimiento con SQLite cifrado y datos de salud. `proguard-rules.pro` está completo en comentarios (vacío efectivo). | `build.gradle:21 minifyEnabled false` |
| android/app/src/main/res/xml/file_paths.xml:3-4 | 🟡 | **FileProvider con paths demasiado amplios.** `<external-path name="my_images" path="."/>` y `<cache-path name="my_cache_images" path="."/>` exponen la raíz completa del almacenamiento externo y del cache vía `content://...fileprovider`. Combinado con `grantUriPermissions="true"`, cualquier URI generado puede referenciar archivos arbitrarios bajo esas raíces. Acotar a subdirectorios específicos (p.ej. `path="images/"`, `path="exports/"`). Plantilla Capacitor por defecto; no endurecida. | `file_paths.xml:3-4` |
| AndroidManifest.xml:96 (ACCESS_BACKGROUND_LOCATION) | 🟡 | **Permiso de ubicación en background.** `ACCESS_BACKGROUND_LOCATION` es legítimo para el flujo lone-worker FGS, pero es un permiso de alto riesgo bajo escrutinio de Play (requiere justificación en consola + video). Verificar que está condicionado al consentimiento del trabajador y documentado en la declaración de Play. No es un bug, pero merece revisión de cumplimiento/privacidad (Ley 19.628 / datos de localización). | `AndroidManifest.xml` bloque `uses-permission` FGS |
| android/app/src/androidTest/.../ExampleInstrumentedTest.java:24 | 🔵 | **Test instrumentado boilerplate con assert incorrecto.** `assertEquals("com.getcapacitor.app", appContext.getPackageName())` — el package real es `com.praeventio.guard`. Test plantilla nunca actualizado; fallaría si se ejecutara. Cosmético (no corre en CI de este repo). | `ExampleInstrumentedTest.java:24` |
| capacitor.config.ts:31-33 | 🔵 | **cleartext sólo en dev (correcto), pero depende de NODE_ENV en build.** `server.cleartext:true` + `url:http://10.0.2.2:5173` se inyectan sólo si `!isProd`. `android.allowMixedContent:false` está bien. Riesgo: si un build de store se genera sin `NODE_ENV=production`, se embebería el server cleartext del emulador. El comentario lo advierte ("remove the server block before store builds") pero no hay guard automatizado. | `capacitor.config.ts:22,31-33` |

## Conteo

- 🔴 Críticos: **2** (domain mismatch deep-link/WebAuthn; inconsistencia interna de dominios en .env.example).
- 🟡 Medios: **4** (AASA TEAMID placeholder; release sin minify/shrink; FileProvider paths amplios; permiso background-location a revisar).
- 🔵 Bajos/informativos: **2** (test boilerplate package erróneo; cleartext dev dependiente de NODE_ENV).
- **Limpios (sin hallazgos):** **47 / 55** archivos. Incluye: AndroidManifest cumple **#17 `allowBackup="false"`** ✅; los tres `android:exported` correctos (MainActivity `true` con intent-filter; FileProvider y ForegroundService `false`); SQLite cifrado nativo activo (`androidIsEncryption:true` / `iosIsEncryption:true`, **#16**); sin keystores / service-account / google-services.json commiteados; sin secretos hardcodeados (Fastfile lee todo de ENV); gradle-wrapper.jar canónico; gradlew/gradlew.bat estándar.

## Notas de alcance

- El slice `[0:55]` ordenado por path **no** alcanza `ios/*`, `src/workers/*` ni `packages/capacitor-mesh/*` — esos paths caen en `[55:72]` (siguiente lote I-PLAT). La descripción del lote los mencionaba pero el slice numérico los excluye; se auditan en el lote #28.
- "Plugin mesh nativo vs stub", "service workers (Workbox)" y archivos Swift/plist iOS quedan por tanto **fuera** de este lote por el slice exacto solicitado.

## Resumen

Lote #27 (55 archivos android/capacitor/fastlane) sin secretos ni keystores commiteados, con `allowBackup="false"` (#17) y cifrado SQLite nativo (#16) correctamente activos, y `exported` bien acotado. El hallazgo dominante es un **mismatch de dominio crítico** (2×🔴): toda la cadena de deep-linking nativo (manifest, AASA, assetlinks, listener `appUrlOpen`) usa `praeventio.app`, mientras el servidor productivo, WebAuthn RP ID y emails usan `app.praeventio.net`; el propio `.env.example` mezcla tres dominios distintos, lo que romperá App Links/Universal Links y la validación WebAuthn en producción. En 🟡: AASA aún con placeholder `TEAMID`, release build sin R8/ofuscación (`minifyEnabled false`), FileProvider con `path="."` (raíz externa+cache expuesta) y permiso `ACCESS_BACKGROUND_LOCATION` a revisar para Play. En 🔵: test instrumentado con package erróneo y cleartext-dev dependiente de NODE_ENV sin guard. 47/55 limpios. iOS/workers/mesh quedan para el lote #28 (slice [55:72]).
