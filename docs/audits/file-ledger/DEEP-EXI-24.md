# DEEP-EXI-24 — Lote #24 (I-CORE) · Pasada línea-por-línea · 2026-06-03

**Deriva:** `ledger.json` filtrado `category==="I-CORE"`, ordenado por `path`,
slice `[0:53]` = los 53 archivos de la categoría (contexts, store, providers,
lib, utils, types, constants, App.tsx/main.tsx).

**Objetivo:** hallazgos NUEVOS que la pasada a nivel-bloque `DEEP-INFRA-CORE.md`
no leyó a fondo. Foco directiva: escritura client-side sin audit, `Math.random`
en IDs, secretos hardcodeados, `tenantId 'default'` spoofeable, errores que
filtran internals, promesas sin await, mutación de estado, memory leaks de
listeners, y bugs reales.

---

## Atestación de lectura — 53/53

Todos los archivos del slice fueron leídos completos (cat -n, línea por línea).
Los certificados DS/SUSESO/aptitud (`ds67/ds76/ds109/suseso/aptitude/training
Certificate`, `pricingOcPdf`) son generadores PDF puros (jsPDF) sin I/O ni
auth — verificados además por grep dirigido (`Math.random|btoa|atob|secret|
apiKey|password|TODO/FIXME`): 0 hits salvo un TODO histórico ya resuelto
(`pricingOcPdf.ts:4`).

| # | Archivo | Veredicto |
|---|---|---|
| 1 | src/App.tsx | 🟡 demo-mode auth bypass |
| 2 | src/constants.ts | limpio |
| 3 | src/constants/glossary.ts | limpio |
| 4 | src/contexts/AccessibilityContext.tsx | limpio |
| 5 | src/contexts/AppModeContext.tsx | 🔵 value sin memo |
| 6 | src/contexts/EmergencyContext.tsx | limpio (fan-out fail-soft correcto) |
| 7 | src/contexts/FirebaseContext.tsx | 🟡 seeding/auto-create client-side sin audit |
| 8 | src/contexts/LanguageProvider.tsx | limpio |
| 9 | src/contexts/NormativeContext.tsx | limpio (data estática) |
| 10 | src/contexts/NotificationContext.tsx | 🟡 leak listener onMessage |
| 11 | src/contexts/ProjectContext.tsx | 🟡 createProject client-side sin audit |
| 12 | src/contexts/SensorContext.tsx | limpio |
| 13 | src/contexts/SubscriptionContext.tsx | limpio (upgrade server-side; DT-01 cerrado) |
| 14 | src/contexts/SystemEngineProvider.tsx | 🔵 dep `sub` en bindExecutor |
| 15 | src/contexts/ThemeContext.tsx | 🟡 leak MediaQuery listener |
| 16 | src/contexts/UniversalKnowledgeContext.tsx | 🟡 createNode/createEdge client-side sin audit |
| 17 | src/index.css | limpio (CSS) |
| 18 | src/lib/apiAuth.ts | limpio |
| 19 | src/lib/e2eAuth.ts | limpio (gate MODE=test) |
| 20 | src/lib/i18n.ts | limpio |
| 21 | src/lib/sentry.ts | limpio (redactPii sólido) |
| 22 | src/main.tsx | limpio |
| 23 | src/providers/AppProviders.tsx | 🟡 tenantId 'default' spoofeable |
| 24 | src/providers/MeshProvider.tsx | limpio |
| 25 | src/store/eventBus.ts | limpio |
| 26 | src/types/globals.d.ts | 🔵 `__GP_TENANT_ID__` window-writable (corrobora #23) |
| 27 | src/types/index.ts | limpio |
| 28 | src/types/organic.ts | limpio |
| 29 | src/types/roles.ts | limpio |
| 30 | src/utils/aptitudeCertificate.ts | limpio (PDF puro) |
| 31 | src/utils/biometrics.ts | 🔴 WebAuthn sin verificación server-side |
| 32 | src/utils/contentModeration.ts | limpio |
| 33 | src/utils/deterministicRandom.ts | limpio (PRNG sólo tests) |
| 34 | src/utils/ds109Certificate.ts | limpio |
| 35 | src/utils/ds67Certificate.ts | limpio |
| 36 | src/utils/ds67Notification.ts | limpio |
| 37 | src/utils/ds76Certificate.ts | limpio |
| 38 | src/utils/ds76MiningContractor.ts | limpio |
| 39 | src/utils/haversine.ts | limpio |
| 40 | src/utils/imageCompression.ts | limpio |
| 41 | src/utils/logger.ts | limpio |
| 42 | src/utils/networkStatus.ts | limpio |
| 43 | src/utils/nodeTypeUtils.ts | limpio |
| 44 | src/utils/offlineKnowledge.ts | limpio |
| 45 | src/utils/offlineStorage.ts | 🔴 "encriptación" = base64 |
| 46 | src/utils/pricingOcPdf.ts | limpio |
| 47 | src/utils/pwa-offline.ts | limpio (SQLite encryption real) |
| 48 | src/utils/randomId.ts | limpio |
| 49 | src/utils/rut.ts | limpio |
| 50 | src/utils/sqliteEncryption.ts | limpio |
| 51 | src/utils/susesoCertificate.ts | limpio |
| 52 | src/utils/trainingCertificate.ts | limpio |
| 53 | src/vite-env.d.ts | limpio (tipos) |

---

## Hallazgos NUEVOS (no cubiertos a fondo por DEEP-INFRA-CORE.md)

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| src/utils/biometrics.ts:69-98 | 🔴 | `verifyBiometric` genera el `challenge` en el CLIENTE (`window.crypto.getRandomValues`, :70-71) y devuelve `true` con sólo que `navigator.credentials.get()` resuelva. NO hay challenge server-side, NO se envía/verifica la firma de la assertion en backend. WebAuthn local-only = trivialmente spoofeable (cualquier authenticator/extension/mock retorna assertion → `return true`). Si esto gatea unlock de Caja Negra, my-data o re-auth, es bypass real. | `const challenge = new Uint8Array(32); window.crypto.getRandomValues(challenge);` … `if (assertion) { return true; }` (:88-92) |
| src/utils/offlineStorage.ts:116-132 | 🔴 | `encryptData`/`decryptData` son `btoa(encodeURIComponent(JSON.stringify(...)))` — base64, NO cifrado. El campo se persiste como `_encryptedData` (nombre engañoso) en IndexedDB web para `workers` (PII: RUT, nombre) y `matrices`. Reversible con `atob`. En el path web es la ÚNICA protección. "Encryption theater" / stub disfrazado de cifrado. Contradice la promesa de data-at-rest del Regla #16 en la rama web. | `return btoa(encodeURIComponent(JSON.stringify(data)));` (:118); aplicado en `saveWorkerOffline` (:135) y `saveMatrixOffline` (:162) |
| src/App.tsx:264-328 | 🟡 | Demo-mode bypassea TODA la auth con `?demo=true` en el query string: monta `<AppProviders>` + rutas completas (Dashboard, Emergency, Health, Compliance, AI, my-data implícito vía route groups) sin `user`. No hay gate de entorno (a diferencia de E2E que checa `MODE==='test'`). En prod, `https://app/?demo=true` entra a la SPA autenticada-equivalente; aunque las queries Firestore fallarán por rules, expone UI/rutas y depende 100% de rules como única barrera. | `const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true'; if (isDemo) { return (<AppProviders>…todas las rutas…</AppProviders>); }` |
| src/providers/AppProviders.tsx:82 | 🟡 | `engineTenantId = window.__GP_TENANT_ID__ \|\| 'default'`. El tenant del SystemEngine (policies geofence→SOS, tier-reactivity) se lee de un global window escribible por el cliente y cae a `'default'`. Spoofeable: cualquier script en página puede setear `__GP_TENANT_ID__` y enrutar eventos/decisiones a otro tenant lógico, o colisionar todos en `'default'`. Mitigado hoy sólo porque el engine está OFF por flag (`VITE_SYSTEM_ENGINE_ENABLED`), pero el cableado quedará vivo al activarlo. | `(typeof window !== 'undefined' && window.__GP_TENANT_ID__) \|\| 'default'`; tipo en `globals.d.ts:30` confirma window-writable |
| src/contexts/ThemeContext.tsx:74,84 | 🟡 | Memory leak de listener: `addEventListener('change', () => applyTheme(themeMode))` (:74) y el cleanup `removeEventListener('change', () => applyTheme(themeMode))` (:84) pasan funciones inline DISTINTAS → `removeEventListener` es no-op. El listener de `matchMedia` se acumula en cada re-run del effect (cambio de `themeMode`/`applyTheme`). Sesiones largas → N handlers redundantes recalculando tema. | dos closures `() => applyTheme(themeMode)` separadas; sólo se remueve por ref idéntica |
| src/contexts/NotificationContext.tsx:73-109 | 🟡 | El effect `setupMessaging` corre en cada cambio de `isCrisisMode` (dep :109) y registra un nuevo `onMessage(messaging, …)` (:92) SIN cleanup del anterior — `onMessage` retorna un unsubscribe que se descarta. Además re-pide `Notification.requestPermission()` y `getToken` en cada toggle. Resultado: handlers duplicados de push (notificación FCM se muestra N veces) + leak de subscription. | `onMessage(messaging, (payload)=>{…})` sin guardar/llamar el unsubscribe; effect dep `[isCrisisMode]` |
| src/contexts/UniversalKnowledgeContext.tsx:223-241 | 🟡 | `createNode` (addDoc `nodes`) y `createEdge` (2× updateDoc `nodes`) escriben Firestore client-side sin `audit_logs`, sin `createdBy`/userId stamp, y `createNode` ni siquiera setea `projectId` (queda fuera del filtro `where('projectId','==')` del propio provider → nodo huérfano invisible). Patrón sistémico de escritura client-side sin audit (Regla #3). | `await addDoc(collection(db,'nodes'), { ...data, createdAt, updatedAt });` — sin projectId/userId/audit |
| src/contexts/ProjectContext.tsx:199-254 | 🟡 | `createProject` hace `addDoc(collection(db,'projects'), …)` directo client-side sin escritura a `audit_logs` (Regla #3: toda op que cambia estado debe auditar). `createdBy`/`members` se setean desde `user?.uid` confiando en el cliente. Mismo patrón sistémico que UniversalKnowledge/Emergency. | `const docRef = await addDoc(collection(db,'projects'), { ...projectData, createdBy: user?.uid, members:[user?.uid] });` |
| src/contexts/FirebaseContext.tsx:126-169 | 🟡 | En `onAuthStateChanged`: (a) auto-crea `users/{uid}` con `role:'operario'` client-side sin audit; (b) "Seeding initial nodes" hace `getDocs(collection(db,'nodes'))` GLOBAL (sin filtro) y `setDoc` masivo de `risks` si vacío — corre en CADA primer login, lectura wide-open de toda la colección `nodes` + escrituras sin audit ni projectId. El seed pertenece al server. | `const nodesSnapshot = await getDocs(collection(db,'nodes')); if (nodesSnapshot.empty) { for (const risk of risks) await setDoc(doc(db,'nodes',risk.id), {...}); }` (:152-168) |
| src/contexts/AppModeContext.tsx:239-247 | 🔵 | A diferencia de TODOS los demás contexts del lote (memoizados explícitamente "Plan 2026-05-23 perf"), el `value` se construye inline sin `useMemo` → invalida a todos los consumers (EmergencyOverlay, Sidebar, FallDetection) en cada render del provider. Inconsistencia con la convención del propio repo. | `const value: AppModeContextValue = { mode, appearance, setMode, … };` (sin useMemo) |
| src/contexts/SystemEngineProvider.tsx:106-112 | 🔵 | `bindExecutor` effect lista `sub` (objeto SubscriptionContext completo) como dep pero no lo usa en el cuerpo (comentario :100-105 explica que omitió las bindings de subscription). `sub` cambia de referencia salvo memo → re-bind innecesario del executor. Dep muerta. | `}, [triggerEmergency, addNotification, sub]);` con `sub` no referenciado dentro |
| src/utils/offlineStorage.ts:299-306 | 🔵 | `unlockBlackBox` en native es un `return;` no-op silencioso (:300) — la Caja Negra biométrica nunca se desbloquea en Android/iOS por esta vía. Comentario dice "native unlock handled separately" pero no hay referencia al handler. Posible stub sin TODO(sprint)/inventario (Regla #13). | `if (Capacitor.isNativePlatform()) return; // native unlock handled separately` |

---

## Conteo

- 🔴 **2** — `biometrics.ts` (WebAuthn sin verificación server-side),
  `offlineStorage.ts` (base64 disfrazado de cifrado).
- 🟡 **7** — demo bypass (App.tsx), tenantId spoofeable (AppProviders),
  leak ThemeContext, leak NotificationContext, y el patrón sistémico de
  escritura client-side sin audit en 3 contexts (UniversalKnowledge, Project,
  Firebase).
- 🔵 **4** — value sin memo (AppMode), dep muerta `sub` (SystemEngine),
  `__GP_TENANT_ID__` window-writable (globals.d.ts, corrobora 🟡 #23),
  unlockBlackBox native no-op.
- **Limpios:** 40/53 (todos los certificados PDF, calc-utils puros —
  haversine/rut/logger/eventBus/sentry/randomId/sqliteEncryption/pwa-offline,
  data estática — constants/glossary/types/NormativeContext, y los providers
  i18n/Mesh/Accessibility/Sensor/Subscription).

---

## Resumen (6-10 líneas)

Lectura exhaustiva de los 53 archivos I-CORE. Dos 🔴 reales no señalados a
nivel-bloque: (1) `biometrics.ts` implementa WebAuthn 100% client-side —
challenge generado en el navegador y `return true` con sólo resolver
`credentials.get()`, sin verificación de firma en servidor → spoofeable; (2)
`offlineStorage.ts` llama "encryptData" a un simple `btoa(...)` base64 y lo
persiste como `_encryptedData` (PII de workers/matrices en IndexedDB web), un
stub disfrazado de cifrado que contradice la promesa data-at-rest. El hallazgo
sistémico más relevante es el patrón de **escritura Firestore client-side sin
`audit_logs`** repetido en ProjectContext (`createProject`),
UniversalKnowledgeContext (`createNode`/`createEdge`) y FirebaseContext
(auto-create `users/{uid}` + seed masivo de `nodes`), violando la Regla #3;
`createNode` además omite `projectId` (nodo huérfano). El `tenantId 'default'`
spoofeable vía `window.__GP_TENANT_ID__` (AppProviders:82 + globals.d.ts:30)
queda latente porque el SystemEngine está tras flag, pero el cableado está
vivo. Dos leaks de listener concretos: ThemeContext (`removeEventListener` con
closure distinta, no-op) y NotificationContext (`onMessage` re-registrado sin
unsubscribe en cada toggle de `isCrisisMode`). Más el bypass de auth por
`?demo=true` sin gate de entorno (App.tsx:264), apoyado sólo en firestore.rules.
Los 26 generadores PDF / utils puros / data estática están limpios. NO se hizo
commit (doc-only).
