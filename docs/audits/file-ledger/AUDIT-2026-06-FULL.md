# Auditoría integral 2026-06 (Ola A) — todo el código, no solo los 19 bloques

> **Propósito.** Complementa los DEEP-* (auditoría línea-a-línea 2026-06-02) con una
> verificación de **lógica punta-a-punta al estado actual de main** (post-#819):
> ¿el botón llama a un endpoint real? ¿el endpoint persiste y audita? ¿el dato en
> pantalla es verdadero? Incluye las áreas transversales SIN bloque (B19–B24, nuevos).
> Principio rector: **hacer real, no borrar** — huérfano→montar, mock→dato real,
> stub→implementar o gatear honesto, duplicado→consolidar.
>
> Método: barridos automatizados sobre todo `src/` + revisión dirigida por área +
> verificación cruzada con 4 agentes contra los claims de los DEEP-*. Los hallazgos
> nuevos se integran a `PHASE5-REMEDIATION.md`; este archivo es el índice de evidencia.

## A.1 — Barridos automatizados (todo src/, estado 2026-06-10 main@726f994)

### Resultados estructurales (sanos)
- **172/172 páginas** de `src/pages/` referenciadas por algún router — 0 páginas huérfanas.
- **203/203 routers** de `src/server/routes/` montados (en `server.ts` o vía re-mount) — 0 endpoints muertos por des-montaje.

### 🔴 Cliente llamando endpoints que NO existen (roto en producción)
| Llamada | Caller | Veredicto |
|---|---|---|
| `/api/projects/:id/health-check` | `src/components/ProjectHealthCheck.tsx:68` (montado en `Analytics.tsx`) | El endpoint fue **eliminado en Round 14** por muerto + cross-tenant explotable (`server.ts:447-451`). El panel falla siempre. FIX: reintroducir endpoint con `assertProjectMember` (como exige el comentario) y re-cablear. |
| `/api/sprint-k/:pid/visitors/active` | `src/hooks/useActiveVisitors.ts` | Endpoint inexistente; stack de visitas paralelo muerto (`visitorAccessService.ts` + `VisitorCheckInForm`). FIX: consolidar al canónico `visitors.ts` (B11). |
| `/api/cad/upload-url` | `src/services/cad/dwgAdapter.ts` (usado por `dwgDocumentValidator`, `usdzConverter`) | Endpoint inexistente — cadena CAD/BlueprintViewer real (B-DigitalTwin). FIX: implementar el endpoint de upload firmado al cablear BlueprintViewer real. |
| Colección `hallazgos` | `src/components/processes/ProcessDetailModal.tsx:72` (vivo en `CuadrillasDashboard`) | Suscripción a colección SIN regla (`firestore.rules` solo tiene `findings:677`) → default-deny, panel vacío para siempre. FIX: leer `findings` canónico. |

Falsos positivos verificados y descartados: `audit-log` (existe `audit.ts:110`),
`sitebook/:pid/entries` (existe `sitebook.ts:75`), `moc` (operationalChange montado),
`aptitude-cert` (montado `/api/medical`, `server.ts:973`), `hazmat` (mount sprint-k),
`photogrammetry/jobs` y `webauthn/register` y `diat/render` (solo comentarios).

### 🟡 Última milla UI — huérfanos confirmados (0 importadores productivos)
**108 hooks + 146 componentes** (lista completa: `audit-2026-06/orphan-hooks-components.txt`).
Coincide con el patrón §2.33-12 (hooks Sprint-K construidos antes de su UI). Política:
montar por tandas, vida/cumplimiento primero (Ola 4); deprecar solo duplicados con
aprobación. Destacados de vida/legal: `LotoStatusPanel` (B8, vida), `LoneWorkerAdminPanel`/
`LoneWorkerCheckInWidget` (B1), `ConflictResolutionDrawer`+`SyncQueueBadge` (B16),
`ConfidentialReportInbox` (Karin), `StoppageBanner`/`StoppageResumeModal` (B8),
`PinSignModal`, `EvacuationStatusBoard`, `SIFAlert`, `IncidentReportForm`+`InvestigationPanel`+
`PDCAClosePanel` (B4), `HazmatStorageManager`/`HazmatCompatibilityPanel` (B10).

### 🟡 Audit-bypass: escritura Firestore directa desde cliente
**77 archivos** de cliente con `setDoc/addDoc/updateDoc/deleteDoc` sin audit server en el
mismo flujo (+14 mixtos) — inventario completo: `audit-2026-06/client-direct-writers.txt`.
Incluye flujos de estado legal/vida: `ComiteParitario.tsx` (write además DENEGADO por
regla — ver B12), `EmergencyOverlay`, `ManDownSupervisorWidget`, `Workers/*Modal`,
`siteBookStore`, `rootCauseStore` (path sin regla — ver B4), `controlValidationsStore`.
Política Regla #3: re-cablear a endpoints auditados los de estado legal/vida; los de
preferencia personal pueden quedar client-side con regla + trigger de audit.

### 🟡 Colecciones referenciadas en código SIN match en firestore.rules
53 nombres (lista: `audit-2026-06/collections-no-rule.txt`). La mayoría son **server-only
(Admin SDK)** — el default-deny los protege y es intencional; se marcan para documentar en
`security_spec.md`. Riesgo real solo cuando el CLIENTE las usa: `hallazgos` (arriba).
Subcolecciones pueden ser falsos positivos del matcher (verificar antes de tocar).

### Otros barridos
- `Math.random` en server/services no-test: 29 ocurrencias / 8 archivos top (`mesh.ts`,
  `commuteSession.ts`, `syncManager.ts`, `processService.ts`, `crewService.ts`, …) —
  triage Regla #15: IDs → `randomId()`; jitter/simulación legítima → comentario exención.
- `JSON.parse` crudo sobre respuestas IA en server: 7 (migrar a `parseGeminiJson`, F2).
- `mockData/DEMO_/MOCK_` en pages/components: 21 archivos (triage: ¿visible a usuario?).
- `NotImplementedError`: 22 archivos (cotejar contra `docs/stubs-inventory.md`, Regla #13).

## A.2 — Áreas transversales sin bloque (B19–B24, nuevos)

| Bloque nuevo | Alcance | Informe |
|---|---|---|
| **B19-Plataforma** | server.ts core, middleware, jobs (¿quién los agenda?), triggers (¿se inician?), CI workflows, scripts/guards | `audit-2026-06/B19-plataforma-B23-estado.md` |
| **B20-i18n** | paridad es/en/pt-BR, claves muertas, texto hardcodeado fuera de i18n | `audit-2026-06/B20-B22-B24-movil-i18n-corpus-tests.md` |
| **B21-Mobile/Capacitor** | config Android/iOS, permisos, deep links vs praeventio.net, plugin mesh JS↔nativo | ídem |
| **B22-Corpus normativo** | data/normativa real vs placeholder, ingesta RAG, normas citadas sin fuente | ídem |
| **B23-Estado compartido** | contexts/stores/utils, providers huérfanos, migración createProjectScopedStore | `audit-2026-06/B19-plataforma-B23-estado.md` |
| **B24-Calidad tests** | e2e fixme, wire-up contracts, mutation gaps | `audit-2026-06/B20-B22-B24-movil-i18n-corpus-tests.md` |

### Top hallazgos A.2 (verificados 2026-06-10; detalle y file:line en los informes)

**B19-Plataforma 🔴 (4):**
1. **Cero crons corren en producción**: deploy provisiona Cloud Scheduler con OIDC, pero
   `verifySchedulerToken` compara un secret literal que nunca llega y los endpoints de
   climate-scan/weekly-digest/replicate-critical están además gateados por `verifyAuth`
   → 401 en cada tick; `continue-on-error: true` enmascara el fallo.
2. **`runLoneWorkerEscalation` (vida, cada 5 min) no se provisiona en ningún lado**; el
   snippet del runbook usa un header `X-Scheduler-Token` que el middleware no lee.
3. **FCM de incidente crítico roto en móvil**: `backgroundTriggers.ts:213` lee
   `users.fcmToken` singular; el registro escribe `fcmTokens[]`; el helper canónico
   `projectTokens.ts` existe y no se usa.
4. **Triggers/jobs in-process con Cloud Run `min-instances=0`** → los onSnapshot/intervals
   solo viven con tráfico; el "tiempo real" es ilusorio sin instancia caliente.
   🟡: `requireTier` montado solo en oauthGoogle; limiters de cuota IA en MemoryStore
   per-réplica; `systemEngineTrigger` no-op (server no pasa `onEvent`); materializer ZK
   detrás de flag que nadie chequea; CI sin job ESLint; SIGTERM sin `server.close()`.

**B21-Mobile/Capacitor 🔴 (3):**
5. **Mesh nativo muerto en dispositivo**: el BLE real Kotlin/Swift (Sprint 46) existe en
   `packages/capacitor-mesh/` pero el paquete NO es dependencia npm, NO está en
   `android/capacitor.settings.gradle` y no hay proyecto Xcode → `registerPlugin('Mesh')`
   cae al stub web: el SOS offline por mesh no funciona en celulares.
6. **AndroidManifest sin permisos clave**: faltan ACCESS_FINE/COARSE_LOCATION, CAMERA y
   BLE → GPS del SOS, escáner QR y biometría muertos en APK (`AndroidManifest.xml:66-90`).
7. **`capacitor.settings.gradle` stale**: el plugin FGS (lone-worker foreground service) y
   capgo-proximity no están incluidos; el `<service>` declarado referencia una clase
   ausente del APK.
   🟡: deep links/App Links en `praeventio.app` vs WebAuthn/correos en
   `app.praeventio.net`; AASA con `TEAMID` placeholder. (✅ `allowBackup=false`.)

**B20-i18n 🔴 (1):** ~3.150 de 5.155 claves `t()` usadas no existen en `common.json`
(2.745 con default inline en español) → usuarios en/pt-BR ven español; el gate de paridad
es ciego a claves no declaradas y su baseline cubre claves de vida (`incident_report.*`,
`lone_worker.*`). (✅ tono tuteo consistente.)

**B22-Corpus normativo 🟡:** RAG efectivo = ~17 chunks bag-of-words; índice vectorial sin
pipeline de ingesta (siempre fallback); el corpus omite DS 132 (citado 124 veces en
código), DS 76/67/148, Ley 19.628 y todas las NCh; "Legal Monitor" re-analiza 5 resúmenes
estáticos. (✅ referencias BCN del corpus CL existente son verídicas.)

**B23-Estado compartido 🟡:** 5 contexts escriben Firestore sin audit (Regla #3); doble
registro FCM divergente (`fcmToken` vs `fcmTokens[]`); DOS event-buses duplicados con 0
consumidores; factory `createProjectScopedStore` escribe sin audit.
(✅ verifyAuth/idempotencia/cifrados/guards husky verificados reales.)

**B24-Tests 🟡:** e2e de SOS/offline/lifecycle en `describe.fixme` (nunca corren);
105/160 tests de rutas son wire-up-only y 68 dominios sin supertest; Stryker no muta 5
motores incl. `ergonomicLegalTrigger.ts`.

## Hallazgos mayores de la verificación cruzada de bloques (2026-06-10)

Confirmados contra código (detalle en informes de bloque y PHASE5-REMEDIATION.md):
1. 🔴 **B9 SiteBook: 3 esquemas de almacenamiento disjuntos** — cliente `projects/{pid}/site_book`
   (`siteBookStore.ts:6`), adapter server `tenants/{tid}/projects/{pid}/sitebook_entries`
   (`siteBookFirestoreAdapter.ts:78`), firma `projects/{pid}/site_book_entries`
   (`sitebookSignRoutes.ts:94`) → la firma WebAuthn nunca encuentra la entrada creada.
2. 🔴 **B17 `documents_for_read`**: regla exige `authorUid` (`firestore.rules:456`) que el tipo
   no tiene ni la factory estampa (`readReceiptService.ts:34`, `createProjectScopedStore.ts:197`)
   → save() cliente siempre denegado.
3. 🔴 **B12 `comite_actas`**: `ComiteParitario.tsx:73,111` escribe, la regla solo concede read
   (`firestore.rules:630`) → PERMISSION_DENIED; consolidar en `CphsModule` server-side.
4. 🔴 **B13 MOC**: `OperationalChanges.tsx:169-285` escribe vía store cliente saltando la ruta
   auditada → sin audit_logs (ISO 45001); `shiftHandover.ts:30` compute-only sin persistir.
5. 🔴 **B4/ZK PDCA sin aristas**: `incidentFlow.ts:77-84` nunca inyecta `createEdge` → el grafo
   incidente→lección→capacitación queda desconectado (promesa Zettelkasten).
6. 🔴 **B17 External Audit Portal sin gate de rol** (`externalAuditPortal.ts:234,355,428`).
7. 🔴 **B5/B15 `mark-paid`**: ni emite DTE ni activa `users/{uid}.subscription` (`billing.ts:671`).
8. 🔴 **ZK ingesta**: `KnowledgeIngestion.tsx:54-64` nodos `global`/`isMasterNode` sin gate de rol;
   `ragService.queryCommunityKnowledge` sin umbral de score (self-poisoning).
9. 🔴 **B14 SLM**: `SLM_OFFLINE_ENABLED=false`, Phi-3/Gemma a CDN runtime (~2.7 GB) — la promesa
   "IA embebida sin depender de cuotas" no se cumple aún.
10. 🔴 **F4 nativo**: `useBiometricAuth.ts:249` login biométrico nativo retorna true sin
    `/challenge`+`/verify` server.

Y desactualizaciones de DEEP-* verificadas (ya RESUELTAS en main, marcar en tracker):
`visitors.ts` membership (4 endpoints), LOTO write-path completo (`loto.ts` 5 endpoints),
CPHS rules-tests (`cphsMeetings.rules.test.ts`, `comiteActas.rules.test.ts`),
`networkBackend.ts` membership-gate (canonicalización + `assertProjectMember`).

## Ejecución
El orden de remediación vive en `PHASE5-REMEDIATION.md` + plan de sesión (olas:
roto-en-prod → auditoría/legal → promesas de producto → última milla UI → limpieza).
Regla de oro por PR: verificar el ítem en código ANTES de tocar (este ledger fecha
2026-06-10; el código se mueve rápido).
