# DEEP-EX-38 — Pasada exhaustiva línea-por-línea (Lote #38)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "B-DigitalTwin"`,
ordenado por `path`, slice `[55:61]` (6 archivos).
**Universo:** 61 archivos `FEAT`/`B-DigitalTwin`; este lote cubre `[55:61]`:
los stores Firestore-bound + tipos del subsistema gemelo digital / fotogrametría /
geometría de sitio:
`photogrammetry/onDeviceAdapter.ts`, `photogrammetry/reconstructionJobStore.ts`,
`photogrammetry/types.ts`, `placedObjectsStore.ts`, `siteGeometry.ts`,
`siteGeometryStore.ts`.
**Foco:** egress de imágenes/cámara (#12), colecciones sin regla, tenantId del
cliente sin token (#6), `Math.random` IDs (#15), auth/audit faltante (#3/#14),
5xx-leak (#8), gemini-whitelist (#5), stubs (#13), promesas sin await, doc-drift.
**No repite:** `DEEP-NH-services-infra.md` (tabla LOC del subsistema completo +
huérfanos cloud-photogrammetry + `Math.random` jobId `onDeviceAdapter.ts:250` +
usdz-cast `:190`) ni `DEEP-EX-37.md` (no existe en el repo a la fecha; baseline
efectivo = NH-services-infra). Este lote profundiza en lo que NH **no** verificó:
la **cobertura real de `firestore.rules` / `storage.rules`** para los paths que
estos stores escriben.

## Atestación 6/6

Los 6 archivos del slice fueron leídos completos línea-por-línea. Cruces
verificados contra: `firestore.rules` (bloque `match /projects/{projectId}`
:251-345 incl. Master-Gate `{subCollection=**}` read-only :258-260 y el
`digital_twin_jobs` :310-314; bloque `match /tenants/{tenantId}` :944+ con su
`match /{subcoll}/{docId}` de un solo nivel; default-deny raíz :17-19),
`storage.rules` (matchers explícitos :87-157 + catch-all `if false` :159-161),
`src/services/firebase.ts` (confirma **client Web SDK** — `firebase/firestore`
:3, `firebase/storage` :4, `getStorage` :218 — sujeto a rules, **no** Admin SDK),
`src/pages/DigitalTwinFaena.tsx` (consumidor real: `createOnDeviceReconstructionAdapter`
:476, `submitJob` :477, `savePlacedObject` :279 — todo client-side, sin endpoint
server), `src/components/digital-twin/Site25DPanel.tsx` (`savePolygon` :234 con
`tenantId = auth.currentUser?.tenantId ?? 'default'` :191), `verifyTwinStepUp.ts`
(solo menciona los stores en un comentario; no los importa), y búsqueda global de
writers de `digital_twin_jobs` / `reconstruction_jobs` / `placed_objects` /
`site_geometry` + rules-tests.

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🔴 | `photogrammetry/onDeviceAdapter.ts:140-150, 158-169` (+ `storage.rules:159-161`) | **El upload del GLB/USDZ on-device está BLOQUEADO por `storage.rules` → la feature no puede completar para un cliente real.** El adapter sube a `reconstructions/${projectId}/${jobId}.glb` (`:140`) y `.usdz` (`:158`) vía `uploadBytes` del **Storage Web SDK** (`firebase/storage`, confirmado `firebase.ts:4,218` — sujeto a reglas, no Admin SDK). En `storage.rules` los únicos matchers explícitos son `quarantine/`, `tenants/{tid}/{medical,legal,evidence,general}/`, `workers/{uid}/`, `companies/{companyId}/` (`:87-157`); el path `reconstructions/...` **no matchea ninguno** y cae al catch-all `match /{allPaths=**} { allow read, write: if false }` (`:159-161`). Por tanto `uploadBytes` → `storage/unauthorized`, el `executeJob` salta al catch (`:207`), marca el job `failed` (`:212`) y la reconstrucción nunca produce mesh. NH-services-infra afirmó "Sube GLB+USDZ... persiste a Firestore... **Reales**" sin verificar las reglas — el pipeline de cómputo es real pero su persistencia está cerrada por defecto. **Falla silenciosa end-user** (el job aparece `failed` con mensaje genérico). Además, el path `reconstructions/{projectId}/...` **no lleva tenantId**, así que aun abriendo la regla no habría aislamiento por tenant en el bucket. |
| 2 | 🔴 | `photogrammetry/reconstructionJobStore.ts:40, 55-68` (+ `firestore.rules:258-260, 310-314`) | **Colección `reconstruction_jobs` sin regla de escritura — writes cliente denegados; y la regla server-only existente apunta a una colección FANTASMA.** El store escribe a `projects/${projectId}/reconstruction_jobs/{jobId}` con `setDoc`/`updateDoc` del **Web SDK cliente** (`firebase.ts:3`). Bajo `match /projects/{projectId}` el único matcher que cubriría esa subcolección es el Master-Gate `match /{subCollection=**}/{docId}` que **solo concede `read`** (`:258-260`); no hay `match /reconstruction_jobs/...` con `allow write`, así que el write cae al default-deny raíz (`:17-19`) → `createReconstructionJob`/`markJobCompleted`/`markJobFailed` fallan con `permission-denied`. Peor aún: las rules SÍ definen `match /digital_twin_jobs/{jobId} { allow read...; allow write: if false }` (`:310-314`, "server writes only"), pero **NINGÚN archivo del repo escribe a `digital_twin_jobs`** (grep global = 0 writers). Es una regla huérfana para una colección que el código renombró a `reconstruction_jobs` sin actualizar las reglas → **doc/rules-vs-code drift** (conv. #4 espíritu, viola #4-firestore: colección nueva exige regla explícita + ≥5 rules-tests; **0 rules-tests** cubren `reconstruction_jobs`). Combinado con #1, todo el flujo on-device queda inerte para el cliente real. |
| 3 | 🟡 | `placedObjectsStore.ts:33-35, 52` (+ `firestore.rules:258-260`) | **`placed_objects` sin regla de escritura — mutaciones cliente denegadas por default-deny.** `savePlacedObject`/`updatePlacedObject`/`deletePlacedObject` escriben a `projects/${projectId}/placed_objects/{id}` con el Web SDK cliente. Igual que #2: el Master-Gate `{subCollection=**}` solo da `read` (`:258-260`); no existe `match /placed_objects/...` con `allow write` → default-deny. El consumidor `DigitalTwinFaena.tsx:279` hace `void savePlacedObject(...).catch(...)` (fire-and-forget, error tragado al log), así que el usuario coloca extintores/AEDs/hidrantes virtuales en el twin, ve el objeto en estado local optimista, **pero nunca se persiste** — al recargar desaparece. Persistencia de objetos de seguridad (rutas de evacuación, duchas de emergencia, detectores de gas) silenciosamente rota. Sin regla + sin rules-tests (conv. #4-firestore). Severidad 🟡 vs #2 porque el fallo es de durabilidad UX, no del pipeline crítico de reconstrucción. |
| 4 | 🟡 | `siteGeometryStore.ts:46, 56` + `siteGeometry.ts:224-226` (+ `firestore.rules:944-963`) | **`site_geometry` escribe a un path 4-niveles `tenants/{tid}/projects/{pid}/site_geometry/{id}` que NINGUNA regla cubre; el matcher `tenants` es de un solo nivel.** `savePolygon` (`:56`) hace `setDoc` (Web SDK cliente) a `tenants/${tenantId}/projects/${projectId}/site_geometry/${id}` (path armado en `siteGeometry.ts:224`). En `firestore.rules` el bloque `match /tenants/{tenantId}` tiene `match /{subcoll}/{docId}` que matchea **un único nivel** de subcolección (`:961`, `tenants/{tid}/{subcoll}/{doc}`), `create/update/delete: if false`; no hay matcher recursivo ni para `projects/{pid}/site_geometry/{geomId}` bajo tenants → default-deny. `setDoc` falla con `permission-denied`. **Inconsistencia de modelo de datos del lote:** `reconstruction_jobs` y `placed_objects` usan el path **legacy top-level** `projects/{pid}/...` (#2,#3, sin tenant), mientras `site_geometry` usa el path **tenant-scoped** `tenants/{tid}/projects/{pid}/...` — tres colecciones del mismo subsistema "Digital Twin", dos convenciones de path incompatibles, **ninguna** con regla de escritura. |
| 5 | 🟡 | `src/components/digital-twin/Site25DPanel.tsx:191, 234-235` (consumidor de `siteGeometryStore`) | **`tenantId` derivado del cliente con fallback `'default'`, sin verificación contra token (conv. #6 / #12-aislamiento).** El panel pasa `tenantId = auth.currentUser?.tenantId ?? 'default'` (`:191`) directo a `savePolygon`/`subscribeSiteGeometry`. Como el store es client-SDK puro (no hay route server que llame `assertProjectMember`), el aislamiento de tenant depende **enteramente** de `firestore.rules` — que aquí no cubren el path (#4), de modo que la única defensa real está ausente. El fallback `'default'` además colapsaría geometría de proyectos sin `tenantId` claim en un tenant compartido `tenants/default/...`. No explotable hoy (los writes están denegados por #4), pero es el anti-patrón #6: clave de aislamiento provista por el cliente sin un check server-side. |
| 6 | 🔵 | `photogrammetry/types.ts:5-23, 62-66, 121-142` | **Doc-drift: el header y la interface canónica `PhotogrammetryAdapter` siguen describiendo el flujo CLOUD descartado (§2.28).** El comentario de cabecera enumera "2. Cliente sube el archivo a Cloud Storage (signed URL). 3. Cloud Run job (Meshroom/RealityCapture/Hyper3D)..." (`:9-12`) y referencia archivos inexistentes `jobOrchestrator.ts`/`meshLoader.ts`/`photogrammetryAdapter.ts` (`:20-23`). `PhotogrammetryJobInput.videoUri` (`:64`, "Storage path o URL al video subido") + `engine` con tombstones `meshroom/colmap/reality-capture/hyper3d` (`:49-53`) describen el upload de video remoto que la directiva on-device **prohíbe** (el video NUNCA sube). La interface `PhotogrammetryAdapter` (`:121-142`) documenta "worker pool en Cloud Run" (`:128`) y `waitForJob` polling — pero el único impl (`OnDeviceReconstructionAdapter`) lanza `Error` en `getJobStatus`/`waitForJob` (`onDeviceAdapter.ts:223,236`). Header contradice la directiva inviolable; mismo hallazgo de clase que NH §2.4, anotado aquí a nivel línea. No-bloqueante (solo tipos), pero confunde el threat-surface y el contrato real. |

## Limpios (sin hallazgos nuevos)

- **`siteGeometry.ts`** (helpers puros) — `closeRing`/`isValidRing` (rechaza
  rings degenerados <3 puntos distintos, `:85-93`), `buildFeature` (throws on
  invalid, `:100`), `ringCentroid` (descarta el vértice de cierre para no
  doble-pesar, `:121`), `projectWindSuction` (reusa `windLoadOnSurface` del
  motor Bernoulli — single source of truth de física, `:200`; radio capado a
  250 m `:205`; conversión meteorológica "from"→"toward" correcta `:210`; guarda
  `Math.max(0.01, cos(lat))` anti-división-por-cero en el polo `:215`).
  Determinístico, sin IO, sin `Math.random`, sin egress. GeoJSON RFC 7946 (lng,lat).
- **`onDeviceAdapter.ts`** (salvo #1) — **privacy-by-design correcto en su
  intención**: el `videoFile` nunca toca Storage, solo el GLB/USDZ resultante
  (#12 respetado en diseño); `OnDeviceJobInput` reemplaza `videoUri` por `File`
  local (`:47-58`) cerrando el path de upload de video; validación de inputs
  vacíos (`:84-86`); `AbortError` mapeado a mensaje de cancelación amable
  (`:209-210`); `friendlyErrorMessage` redacta errores técnicos sin leak de
  internals (`:255-269`). El `void this.executeJob(...).catch(...)` (`:104`) es
  un fire-and-forget **deliberado** (devuelve `{jobId}` antes de terminar, patrón
  documentado `:78-82`) con `markJobFailed` best-effort en el catch — no es un
  "promesa sin await" peligroso. `Math.random()` para jobId (`:250`) ya marcado
  por NH §2.9 — fuera del scope de `precommit-stub-guard` (`src/services/`, no
  `src/server/`), rama no-muerta pero no bloqueante; preferir `randomId()`.
  El usdz-cast `as unknown as` (`:190`) ya marcado por NH §2.10.
- **`reconstructionJobStore.ts`** (salvo #2) — clamps de `limit` defensivos
  (`Math.max(1, Math.min(limitCount, 100))`, `:136,:167`), `try/catch` por-doc
  en `forEach` para no tumbar el snapshot por un doc malformado (`:140-145,
  :173-178`), `subscribeReconstructionJobs` devuelve noop-unsubscribe si no hay
  `projectId` (`:162-165`, cumple contrato useEffect), `onError` propaga +
  `onSnap([])` (`:182-186`). Sin `JSON.parse` sin guard, sin egress, sin
  `Math.random`. (El problema es la **ausencia de regla**, no el código.)
- **`placedObjectsStore.ts`** (salvo #3) — `setDoc` idempotente con id
  determinista + `merge:true` para preservar `zettelkastenNodeId` escrito por
  otra pipeline (`:53`), strip defensivo de `undefined` antes de `updateDoc`
  (Firestore los rechaza top-level, `:127-131`), validación de `projectId`/`id`
  vacíos en los 3 mutadores, `deleteDoc` idempotente. El cast
  `as { [k: string]: any }` (`:135`) es el patrón conocido del Web SDK
  (`UpdateData`), comentado honestamente.
- **`siteGeometryStore.ts`** (salvo #4) — `savePolygon` valida el ring vía
  `buildFeature` (throws antes de escribir, `:45`), `serverTimestamp()` para
  `updatedAt` (no confía en reloj cliente, `:54`), `recordToFeature` re-hidrata
  con el builder puro (re-valida, `:61`), subscribe con `try/catch` por-doc
  (`:90-96`). Sin leak, sin `Math.random`.

**No aplican a este lote:** gemini-whitelist (#5) — ningún archivo toca
`/api/gemini`; 5xx-leak (#8) — no hay routes Express, son stores cliente;
audit `await` (#14) — no hay `auditServerEvent` (son operaciones client-SDK;
el audit-log de dominio lo emiten las routes/triggers server, no estos stores);
RMW-sin-tx (#19) — los `updateDoc` son patches de un solo doc sin `get()` previo.

## Resumen

Cubiertos los 6 archivos del slice `FEAT`/`B-DigitalTwin[55:61]` (los stores
Firestore-bound + tipos del gemelo digital). Hallazgo dominante y **nuevo** (que
NH-services-infra no detectó porque no cruzó las reglas): **el subsistema
Digital-Twin escribe con el Web SDK cliente a paths que ni `storage.rules` ni
`firestore.rules` cubren, así que las escrituras quedan denegadas por
default-deny**. 🔴 #1: el upload del GLB/USDZ on-device cae al catch-all
`if false` de `storage.rules` (`:159`) → la reconstrucción nunca persiste mesh
y el job termina `failed` silenciosamente. 🔴 #2: `reconstruction_jobs` no tiene
regla de escritura y la regla server-only que sí existe apunta a una colección
**fantasma** `digital_twin_jobs` con **cero writers** en el repo — rules-vs-code
drift + 0 rules-tests (viola #4-firestore). 🟡 #3 (`placed_objects`) y 🟡 #4
(`site_geometry`) repiten el patrón: mutaciones cliente denegadas, durabilidad
rota; #4 además expone una **inconsistencia de path** del propio subsistema
(`projects/{pid}/...` legacy vs `tenants/{tid}/projects/{pid}/...`). 🟡 #5:
`Site25DPanel` deriva `tenantId` del cliente con fallback `'default'` sin check
server (conv. #6) — la única defensa de aislamiento (las rules) está ausente.
🔵 #6: doc-drift en `types.ts` (header + interface describen el flujo Cloud Run
descartado). El cómputo on-device (privacy-by-design del video, #12) y los
helpers puros de geometría/viento están limpios; el problema es de
**reglas/wiring de persistencia**, no de lógica. Sin gemini fuera de whitelist,
sin 5xx-leak, sin RMW-sin-tx, sin `JSON.parse` server sin guard en este lote.
