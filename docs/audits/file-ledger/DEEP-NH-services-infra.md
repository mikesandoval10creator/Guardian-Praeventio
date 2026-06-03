# DEEP — needs-human: servicios twin/AR/privacidad/IoT/infra · 2026-06-02

**Archivos revisados:** 95 (todos `category==="FEAT-services"` && `block===""` bajo
los subdirs: digitalTwin, ar, cad, photogrammetry, privacy/privacyShield, security,
external, iot, sync, exposure, audit, documents, email, dea, b2d, eventReplay,
eventBus, eventStore, domainEvents, evidenceChain).

Estados: ✅ real/funcional · 🟡 funcional con deuda/parcial · 🏚️ stub/orphan ·
🔵 cross-cutting infra · 🔑 seguridad/cripto · 🔴 riesgo.

---

## 1. Lo que YA HACE (por subsistema, con bloque sugerido)

### digitalTwin + onDeviceReconstruction + photogrammetry → **B-DigitalTwin (nuevo)** ✅🟡
Pipeline VIDEO→MESH **100% on-device, real** (no stub). El video NUNCA sube; solo
el GLB/USDZ resultante va a Storage.
- `onDeviceReconstruction/index.ts:123` `reconstructFromVideo()` orquesta:
  frameExtractor (HTMLVideoElement+canvas) → pointCloudBuilder → glbExporter
  (three.js `GLTFExporter`, POINTS) → usdzExporter (three.js `USDZExporter`, quads).
- `pointCloudBuilder.ts:112` — **heurística monocular brightness+edge** (NO SfM real;
  el propio header lo admite, `:6-10`); `:263` versión async usa **MiDaS ONNX real**
  vía `onnxruntime-web` si el modelo está bundled, con fallback automático a la
  heurística (`midasDepthEstimator.ts:72` `tryCreateMidasEstimator` hace HEAD 404→null).
- `onDeviceAdapter.ts:71` `OnDeviceReconstructionAdapter` — WIRED en
  `src/pages/DigitalTwinFaena.tsx:476`. Sube GLB+USDZ, persiste a Firestore vía
  `reconstructionJobStore.ts` (CRUD real, `subscribeReconstructionJobs`).
- `gaussianSplatRegistry.ts` — registry determinístico de capturas splat; visor real
  en `components/digital-twin/GaussianSplatViewer.tsx`.
- `siteGeometry/placedObjectsStore/objectPlacement/normativaRules` — consumidos por
  componentes digital-twin + `useArPlacement.ts` + ruta b2d/hazmat. Reales.

### ar → **B-DigitalTwin / AR** ✅🟡
- `webXrCapabilities.ts:63` feature-detection WebXR `immersive-ar` real; `posterMatcher.ts:24`
  usa **MediaPipe ImageEmbedder** (MobileNetV3, local WASM/CDN) → cosine sim contra catálogo.
  Consumido por `components/ar/ARPosterScanner.tsx`.
- `usdzConverter.ts:46` cliente real de Cloud Run `usdz-converter` (OpenUSD); infra existe
  en `infra/usdz-converter/`. Usado por `scripts/generate-ar-usdz.mjs` + server.
- `arAnchorService.ts` + `arAnchorFirestoreAdapter.ts` — anclas AR por proyecto, reales.

### external (clima/sismo) → **B18-Analitica / cross-cutting** ✅
**Todas APIs reales, no stub determinístico.** Cada adapter: zod schema, cache TTL,
retry 2× backoff, Sentry capture.
- `usgs/usgsEarthquakeAdapter.ts:35` → `earthquake.usgs.gov/fdsnws` (real).
- `nasaPower/nasaPowerAdapter.ts:52` → `power.larc.nasa.gov` (real).
- `eonet/eonetAdapter.ts:40` → `eonet.gsfc.nasa.gov` (real).
- `b2d/externalClimate.ts:1` → Open-Meteo + USGS + OpenAQ reales; cache 1h; NUNCA pasa
  tenantId upstream (`:19`).

### privacy / privacyShield → **B-Cumplimiento/Privacidad** ✅
- `privacy/registry.ts` — 11 regímenes reales con datos (GDPR/CCPA/CPRA/LGPD/Ley19628/
  PIPEDA/APPI/PDPA/PIPL/152-FZ/PIPA-TW) + merge AND-de-obligaciones (`getMostStrictRegime`,
  `strictestDeadlineDays`). Cada `regimes/*.ts` cita artículos reales (gdpr.ts:21 art.15-22).
- `dpiaTemplate.ts` — generador PDF DPIA real (jsPDF), tier-gated.
- `privacyShield/piiClassifier.ts` — clasificador PII determinístico + retención.

### security → **🔑 cross-cutting cripto** ✅
- `kmsAdapter.ts:127` `CloudKmsAdapter` **real** (`@google-cloud/kms`), gated por
  `KMS_KEY_RESOURCE_NAME`; **no auto-fallback a dev KEK** (`:197` decisión de seguridad
  documentada). in-memory-dev + noop para dev/break-glass.
- `kmsEnvelope.ts` envelope AES-256-GCM (DEK per-op + KMS-wrapped). browser-side espejo:
  `browserEnvelope.ts` + `deviceKek.ts` (CryptoKey no-exportable en IDB) + `encryptedKvStore.ts`.

### sync → **B16-Offline** ✅
- `syncStateMachine.ts` cola unificada IDB + backoff; `genericOutboxEngine.ts` outbox
  reutilizable; `conflictResolver.ts` per-field LWW + prompt humano en campos críticos;
  `monotonicSync.ts` rev monotónica anti-clock-skew; `topologyAwarePrefetch.ts` prefetch
  scoring; `encryptedOutboxAdapter.ts` cifra via encryptedKvStore.

### audit / evidenceChain / eventReplay / domainEvents / eventStore / eventBus → **B17/cross-cutting** ✅
- `audit/tamperProofChain.ts` — hash-chain SHA-256 append-only (post-fatal, Ley Karin,
  ISO45001); pure core, persistencia inyectable.
- `evidenceChain/custodyChainService.ts` — cadena de custodia content-addressed (sha256,
  `@noble/hashes`), no blockchain (decisión `:5`).
- `eventReplay/eventReplayAuditTool.ts` sobre `domainEventStore.ts` (event sourcing +
  snapshots + replay punto-en-tiempo). `eventBus.ts` pub/sub in-process.

### documents / email / dea / cad / exposure / iot(rules) → ✅
- `documents/legalDocTemplates.ts` (RIOHS/DDR/ODI/PTS/CPHS, determinístico, cita norma).
- `email/resendService.ts` (Resend SDK real, no-op si falta key) + `templates.ts` (HTML inline).
- `dea/deaService.ts` (Ley 21.156, reemplazó MOCK_DEAS de DEAZones.tsx `:9`).
- `cad/dwgAdapter.ts` cliente Cloud Run LibreDWG (infra `infra/dwg-converter/` existe);
  `dxfAdapter.ts` MIT-only; `dwgDocumentValidator.ts` pre-upload pure. Wired en
  `src/server/routes/cad.ts`.
- `exposure/thermalStressCalculator.ts` (WBGT/OSHA/NIOSH), `exposureRegistry.ts` (DS594).
- `iot/edgeFilter.ts`, `ingestRuleEngine.ts`, `probabilityFailureScoring.ts`,
  `firestoreBridge.ts` — motores puros reales; bridge wired a server.ts:1465.
- `b2d/apiKeyService.ts` (SHA-256 hash, plaintext nunca persiste) + `usage.ts`.

---

## 2. Lo que está PENDIENTE (huérfanos / stubs / deuda)

1. 🏚️ **`iot/mqttAdapter.ts` cloud/EMQX = NotImplementedError reales.**
   `createCloudIotCoreAdapter` (`:185`) y `createEmqxAdapter` (`:216`) lanzan
   "not yet implemented … until Sprint 33 H1". Solo `InMemoryAdapter` funciona.
   server.ts:1444 gatea por `IOT_BROKER_ENABLED` (default off) → invisible al usuario.
   **Pero** el comentario del módulo (`:16-18`) afirma "`mqtt` is NOT a dependency" —
   **FALSO**: `package.json:151` declara `"mqtt": "^5.15.1"`. Doc-vs-code drift.

2. 🏚️ **`iot/mqttClient.ts` (368 LOC, MQTT.js-over-WS real) está HUÉRFANO.**
   Ningún consumidor fuera de su test. Es un cliente WS completo y real pero NADIE
   lo importa — el path productivo es `mqttAdapter.ts` (que aún no implementa cloud/emqx).
   Dos implementaciones MQTT paralelas, ninguna conectada a un broker real en prod.

3. 🏚️ **`photogrammetry/mockAdapter.ts` (173 LOC) huérfano en producción.**
   Header dice "NO usar en producción / fallback cuando cloud caído", pero el cloud fue
   descartado (§2.28) y DigitalTwinFaena usa OnDeviceAdapter directo. Solo lo consume su
   propio test. Anti-stub-disfrazado OK (no visible a usuarios), pero ya no cumple rol.

4. 🏚️ **`photogrammetry/types.ts` engines server-side = tombstones.** `:46-53`
   `meshroom/colmap/reality-capture/hyper3d` quedan como type-literals "DESCARTADO".
   El `PhotogrammetryAdapter` interface canónica describe flujo cloud (`:9` "Cliente sube
   a Cloud Storage") que ya no existe — doc del header contradice la directiva on-device.

5. 🏚️ **Infra workers de fotogrametría server-side existen pero están MUERTOS.**
   `infra/photogrammetry-worker/` (Dockerfile, COLMAP/poisson-mesh.py, server.py) e
   `infra/modal-photogrammetry/app.py` siguen en el repo, pero server.ts:65-69 + :643-646
   removió `/api/photogrammetry`. Código infra sin caller. **Decidir: borrar o reactivar.**

6. 🟡 **`health.ts:249` `checkPhotogrammetryWorker` health-check apunta a worker removido.**
   Se reporta `skipped=true` si no hay URL, pero el check sobrevive a una feature borrada.

7. 🏚️ **`ar/posterEmbeddings.generated.ts` vacío por diseño** (`POSTER_EMBEDDINGS = {}`).
   El AR Poster Scan (posterMatcher + ARPosterScanner) **no matchea nada** hasta que
   alguien corra `scripts/seed-poster-embeddings.ts` con assets en `public/posters/`.
   Feature efectivamente inerte en runtime. No registrado en `docs/stubs-inventory.md`(verificar).

8. 🏚️ **AR submódulos sin consumidor productivo (solo tests):**
   `arPlatformPolicy.ts`, `arQuickLookFallback.ts`, `arHitTest.ts`, `webXrCapabilities.ts`.
   Lógica pura testeada pero ningún `.tsx`/hook los importa hoy → preparados para una
   UI WebXR que aún no aterrizó, o huérfanos tras refactor. Confirmar con dueño.

9. ⚠️ **`Math.random()` para IDs en código cliente (rule 15 aplica solo a src/server,
   pero es smell):** `onDeviceAdapter.ts:250` (jobId), `arAnchorService.ts:195`,
   `mqttClient.ts:110` (clientId), `mockAdapter.ts:67`. Preferir `randomId()` de
   `utils/randomId.ts`. No bloqueante (no es src/server) pero inconsistente con el estándar.

10. 🟡 **`onDeviceAdapter.ts:177-198`** persiste `usdzUri`/`usdzSizeBytes` como campos
    fuera del shape canónico vía cast (`as unknown as`), leídos por UI con cast. Tech-debt
    de tipos; comentado honestamente pero frágil.

11. 🟡 **`onDeviceReconstruction` sin test** en frameExtractor/glbExporter/usdzExporter/index
    (los 3 con `test=-` en ledger). pointCloudBuilder y midasDepthEstimator SÍ testeados.

---

## 3. Tabla por archivo

| Archivo | LOC | Estado | Bloque sugerido | Propósito + hallazgo file:line |
|---|---|---|---|---|
| digitalTwin/onDeviceReconstruction/index.ts | 258 | ✅ | B-DigitalTwin | Orquesta video→GLB+USDZ on-device `:123`. Sin test. |
| .../pointCloudBuilder.ts | 395 | ✅ | B-DigitalTwin | Heurística monocular `:112` + path MiDaS async `:263`. NO es SfM (`:6`). |
| .../midasDepthEstimator.ts | 273 | ✅ | B-DigitalTwin | MiDaS ONNX real `:72`; fallback HEAD-404 a heurística. Modelo no commiteado `:7`. |
| .../frameExtractor.ts | 242 | ✅ | B-DigitalTwin | HTMLVideoElement+canvas, no upload. Sin test. |
| .../glbExporter.ts | 101 | ✅ | B-DigitalTwin | three.js GLTFExporter POINTS `:41`. Sin test. |
| .../usdzExporter.ts | 240 | ✅ | B-DigitalTwin | three.js USDZExporter quads para iOS Quick Look. |
| photogrammetry/onDeviceAdapter.ts | 271 | ✅🟡 | B-DigitalTwin | Adapter WIRED en DigitalTwinFaena:476; usdz cast `:190`; Math.random `:250`. |
| photogrammetry/mockAdapter.ts | 173 | 🏚️ | B-DigitalTwin | Sin consumidor prod (cloud descartado). Solo test. |
| photogrammetry/reconstructionJobStore.ts | 204 | ✅ | B-DigitalTwin | CRUD Firestore + onSnapshot real. |
| photogrammetry/types.ts | 200 | 🟡 | B-DigitalTwin | Tombstones engines cloud `:46`; header describe flujo cloud muerto. |
| digitalTwin/gaussianSplatRegistry.ts | 306 | ✅ | B-DigitalTwin | Registry splat; visor GaussianSplatViewer.tsx. |
| digitalTwin/gaussianSplatFirestoreAdapter.ts | 84 | ✅ | B-DigitalTwin | Adapter Firestore splat. |
| digitalTwin/objectPlacement/normativaRules.ts | 260 | ✅ | B-DigitalTwin | Reglas DS594/NCh; usado por NormativaWarningsBanner + b2d/hazmat. |
| digitalTwin/placedObjectsStore.ts | 137 | ✅ | B-DigitalTwin | Store; usado por useArPlacement + verifyTwinStepUp. |
| digitalTwin/siteGeometry.ts | 227 | ✅ | B-DigitalTwin | Geometría; HazmatWindOverlay/RiskNodeMarkers/Site25DPanel. |
| digitalTwin/siteGeometryStore.ts | 103 | ✅ | B-DigitalTwin | Persistencia geometría. |
| ar/webXrCapabilities.ts | 259 | 🏚️ | AR | Feature-detect WebXR real; sin consumidor .tsx (solo test). |
| ar/arPlatformPolicy.ts | 138 | 🏚️ | AR | Política plataforma; sin consumidor prod. |
| ar/arQuickLookFallback.ts | 159 | 🏚️ | AR | Fallback iOS; sin consumidor prod. |
| ar/arHitTest.ts | 220 | 🏚️ | AR | Hit-test pure; sin consumidor prod. |
| ar/arAnchorService.ts | 254 | ✅ | AR | Anclas AR por proyecto (3 historias `:8`). |
| ar/arAnchorFirestoreAdapter.ts | 205 | ✅ | AR | Wire Firestore anclas. |
| ar/posterCatalog.ts | 453 | ✅ | AR | Catálogo afiches + cosineSimilarity. |
| ar/posterMatcher.ts | 299 | ✅ | AR | MediaPipe ImageEmbedder real; ARPosterScanner.tsx. |
| ar/posterEmbeddings.generated.ts | 26 | 🏚️ | AR | **Vacío** `{}` — poster scan inerte hasta seed `:21`. |
| ar/usdzConverter.ts | 142 | ✅ | AR | Cliente Cloud Run OpenUSD; infra existe; scripts/generate-ar-usdz.mjs. |
| external/usgs/usgsEarthquakeAdapter.ts | 128 | ✅ | B18 | USGS real `:35`. |
| external/usgs/types.ts | 40 | ✅ | B18 | Zod schema sismo. |
| external/nasaPower/nasaPowerAdapter.ts | 325 | ✅ | B18 | NASA POWER real `:52`. |
| external/nasaPower/types.ts | 138 | ✅ | B18 | Zod schema clima. |
| external/eonet/eonetAdapter.ts | 157 | ✅ | B18 | EONET real `:40`. |
| external/eonet/types.ts | 79 | ✅ | B18 | Zod schema eventos. |
| external/recommendationBuilder.ts | 221 | ✅ | B18 | Presenta evento "tranquilo" al operario. |
| external/index.ts | 70 | ✅ | B18 | Barrel. |
| b2d/externalClimate.ts | 384 | ✅ | B-B2D | Open-Meteo+USGS+OpenAQ reales; sin tenantId upstream `:19`. Sin test. |
| b2d/apiKeyService.ts | 233 | ✅🔑 | B-B2D | SHA-256, plaintext nunca persiste. |
| b2d/usage.ts | 35 | ✅ | B-B2D | Wrapper quotaTracker. |
| iot/mqttClient.ts | 368 | 🏚️ | B-IoT | MQTT.js-WS real pero HUÉRFANO (sin consumidor prod). |
| iot/mqttAdapter.ts | 350 | 🏚️ | B-IoT | cloud/emqx = NotImplemented `:185,:216`; comentario miente sobre dep mqtt. |
| iot/firestoreBridge.ts | 221 | ✅ | B-IoT | Bridge→Firestore tenant-scoped; wired server.ts:1465. |
| iot/edgeFilter.ts | 622 | ✅ | B-IoT | Filtrado 2-fase mesh; nunca bloquea maquinaria `:15`. |
| iot/ingestRuleEngine.ts | 167 | ✅ | B-IoT | Reglas persist/alert pure. Sin test. |
| iot/probabilityFailureScoring.ts | 172 | ✅ | B-IoT | Score falla heurístico (sin ML aún `:10`). |
| iot/types.ts | 103 | ✅ | B-IoT | Tipos telemetría. |
| privacy/registry.ts | 260 | ✅ | Privacidad | 11 regímenes + merge AND. POPIA/DPDP-IN stubs `:54`. |
| privacy/dpiaTemplate.ts | 284 | ✅ | Privacidad | DPIA PDF real (jsPDF). |
| privacy/regimes/*.ts (11) | 39-53 | ✅ | Privacidad | Specs con citas reales (gdpr.ts:21). |
| privacy/types.ts | 100 | ✅ | Privacidad | Tipos régimen. |
| privacyShield/piiClassifier.ts | 189 | ✅ | Privacidad | Clasificador PII + retención. |
| security/kmsAdapter.ts | 219 | ✅🔑 | Cripto | CloudKMS real `:127`; no auto-fallback `:197`. Sin test (ledger=-). |
| security/kmsEnvelope.ts | 172 | ✅🔑 | Cripto | Envelope AES-256-GCM + KMS wrap. |
| security/browserEnvelope.ts | 354 | ✅🔑 | Cripto | Envelope browser SubtleCrypto. |
| security/deviceKek.ts | 194 | ✅🔑 | Cripto | CryptoKey no-exportable IDB. |
| security/encryptedKvStore.ts | 201 | ✅🔑 | Cripto | KV cifrado drop-in idb-keyval. |
| sync/syncStateMachine.ts | 398 | ✅ | B16 | Cola unificada IDB + backoff. |
| sync/genericOutboxEngine.ts | 402 | ✅ | B16 | Outbox reutilizable. |
| sync/conflictResolver.ts | 393 | ✅ | B16 | Per-field LWW + prompt humano campos críticos. |
| sync/encryptedOutboxAdapter.ts | 152 | ✅🔑 | B16 | Outbox cifrado. |
| sync/monotonicSync.ts | 154 | ✅ | B16 | Rev monotónica anti-skew. |
| sync/topologyAwarePrefetch.ts | 375 | ✅ | B16 | Prefetch scoring. |
| sync/outboxBackoff.ts | 40 | ✅ | B16 | Backoff exp determinístico. |
| audit/tamperProofChain.ts | 404 | ✅ | B17 | Hash-chain SHA-256 append-only. |
| audit/expressBundleBuilder.ts | 257 | ✅ | B17/B5 | Bundle fiscalización 30s. |
| evidenceChain/custodyChainService.ts | 249 | ✅ | B4 | Cadena custodia sha256 (no blockchain `:5`). |
| evidenceChain/custodyChainFirestoreAdapter.ts | 76 | ✅ | B4 | Wire Firestore. |
| eventReplay/eventReplayAuditTool.ts | 391 | ✅ | B17 | Replay punto-en-tiempo + compliance export. |
| domainEvents/domainEventStore.ts | 208 | ✅ | B17 | Event sourcing + snapshots. |
| eventStore/inMemoryEventStore.ts | 231 | ✅ | B17 | Store in-memory real. |
| eventStore/types.ts | 172 | ✅ | B17 | Tipos event store. |
| eventBus/eventBus.ts | 360 | ✅ | cross-cutting | Pub/sub in-process. |
| eventBus/integrations.ts | 189 | ✅ | cross-cutting | Frontera reactiva services puros. |
| documents/documentVersioning.ts | 281 | ✅ | B5 | Versionado semver + diff + cadena firmas. |
| documents/documentVersioningFirestoreAdapter.ts | 168 | ✅ | B5 | Wire Firestore. |
| documents/legalDocTemplates.ts | 291 | ✅ | B5 | RIOHS/DDR/ODI/PTS/CPHS determinístico. |
| email/resendService.ts | 167 | ✅ | cross-cutting | Resend SDK; no-op sin key. |
| email/templates.ts | 559 | ✅ | cross-cutting | Plantillas HTML inline. Sin test. |
| email/index.ts | 25 | ✅ | cross-cutting | Barrel. |
| dea/deaService.ts | 142 | ✅ | B1/Emergencia | Ley 21.156; reemplazó mock `:9`. |
| dea/deaFirestoreAdapter.ts | 121 | ✅ | B1/Emergencia | Wire Firestore DEA. |
| cad/dwgAdapter.ts | 169 | ✅ | B-DigitalTwin | Cliente Cloud Run LibreDWG; infra existe. Sin test. |
| cad/dxfAdapter.ts | 189 | ✅ | B-DigitalTwin | DXF→drawable MIT-only. |
| cad/dwgDocumentValidator.ts | 398 | ✅ | B-DigitalTwin | Validación pre-upload pure. |
| exposure/thermalStressCalculator.ts | 281 | ✅ | B7/Salud | WBGT/OSHA/NIOSH. |
| exposure/exposureRegistry.ts | 106 | ✅ | B7/Salud | DS594 art.60. |
| exposure/exposureFirestoreAdapter.ts | 50 | ✅ | B7/Salud | Wire Firestore. |

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **IoT MQTT no llega a broker real en prod.** `mqttAdapter.ts` cloud/EMQX son
  NotImplementedError (`:185,:216`); el cliente WS real `mqttClient.ts` (368 LOC) está
  huérfano. **Decidir:** (a) cablear `mqttClient.ts` dentro de `createEmqxAdapter`, o
  (b) borrar `mqttClient.ts` si EMQX/CloudIoT no es el camino. Ahora hay 2 MQTT paralelos.
  Además corregir el comentario falso `mqttAdapter.ts:16` ("mqtt is NOT a dependency").

- ❓ **Infra fotogrametría server-side (`infra/photogrammetry-worker/`,
  `infra/modal-photogrammetry/`, COLMAP/Poisson) está MUERTA** tras la directiva on-device
  (§2.28). **Borrar** el infra + el health-check `health.ts:249`, o documentar que es
  futuro opt-in. Hoy es código sin caller que confunde el threat-surface.

- ❓ **AR Poster Scan inerte:** `posterEmbeddings.generated.ts` está vacío por diseño.
  ¿Correr `seed-poster-embeddings.ts` con assets reales, o ocultar la feature tras flag
  hasta que haya catálogo firmado? Hoy ARPosterScanner no matchea nada.

- ❓ **4 módulos AR sin consumidor prod** (webXrCapabilities, arPlatformPolicy,
  arQuickLookFallback, arHitTest). ¿Es una UI WebXR pendiente de aterrizar o residuo de
  refactor? Si lo segundo, candidatos a borrar (están testeados → cuidado).

- ⚠️ **Bloque nuevo sugerido: "B-DigitalTwin"** (twin + AR + photogrammetry + CAD +
  gaussian splat). Hoy ~25 archivos sin bloque que forman un subsistema coherente y real
  (excepto el cloud-photogrammetry muerto). Merece su propio bloque en el ledger.

- 🟡 **Cobertura de tests:** `onDeviceReconstruction/{index,frameExtractor,glbExporter,
  usdzExporter}`, `iot/{mqttAdapter,ingestRuleEngine,types}`, `b2d/externalClimate`,
  `security/kmsAdapter` y los 11 `privacy/regimes/*` figuran SIN test. Cripto (kmsAdapter)
  y clima B2D son los más sensibles a cubrir.
