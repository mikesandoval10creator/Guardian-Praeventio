# Auditoría Ola A — B20 (i18n) · B21 (Mobile/Capacitor) · B22 (Corpus normativo/RAG) · B24 (Calidad de tests)

Fecha: 2026-06-10 · Rama: `claude/buenas-6ahumq` · Auditor: Claude (Ola A, Phase 5)
Método: lectura directa de código + ejecución de `scripts/validate-i18n.cjs` + análisis estático
de claves i18n (script ad-hoc, literal + prefijo dinámico) + inspección de manifiestos/gradle/podspec.

Severidades: 🔴 roto-en-prod · 🟡 integridad · 🔵 limpieza.

---

## B20 — i18n / Locales

### Resultado del validador oficial

`node scripts/validate-i18n.cjs` → **PASS** — "launch-locale parity held (gap baselined: en:0 · pt-BR:59)".
El gate funciona, pero su universo son SOLO las claves que existen en `es/common.json` (2.342 hojas).

### B20-1 🔴 ~3.150 claves usadas en código que NO existen en `es/common.json` — el gate de paridad es ciego a ellas

- Evidencia: análisis estático sobre todo `src/` (excl. tests): **5.155 claves distintas** invocadas vía
  `t('ns.key')`; **3.150 (61%) no tienen entrada** en `src/i18n/locales/es/common.json`.
- El patrón dominante es `t('clave.x', 'Texto en español')` con default inline: **2.745 llamadas** con
  segundo argumento literal. Ejemplos de namespaces enteros fuera del JSON: `incidentFlow` (60 claves),
  `drivingSafety` (60), `annualReview` (57), `closure` (56), `confidentialReports` (51), `brigade` (50),
  `hazmat` (50), `drills` (48), `deaZones` (45), `evacuation` (42).
- Consecuencia real: un usuario en `en` o `pt-BR` ve el **default en español** para esas 3.150 claves
  (i18next no encuentra la clave en ningún bundle y renderiza el defaultValue). El gate de Regla #18
  jamás lo detecta porque la clave nunca entró al JSON de referencia.
- Nótese que varios de esos namespaces son **vida-seguridad** (brigade, evacuation, deaZones, drills,
  incidentFlow) — exactamente lo que ADR 0021 exige libre y usable para todo trabajador.
- Para hacerlo real (cablear, no borrar): extraer los defaults inline a `es/common.json` (codemod
  `t('k','v')` → entrada JSON + `t('k')`), traducir a `en`/`pt-BR`, y extender
  `scripts/validate-i18n.cjs` para fallar ante claves usadas-en-código-sin-entrada (hoy solo compara
  JSON contra JSON).
  - Refs: `src/i18n/index.ts:47-54` (solo `common.json` por locale), `src/i18n/locales/es/common.json`
    (2.342 hojas), muestreo `src/components/incidentFlow/LessonPublishForm.tsx`,
    `src/pages/DrivingSafety.tsx`.

### B20-2 🟡 Baseline de paridad pt-BR (59 claves) cubre dos features de vida-seguridad

- `scripts/i18n-parity-baseline.json:6-64` — las 59 claves sin pt-BR son `incident_report.*` (30,
  reporte de incidentes), `lone_worker.*` (14, trabajador solitario/FGS) y `oc.*` (15, calculadora).
- Reportar un incidente o usar lone-worker en pt-BR cae al fallback `pt-BR → en → es`
  (`src/i18n/index.ts:121`). Funciona, pero el flujo de pánico queda en idioma equivocado para Brasil
  (locale declarado "launch" en CLAUDE.md Regla #18).
- Hacer real: traducir esas 59 claves y vaciar el baseline (es un ratchet: solo puede encoger).

### B20-3 🟡 Restos de la era pre-ADR-0012: 47 claves diagnósticas muertas embarcadas en el bundle

- 77 claves definidas y nunca usadas (tras filtrar claves dinámicas por prefijo). De ellas, **27 en
  `differential_dx.*`** y **20 en `drug_interactions.*`** son la UI diagnóstica ANTIGUA:
  `differential_dx.diat_required` ("DIAT/DIEP REQUERIDO"), `differential_dx.occupational_disease`,
  `differential_dx.prob_high`, `drug_interactions.severity_contraindicated`,
  `drug_interactions.badge_gemini` ("Gemini IA"), `drug_interactions.analyze_count`…
- Los componentes reconvertidos (`src/components/medicine/DifferentialDiagnosis.tsx:33-43`,
  `src/components/medicine/DrugInteractions.tsx`) ya usan claves NUEVAS (`differential_dx.title`
  "Referencia clínica CIE-10", `drug_interactions.badge_reference`, `catalog_*`) — pero esas claves
  nuevas **tampoco están en los JSON** (caen en B20-1) y las viejas siguen embarcadas en es/en/pt-BR.
- Riesgo: copy diagnóstico ("probabilidad alta", "contraindicado", "analizar fármacos") sigue en el
  bundle distribuido; un regreso accidental del componente viejo lo reactivaría sin tocar locales.
- Hacer real: mover las claves nuevas de los componentes reconvertidos al JSON y eliminar del JSON las
  47 claves de la UI diagnóstica retirada (esto es limpieza de datos, no de capacidad — la capacidad
  ya fue reconvertida conforme ADR 0012). Resto de muertas: `dashboard.*` (10), `nav.*` (5),
  `time.*` (5), `epp_required.*` (4) — verificar una a una antes de podar (lista completa generada
  durante la auditoría; regenerable con el mismo script).

### B20-4 🟡 Texto español hardcodeado fuera de i18n en la mayoría de las páginas

- Muestreo dirigido de las 10 páginas más grandes: todas usan `useTranslation`, pero conviven con
  literales españoles directos:
  - `src/pages/Training.tsx:290-291,455,465` (títulos de cápsula, placeholders).
  - `src/pages/PTSGenerator.tsx:63-65,102-106` (mensajes de suspensión por clima — texto operativo
    de seguridad, hardcodeado).
  - `src/pages/DigitalTwinFaena.tsx:312-317,437-442` (toasts de error).
  - `src/pages/OfflineInspection.tsx:86-87,374,474,502-516` (plantillas de inspección y avisos offline).
- Barrido heurístico (tildes/ñ/"ción" en literales): **185 de 224 páginas** contienen literales
  españoles, ~1.341 líneas (incluye falsos positivos de comentarios; el orden de magnitud es real).
- Hacer real: misma remediación que B20-1 (extracción a claves), priorizando mensajes operativos de
  seguridad (suspensiones, SOS, offline).

### B20-5 🔵 Calidad voseo/chileno y drift de comentarios

- Tono consistente: **72 entradas en tuteo, 0 en ustedeo** en `es/common.json` — no hay mezcla
  tú/usted. Léxico CL correcto en dominio ("faena", "mutualidad", "DIAT/DIEP", RUT con guión).
  No se usa voseo verbal chileno (podís/querís), lo cual es correcto para registro profesional es-CL.
- 🔵 Drift doc-código: el comentario de `src/i18n/index.ts:20` dice `pt-BR → pt → en` pero el código
  implementa `'pt-BR': ['en', 'es']` (`src/i18n/index.ts:121`). No existe locale `pt`. Corregir comentario.
- 🔵 Locales lazy desiguales por diseño (27–46 claves: `ar`,`de`,`fr`… solo landing) — conforme a
  Regla #18, sin hallazgo.

---

## B21 — Mobile / Capacitor

### B21-1 🔴 El plugin mesh nativo REAL existe pero NO está instalado en la app — mesh on-device muerto

- El código nativo es real, no stub: `packages/capacitor-mesh/android/src/main/java/com/praeventio/mesh/MeshPlugin.kt`
  (552 LOC, "Sprint 46 REAL BLE GATT": advertiser + scanner + GATT server/client, chunking 512B) y
  `packages/capacitor-mesh/ios/Plugin.swift` (358 LOC, CoreBluetooth real, UUID derivado válido
  `00001234-12AE-3E45-7123-456789ABCDEF` — el problema "iOS mesh UUID" del plan ya está resuelto EN EL
  PLUGIN: `Plugin.swift:36-44`).
- Pero la cadena de integración está cortada en TRES puntos:
  1. `package.json` **no declara** `@praeventio/capacitor-mesh` como dependencia ni define
     `workspaces` (verificado: `workspaces: undefined`). Solo existe el script `mesh:build`
     (`package.json:43`). El import en `src/services/mesh/transportFacade.ts:21` resuelve únicamente
     por alias de Vite (`vite.config.ts:211-213`) y paths de TS (`tsconfig.json:23-24`).
  2. `android/capacitor.settings.gradle` (generado por `cap sync`, committeado) **no incluye**
     `:praeventio-capacitor-mesh` — solo 10 plugins, ninguno es el mesh. El Kotlin jamás se compila
     dentro del APK.
  3. `ios/` no contiene proyecto Xcode (ver B21-4), así que el Swift tampoco se integra.
- Resultado en dispositivo: `registerPlugin('Mesh', {web: …})` (`packages/capacitor-mesh/src/index.ts:9-13`)
  sin implementación nativa registrada → `start()` rechaza con "not implemented on android/ios" y
  `transportFacade.ts:94` emite su propio error ("Make sure @praeventio/capacitor-mesh is installed
  and registered"). El relé mesh de emergencia (ADR 0013) solo funciona en web vía simulador
  `BroadcastChannel` entre pestañas (`packages/capacitor-mesh/src/web.ts:5-9`) — útil para demo,
  inerte en terreno.
- Hacer real: (a) declarar workspace npm (`"workspaces": ["packages/*"]`) o dependencia
  `file:packages/capacitor-mesh`; (b) `npx cap sync` para regenerar `capacitor.settings.gradle` con el
  include del plugin; (c) compilar `dist/` del plugin en CI (`mesh:build` ya existe); (d) smoke test
  Android instrumentado de `start/getState`.

### B21-2 🔴 AndroidManifest de la app: faltan permisos que las features embarcadas requieren

- `android/app/src/main/AndroidManifest.xml:66-90` declara: INTERNET, FOREGROUND_SERVICE{,_LOCATION,_HEALTH},
  ACCESS_BACKGROUND_LOCATION, POST_NOTIFICATIONS, WAKE_LOCK. Faltan:
  - **`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`**: `@capacitor/geolocation` NO los aporta por
    merge (su manifest del plugin está vacío — verificado en
    `node_modules/@capacitor/geolocation/android/src/main/AndroidManifest.xml`); la doc de Capacitor
    exige declararlos en la app. Además `ACCESS_BACKGROUND_LOCATION` sin FINE/COARSE es inerte (y Play
    Console lo rechaza). Impacto: **SOS/ManDown/lone-worker sin GPS en build nativa**.
  - **`CAMERA`**: getUserMedia en el WebView (html5-qrcode para QR, MediaPipe biométrico on-device)
    requiere `android.permission.CAMERA` declarado para que `onPermissionRequest` lo conceda.
    Impacto: escáner QR y biometría de fatiga muertos en APK.
  - **`BLUETOOTH_SCAN/CONNECT` (API 31+)**: `@capacitor-community/bluetooth-le` está en
    `capacitor.settings.gradle:12-13` pero los permisos BLE solo existen en el manifest del plugin
    mesh NO incluido (`packages/capacitor-mesh/android/src/main/AndroidManifest.xml:13-27`). Verificar
    qué aporta el merge del plugin community; si nada, declararlos en la app.
- Hacer real: añadir los `uses-permission` a `android/app/src/main/AndroidManifest.xml` + test de
  contrato que parsee el manifest y pinne el set de permisos vs features (ya existe el patrón guard
  en `scripts/precommit-allowbackup-guard.cjs`).

### B21-3 🔴 `capacitor.settings.gradle` desactualizado: el plugin del Foreground Service del lone-worker no está incluido

- `android/app/src/main/AndroidManifest.xml:56-60` declara el service
  `io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService`
  (`foregroundServiceType="location|health"`), y `capacitor.config.ts` configura el canal
  `lone_worker` — pero `@capawesome-team/capacitor-android-foreground-service` (presente en
  `package.json`) **no aparece en `android/capacitor.settings.gradle`** (10 includes, ninguno
  capawesome). Tampoco `@capgo/capacitor-proximity`. La clase del service no existirá en el APK:
  el check-in persistente del trabajador solitario no arranca (y el `<service>` referencia una clase
  inexistente).
- Causa probable: `capacitor.settings.gradle` fue committeado en un `cap sync` anterior a la adición
  de esos plugins y nunca regenerado.
- Hacer real: `npx cap sync android` y committear el settings.gradle regenerado; añadir verificación
  CI que compare dependencias `@capacitor*`/`@capawesome*`/`@capgo*` de package.json contra los
  includes del settings.gradle.

### B21-4 🟡 iOS: no existe proyecto Xcode en el repo — solo fastlane

- `ios/` contiene únicamente `App/fastlane/{Fastfile,Appfile}`. No hay `App.xcodeproj`, `Podfile`,
  `Info.plist` ni entitlements. El Fastfile (Sprint 30 Bucket GG) define lanes `testflight/appstore/
  build_only` que asumen un proyecto que no está versionado.
- Inconsistencia interna: el comentario de `capacitor.config.ts:8` dice "Native folders (`android/`,
  `ios/`) are NOT generated yet" — pero `android/` SÍ existe y está committeado. Doc drift doble.
- Impacto: Universal Links, HealthKit, mesh iOS y todo IOS_BUILD.md son irreproducibles desde el repo;
  el `Plugin.swift` del mesh no tiene dónde integrarse.
- Hacer real: `npx cap add ios` + committear el proyecto (o documentar explícitamente en
  IOS_BUILD.md/ADR que el proyecto iOS vive fuera del repo y por qué); actualizar el comentario de
  capacitor.config.ts.

### B21-5 🟡 Deep links apuntan a `praeventio.app`; el backend usa `app.praeventio.net` (cross-cutting "dominio" del plan)

- App Links Android: `android/app/src/main/AndroidManifest.xml:33` → `android:host="praeventio.app"`.
  Comentarios de `capacitor.config.ts` (Sprint 21 Bucket G) también `praeventio.app`.
- Backend/WebAuthn/correos: `src/server/auth/webauthnAssertion.ts:52-54` (origin/RP ID
  `app.praeventio.net`), `src/server/routes/projects.ts:143` (`APP_URL` default
  `https://app.praeventio.net`), `:278` (`noreply@praeventio.net`).
- Si el dominio productivo es `praeventio.net`, los App Links nunca verificarán (assetlinks se
  serviría en un host que el intent-filter no escucha) y los magic links de correo abrirán el browser,
  no la app.
- AASA con placeholder: `public/.well-known/apple-app-site-association:6,22` → `"TEAMID.com.praeventio.guard"`
  literal — iOS rechaza el archivo hasta poner el Team ID real. `assetlinks.json` sí tiene un
  fingerprint SHA-256 concreto (validar que corresponde al keystore release real, no al debug).
- Hacer real: decidir host canónico, alinear intent-filter + AASA + assetlinks + webauthn RP ID +
  APP_URL, y un test de contrato de consistencia de dominio (existe precedente:
  `src/__tests__/contracts/contactEmailConsistency.test.ts`).

### B21-6 🔵 Versionado y firma Android

- `android/app/build.gradle:10-11`: `versionCode 1`, `versionName "1.0"` — sin pipeline de bump.
- Sin bloque `signingConfigs` en `build.gradle` (release queda sin firma en build local; la firma
  depende de fastlane/CI "mobile-signing"). Aceptable si está documentado; añadir nota inline.
- `allowBackup="false"` ✅ correcto (`AndroidManifest.xml:5`, Regla #17). `targetSdk 36`, `minSdk 24`,
  Capacitor 8 ✅ (`android/variables.gradle:2-4`).

---

## B22 — Corpus normativo / RAG

### Qué contiene de verdad

- `src/data/normativa/` = **7 archivos, 747 líneas en total**: `cl` (11 normas), `ar`, `br`, `co`,
  `mx`, `pe`, `iso`. Son **catálogos de metadatos** (`CountryPack`: título, referencia, scope de 2-3
  frases, URL a BCN/iso.org), no texto normativo. El contenido muestreado es REAL y verificable
  (IDs de BCN correctos, DS 44/2024 reemplazando DS 40 bien documentado en `cl.ts:6-7,47-53`;
  `br.ts` con NRs reales y avisos `VERIFY:` honestos en umbrales CIPA/SESMT).
- `src/data/bcnKnowledgeBase.ts` = **5 leyes** con resúmenes de 5-8 bullets cada una (89 líneas).
- **No existe corpus NCh** pese a que CLAUDE.md describe `src/data/normativa/` como "BCN + ISO + NCh
  corpus (RAG source)" — ver B22-3.

### B22-1 🟡 El "RAG" productivo es un buscador bag-of-words sobre ~17 chunks; Pinecone no tiene pipeline de ingesta

- `src/services/coach/normativeRag.ts` tiene dos modos. El modo Pinecone (real vector search) requiere
  `PINECONE_API_KEY`+`PINECONE_INDEX`, pero **nada en el repo puebla el índice**: `ingestChunk` no se
  expone por HTTP deliberadamente (`src/server/routes/coachRag.ts:22-23` "ingestChunk is not exposed")
  y no hay script de seed hacia Pinecone. En producción, el índice estaría vacío salvo carga manual
  externa → toda query cae al fallback in-memory (`normativeRag.ts:279-283`).
- El modo in-memory = 12 chunks derivados de CL_PACK (1 chunk por norma, texto = título+scope) + 7
  chunks curados (`CHEMICAL_DETAIL_CHUNKS:133-155`, `MEDICINE:157-172`, `LEGAL:174-189`), con
  similitud Jaccard de tokens (`normativeRag.ts:74-81`). Es determinista y honesto (documentado), pero
  el "coach con RAG normativo" cita desde ~17 párrafos. Los chunks curados sí tienen contenido técnico
  real (LPP DS 594 anexo 4, plazos Ley Karin, periodicidad PREXOR).
- Hacer real: script de ingesta (descarga BCN → chunking → `ingestChunk` a Pinecone) + job de
  actualización; o al menos ampliar el seed in-memory con los textos de `bcnKnowledgeBase.ts` (hoy ni
  siquiera se reutilizan esos 5 resúmenes en el RAG del coach).

### B22-2 🟡 ID muerto `cl-ds-40` en el mapeo de dominios del RAG — DS 44 cae al default

- `src/services/coach/normativeRag.ts:91,106` mapean `'cl-ds-40'`, pero el pack real usa `'cl-ds-44'`
  (`src/data/normativa/cl.ts:47`). El chunk del DS 44/2024 cae al default `['legal']`/`'BCN'`
  (`normativeRag.ts:121,124`) — en este caso coincide con la intención, así que el efecto es benigno
  HOY, pero el mapeo está silenciosamente roto y cualquier reclasificación futura no se aplicará.
- Igual drift en `src/data/bcnKnowledgeBase.ts:42-47`: entrada `id: "ds-40"`, `title: "Decreto
  Supremo 40"` cuyo `content` empieza "El DS 44/2024 aprueba…". Hay un test de contrato que lo vigila
  a medias (`src/__tests__/contracts/ds40Annotation.test.ts`).
- Hacer real: renombrar id/título a DS 44 en ambos archivos + actualizar el mapeo del RAG + test.

### B22-3 🟡 Normas intensamente citadas en código que NO existen en ningún corpus

- Inventario de citas en `src/` vs corpus (`cl.ts` + `bcnKnowledgeBase.ts`):
  - **DS 132 (minería)** — 124 menciones en código, 0 en corpus (target declarado del producto es
    minería).
  - **DS 76** (87 menciones; existe `src/services/compliance/ds76/ds76Service.ts`), **DS 67** (53;
    `ds67Service.ts`), **DS 43** (24), **DS 148** (12 — solo 1 chunk curado en el RAG), **DS 110**,
    **DS 78**, **DS 248**.
  - **Ley 19.628 (datos personales)** — 65 menciones; **Ley 21.719** (nueva ley de datos) — 22;
    **Ley 19.799 (firma electrónica)** — 15. Ninguna en corpus.
  - **NCh**: citadas en componentes de ingeniería (`src/components/engineering/StructuralCalculator.tsx`
    NCh 432/433, `HidranteFireNetworkPanel.tsx` NCh 1646, `src/components/hazmat/HazmatCompatibilityAlert.tsx`
    NCh 2245, `src/server/routes/workPermits.ts:351` NCh 349) — el "NCh corpus" de CLAUDE.md no existe
    como datos; las NCh viven hardcodeadas en la lógica de cada componente.
- Consecuencia: el coach RAG no puede citar las normas que el resto del producto aplica; respuestas
  del coach sobre minería (DS 132) o residuos (DS 148) se generan sin grounding.
- Hacer real: ampliar `cl.ts` (mismo formato CountryPack, fuentes BCN) con DS 132/76/67/43/148 y las
  leyes de datos; decidir si NCh entra al corpus (texto ISO/NCh es de pago — usar resúmenes de scope
  como con ISO 45001, patrón ya establecido en `iso.ts:16-17`).

### B22-4 🟡 "Legal Monitor" no monitorea: escanea 5 resúmenes estáticos de 2023-2024

- `src/server/routes/misc.ts:315-337` (`GET /legal/check-updates`): itera `bcnKnowledgeBase` (5 leyes,
  `lastUpdated` hardcodeado 2020-2024) y pide a Gemini analizar impacto. No hay fetch a BCN ni
  detección de cambios reales — el "monitor de actualizaciones legales" siempre analiza el mismo
  texto embarcado. `searchBCN` (`bcnKnowledgeBase.ts:78-89`) declara en comentario "Simple keyword
  matching for the prototype" y además es **export muerto** (0 consumidores).
- Hacer real: job que consulte la API/RSS de BCN (LeyChile expone XML por idNorma, ya presentes en
  `cl.ts` como URLs) y diffee contra hash almacenado; o etiquetar el endpoint como análisis estático
  (no "updates") y registrar en `docs/stubs-inventory.md` (Regla #13). Podar `searchBCN` o cablearlo.

### B22-5 🔵 Quién consume el corpus (mapa de ingesta, para referencia)

- `CL_PACK` y hermanos → `src/services/normativa/countryPacks.ts` →
  `locationNormativa.ts`/`useGeoCountry.ts` (selección por país) → `NormativaSwitch.tsx` (UI)
  y `src/server/routes/b2d/normativa.ts:46-105` (API B2D `search`/`by-id`/`validate`).
- `CL_PACK` → seed del RAG del coach (`normativeRag.ts:119-126`) → `src/server/routes/coachRag.ts`
  (3 endpoints con verifyAuth + assertProjectMember ✅).
- `bcnKnowledgeBase` → solo `misc.ts:317` (legal monitor). Los dos "corpus" CL no se cruzan entre sí.

---

## B24 — Calidad de tests (panorama)

### B24-1 🟡 E2E: los tres flujos críticos están en `describe.fixme` — nunca se ejecutan

- `tests/e2e/` tiene 8 specs, 23 `test(...)`. Suites completas desactivadas:
  - `tests/e2e/sos-button.spec.ts:23` — `test.describe.fixme('SOSButton long-press')` (¡el SOS, vida-seguridad!).
  - `tests/e2e/offline-resilience.spec.ts:21` — `test.describe.fixme('Offline-first sync')`.
  - `tests/e2e/process-lifecycle.spec.ts:21` — `test.describe.fixme(...)`.
  Los tres comentan "Un-fixme once verified end-to-end" (requieren emulador Java 21).
- Además ~13 `test.skip(...)` condicionales por env (`E2E_FULL_STACK_AUTH`, emulador) en
  `accessibility.spec.ts:82-130`, `fall-detection-toggle.spec.ts:12`, `landing*.spec.ts`,
  `sw-models-cache.spec.ts:32`. En CI sin esos flags, la cobertura e2e efectiva se reduce a landing +
  partes de accesibilidad.
- Hacer real: `test:e2e:full` ya levanta el emulador según CLAUDE.md — quitar los `fixme` y correr esa
  variante en CI nocturno; el SOS e2e debería ser bloqueante (B1 ya remedió sosOutbox: verificarlo punta a punta).

### B24-2 🟡 105 tests de rutas siguen siendo "wire-up contract" (solo inspección de `router.stack`); 68 dominios sin ningún test de handler

- `src/server/routes/*.test.ts`: 160 archivos; **105** son del patrón wire-up — castean el router a
  `{ stack: Layer[] }` y solo afirman que el path está registrado, sin ejecutar el handler (ejemplo
  íntegro: `src/server/routes/adoption.test.ts:6-32`). Solo 15 usan supertest;
  2 usan el literal `router.stack` (`hazmatInventory.test.ts`, `operationalChange.test.ts`).
- Cruce con la suite real (`src/__tests__/server/`, 172 archivos, 160 con supertest): **68 de los 105**
  dominios wire-up NO tienen contraparte supertest con el mismo nombre — p.ej. `adoption`, `agenda`,
  `aggregateTelemetry`, `aiToggle`, `auditChain`, `bbs`, `circadian`, `coachRag`, `commsDrill`,
  `contractors`, `controlComparator`… (puede haber cobertura bajo otro nombre; verificar dominio a
  dominio durante la remediación). Esto coincide con el catálogo de anti-patrones de DEEP-EXT-INDEX.md.
- Hacer real: por cada dominio sin supertest, suite mínima 401/200/400-403-404 (patrón canónico de
  CLAUDE.md "Testing notes"), empezando por los que escriben estado (auditChain, contractors,
  commsDrill).

### B24-3 🟡 Mutation testing no cubre 5 de los motores "mutation-tested" según CLAUDE.md

- `stryker.config.json` (`mutate`, 14 archivos) cubre: verifyAuth, limiters, slm×3,
  sentryInstrumentation, webpayAdapter, ergonomicAssessments, iperAssessments, tmert, iper, prexor,
  reba, rula. **Fuera de la lista** pese a vivir en los directorios declarados como mutation-tested
  (Regla #9): `src/services/ergonomics/landmarksToScore.ts`, `src/services/ergonomics/poseEdgeFilter.ts`,
  `src/services/protocols/iperCriticidad.ts`, `src/services/protocols/iso31000Band.ts`,
  `src/services/safety/ergonomicLegalTrigger.ts` (este último dispara obligaciones LEGALES — debería
  estar mutado sí o sí).
- Config por lo demás honesta y bien documentada (ignoreStatic justificado, exclusión ArrayDeclaration
  para tablas REBA/RULA canónicas, enforcement post-hoc vía `scripts/check-mutation-thresholds.cjs`).
- Hacer real: añadir los 5 archivos a `mutate` + baseline en `docs/testing/MUTATION_BASELINE.md`.

### B24-4 🔵 Skips/todo en suites vitest: casi limpio

- Solo 4 ocurrencias: `src/components/ar/ARPosterScanner.test.tsx:153` (`it.todo`, flaky documentado),
  `src/__tests__/contracts/ds40Annotation.test.ts:79` y `contactEmailConsistency.test.ts:56`
  (`it.skip` condicional si el archivo no existe localmente — patrón aceptable),
  `src/rules-tests/tenantScoped.test.ts:64` (`ctx.skip` si no hay emulador — riesgo conocido F1:
  en CI sin emulador la suite "pasa" sin probar nada; el harness rules-tests real es cimiento F1 del plan).

---

## Tabla resumen

| # | Sev | Área | Hallazgo | Ubicación clave |
|---|-----|------|----------|-----------------|
| B20-1 | 🔴 | i18n | ~3.150 claves t() sin entrada en common.json (2.745 defaults inline en español) → en/pt-BR ven español; gate de paridad ciego | `src/i18n/locales/es/common.json`, `scripts/validate-i18n.cjs` |
| B20-2 | 🟡 | i18n | Baseline pt-BR (59 claves) cubre incident_report + lone_worker (vida-seguridad) | `scripts/i18n-parity-baseline.json:6-64` |
| B20-3 | 🟡 | i18n | 47 claves diagnósticas muertas pre-ADR-0012 embarcadas; claves nuevas de componentes reconvertidos tampoco en JSON | `es/common.json` (`differential_dx`, `drug_interactions`), `src/components/medicine/DifferentialDiagnosis.tsx:33` |
| B20-4 | 🟡 | i18n | 185/224 páginas con literales españoles fuera de i18n, incl. mensajes operativos de seguridad | `src/pages/PTSGenerator.tsx:63-65,102-106` |
| B20-5 | 🔵 | i18n | Tono tuteo consistente ✅; comentario fallback pt-BR desactualizado | `src/i18n/index.ts:20` vs `:121` |
| B21-1 | 🔴 | Mobile | Plugin mesh nativo real (Kotlin/Swift Sprint 46) NO instalado: sin dependencia npm/workspace, sin include gradle, sin proyecto iOS → mesh on-device muerto | `package.json`, `android/capacitor.settings.gradle`, `src/services/mesh/transportFacade.ts:21,94` |
| B21-2 | 🔴 | Mobile | Manifest sin ACCESS_FINE/COARSE_LOCATION, CAMERA ni BLE → GPS de SOS, QR y biometría muertos en APK | `android/app/src/main/AndroidManifest.xml:66-90` |
| B21-3 | 🔴 | Mobile | capacitor.settings.gradle stale: falta plugin FGS capawesome (lone-worker) y capgo-proximity; el `<service>` referencia clase inexistente | `android/capacitor.settings.gradle`, `AndroidManifest.xml:56-60` |
| B21-4 | 🟡 | Mobile | Sin proyecto Xcode en `ios/` (solo fastlane); comentarios capacitor.config contradicen el repo | `ios/App/fastlane/Fastfile`, `capacitor.config.ts:8` |
| B21-5 | 🟡 | Mobile | Deep links `praeventio.app` vs backend `app.praeventio.net`; AASA con TEAMID placeholder | `AndroidManifest.xml:33`, `webauthnAssertion.ts:52-54`, `apple-app-site-association:6` |
| B21-6 | 🔵 | Mobile | versionCode 1 sin pipeline de bump; sin signingConfigs inline (depende de fastlane/CI); allowBackup=false ✅ | `android/app/build.gradle:10-11` |
| B22-1 | 🟡 | RAG | RAG productivo = bag-of-words sobre ~17 chunks; Pinecone sin pipeline de ingesta (índice vacío → siempre fallback) | `src/services/coach/normativeRag.ts:74-81,133-189`, `coachRag.ts:22` |
| B22-2 | 🟡 | RAG | ID muerto `cl-ds-40` en mapeo de dominios; drift DS 40/DS 44 en bcnKnowledgeBase | `normativeRag.ts:91,106`, `bcnKnowledgeBase.ts:42-47` |
| B22-3 | 🟡 | Corpus | DS 132 (124 citas), DS 76/67/43/148, Ley 19.628/21.719 y todas las NCh citadas en código pero ausentes del corpus; "NCh corpus" de CLAUDE.md no existe | `src/data/normativa/cl.ts` (11 normas) vs inventario de citas |
| B22-4 | 🟡 | Corpus | "Legal Monitor" analiza 5 resúmenes estáticos, no consulta BCN; `searchBCN` es export muerto autodeclarado "prototype" | `src/server/routes/misc.ts:315-337`, `bcnKnowledgeBase.ts:78-89` |
| B24-1 | 🟡 | Tests | E2E de SOS, offline-sync y lifecycle en `describe.fixme` — nunca corren | `tests/e2e/sos-button.spec.ts:23`, `offline-resilience.spec.ts:21`, `process-lifecycle.spec.ts:21` |
| B24-2 | 🟡 | Tests | 105/160 tests de rutas son wire-up-only (inspección de stack); 68 dominios sin supertest homónimo | `src/server/routes/adoption.test.ts:6-32` (patrón) |
| B24-3 | 🟡 | Tests | Stryker no muta 5 motores de cálculo, incl. `ergonomicLegalTrigger.ts` (dispara obligaciones legales) | `stryker.config.json` (`mutate`) |
| B24-4 | 🔵 | Tests | Solo 4 skip/todo en vitest; rules-tests se auto-skipean sin emulador (cimiento F1 pendiente) | `src/rules-tests/tenantScoped.test.ts:64` |

### Priorización sugerida (vida/privacidad primero, conforme al plan Phase 5)

1. **B21-2 + B21-3** (permisos + FGS): sin esto, SOS/lone-worker no funcionan en la app nativa.
2. **B21-1** (mesh): el código nativo ya existe — es puro cableado de build.
3. **B24-1** (e2e SOS): reactivar antes de tocar más el camino de emergencia.
4. **B20-1/B20-2** (i18n vida-seguridad en en/pt-BR).
5. **B21-5** (dominio canónico — bloquea WebAuthn y App Links, cross-cutting ya identificado en el plan).
6. B22-* y B24-2/3 en los bloques correspondientes (B14-IA para RAG, gobernanza F5 para tests).
