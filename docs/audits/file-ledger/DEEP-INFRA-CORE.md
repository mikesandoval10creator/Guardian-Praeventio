# DEEP — Infra: I-CORE / I-I18N / I-DATA · 2026-06-02

**Archivos revisados:** 89 (53 I-CORE · 18 I-I18N · 18 I-DATA), todos no-test.
Lectura a fondo de los contextos críticos, el provider tree, la factory de
stores client-side, el corpus normativo RAG y la paridad i18n.

---

## 1. Lo que YA HACE (implementado y real)

- **Cadena de providers completa y bien ordenada** (`src/providers/AppProviders.tsx`).
  El orden está justificado inline (Accessibility > AppMode > Theme > Normative >
  Project > UniversalKnowledge > Subscription > Notification > Emergency > Sensor >
  SLM > Mesh > SystemEngine). `ProjectProvider` envuelve a
  `UniversalKnowledgeProvider` porque éste filtra `where('projectId','==',…)`
  (`AppProviders.tsx:114-115`, `UniversalKnowledgeContext.tsx:107-111`).
- **FirebaseContext** (`src/contexts/FirebaseContext.tsx`): auth real vía
  `onAuthStateChanged`, auto-creación del doc `users/{uid}` con rol `operario`
  (`:127-139`), gate E2E shim sólo bajo `MODE=test` (`:75-117`), `contextValue`
  memoizado (`:196`). isAdmin se recalcula desde `userData.role`.
- **SubscriptionContext** (`src/contexts/SubscriptionContext.tsx`): gating de
  features puro por `PLAN_RANK` (`:38-73`), y — clave — `upgradePlan` NO escribe
  el plan client-side: hace `POST /api/subscription/upgrade` que valida invoice
  pagado server-side (`:165-200`). Cierra el bug DT-01 ("auto-asignarse Ilimitado").
  Cumple Regla #11 (gating server-side canónico; el cliente es sólo UX).
- **EmergencyContext** (`src/contexts/EmergencyContext.tsx`): triple camino bien
  modelado (`'ok' | 'network-fail' | 'server-error'`, `:36`) — distingue offline
  (→ mesh fallback BLE/WiFi, ADR 0013) de 5xx (no mesh). Fan-out a supervisores
  vía `/api/emergency/notify-brigada` con whitelist Zod (`:13`). Fire-and-forget,
  no bloquea la UI de emergencia.
- **SensorContext** (`src/contexts/SensorContext.tsx`): nativo (Capacitor Motion)
  + web (DeviceMotion/Orientation) con cleanup correcto; 100% on-device (Regla #12).
- **NormativeContext** (`src/contexts/NormativeContext.tsx`): 14 normativas + 5
  protocolos CL reales con artículos citados (Ley 16.744, DS 101/109/44/594/298/132/977,
  Ley 21.342/21.643, PREXOR, PLANESI, TMERT, ISTAS-21). Búsqueda con normalización
  NFD (acento-insensitive). Es el contexto RAG de marco legal.
- **Corpus normativo RAG real** (`src/data/normativa/*.ts`): 7 países (CL/AR/BR/CO/MX/PE
  + ISO 45001 universal) con URLs verificables — CL apunta a `bcn.cl/leychile`
  con `idNorma` reales (`cl.ts:45,53,…`), ISO a `iso.org/standard/63787.html`.
  CL refleja DS 44/2024 vigente (reemplaza DS 40/1969 derogado 2025-02-01).
- **Catálogos médicos CC0/CC-BY-SA** (`src/data/medical/*.json` + `index.ts`):
  diagnoses (CIE-10 subset SST), drugs (ATC/DrugBank Open Data), anatomy
  (Wikipedia ES). Cada uno con bloque `_meta` que declara license + source +
  disclaimer. Datos reales, no placeholder.
- **Generadores de certificados legales reales** (`src/utils/ds*.ts`,
  `susesoCertificate.ts`, `aptitudeCertificate.ts`, `trainingCertificate.ts`,
  `pricingOcPdf.ts`): los 8 usan jsPDF + autotable, con marco normativo citado en
  header (DS 67/76/109, Ley 16.744 art. 76). No son stubs.
- **Utilidades core sólidas**: `rut.ts` (modulo-11 SII canónico, puro),
  `randomId.ts` (crypto.randomUUID + fallback documentado, Regla #15),
  `sqliteEncryption.ts` (P0: SQLCipher vía secure store del plugin, NUNCA
  `@capacitor/preferences`, Regla #16), `deterministicRandom.ts` (Mulberry32
  sólo-tests), `logger.ts`, `haversine.ts`.
- **i18n** (`src/i18n/index.ts`): boot eager de 6 launch locales, lazy-load de 10
  (`fr/de/it/ja/zh-CN/ar/ko/hi/zh-TW/ru`), cadenas de fallback explícitas
  (`pt-BR→en→es`, `zh-TW→zh-CN→en→es`). **Paridad de lanzamiento VERDE**:
  `validate-i18n.cjs` PASS (es:2290 = en:2290; gap pt-BR:59 baselined). Regla #18 OK.
- **eventBus** (`src/store/eventBus.ts`): bus tipado discriminado, API
  zustand-compatible sin agregar dep, snapshot del último evento por tipo.
- **SystemEngineProvider** (`src/contexts/SystemEngineProvider.tsx`): correctamente
  opt-in (early-return si `enabled=false`, `:70`), registra policies idempotente,
  usa refs para leer estado vivo de emergencia (`:123-124`).

## 2. Lo que está PENDIENTE (deuda)

- **🔴 PATRÓN SISTÉMICO — escrituras client-side sin audit_logs (Regla #3).**
  Es el mismo hallazgo de MOC/CPHS, confirmado aquí en la INFRA:
  - `createProjectScopedStore.ts:190-215` (`save`/`patch`) escribe directo a
    `projects/{pid}/<col>/{id}` vía `setDoc`/`updateDoc` desde el cliente — **cero**
    `auditServerEvent`. Lo usan ≥14 stores (auditPortal, changeMgmt/operationalChange,
    exceptions, loneWorker, stoppage, …). El comentario del archivo (`:5-8`) admite
    que centraliza "14 stores client-side".
  - `ProjectContext.createProject` (`:224`) usa `addDoc(collection(db,'projects'))`
    client-side, sin audit log (sí emite analytics, no compliance trail).
  - `UniversalKnowledgeContext.createNode/createEdge` (`:223-242`) y el persist de
    migración (`:155`) escriben `nodes` client-side sin audit.
  - `EmergencyContext.triggerEmergency/resolveEmergency` (`:116,:203`) escriben
    `emergency_events` client-side sin audit (el evento más sensible del sistema).
  - `FirebaseContext` (`:139,:157`) crea `users/{uid}` y seed de `nodes` client-side.
  - `grep` confirma: **0** referencias a `auditServerEvent`/`audit_logs` en
    `src/contexts`, `src/providers`, `src/store`. Toda mutación de estado que pase
    por estos caminos viola el invariante de auditoría. Decidir si es by-design
    (audit lo hace un trigger Firestore server-side) o gap real — **no encontré el
    trigger**; ver §4.
- **⚠️ SystemEngine tenantId no proviene de claim verificado.**
  `AppProviders.tsx:81-82` setea `engineTenantId = window.__GP_TENANT_ID__ || 'default'`,
  pero el JSDoc del prop dice "usually fetched from the verified user claim"
  (`SystemEngineProvider.tsx:42`). Hoy es un global de `window` (spoofeable) con
  fallback `'default'`. Mitigado porque el engine está **OFF por flag**
  (`VITE_SYSTEM_ENGINE_ENABLED`, default false). No bloqueante hasta que se encienda.
- **🟡 Doc-drift en `bcnKnowledgeBase.ts`** (`:41-51`): entrada con `id:"ds-40"` y
  `title:"Decreto Supremo 40"` cuyo `content` describe el DS 44/2024 ("El DS 44/2024
  aprueba…"). El id/título quedaron en DS 40 (derogado) mientras el cuerpo se
  actualizó. Inconsistencia menor de RAG; corregir id/title a DS 44.
- **🟡 ProjectContext.createProject auto-selecciona el primer proyecto** (`:282-284`)
  sin persistir preferencia — comportamiento aceptable pero puede sorprender en
  cuentas multi-proyecto. `isAdmin` query unfiltered (`:266-267`) carga TODOS los
  proyectos (escala/leak potencial en tenants grandes; documentado finding #10).
- **🟡 Locales lazy stub muy parciales** (`ar/de/fr/it: 42 keys`, `ja/ko/hi: 45`,
  `ru/zh-CN/zh-TW: 63` vs es:2290). Por diseño (fuera de Regla #18, cubiertos por
  fallback `→en→es`), pero el usuario que elige `de` verá ~98% de la UI en inglés.
- **🟡 es-AR/MX/PE son override parciales** (126 keys c/u): sólo `app/nav/auth/
  common/pricing/dashboard/errors/time/biometric/emergency/medical`. Correcto
  (fallback a `es`), pero terminología regional limitada.

## 3. Tabla por archivo (TODOS los no-test)

| Archivo | LOC | Estado | Propósito + hallazgo file:line |
|---|---|---|---|
| src/App.tsx | 566 | ✅ | Router + 200+ rutas lazy, route-groups. Code-split agresivo cold-start (`:25-34`). |
| src/main.tsx | 205 | ✅ | Bootstrap; init i18next ANTES de imports de componentes (`:1`). |
| src/constants.ts | 298 | ✅ | Constantes de dominio. Real. |
| src/constants/glossary.ts | 278 | ✅ | Glosario SST. Real. |
| src/contexts/FirebaseContext.tsx | 215 | 🔴 | Auth real + E2E shim gated. Crea users/nodes client-side sin audit (`:139,:157`). |
| src/contexts/ProjectContext.tsx | 338 | 🔴 | `createProject` addDoc client-side sin audit (`:224`); admin query unfiltered (`:266`). |
| src/contexts/SubscriptionContext.tsx | 257 | ✅ | Gating por rank; upgrade vía endpoint que valida pago (`:182`). Regla #11 OK. |
| src/contexts/EmergencyContext.tsx | 236 | 🔴 | Triple-path mesh fallback sólido; escribe emergency_events client-side sin audit (`:116,:203`). |
| src/contexts/SensorContext.tsx | 140 | ✅ | Motion nativo+web, on-device, cleanup OK. |
| src/contexts/SystemEngineProvider.tsx | 185 | ⚠️ | Opt-in (flag OFF); tenantId real lo inyecta AppProviders desde window (ver §4). |
| src/contexts/NormativeContext.tsx | 582 | ✅ | 14 normativas + 5 protocolos CL reales con arts. citados. RAG legal. |
| src/contexts/UniversalKnowledgeContext.tsx | 296 | 🔴 | createNode/createEdge/migration-persist client-side sin audit (`:223-242,:155`). |
| src/contexts/NotificationContext.tsx | 211 | ✅ | onSnapshot users notifs; updateDoc markRead. Real. |
| src/contexts/AppModeContext.tsx | 277 | ✅ | Modo app + emergencyAuto; persiste en localStorage (`:66,:94`). |
| src/contexts/AccessibilityContext.tsx | 211 | ✅ | 4 prefs a11y, localStorage versionado `accessibility-prefs-v1`. |
| src/contexts/ThemeContext.tsx | 123 | ✅ | Theme system/dark + day/night. localStorage. |
| src/contexts/LanguageProvider.tsx | 287 | ✅ | 16 locales, loadLocale lazy, RTL flip, Firestore-user layer. |
| src/index.css | 398 | ✅ | Brand tokens (teal #4db6ac) + a11y classes. |
| src/providers/AppProviders.tsx | 131 | ⚠️ | Orden de providers justificado; tenantId desde window||'default' (`:81-82`). |
| src/providers/MeshProvider.tsx | 131 | ✅ | Mesh relay ADR-0013, montado dentro de Project+Firebase. |
| src/store/eventBus.ts | 185 | ✅ | Bus tipado discriminado, API zustand-compat sin dep. |
| src/lib/apiAuth.ts | 118 | ✅ | Header auth unificado E2E+Bearer (§2.20). |
| src/lib/e2eAuth.ts | 119 | ✅ | E2E gated por `import.meta.env.MODE==='test'`; prod nunca entra (`:36-42`). |
| src/lib/i18n.ts | 26 | 🔵 | Legacy entry, kept for back-compat. Reemplazado por src/i18n. |
| src/lib/sentry.ts | 151 | ✅ | Captura de errores; helper captureEmergencyError. |
| src/types/index.ts | 234 | ✅ | Tipos de dominio. |
| src/types/globals.d.ts | 58 | ✅ | window augmentation (incl. __GP_TENANT_ID__). |
| src/types/organic.ts | 150 | ✅ | Project→Crew→Process→Task estructura orgánica. |
| src/types/roles.ts | 75 | ✅ | Single source of truth de role ids. |
| src/vite-env.d.ts | 13 | ✅ | Vite client types. |
| src/utils/aptitudeCertificate.ts | 203 | ✅ | jsPDF certificado de aptitud. Real. |
| src/utils/biometrics.ts | 99 | ✅ | Helpers biométricos on-device. |
| src/utils/contentModeration.ts | 77 | ✅ | Ley 20.005/20.609. Filtro local. |
| src/utils/deterministicRandom.ts | 129 | ✅ | Mulberry32 PRNG sólo-tests; override de Math.random no-prod. |
| src/utils/ds109Certificate.ts | 529 | ✅ | jsPDF DS 109 calificación EP. Real. |
| src/utils/ds67Certificate.ts | 272 | ✅ | jsPDF DS 67. Real. |
| src/utils/ds67Notification.ts | 425 | ✅ | jsPDF notificación mutual DS 67 (`:1-13`). |
| src/utils/ds76Certificate.ts | 239 | ✅ | jsPDF DS 76. Real. |
| src/utils/ds76MiningContractor.ts | 439 | ✅ | jsPDF DS 76 empresa principal minería. Real. |
| src/utils/haversine.ts | 82 | ✅ | Great-circle puro. |
| src/utils/imageCompression.ts | 103 | ✅ | Compresión imágenes client-side. |
| src/utils/logger.ts | 131 | ✅ | Logger estructurado + request context. |
| src/utils/networkStatus.ts | 25 | ✅ | isOnline helper (mesh fallback). |
| src/utils/nodeTypeUtils.ts | 175 | ✅ | Helpers de NodeType Zettelkasten. |
| src/utils/offlineKnowledge.ts | 126 | ✅ | Conocimiento offline. |
| src/utils/offlineStorage.ts | 351 | ✅ | IndexedDB offline store. |
| src/utils/pricingOcPdf.ts | 281 | ✅ | jsPDF orden de compra pricing. |
| src/utils/pwa-offline.ts | 315 | ✅ | Outbox sync offline (saveForSync usado por ProjectContext). |
| src/utils/randomId.ts | 37 | ✅ | crypto.randomUUID + fallback documentado. Regla #15. |
| src/utils/rut.ts | 81 | ✅ | Modulo-11 SII canónico, puro. |
| src/utils/sqliteEncryption.ts | 77 | 🔑 | SQLCipher vía secure store; nunca preferences. Regla #16. |
| src/utils/susesoCertificate.ts | 347 | ✅ | jsPDF SUSESO. "placeholder" es sólo logo fallback (`:62,:128`). |
| src/utils/trainingCertificate.ts | 112 | ✅ | jsPDF certificado capacitación. |
| src/i18n/index.ts | 189 | ✅ | Boot eager 6 + lazy 10, fallback chains. |
| src/i18n/rtl.ts | 45 | ✅ | RTL helpers (ar/he/fa/ur). |
| src/i18n/locales/es/common.json | 2963 | ✅ | Referencia es-CL, 2290 keys. |
| src/i18n/locales/en/common.json | 2976 | ✅ | Paridad total con es (2290). |
| src/i18n/locales/pt-BR/common.json | 2903 | 🟡 | 2231 keys; gap 59 baselined. |
| src/i18n/locales/es-AR/common.json | 151 | 🟡 | Override parcial 126 keys; fallback es. |
| src/i18n/locales/es-MX/common.json | 151 | 🟡 | Override parcial 126 keys; fallback es. |
| src/i18n/locales/es-PE/common.json | 151 | 🟡 | Override parcial 126 keys; fallback es. |
| src/i18n/locales/{fr,de,it,ar}/common.json | 42 | 🟡 | Stub lazy ~42 keys; fallback →en→es. By design. |
| src/i18n/locales/{ja,ko,hi}/common.json | 45 | 🟡 | Stub lazy ~45 keys; fallback →en→es. |
| src/i18n/locales/{ru,zh-CN,zh-TW}/common.json | 63 | 🟡 | Stub lazy ~63 keys; zh-TW→zh-CN→en→es. |
| src/data/normativa/cl.ts | 136 | ✅ | 12 regs CL con URLs bcn.cl verificables; DS 44/2024 vigente. |
| src/data/normativa/iso.ts | 98 | ✅ | ISO 45001 cláusulas 4-10, URLs iso.org. |
| src/data/normativa/ar.ts | 101 | ✅ | 7 regs AR con URLs. |
| src/data/normativa/br.ts | 120 | ✅ | 9 regs BR (NRs) con URLs. |
| src/data/normativa/co.ts | 98 | ✅ | 7 regs CO con URLs. |
| src/data/normativa/mx.ts | 108 | ✅ | 8 regs MX (NOMs) con URLs. |
| src/data/normativa/pe.ts | 93 | ✅ | 7 regs PE con URLs. |
| src/data/bcnKnowledgeBase.ts | 90 | 🟡 | 5 leyes CL resumidas; id="ds-40" con content DS 44/2024 (`:41-51`). |
| src/data/medical/diagnoses.json | 599 | ✅ | CIE-10 subset SST, CC0, _meta con license/source. |
| src/data/medical/drugs.json | 488 | ✅ | ATC/DrugBank Open Data, CC0, _meta. |
| src/data/medical/anatomy.json | 464 | ✅ | Wikipedia ES CC-BY-SA, _meta, refs DS 594/109. |
| src/data/medical/index.ts | 68 | ✅ | Loader tipado de catálogos médicos. |
| src/data/demoProject.ts | 442 | ✅ | Demo sintético ADR 0011. |
| src/data/industryDemos.ts | 262 | ✅ | Demos por industria. |
| src/data/industryIPER.ts | 938 | ✅ | Matriz IPER por industria. Real, extenso. |
| src/data/epp.ts | 83 | ✅ | Catálogo EPP. |
| src/data/risks.ts | 78 | ✅ | Seeds de riesgos (usados por FirebaseContext seed). |
| src/data/milestones.ts | 126 | ✅ | Hitos/logros. |

## 4. Para decisión del usuario (❓/⚠️)

1. **🔴 ¿Es by-design que contextos y `createProjectScopedStore` escriban
   Firestore client-side sin `auditServerEvent`?** Es el patrón sistémico ya visto
   en MOC/CPHS, ahora confirmado en la infra (factory + 4 contextos críticos +
   FirebaseContext). NO encontré un trigger server-side que rellene `audit_logs`
   para escrituras client-side de subcolecciones de proyecto. Si el modelo es
   "el cliente escribe, un trigger Firestore audita", **falta el trigger** (o no
   está en scope) → gap de cumplimiento Regla #3. Si el modelo es "todo lo
   auditable debe pasar por un endpoint server", entonces estos caminos client-side
   son la deuda a migrar. ❓ Confirmar arquitectura objetivo y priorizar
   `emergency_events` (evento más sensible) + el factory (14 stores) primero.

2. **⚠️ SystemEngine `tenantId`: `window.__GP_TENANT_ID__ || 'default'`**
   (`AppProviders.tsx:81`) contradice el contrato del prop ("verified user claim",
   `SystemEngineProvider.tsx:42`). Hoy spoofeable vía window y con fallback
   `'default'` (riesgo cross-tenant si dos tenants comparten `'default'`). Mitigado
   por flag OFF. ⚠️ ANTES de encender `VITE_SYSTEM_ENGINE_ENABLED` en prod, cablear
   tenantId desde el ID-token claim verificado.

3. **🟡 `bcnKnowledgeBase.ts:41`** entrada `ds-40` con cuerpo DS 44/2024 — corregir
   id/title a DS 44 para coherencia del RAG (el corpus principal en `normativa/cl.ts`
   ya está correcto). Decidir si vale el churn o si `bcnKnowledgeBase.ts` está siendo
   deprecado en favor de `normativa/cl.ts` (ambos coexisten hoy).

4. **🟡 ProjectContext admin query unfiltered** (`:266-267`): un admin carga TODOS
   los `projects`. Aceptable hoy, pero confirmar techo de escala antes de tenants
   grandes (paginación/scoping por org).
