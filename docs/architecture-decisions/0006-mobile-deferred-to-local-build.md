# ADR-0006: Mobile build deferred to local — rationale + Sprint 21 plan

**Fecha**: 2026-05-03
**Sprint**: 20 — seventh wave (Brecha A — Capacitor mobile, fase 4 master plan)
**Estado**: Aceptada
**Decisores**: Daho Sandoval (product), Claude Code (assist)
**Predecesor**: master-plan-end-to-end.md, fase 4 (Brecha A)
**Relacionado**: `IOS_BUILD.md`, `docs/mobile-build-runbook.md`, `.github/workflows/mobile-build-check.yml`

---

## Contexto

Sprint 17b instaló las dependencias Capacitor 8 y wireó el plugin de motion (FallDetection). Sprint 20 Brecha A ("Capacitor mobile") es fase 4 del master plan: cerrar la brecha del wrap nativo Android + iOS.

En este Sprint la pregunta concreta a decidir era:

> ¿Generamos `android/` + `ios/` (`npx cap add`), commiteamos, y automatizamos el build mobile en GitHub Actions ahora? ¿O lo dejamos como build local del dueño del producto, con preparación documental + workflow stub?

El entorno de desarrollo de este Sprint no tiene Android SDK ni Xcode instalados, y los runners hosted de GitHub Actions imponen costos y fricción operativa que no están justificados para una sola iteración de MVP.

## Forces

1. **Toolchain mobile no disponible local**: el contenedor de desarrollo actual no tiene Android SDK ni Xcode. `npx cap add android` requiere Android SDK + JDK 17 + variables de entorno (`ANDROID_HOME`, `JAVA_HOME`); `npx cap add ios` requiere macOS + Xcode 15+ + CocoaPods. Forzar que el entorno de desarrollo tenga estos toolchains para "completar el Sprint" es overhead que no aporta valor inmediato al producto — el binario para tienda lo arma el dueño en su máquina.

2. **Costo de runners hosted**: Android puede correr en `ubuntu-latest` (gratis para repos privados dentro del free tier hasta cierto cap), pero iOS requiere `macos-latest` que cobra **10x el costo de minuto** comparado con Linux (típicamente $0.08/min vs $0.008/min en planes pagos). Para un Sprint de MVP donde aún no hay submission planificada, gastar minutos en builds nativos automatizados es prematuro.

3. **Signing keystore + provisioning profile aún no existen**: para que un workflow de CI emita un APK/AAB instalable necesitamos:
   - Android: keystore JKS + alias + passwords almacenados como GitHub Secrets (`ANDROID_KEYSTORE_B64`, etc.).
   - iOS: certificado de distribución (`.p12`), provisioning profile (`.mobileprovision`), y App Store Connect API key.
   - Ninguno de estos secretos ha sido generado todavía. Generarlos prematuramente abre superficie de seguridad sin un caso de uso concreto.

4. **El primer submission lo hará el dueño localmente**: Daho prefiere autonomía + procesos largos, pero el primer submit a Play Internal Testing / TestFlight es un proceso humano (firma de cuenta de developer, configuración de listing en Play Console / App Store Connect, política de privacidad pública). Automatizar el build sin que la pipeline humana esté lista no acelera el primer submit.

5. **El stub debe darle al equipo una pista clara de cómo continuar**: dejar la rama sin ninguna mención de mobile sería peor — el siguiente Sprint perdería contexto de qué está hecho y qué falta. Un stub workflow + ADR + runbook capturan la intención y dejan la pista para Sprint 21+.

6. **`@perfood/capacitor-healthkit` ya tiene runbook iOS**: `IOS_BUILD.md` (Agent B2, 2026-04-28) cubre el detalle iOS. Sólo faltaba el contraparte Android + cross-platform overview, que entregamos en `docs/mobile-build-runbook.md`.

## Decisión

**En Sprint 20 entregamos preparación documental + stub workflow, pero NO ejecutamos `npx cap add` ni intentamos automatizar el build mobile en CI hosted. El primer build mobile lo hará el dueño del producto localmente siguiendo `docs/mobile-build-runbook.md`. Sprint 21+ puede automatizar con Fastlane si el dueño lo prioriza.**

### Lo que SÍ entrega Sprint 20 Brecha A

1. `capacitor.config.ts` validado con header explicando qué falta y por qué (Sprint 20 mobile-prep markers).
2. `docs/mobile-build-runbook.md` — runbook cross-platform con prerequisitos, comandos, matriz de permisos por plugin (11 plugins → AndroidManifest + Info.plist), troubleshooting, y forward-pointer a Sprint 21+.
3. `.github/workflows/mobile-build-check.yml` — stub que en cada PR verifica que el bundle web sigue compilando y que el Capacitor CLI puede parsear el config. NO marcado como required check. Incluye un sketch comentado del workflow real Gradle+Fastlane para Sprint 21+.
4. Este ADR.

### Lo que NO entrega Sprint 20 Brecha A (deferred)

- Carpetas `android/` y `ios/` generadas y commiteadas.
- Workflow real de Gradle + signing + upload a Play Internal Testing.
- Workflow real de xcodebuild + Fastlane + upload a TestFlight.
- Generación de keystore + certificados de distribución.
- Configuración de listing en Play Console / App Store Connect.

## Plan Sprint 21+

Cuando el dueño priorice automatizar el mobile build:

### Fase 1 — Generar artefactos nativos (local, una vez)
- Dueño corre `npx cap add android` en una máquina con Android Studio.
- Dueño corre `npx cap add ios` en una máquina con macOS + Xcode.
- Aplica las edits de `Info.plist` + `App.entitlements` documentadas en `IOS_BUILD.md` y la matriz de permisos en `docs/mobile-build-runbook.md`.
- Commit `android/` e `ios/` al repo.

### Fase 2 — Generar secretos de signing
- Android: `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias praeventio-guard`. Convertir a base64 (`base64 release.jks > release.jks.b64`) y guardar como GitHub Secret `ANDROID_KEYSTORE_B64`.
- iOS: enrollment $99/año en Apple Developer Program, generar Distribution Certificate + App Store provisioning profile. Exportar `.p12` y guardar como secret junto con la App Store Connect API key.

### Fase 3 — Workflow real
Reemplazar `mobile-build-check.yml` con un workflow Fastlane:
- `fastlane android internal` → APK firmado → upload a Play Internal Testing.
- `fastlane ios beta` → IPA firmado → upload a TestFlight (requiere `macos-latest` runner).
- Trigger: en tag `v*-mobile` o manual `workflow_dispatch`.

### Fase 4 — Pipeline humano
- Crear listing en Play Console (privacy policy, screenshots, descripción CL).
- Crear app en App Store Connect (privacy nutrition labels, AppPrivacy URL).
- Subir el primer build de TestFlight + invitar testers internos.

## Consecuencias

**Positivas**
- Sprint 20 cierra Brecha A sin overhead de toolchain mobile en CI.
- El siguiente desarrollador que toque mobile tiene un runbook + matriz de permisos + ADR explicando exactamente qué falta.
- Cero costo en runners macOS hasta que el dueño priorice el submit.
- Cero secretos de signing en el repo hasta que sean necesarios.

**Negativas / Trade-offs**
- El primer submit a Play / App Store requiere que el dueño tenga macOS o pida el build a un colaborador con Mac.
- Si una PR rompe la integración Capacitor (ej. cambia `webDir`, agrega un plugin con permisos no declarados), no lo detectamos en CI hasta que alguien corre `cap sync` localmente. El stub mitiga esto en parte verificando que `cap config --list` parsea, pero no detecta drift de permisos.
- Hay riesgo de que `android/` e `ios/` queden out-of-sync con `capacitor.config.ts` si nadie corre `cap sync` después de cambios. Mitigación: el runbook y el stub workflow lo recuerdan; Sprint 21+ lo automatiza.

## Alternativas consideradas

1. **Ejecutar `cap add` + commitear native folders ahora, sin automatizar el build**: descartado. Generar `android/` requiere Android SDK; generar `ios/` requiere macOS. Ninguno disponible en este entorno. Forzaría un context-switch de máquina solo para tener carpetas vacías que aún no se buildean.

2. **macOS runner en CI con Fastlane lite**: descartado por costo + falta de signing certs. Sin certs reales el workflow solo hace `xcodebuild -showBuildSettings`, que aporta menos que el stub Linux actual.

3. **Codemagic / Bitrise como CI mobile dedicado**: opción válida para Sprint 21+, descartada para Sprint 20 por scope. El plan deja la puerta abierta — la decisión Fastlane vs Codemagic vs Bitrise se tomará en el Sprint que active la automatización.

4. **No hacer nada en este Sprint**: descartado. El master plan tiene Brecha A como fase 4 explícita; dejar la rama sin tocar mobile pierde el momentum y el siguiente Sprint pierde contexto de qué falta.
