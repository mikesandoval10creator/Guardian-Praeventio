# DEEP — Lote EXI-28 · I-PLAT (mobile/native platform) · 2026-06-03

**Atestación: 17/17 archivos leídos línea por línea.**
DERIVA: `docs/audits/file-ledger/ledger.json` filtrado por
`category === "I-PLAT"` (72 matches), ordenado por `path`, slice `[55:72]` →
17 archivos. Lista verificada vía Node contra el ledger.

> No-repetición: el doc previo referido por el usuario (`DEEP-EXI-27.md`) no
> existe en el repo; el adyacente `DEEP-EX-27.md` cubre **B13-MOC (FEAT)**,
> scope completamente distinto (handover/MOC TS). Cero solape con este lote
> nativo. Foco aquí: directiva #17 (allowBackup), cleartextTraffic, permisos,
> secretos/keystores, deep-links, plugin mesh nativo real-vs-stub, service
> workers, cifrado SQLite nativo, exported components, bugs nativos.

---

## Hallazgos

### 🟡 N1 — `Plugin.swift`: el `serviceUUID`/`meshDataCharUUID` se construyen desde una cadena que NO es un UUID válido → `CBUUID(string:)` produce un UUID distinto al de Android ⇒ iOS y Android NUNCA se ven en la malla
`Plugin.swift:34-39` hace
`CBUUID(string: "00001234-PRAE-VENTI-O123-456789ABCDEF")` y
`CBUUID(string: "00001235-PRAE-VENTI-O123-456789ABCDEF")`. Esa cadena **no es
un UUID hex de 128 bits**: contiene `P R V N T I O` (no son dígitos hex) y el
3er grupo `O123` no es hex. `CBUUID(string:)` de CoreBluetooth solo acepta
cadenas de 4 / 8 caracteres hex (forma corta) o un UUID canónico 8-4-4-4-12
**hex**; con esta entrada Apple, en la práctica, o lanza/loggea
`*** -[CBUUID initWithString:] called with invalid UUID string` o interpreta
algo distinto — en ningún caso queda igual al UUID que Android sí derivó
correctamente. Y ahí está el bug real de interoperabilidad: el Kotlin
(`MeshPlugin.kt:74-86`) **reconoce** que la marca textual no es UUID válido y
deriva un UUID hex distinto y bien formado
(`BLE_SERVICE_UUID_STR = "00001234-12AE-3E45-7123-456789ABCDEF"`,
`MESH_DATA_UUID_STR = "0000ABCD-12AE-3E45-7123-456789ABCDEF"`), mientras que
iOS pasa la cadena cruda inválida. Resultado: aunque ambos compilaran y
advirtieran, **un iPhone y un Android no comparten ni el service UUID ni el
characteristic UUID** (Android service=`...12AE...`, char=`0000ABCD...`; iOS
service/char derivados de strings inválidos). Para una "malla de comunicación
de emergencia offline entre trabajadores" (copy del `Info.plist:15`) esto es la
diferencia entre que el relevo BLE funcione cross-platform o no exista. Bug
nativo real, no estético. Además los dos UUID de characteristic difieren por
diseño (`0000ABCD...` Android vs `00001235-...` iOS), un segundo mismatch.

### 🟡 N2 — Doc-vs-código fuertemente desincronizado: README/build.gradle/Manifest/Info.plist/package.json dicen "STUB / SCAFFOLD Sprint 30/31, logs only", pero `MeshPlugin.kt` y `Plugin.swift` son implementaciones BLE GATT / CoreBluetooth REALES (Sprint 46)
`README.md:6-8` afirma «Native code is **stubbed (logs only)**. Real BLE GATT
stack lands in Sprint 31». `package.json:4` repite «Sprint 31 will land the
real Kotlin/Swift code» y `version: "0.1.0-scaffold"`. `build.gradle:1-7`,
`AndroidManifest.xml:4`, `Info.plist:4` y `definitions.ts:6-8` se rotulan
«SCAFFOLD». PERO `MeshPlugin.kt:3` se declara «Sprint 46 REAL BLE GATT» con
`BluetoothLeAdvertiser`/`Scanner`/`GattServer`/`GattClient` cableados de
verdad, y `Plugin.swift:3-5` «Sprint 46 REAL CoreBluetooth». Es exactamente la
clase de drift que la directiva #20 quiere evitar (doc afirma estado X, código
hace Y). Riesgo concreto: (a) un revisor que confíe en el README cree que esto
es inerte/seguro y no audita los permisos BLE peligrosos que ahora SÍ se
ejercen; (b) `versionName "0.1.0-scaffold"` (build.gradle:38) +
`version 0.1.0-scaffold` (package.json:3) hace que el podspec
(`PraeventioCapacitorMesh.podspec:7-12`) publique un pod etiquetado «scaffold»
sobre código productivo, y el `:tag => s.version` apunte a un tag git inexistente
para release. Doc-only fix pendiente.

### 🟡 N3 — `MeshPlugin.kt` / `Plugin.swift`: el GATT server acepta WRITE de CUALQUIER dispositivo y emite `mesh:packet` al JS sin filtrar por projectId ni firma en la capa nativa
`MeshPlugin.kt:373-411` (`onCharacteristicWriteRequest`) reensambla el JSON de
cualquier peer que escriba la characteristic `mesh-data` y hace
`notifyListeners("mesh:packet", js)` sin verificar firma ni que el packet
pertenezca al `projectId` con que arrancó el plugin. Igual en iOS:
`Plugin.swift:222-239` (`didReceiveWrite` → `handleIncomingPacket`) parsea y
emite cualquier JSON entrante. La characteristic se expone con
`PERMISSION_WRITE` puro (`:442`) / `[.writeable]` (`:199`) — **sin
encryption/authentication requerida** (no usa `PERMISSION_WRITE_ENCRYPTED`).
Mitigación: el aislamiento real por proyecto + verificación de firma ocurre en
la **capa engine** (`meshRelayQueue.receive` vía
`transportFacade.handleIncomingPacket:211-216`, fuera de este lote), así que un
packet de otro proyecto se descarta antes de llegar al router. PERO: (a) la
malla es para EMERGENCIAS y el server nativo es un sumidero abierto sin rate
limit — un atacante en rango BLE puede inundar `notifyListeners` con basura JSON
balanceada (la heurística `isBalancedJson:414-430` la acepta) forzando trabajo
de parsing/verify en cada teléfono; (b) el `advertise` emite `peerId.hashCode()`
(32-bit, `:279-281`) y el iOS el `localName = "praeventio-" + peerId.prefix(8)`
(`:206`) — fuga de un prefijo del UID del trabajador en claro por aire, sin
opt-in, observable por cualquier scanner BLE pasivo (tracking de presencia de
personal en faena). Anoto como superficie a endurecer (encrypted characteristic
+ no leakear UID en advertise).

### 🔵 N4 — `MeshPlugin.kt`: `peerId.hashCode()` como identidad de advertising — colisión/spoof trivial; y `Math.random` no se usa (OK #15) pero el id de peer en claro es débil
`MeshPlugin.kt:279-281` mete `pid.hashCode()` (Java String hashCode, 32 bits,
no-cripto, reversible/colisionable) como manufacturer data de advertising. No
viola #15 (no es `Math.random`, no es generación de ID server-side), pero como
discriminador de peer es spoofeable: dos workers pueden colisionar y un
atacante puede falsificar el hash de un peerId objetivo. Bajo impacto porque el
matching real de peer en el engine va por la firma del packet, no por el
manufacturer data; el advertise data es solo hint de descubrimiento. Anoto la
debilidad.

### 🔵 N5 — `Plugin.swift`: `send()` trunca el packet a 512 bytes con `subdata(in: 0..<512)` en vez de chunkear — packets MOC/SOS grandes se CORROMPEN silenciosamente en iOS
`Plugin.swift:147-148` hace
`let capped = data.count > 512 ? data.subdata(in: 0..<512) : data` y escribe
solo eso. Android SÍ chunkea correctamente (`chunkify:488-498` +
`writeChunks:505-531`, 512B por chunk con reensamblado en el receptor). iOS
**descarta** todo lo que pase de 512 bytes y aun así reporta el peer en
`deliveredTo` (`:156-157`) → el remitente cree que entregó el packet completo.
Para un packet de malla con payload de incidente/SOS >512B, el receptor iOS
recibe JSON truncado, `JSONSerialization` falla en `handleIncomingPacket:231` y
lo dropea «malformed» — pérdida de mensaje de emergencia con falso «delivered».
Inconsistencia de contrato entre plataformas + data loss silencioso.

### 🔵 N6 — `package.json` `files[]` apunta a rutas iOS que NO existen (`ios/Sources`, `ios/Plugin/`); el source real es `ios/Plugin.swift` plano
`package.json:9-16` lista `"ios/Sources"` y `"ios/Plugin/"` en `files`, pero el
plugin Swift vive en `ios/Plugin.swift` (archivo plano) y el podspec lo recoge
vía `source_files = 'ios/*.{swift,h,m}'` (`PraeventioCapacitorMesh.podspec:13`).
Al publicar el paquete npm, el tarball NO incluiría el `.swift` (las rutas del
`files[]` no matchean), y el `capacitor.ios.src = "ios"` (`:33`) salvaría el
build local pero un consumidor que instale desde npm registry se quedaría sin
fuente iOS. Empaque roto para distribución; no afecta build monorepo local.

### 🔵 N7 — `Fastfile`/`Appfile`/`Pluginfile`: limpios respecto a secretos — todo vía ENV, ningún Team ID / keystore / password hardcodeado
`Fastfile:33-35` y `Appfile:7-9` documentan explícitamente «paste the real
Apple Team ID … into the GHA secrets (NOT this file)» y leen todo de `ENV[...]`
(`Appfile:11-13`, `Fastfile:43,52,80,97`). `match(readonly: true)` (`:54`) evita
mutar el repo de certs en CI. `upload_to_app_store(submit_for_review: false,
automatic_release: false)` (`:96-102`) — sin auto-submit, correcto.
`Pluginfile` no contiene secretos. Sin hallazgo de seguridad; sólo nota: el
`before_all` valida `APP_BUNDLE_ID` pero NO `MATCH_PASSWORD`/`APPLE_TEAM_ID`,
así que un run sin esos secretos falla más tarde y menos claro (cosmético).

### 🔵 N8 — `AndroidManifest.xml`: permisos BLE/Wi-Fi bien acotados; sin `cleartextTraffic`/`allowBackup` aquí (es manifest de librería, no de app) — directiva #17 N/A en este archivo
El manifest del módulo `capacitor-mesh` declara solo `uses-permission`/
`uses-feature` BLE+WiFi, con `neverForLocation` en `BLUETOOTH_SCAN:14` y
`NEARBY_WIFI_DEVICES:37` (minimiza inferencia de ubicación — buena práctica), y
`maxSdkVersion="30"` en los permisos legacy (`:26,28,31`). NO declara
`android:allowBackup` ni `usesCleartextTraffic` ni `application` — porque es un
**manifest de librería** que se mergea en el host; la directiva #17
(`allowBackup="false"`) aplica al manifest de la APP, fuera de este lote. El
`xmlns:tools` se re-declara por-elemento (`:16,19,22,39,45`) en vez de en
`<manifest>` — válido pero verboso; el manifest merger lo tolera. Nota menor:
`uses-feature bluetooth_le required="true"` (`:47`) excluiría del Play Store a
dispositivos sin BLE para TODA la app si este módulo está presente — para una
PWA de prevención que debe correr en cualquier teléfono de faena, debería ser
`required="false"`. Anoto.

### 🔵 N9 — `forceGraphWorker.ts`: worker limpio, defensivo y puro — sin hallazgo
`src/workers/forceGraphWorker.ts` valida el shape de entrada
(`parseForceGraphRequest:99-117`), clampa `iterations` a `[1,600]` (`:127`,
evita DoS de cómputo), filtra links colgantes (`:142-147`), corre d3-force
síncrono y postea `simulate.done`/`simulate.error` sin nunca crashear el worker
(`:188-213`). Sin red, sin Firestore, sin random, sin secretos. El único matiz
es el "3D approximado" (`:159-168`, deja z=0 y delega al render) — documentado y
honesto, no es stub disfrazado. Limpio.

### 🔵 N10 — `web.ts` (simulador BroadcastChannel): correcto y honestamente rotulado «NOT real BLE»; aísla por `projectId` en el nombre de canal
`web.ts:114` usa `praeventio-mesh-${opts.projectId}` como nombre de canal, así
que dos proyectos distintos no se cruzan packets en el simulador — paridad con
el filtro de proyecto del engine. El RSSI sintético (`:190`) y el «report all as
delivered» (`:166-169`) están comentados como simulación. `__setChannelFactoryForTests`
(`:76-80`) es inyección de test legítima, no un backdoor. Limpio.

---

## Tabla por archivo (17/17)

| # | Archivo | LOC | Estado | Hallazgo / nota (file:line) |
|---|---|---|---|---|
| 1 | fastlane/Pluginfile | 17 | ✅ | Solo comentarios + plugin comentado. Sin secretos. |
| 2 | ios/App/fastlane/Appfile | 18 | ✅ | Todo ENV-driven; doc «no commitear Team ID». N7. |
| 3 | ios/App/fastlane/Fastfile | 105 | ✅ | match readonly, sin auto-submit, sin secretos hardcoded. N7. |
| 4 | packages/capacitor-mesh/PraeventioCapacitorMesh.podspec | 17 | 🔵 | `:tag => s.version` = `0.1.0-scaffold` (tag git inexistente para release). N2/N6. |
| 5 | packages/capacitor-mesh/README.md | 59 | 🟡 | Afirma «native stubbed, logs only / Sprint 31» — falso vs Kt/Swift reales. N2. |
| 6 | packages/capacitor-mesh/android/build.gradle | 71 | 🟡 | Header «SCAFFOLD»; `versionName 0.1.0-scaffold` sobre código real. N2. minifyEnabled false (lib, OK). |
| 7 | packages/capacitor-mesh/android/src/main/AndroidManifest.xml | 49 | 🔵 | N8 `bluetooth_le required=true` excluiría no-BLE; tools ns por-elemento. allowBackup N/A (lib). |
| 8 | packages/.../java/com/praeventio/mesh/MeshPlugin.kt | 553 | 🟡 | N1 UUID hex correcto pero ≠ iOS. N3 GATT abierto sin enc/firma. N4 hashCode advertise. Permission gating OK (:238-254). |
| 9 | packages/capacitor-mesh/ios/Info.plist | 27 | ✅ | Usage strings + background modes coherentes con BLE real. Sin secretos. |
| 10 | packages/capacitor-mesh/ios/Plugin.swift | 351 | 🟡 | N1 `CBUUID(string:)` con cadena no-UUID → no interopera con Android. N3 GATT abierto. N5 trunca a 512 (data loss). |
| 11 | packages/capacitor-mesh/ios/PluginConfig.json | 11 | ✅ | Declaración de métodos correcta vs definitions.ts. |
| 12 | packages/capacitor-mesh/package.json | 50 | 🔵 | N6 `files[]` apunta a ios/Sources, ios/Plugin/ inexistentes. version «scaffold». |
| 13 | packages/capacitor-mesh/src/definitions.ts | 70 | ✅ | Tipos limpios; import cross-pkg de MeshPacket. Header «scaffold» (N2 menor). |
| 14 | packages/capacitor-mesh/src/index.ts | 17 | ✅ | registerPlugin con web fallback. Limpio. |
| 15 | packages/capacitor-mesh/src/web.ts | 241 | ✅ | N10 simulador honesto, aísla por projectId en canal. |
| 16 | packages/capacitor-mesh/tsconfig.json | 19 | ✅ | strict + isolatedModules. Limpio. |
| 17 | src/workers/forceGraphWorker.ts | 215 | ✅ | N9 puro, defensivo, clamp iteraciones, nunca crashea. |

Leyenda: ✅ ok · 🟡 deuda/bug real · 🔵 backend/nativo listo o nota menor · 🔴 invariante rota.

## Archivos limpios (sin hallazgo 🔴/🟡): 1,2,3,7,9,11,12,13,14,15,16,17 (12/17, incl. notas 🔵 menores en 4,7,12). Con bug/deuda real 🟡: 5,6,8,10 (4/17). Sin 🔴. Directivas #17/cleartext/secretos: limpias en este lote (manifest es de librería; fastlane 100% ENV).

---

## Resumen (6-10 líneas)

Lote EXI-28 — 17/17 archivos I-PLAT (mobile/native: fastlane iOS + plugin
`@praeventio/capacitor-mesh` + forceGraphWorker) leídos línea por línea. Sin
🔴. Hallazgo nativo más serio (🟡 N1): el `Plugin.swift` iOS construye sus
`CBUUID` desde la marca textual `00001234-PRAE-VENTI-O123-...` que NO es un UUID
hex válido, mientras Android (`MeshPlugin.kt`) sí deriva un UUID hex bien
formado distinto — iPhone y Android terminan con service/characteristic UUIDs
incompatibles y la malla de emergencia BLE NUNCA interopera cross-platform (más
el char UUID también difiere por diseño). 🟡 N2: drift doc-vs-código fuerte —
README/build.gradle/package.json/Manifest rotulan «STUB/SCAFFOLD, logs only,
Sprint 31» pero el Kotlin y el Swift son BLE GATT/CoreBluetooth REALES (Sprint
46), con `version 0.1.0-scaffold` publicada sobre código productivo. 🟡 N3: el
GATT server nativo (ambas plataformas) acepta WRITE de cualquier dispositivo y
emite `mesh:packet` sin filtrar projectId/firma en la capa nativa (la
verificación vive en el engine `meshRelayQueue`, fuera del lote) y la
characteristic no exige encryption; además el advertise fuga un prefijo/hash del
UID del trabajador en claro por aire (tracking pasivo de presencia). 🔵
menores: iOS `send()` trunca packets a 512B en vez de chunkear → data loss
silencioso con falso «delivered» (N5); `package.json files[]` apunta a rutas iOS
inexistentes rompiendo el empaque npm (N6); `peerId.hashCode()` débil como
identidad de advertising (N4); `bluetooth_le required=true` excluiría teléfonos
sin BLE de toda la app (N8). Confirmado limpio: fastlane (Fastfile/Appfile/
Pluginfile) sin secretos, todo ENV-driven con `match readonly` y sin auto-submit
(N7); `forceGraphWorker.ts` puro/defensivo (N9); `web.ts` simulador honesto que
aísla por projectId (N10). Directiva #17 (allowBackup) N/A — el manifest es de
librería, no de app. Doc-only, sin commit.
