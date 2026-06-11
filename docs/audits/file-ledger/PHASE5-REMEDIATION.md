# Fase 5: Remediación de deuda técnica de Praeventio Guard (checklist por bloque)

> **Roadmap durable de ejecución.** Sintetiza la auditoría exhaustiva (cada
> archivo del repo leído línea por línea) en un plan accionable, un PR por
> bloque, vida/privacidad primero. Verdad de referencia: `TODO.md`
> §2.32/§2.33/§2.34 + los `DEEP-*.md` de este mismo directorio.

## Progreso ejecutado (actualizado 2026-06-10)

### Aristas de integración (diseño 2026-06-10, verificadas contra código)

Dos capas de conexiones entre módulos que YA existen — el mayor activo no son features
nuevas sino aristas nuevas. Estado verificado por grep/lectura el 2026-06-10:

**Capa 1 — operación interna:**
- [x] ✅ **A1 Clima→Permisos ✅: viento verificado server-side en `validate-critical`.**
  Antes, `windSpeedMps` venía exclusivamente del body del cliente, dejando decorativos los
  umbrales DS 132 / ISO 12480 (11/15 m/s) de `criticalPermitValidators.ts:99-100` ante un
  solicitante que sub-declara. Ahora, para kinds sensibles al viento (`izaje_critico` —
  `src/server/routes/workPermits.ts:373`), el endpoint lee `projects/{id}.geo`
  (`workPermits.ts:379-401`), resuelve un viento independiente vía
  `environmentBackend.getForecast` con deadline duro de 3 s (`workPermits.ts:435-447`;
  Promise.race en `weatherGate.ts:106-124` — jamás cuelga el endpoint) y valida con
  `effective = max(declarado, server)` (`src/services/workPermits/weatherGate.ts:126-160`).
  Sub-declaración ≥2 m/s bajo el server → issue advisory `WIND_CLIENT_UNDERREPORTED`
  (`workPermits.ts:483-499`); server caído → nota es-CL "No fue posible verificar el viento
  de forma independiente…" (`weatherGate.ts:67-68`). Respuesta expone
  `weatherVerification:{source,serverWindMps,discrepancy,note?}` (`workPermits.ts:430,503-506`).
  Sin geo o kind sin viento → comportamiento previo intacto. NOTA de verdad-de-código: el
  proveedor real de `getForecast` es **OpenWeather** (`environmentBackend.ts:420`), no
  Open-Meteo como decía el contexto — `source:'openweather'`. Endpoint sigue read-only
  (sin audit_log; create/sign/close siguen siendo los eventos auditados). Tests: 15 unit
  (`weatherGate.test.ts`) + 6 supertest router real
  (`src/__tests__/server/workPermits.weatherVerification.test.ts`), suites previas de
  workPermits verdes (193 tests).
- [ ] **A2 Fatiga→Pre-turno→Asignación**: `preShiftRisk.ts:210` ya lee fatigueRisk; falta el
  soft-block de asignación a maquinaria/conducción.
- [ ] **A3 Vencimientos→Hallazgos automáticos**: `checkExpiredPpe.ts` notifica FCM y marca
  expired pero NO crea finding con acción correctiva; replicar para recursos de brigada.
- [~] **A4 Capacitación→Firma de permisos**: el motor YA exige training del kind
  (`workPermitEngine.ts:257,327`); falta que lea el currículum portable como fuente.
- [ ] **A5 Lesión corporal repetida→evaluación REBA/RULA gatillada**: no existe.
- [ ] **A6 Handover→Pre-turno**: anotación severa del turno saliente como fuente del panel
  entrante — no conectado.
- [ ] **A7 MOC aprobado→re-IPER→charla del cambio**: no conectado.
- [~] **A8 Cierre→Semillas del siguiente proyecto**: lecciones de cierre YA persisten
  (`projectClosure.ts` closure/lessons + LessonsAdapter); la precarga al próximo proyecto = slice 3
  de la épica Rubros SII (mismo mecanismo).

**Capa 3 — sensores, patrones y mundo físico (verificada 2026-06-10):**
- [x] 🛟 **A2 sensorBus cableado + regla anti-falso-positivo man-down ✅** (2026-06-11,
  TODO.md §16.2.1). El bus existía pero ningún hook de sensor publicaba; ahora la cadena
  vida está cableada. Motor PURO (regla #9, mutation-ready)
  `src/services/sensorBus/manDownCorrelation.ts:147` `evaluateManDownEvidence(events, now)`:
  impacto solo → `suspect` (countdown normal 10s); impacto+inmovilidad → `suspect` con razón
  extra; impacto+inmovilidad+(BLE off | batería crítica) → `critical` → countdown reducido a
  5s (`MANDOWN_COUNTDOWN_CRITICAL_S`, `manDownCorrelation.ts:80`; ventanas: impacto/inmovilidad
  60s, BLE 120s, batería 300s; la lectura MÁS RECIENTE por kind manda — una reconexión limpia
  el dropout). Publicadores (callbacks existentes, cero listeners de hardware nuevos, vía
  `publishSensorEvent` no-throwing `src/services/sensorBus/publishSensorEvent.ts:33`):
  impacto `FallDetectionMonitor.tsx:80`; inmovilidad sostenida
  `useManDownDetection.ts:414`; BLE peer-visto/scan-vacío/scan-error
  `useBluetoothMesh.ts:39,120,155` (sentinel `LOCAL_DEVICE_UID` — sin auth context,
  `manDownCorrelation.ts:36`); GPS `useGeolocationTracking.ts:103`; batería
  `useManDownDetection.ts:170-211` (seed al armar + republish c/4min, severity desde
  `batteryAdvisor.mode`). Consumo: `useManDownDetection.ts:430-450` evalúa al levantar la
  alerta y modula SOLO el countdown — sin evidencia extra el flujo default queda intacto
  (test de no-regresión pinned). 27 tests motor + 6 hook-correlación + 4 BLE + 2 GPS +
  1 FallDetectionMonitor + 5 publish-bridge; suites previas de man-down/emergency verdes.
- [ ] 🛟 **C1 Asistencia→Tablero de evacuación**: `Attendance.tsx` existe y el headcount de
  evacuación también — desconectados. Conectados = lista NOMINAL en tiempo real de quién falta
  en el punto de encuentro (los minutos que definen un rescate). La más valiosa de la capa.
- [ ] **C2 Excepciones repetidas→MOC**: 3 desviaciones sobre el mismo procedimiento = procedimiento
  mal diseñado; `runConsistencyAudit` debería detectar el patrón y gatillar gestión del cambio.
- [ ] 🛟 **C3 Telemetría→bloqueo operacional**: el ingest HMAC existe; lectura de gas sobre umbral
  en zona → soft-block automático de permisos de espacio confinado de esa zona + alerta. El
  sensor hoy informa; conectado, detiene.
- [ ] **C4 OCR→Zettelkasten/Hazmat**: `DocumentOCRManager` existe; apuntarlo a HDS de químicos /
  certificados / mantenciones → nodos estructurados → HazmatStorageDesigner con
  incompatibilidades reales. El papel legado entra al grafo por la cámara.
- [ ] 🛟 **C5 Trabajo solitario→Refugios/DEA**: el escalamiento ya dispara con última ubicación;
  falta adjuntar la ruta al refugio/DEA más cercano a ese punto (datos que ya existen).
- [ ] **C6 SunTracker→Pre-turno**: elevación solar/fase lunar ya se calculan (SunCalc); como
  fuente del pre-turno (altura al atardecer con sol de frente, nocturno en luna nueva sin
  iluminación verificada). Diferenciador: nadie considera luz natural.
- [ ] **C7 Cierre de proyecto→Ranking de proveedores**: lecciones de cierre y ranking
  (`supplierQualityService.ts`) existen separados; el desempeño de seguridad del proveedor en el
  proyecto cerrado debería alimentar su ranking histórico automáticamente.

**Capa 2 — actores externos y negocio:**
- [ ] 💰 **B1 Incidentes→Siniestralidad→Simulador cotización adicional DS 67**: NO existe (lo que
  hay en `ds67ds76.ts` son formularios PDF). El DS 67 ya está en el pack (cl-ds-67). Argumento de
  venta nº1: proyectar "con esta tendencia tu cotización sube X% = $Y/año". ÉPICA prioritaria.
- [ ] **B2 Incidente→DIAT prellenada→reloj legal**: generación DIAT existe
  (`susesoCertificate.ts`) pero sin cadena auto-prellenada desde el incidente ni gatillo del
  recordatorio de plazo en el calendario legal.
- [ ] **B3 Portal del mandante→KPIs de contratistas DS 76**: los portales de auditor con
  audiencias existen (`auditPortal/`); falta la audiencia "mandante" con indicadores de SUS
  contratistas. Adopción en cascada minera→contratistas.
- [ ] **B4 Paralización justificada→reconocimiento+XP**: no existe; efecto cultural alto, costo bajo.
- [ ] **B5 Trabajador nuevo→inducción personalizada**: no existe (riesgos repetidos de la faena +
  lecciones + currículum portable → ruta de inducción específica).
- [ ] **B6 QR físico en equipo→inspección viva**: no existe (escaneo = inspección con
  fecha/usuario/geo → inventario brigada; no-escaneado-en-N-días → hallazgo, encadena con A3).
- [ ] **B7 Indicadores líderes compuestos→índice predictivo por proyecto**: no existe (componer
  pulso de cultura + observaciones + ratio near-miss + tasa de cierre; insignia del tier-3).


### Sesión 2026-06-10 — Ola A: auditoría integral de TODO el código (PR #820)

Verificación de lógica punta-a-punta al estado main@#819, cubriendo también las áreas SIN
bloque (nuevos **B19-Plataforma, B20-i18n, B21-Mobile/Capacitor, B22-Corpus normativo,
B23-Estado compartido, B24-Calidad tests**). Evidencia: `AUDIT-2026-06-FULL.md` +
`audit-2026-06/*`. Dos correcciones de drift y un lote de hallazgos nuevos:

**Drift corregido (estaba "pendiente" pero YA RESUELTO en main — no re-trabajar):**
- B11 `visitors.ts` membership: `assertMemberAndResolveTenant:98-118` aplicado en los 4 endpoints (#711).
- B8 LOTO write-path completo: `loto.ts` create/apply-lock/verify-zero-energy/release (verificado).
- B12 rules-tests CPHS existen: `cphsMeetings.rules.test.ts` + `comiteActas.rules.test.ts` (2026-06-09).
- B14 `networkBackend.ts` gate: canonicalización projectId + `assertProjectMember` (#679).

**INCIDENTE descubierto y resuelto en esta sesión (no estaba en ningún informe):**
- [x] 🔴🛟 **PRODUCTION-DOWN desde 2026-06-08**: #767 metió `useProject()` (throwing) en
  `OfflineSyncManager`, montado en App() FUERA de AppProviders → throw en cada boot → el
  ErrorBoundary raíz tragaba la SPA entera: **todo visitante veía "Sistema Interrumpido"**.
  El e2e de landing estaba rojo sólido desde el run #1192 y se leía como "flaky". ✅ Resuelto
  (PR #820): `useProjectOptional()` no-throwing + regression test render-sin-provider +
  verificación Playwright local 9/9. LECCIÓN para B24: e2e rojo ≠ flaky; el bisect de runs
  (último verde → primer rojo) encontró el commit en minutos.

**Hallazgos NUEVOS 🔴 (no estaban en este tracker; orden = prioridad de remediación):**
- [x] 🔴🛟 ~~**B19: cero crons en prod**~~ → ✅ **hecho** (PR #820): `verifySchedulerToken`
  ahora acepta el token OIDC de Google del SA pin (`SCHEDULER_SERVICE_ACCOUNT`, match
  exacto de `email` = anti-spoof) **o** el shared secret; `replicate-critical`/`weekly-digest`/
  `climate-scan` pasan de `verifyAuth` puro a `verifySchedulerOrFallback(verifyAuth)` +
  `resolveCronActor` (máquina audita `cloud-scheduler`, humano mantiene admin-check).
  +OIDC tests (accept SA pin, reject SA ajeno/firma/aud/email-no-verif). `continue-on-error`
  se mantiene a propósito (la SA de deploy no puede provisionar Scheduler; el enmascarado
  nunca fue la causa — lo era la auth).
- [x] 🔴🛟 ~~**B19: `runLoneWorkerEscalation` jamás provisionado**~~ → ✅ **hecho** (PR #820):
  cron `lone-worker-escalation` `*/5` añadido a deploy.yml apuntando a
  `/api/maintenance/run-lone-worker-escalation` (ya OIDC-gated por el fix de arriba).
- [x] 🔴🛟 ~~**B19/B23: FCM crítico roto en móvil**~~ → ✅ **hecho** (PR #820): el trigger une
  `users.fcmTokens[]` (canónico, multi-device) + `fcmToken` legacy con dedupe; test pin con
  usuario solo-array y usuario con ambos campos. (Quirúrgico en el trigger para preservar el
  fallback de email user-doc, que el helper canónico obtiene de otra fuente.)
- [x] 🔴🛟 ~~**B21: mesh nativo fuera del build**~~ → ✅ **hecho** (PR #820):
  `@praeventio/capacitor-mesh` como dep `file:`, `cap update android` regeneró
  settings/build.gradle (12 plugins, mesh apunta a `../packages/capacitor-mesh/android`).
  **Pendiente iOS**: crear Xcode project/pod para el plugin (sub-ítem abajo).
- [x] 🔴🛟 ~~**B21: AndroidManifest sin permisos**~~ → ✅ **hecho** (PR #820): declarados
  ACCESS_FINE/COARSE_LOCATION + CAMERA en el manifest de la app; BLE llega por merger desde
  el manifest del plugin mesh (ahora en el build). Test `androidBuildWiring.test.ts` (16 casos)
  fija permisos + includes gradle + allowBackup=false + acople clase FGS↔gradle.
- [x] 🔴🛟 ~~**B21: `capacitor.settings.gradle` stale**~~ → ✅ **hecho** (PR #820): FGS
  lone-worker + capgo-proximity incluidos; la clase del `<service>` ahora compila en el APK.
- [ ] 🟡 **B21-iOS: mesh pod sin proyecto Xcode** — `packages/capacitor-mesh/ios` tiene Swift
  pero no hay `.podspec` integrado al workspace iOS. FIX: generar pod + `cap update ios` (en Mac).
- [x] 🔴 ~~**B19: triggers/jobs in-process × Cloud Run min-instances=0**~~ → ✅ **hecho**
  (PR #820): `--min-instances=1 --no-cpu-throttling` con nota de costo (~USD 10-15/mes) —
  el precio de que los listeners vida-críticos realmente escuchen.
- [x] 🔴 ~~**A.1: `ProjectHealthCheck.tsx:68`** endpoint eliminado~~ → ✅ **hecho** (PR #820):
  `src/server/routes/projectHealth.ts` con verifyAuth + assertProjectMember (el exploit del
  Round 14 queda pin con test 403), contexto normativo desde country pack, cachea
  `health_checks/latest`, audita con auditServerEvent; 502 sin cache si la IA falla.
- [x] 🔴 ~~**A.1: `ProcessDetailModal.tsx:72`** colección `hallazgos` sin regla~~ → ✅ **hecho**
  (PR #820): lee `projects/{pid}/findings` (canónica); también `wisdomCapsule.ts` que leía el
  mismo path muerto server-side (la cápsula siempre resumía 0 hallazgos — test pin sourceNodes).
  QUEDA 🟡: fragmentación residual — weeklyDigest lee `tenants/{tid}/findings` e insights lee
  `findings` top-level; cada path tiene escritor propio → decisión de migración, no re-point ciego.
- [x] 🔴🛟 **A3 conflictQueue en sync path ✅** (2026-06-11, rama `claude/sync-conflict-queue-wire`):
  el motor §16.2.2 existía completo (engine `src/services/sync/conflictQueue.ts` + resolver +
  router `/api/sprint-k` `src/server/routes/conflictQueue.ts` + productor parcial en
  `OfflineSyncManager.tsx:115-149`) pero `matrixSyncManager.flush()` subía el batch SIN comparar
  contra el remoto → dos ediciones offline del mismo incidente = una se perdía en silencio
  (last-write-wins). Ahora: set canónico de 5 doc-types
  (`src/services/sync/safetyCriticalDocTypes.ts:35` `SAFETY_CRITICAL_DOC_TYPES`); pre-flush guard
  `checkSafetyCriticalConflict` (`src/services/syncManager.ts:311` — `getDoc` remoto +
  `detectConflicts`, el MISMO detector que usa OfflineSyncManager) y desvío
  `divertToConflictQueue` (`src/services/syncManager.ts:385`): marca la op local `conflict`
  (retenida, jamás re-flush — espejo del patrón `deadLettered` de `syncStateMachine.ts`), emite
  `sync-critical-conflict` (drawer in-session) y POST best-effort autenticado al enqueue del
  server (que estampa identidad + escribe audit_logs). Resolución humana limpia la op retenida
  (listener `sync-critical-conflict-resolved`, `syncManager.ts:79`) o `restoreServerVersion`.
  Remoto ilegible → defer (nunca blind-write); doc-types no críticos → cero lecturas remotas,
  comportamiento previo intacto. Tests TDD: 5 (`src/services/syncManager.conflict.test.ts`,
  syncManager REAL con Firestore/fetch mockeados) + 6 (`safetyCriticalDocTypes.test.ts`);
  regresión verde: syncManager 5, sync/* + OfflineSyncManager 106, conflictQueueRoute 12.
- [x] 🔴 ~~**B9: SiteBook esquemas disjuntos (cliente vs firma)**~~ → ✅ **hecho** (PR #820):
  `SITE_BOOK_COLLECTION = 'site_book_entries'` en el servicio puro, importado por el store
  cliente Y las rutas de firma (acople por código). QUEDA 🟡: el adapter CRDT
  `tenants/{tid}/projects/{pid}/sitebook_entries` (GET /api/sitebook usado por useInsights)
  es una tercera isla → decisión de migración.
- [x] 🔴 ~~**B17: `documents_for_read` regla↔schema**~~ → ✅ **hecho** (PR #820):
  `buildDocumentForRead()` puro estampa `authorUid` + id `randomId()` (regla #15, antes
  Math.random) + clamp [1,90]; DocumentReadConfirm lo usa y exige sesión.
- [x] 🔴 ~~**B12: `comite_actas` write denegado**~~ → **DRIFT, ya resuelto en main**: la regla
  actual (firestore.rules:665) permite create/update member-gated con `isValidComiteActa` +
  createdAt/fecha inmutables; rules-tests `comiteActas.rules.test.ts` (2026-06-09). El shape
  del cliente coincide con el validador. No re-trabajar.
- [x] 🔴 ~~**B17: External Audit Portal sin gate de rol**~~ → **DRIFT, ya resuelto en main**:
  `assertAdminCaller` aplicado en las 4 rutas admin (externalAuditPortal.ts:270,342,394,467).
- [x] 🔴 ~~**B4/ZK: PDCA sin aristas**~~ → **DRIFT, ya resuelto en main**: `flowDepsFor`
  (incidentFlow.ts:80-95) inyecta `createEdge` con el edge-store Firestore real (fix #650 R2).
- [~] 🔴 **B20: i18n bypaseado a escala** — ~3.151/5.155 claves `t()` no existen en `common.json`.
  ✅ **Mitigado** (PR #820): `validate-i18n.cjs` ahora escanea las claves literales usadas en src
  y ratchetea las no-declaradas (`usedUndeclared` en el baseline, 3.151 sembradas — solo puede
  encoger; código nuevo con clave sin declarar FALLA husky + vitest gate). **PENDIENTE**: codemod
  que genere las claves es desde los defaults inline + traducción en/pt-BR por lotes (bajar el
  baseline a 0 por módulos, vida-seguridad primero: incident_report.*, lone_worker.*).
- [~] 🟡 **B22: corpus normativo incompleto** → ✅ **parcial** (PR #820): DS 132 (Seguridad
  Minera), DS 76 (66 bis), DS 67 (cotización adicional), DS 148 (residuos peligrosos) y
  Ley 19.628 (datos personales) incorporados al CL pack con URLs **verificadas contra BCN**
  (idNorma 221064/257601/159800/226458/141599) + sembrados al corpus RAG con dominios; id
  muerto `cl-ds-40` del mapeo → `cl-ds-44`. **PENDIENTE**: pipeline de ingesta de texto
  completo BCN→chunks (hoy 1 chunk overview por norma) + NCh + índice Pinecone.
- [x] 🟡 ~~**B19: systemEngineTrigger no-op / SIGTERM sin drain / CI sin lint**~~ → ✅ **hecho**
  (PR #820): `makeSystemEventAuditor` (1 fila audit_logs idempotente por system event, Phase 1
  prometida por el header); `gracefulShutdown()` con `server.close()` + budget 8s (antes
  process.exit inmediato mataba requests en cada rollover); job `lint` en ci.yml (errors-gate)
  con el repo llevado a **0 errores eslint** — el barrido encontró que
  `tests/dr/seed-dr-dataset.cjs` NI PARSEABA (`0xdr…` hex inválido → el DR dry-run no podía
  sembrar datos). `npm run lint` reparado (--cache incompatible con el parser firestore).
- [ ] 🟡 **B23: doble event-bus sin consumidores**; 5 contexts sin audit; factory
  `createProjectScopedStore` escribe sin audit (Regla #3) → trigger server o re-cablear.
- [ ] 🟡 **Informe externo 2026-06-10 (ver `docs/audits/AUDITORIA-EXTERNA-2026-06-REVISION.md`):**
  (a) barrido de copy UI/prompts que cite DS 54 como norma VIGENTE (DS 44/2024 derogó DS 40 y
  DS 54 desde 01-02-2025; README y pack CL ya corregidos); (b) **Ley 21.719** (plena vigencia
  2026-12-01): DPIA biometría+geolocalización, registro de actividades de tratamiento,
  notificación de brechas 72h, derechos ARCO+portabilidad — la base técnica existe (bóveda,
  default-deny, audit inmutable, on-device #12), falta el artefacto formal; (c) elevar a ADR la
  directiva "nunca push a APIs externas" (SISESAT/CUN queda como decisión consciente y
  reversible, hoy vive en comentarios de incidentFlow.ts).
  ✅ **Avance 2026-06-10 — gap P0 G-8 (ARCO) cerrado**: `processDataAccessRequest` y
  `eraseUserData` (ley19628.ts) eran código real sin NINGÚN endpoint que los invocara
  (solicitudes de acceso/borrado quedaban `pending` para siempre). Cableados a rutas admin
  con rol re-leído de Firebase Auth: `POST /api/compliance/admin/data-request/:id/process`
  (`src/server/routes/compliance.ts:390`) y `POST .../:id/erase`
  (`src/server/routes/compliance.ts:440` — destructivo: `{ confirm: requestId }` obligatorio,
  `keepLegalRecords: true` fijo, audit antes/después `arco_erasure_started`/
  `arco_erasure_executed`). TDD con funciones reales:
  `src/__tests__/server/complianceArco.test.ts` (14 casos). Detalle en
  `docs/compliance/LEY-21719-ROADMAP.md` §6 (G-8). Quedan G-9 (job plazo 30 días) y el
  resto del roadmap.
- [ ] 🟡 **A.1: inventario última milla** — 108 hooks + 146 componentes huérfanos
  (`audit-2026-06/orphan-hooks-components.txt`); 77 escritores Firestore client-side sin audit
  (`client-direct-writers.txt`); 53 colecciones sin regla (mayoría server-only — documentar).

(Los demás hallazgos por bloque de la verificación 2026-06-10 — mark-paid sin DTE/tier,
KnowledgeIngestion sin gate, score-gate RAG, SLM no embebido, biometría nativa, exceptions
anti-spoof, stoppage/shiftHandover compute-only, etc. — ya tienen ítem en sus secciones B*
de este tracker; ver además `AUDIT-2026-06-FULL.md` §"Hallazgos mayores".)

### Sesión 2026-06-08 — 33 PRs fusionados (#751–#784) + reconciliación del tracker

Olas de vida-primero, privacidad y cimientos. **Verificado contra el código** (no solo
títulos de PR) y marcado ítem por ítem con prueba `file:line` más abajo:
- **Cimientos:** F2 codemod parseGeminiJson (parser canónico `gemini/_shared.ts:55`; #769/#772/#784 —
  PARCIAL, 5 callsites crudos restantes), F4 verify WebAuthn (DTE #765, referee honest-label #766, Login web #775 — PARCIAL, nativo pendiente).
- **Vida (🛟):** ManDown push #671, EmergencySquadManager roster real #672, DynamicEvacuationMap A* #673,
  pings #662, deas/inspections #661, declare-emergency #660, DEA público sin-login #756/#757/#758, TriageBeacon #752/#754.
- **Salud/ADR 0012:** VitalityMonitor reconvertido #668, Medicine tríada #674/#676/#677, medical-guard scope #670/#773,
  clinical_alerts #669, health_vault reglas #762 + revocación de archivo #780, VigilanciaScheduler exámenes reales #763 (Hygiene métricas aún hardcoded).
- **Privacidad:** RUT-ZK gate #776, worker documents #770, comite_actas #760, cphs append-only #774 (Case B; Case A pendiente),
  SUSESO Drive honesto #764, RUT fabricado DIAT/DIEP #759, custody ids #778, crypto ids #779, mesh signing #768, offline AES-256-GCM #761.
- **Cross-cutting:** iOS mesh CBUUID #777, DR replication #735, voseo es-CL #736, Pizarra 4-mode tokens #781.

> **Honestidad:** las marcas `[~]` son PARCIALES reales (parte hecha + parte abierta documentada),
> y `🔵 BLOCKED:` señala lo que NO es accionable hasta una decisión de producto/datos.

### Sesión 2026-06-06 — B17 (cerrado) + B5 + B4 (10 PRs fusionados)

**B17 Admin/Auth/RBAC/Privacidad 🔐 — bloque CERRADO (los ítems server-side/comp;
quedan solo sub-ítems de reglas que requieren emulador):**
- #700 `projects.ts` membresía **por-proyecto** (helpers `callerCanManageProject`/
  `callerIsProjectMember`) — cierra IDOR donde un claim global `gerente/admin`
  gestionaba TODOS los proyectos.
- #701 `WebAuthnKeysSection` **read-only** (sin self-delete) + lista real vía
  `GET /api/auth/webauthn/credentials` (la UI leía una subcolección fantasma).
- #702 `lone_worker_sessions/events` update exige dueño-o-rescatista (otro miembro
  ya no puede flipar a "safe" una sesión ajena). [parte del lote Reglas #650]
- #703 `webauthnAssertion.ts` cierra bypass de detección de **clon** (counter 0).
- #704 **recuperación admin-asistida** de llaves WebAuthn (`POST /api/admin/webauthn/revoke`),
  honra la directriz anti-robo (no self-delete; un teléfono robado desbloqueado pasa step-up).
- #705 `pinSign` credencial **server-side** (`pin_credentials/{tid}__{uid}`) — antes el
  cliente mandaba el hash/contador → forjable; verify/sign-item en `runTransaction`.
- #706 OAuth refresh_token **envelope default-ON** (cifrado salvo opt-out) + degradación
  elegante si el KMS no está disponible.

**B5 Cumplimiento & SUSESO 🔐:**
- #707 `suseso.ts` + #708 `ds67ds76.ts` `tenantId` **autoritativo desde el token**
  (helper compartido `src/server/auth/callerTenant.ts`) — antes un user del tenant A
  creaba/firmaba DIAT/DIEP/DS67/DS76 del tenant B (cross-tenant en datos legales).
- **#809 `eppFlow.ts` (4 handlers) + `iot.ts /devices/register` ✅:** misma familia
  IDOR cross-tenant, VIVOS en prod. eppFlow tomaba `tenantId` del body/query → ahora
  `callerTenantOr403` (token autoritativo). iot derivaba el tenant del proyecto pero
  sin atar al caller → ahora `assertProjectMember` (un admin del tenant A no registra
  device en proyecto del tenant B). +supertest real-router cross-tenant (eppFlow 21,
  nuevo `iotDeviceRegister.test.ts` 5 — reemplaza el parallel-app prohibido).

**🔵 Reglas faltantes (default-deny UI) ✅ #810:** `slo_metrics/{id}/daily`
(admin/supervisor read, server write), `projects/{pid}/training_capsules`,
`projects/{pid}/calendar_events` (member) + `calendar_events` top-level
(projectId-gated, digital-twin lifecycle), `users/{uid}/focus_blocks` (owner),
`users/{uid}/awards` (owner read, server write, no auto-medalla) → 30 rules-tests F1
+ Dirty-Dozen #78–#83. PENDIENTE: rewire `hallazgos`→`projects/{pid}/findings`
(`ProcessDetailModal`) en PR aparte (necesita plumbing de projectId).

**B4 Incidentes 🛟:**
- #709 `sif.ts` revisión ejecutiva SIF estampa `reviewedByUid`/`reviewedAt` desde
  token+reloj server (no del body) — no se puede atribuir/antedatar una revisión de
  lesión grave/fatal.

PENDIENTE B17 (sub-bloque reglas, requiere emulador): `site_book_counters`,
`root_cause_analyses` vs regla, laxitud `exceptions/legal_obligations/shifts`,
`WebAuthnKeysSection` recuperación self-service (futuro). Cada cambio: TDD real,
typecheck/lint 0, audit_logs donde aplica; helper `callerTenant` reutilizable.

### Sesión previa (actualizado 2026-06-04)

**Cimientos compartidos:** F1 harness rules-tests ✅ #657 · F2 parseGeminiJson ✅ #658 ·
F5-p1 governance ✅ #659 · **F3 identidad-desde-token ✅ #678** (`IDENTITY_STAMPED_ACTIONS`
estampa `req.user.uid` sobre `authorUid` antes del spread; + hardening args no-array/payload).
**F4 = bloque grande PENDIENTE** (firma = huella WebAuthn universal; la infra está completa
—verifier + challenge/credential store + helper cliente `webauthnComplianceSign`—; los gaps son
por-consumidor: CPHS (client-side, B12+F4), co-firmas currículum, medical-aptitude. Cada uno es
refactor cliente+server, alto riesgo → con foco fresco + `/cso-praeventio`).

**B1 Emergencia 🛟:** sosOutbox dead-letter + routing hazard-clearing ✅ #656 · ManDown push ✅ #671 ·
**EmergencySquadManager roster real ✅ #672** · **DynamicEvacuationMap → A\* real ✅ #673** (core puro
`src/services/routing/evacuationGrid.ts` = twin→grilla→A\* + `EvacuationGridMap` + cableado
`subscribeSiteGeometry`/`useGeolocationTracking`; reemplaza la narrativa Gemini) · **sensor leaks ✅ #675**
(useAccelerometer listener, SurvivalMode torch interval, useAcousticSOS flanco+histéresis). Reglas:
declare-emergency #660, DEA #661, pings #662, **FirstResponderDispatchPanel feed real #791 + PÁGINA REAL montada #818** (la afirmación "montado #791" era FALSA: #791 solo construyó el feed; el panel seguía huérfano —solo su test lo importaba—; #818 crea `src/pages/FirstResponderMap.tsx` con ruta + nav "Primer Respondedor" + acciones de despacho REALES que postean nota auditada a `emergency_chat` + tel:SAMU 131).
**AlertScheduler probes reales ✅ #798** (feed Bernoulli sobre inputs físicos reales + viento horario Open-Meteo; sin datos ⇒ no probe).
**Falso positivo sísmico ✅ #816** (founder report 2026-06-09): `autoTrigger.ts checkSismo` latcheaba `peakAccelG` y medía tiempo-desde-flanco → un spike <300ms (caída del teléfono) leía como "sismo sostenido". Ahora mide **duración CONTINUA sobre el umbral** (run con primer/último over-sample + grace de dip 150ms; sustained solo si span≥300ms Y el run sigue vivo). +3 regression guards (spike solo/spike+settle/stale-run → no dispara) + dedup regex de clima `STORM_CONDITIONS_RE`. 14/14 verde.
**Emergency/ops collections default-denied (§365 root-cause) ✅ #807:** 7 colecciones que el Master Gate
daba read pero NO write (`emergency_chat`, `emergency_safety`, `emergency_plans`, `notifications`,
`epp_verifications`, `trainings` + tenant `seismic_events` path-bound) → reglas member-gated + 29 rules-tests
F1 + Dirty-Dozen #71–#77. `EmergenciaAvanzada` realineado a la forma canónica `{status,triggeredBy}` que la
regla `emergency_events` ya exigía + try/catch por-write en los 4 handlers (un write denegado nunca aborta el SOS).

**B7 Salud 🛟🔐 (ADR 0012):** VitalityMonitor sin CIE-10 ✅ #668 · clinical_alerts rule ✅ #669 ·
medical-guard ext (hygiene) ✅ #670 · **Medicine TRÍADA reconvertida ✅:** visor→`SymptomDocumenter`
#674 (documenta síntomas para el médico, no diagnostica) · diagnóstico→referencia CIE-10 #676 ·
fármacos→Vademécum #677 · medical-guard ext (occupational-health) #674. PENDIENTE B7: health_vault
(KMS), VigilanciaScheduler exámenes reales, medical aptitude (F4; hoy fail-closed 503).

**Reglas additive ✅:** control_validations #663 (B2) · documents #667 (B5) · read_receipts +
driving_incidents #664 (B6/B11) · personalized_plans/morning_checkins #665 (B7) · findings/placed_objects
#666 (B3/B-DigitalTwin).

**B14 IA/Gemini 🔐:** **networkBackend cross-tenant CERRADO ✅ #679** (`assertProjectMember` en
sync+delete, audit #3/#14, bloqueo de backlink cross-project, normalización projectId). RESIDUAL:
score-gate de nodos 'global'/comunidad (follow-up).

**Infra CI:** flaky hang **root-caused ✅ #680** (`anyRatchet` escaneaba `src/` 2-3× → fork
force-kill bajo carga → pool hang de 30min; ahora 1 scan a module-load + `testTimeout` alineado a CI).

**Método:** un PR por ítem, CI verde → merge (vigilante auto-merge), revisión adversarial
(`/cso-praeventio` vía subagente security-reviewer) en seguridad. Marcar acá + en `TODO.md` al cerrar.
**Recta final:** lo nuevo que salga se aborda de inmediato.

## Contexto
Praeventio Guard es una PWA de **prevención de riesgos para salvar vidas** en
industrias críticas, protegiendo la **privacidad** (Ley 19.628, biometría on-device,
audit trail). Una auditoría **exhaustiva línea por línea de todo el repo** (3.545
archivos; 103 docs en `docs/audits/file-ledger/`) confirmó que la app es
mayoritariamente **real y bien construida**, pero esconde **~45 hallazgos P0/P1 + 17
patrones sistémicos**. Esta fase **resuelve esa deuda, un PR por bloque**, en el orden
de la auditoría (vida y privacidad primero).

**Verdad de referencia** (en repo): `TODO.md` §2.32/§2.33/§2.34 · `DEEP-EX-INDEX.md`
· `DEEP-EXT-INDEX.md` · `INDEX-CONSOLIDADO.md` · `PHASE3-RECONCILIATION.md` · `DEEP-<bloque>.md`.
**Decisiones (usuario):** un PR por bloque · emulador Firestore disponible (verificar
rules-tests reales) · cimientos compartidos primero.

## ⭐ Principio rector — HACER REAL, no eliminar
**El objetivo es hacer real la aplicación de prevención: cada función del código se
considera y se CABLEA donde corresponde.** Reglas:
- **Huérfanos** (componentes/hooks/servicios sin consumidor) → **dárles hogar**: montar
  la página/menú/ruta, cablear al engine/endpoint real. NO borrar.
- **Mocks / datos hardcodeados / "demo"** → **cablear a datos reales**. NO borrar la pieza;
  reemplazar el dato falso por el real.
- **Stubs / NotImplemented** → **implementar y cablear**. NO borrar.
- **Duplicados** → **consolidar preservando TODAS las capacidades** (fusionar en el canónico,
  migrar lo que aporte el otro). NO borrar funcionalidad.
- **Excepciones (2, manejar con cuidado):**
  1. **Directiva legal/ética dura (ADR 0012 — no diagnóstico médico):** lo que infiere
     diagnóstico se **RECONVIERTE a función conforme** (transcribir el veredicto del médico,
     catálogos de referencia con `MedicalDisclaimer`, señales no-diagnósticas) y se cablea.
     **Nunca** se habilita inferencia diagnóstica; **nunca** se borra la pieza sin reconvertir.
     Marcar ❓ decisión de producto si el destino conforme no es obvio.
  2. **Decisión de arquitectura ya tomada (p.ej. COLMAP server-side → on-device §2.28):** el
     **reemplazo ES la función real**; se **documenta** la supersesión (no re-cablear lo
     contradicho, no borrar a ciegas — consultar antes de tocar `infra/` muerto).
- **Datos legales fabricados** (RUT falso, métricas inventadas) → exigir/cablear el dato
  **real**; jamás fabricar (esto SÍ es quitar el dato falso, no la función).

**Severidad:** 🔴 P0/P1 (vida/seguridad/legal) · 🟡 P2 (integridad) · 🔵 P3 (limpieza/cableado).
**Test:** `vitest`=lógica · `rules`=emulador `authenticatedContext` · `comp`=componente jsdom · `super`=supertest router real.

---

## Paso 0 (primer commit nueva sesión)
- [x] Copiar este plan a **`docs/audits/file-ledger/PHASE5-REMEDIATION.md`** (roadmap durable).
- [x] Añadir a **`CLAUDE.md`** la sección "Active work — Phase 5" (texto al final).
- [x] Commit `docs(phase5): remediation roadmap + CLAUDE.md pointer`.

## Fase 5.0 — Cimientos compartidos (hacer primero; reutilizables)
- [x] **F1 Harness rules-tests REAL** — helper en `src/rules-tests/` con **solo
  `authenticatedContext`** (jamás Admin SDK), **falla si el emulador no arranca** (sin
  `if(!testEnv) return`), cubre los 5 casos Regla #4 (owner-allow/non-member-deny/
  schema-violation/post-sign-update-deny/server-field-spoof-deny). Arreglar
  `projectScopedStores.rules.test.ts` (silent-pass + siembra sintética de `signedAt`). (rules)
  → ✅ #657 (`src/rules-tests/_harness.ts` `createRulesTestEnv` lanza si el emulador no arranca; silent-pass muerto).
- [x] **F2 `parseGeminiJson` + codemod (P11)** — parser tipado + fallback 502; aplicar a los
  `*Backend.ts` (medicine/psychosocial/suseso/legal/safetyEngine/shift/prediction/network). (vitest)
  → ✅ #658/#769/#772/#784/#789: el parser canónico es `parseGeminiJson` en `src/services/gemini/_shared.ts:55`
  (NO el filename asumido `parseGeminiJson.ts`); #772 migró 11 parses genuinos; #769 legal; #784 alineó 4 tests stale.
  **✅ #789** migró los callsites empty-coercion restantes de `geminiBackend.ts` al contrato `parseGeminiJson`
  (empty/safety-blocked → `gemini_empty_response`/502 tipado, fin del `{}` silencioso); `gemini/embeddings.ts`
  `autoConnectNodes` conserva su fallback `|| '[]'` POR DISEÑO (un body vacío ahí es la respuesta legítima
  "sin conexiones relevantes" — el prompt instruye `[]`, así que la coerción es el 200 correcto, no un 502; documentado inline).
  **CERRADO `[x]` (2026-06-08):** grep de `JSON.parse(... || '{}')` crudo en `src/` de producción (no-tests) = 0 callsites;
  el único `|| '[]'` restante (`embeddings.ts:116`) es el caso por-diseño documentado arriba — no queda coerción-vacía cruda.
- [x] **F3 Identidad-desde-token (P3)** — endurecer dispatcher `/api/gemini`: las acciones con
  identidad no confían `authorUid`/`projectId` del cliente; estampar `req.user.uid`+tenant. (super)
  → ✅ #678 (`IDENTITY_STAMPED_ACTIONS` en `src/server/routes/gemini.ts:221`; estampa `req.user.uid` antes del spread).
- [~] **F4 Verify WebAuthn real (P4)** — consumidores llaman `verifyAuthenticationResponse`:
  `dte.ts`, referee (`curriculum.ts`/`RefereeAccept.tsx`), `Login.tsx`→`useBiometricAuth`,
  `medicalAptitude`, suseso `kms-sign-rsa`. (super/vitest)
  → ✅ PARCIAL: DTE verify #765 (`dte.ts:404` `verifyWebAuthnAssertion`); referee honest-label #766
  (`curriculum.ts:631-651` registra `device_attested`, `webauthnVerified:false` — verificación cripto estructuralmente
  imposible en path público sin credencial enrolada); Login **web** server-verify #775.
  **PENDIENTE:** Login **nativo** (`useBiometricAuth.ts:249` el path `isNative` retorna true sin /challenge+/verify),
  `medicalAptitude` (stub 503), suseso `kms-sign-rsa` verify.
- [x] **F5 Gobernanza/CI** — cablear `precommit-stub-guard.cjs`(#13) y
  `precommit-allowbackup-guard.cjs`(#17) en `.husky/pre-commit`; **job CI** con `lint` +
  ratchets (no bypaseables con `--no-verify`); **reactivar e2e** `sos-button`/
  `process-lifecycle`/`offline-resilience` (quitar `describe.fixme`). (CI)
  → ✅ PARCIAL #659: guards #13/#17 wired (`.husky/pre-commit:6-7`); job CI lint + ratchets ✅. **PENDIENTE:** reactivar los 3 e2e safety-críticos (`describe.fixme`).

---

## Fase 5.1 — Bloques (un PR por bloque, en este orden)

### B1 — Emergencia & Respuesta 🛟  · ref `DEEP-B1` + `DEEP-EX-01/02/03`
- [x] `sosOutbox` dead-letter (HECHO).
- [x] `routingBackend.clearPointFromHazards` (HECHO).
- [x] 🔴 `EmergencySquadManager.tsx:28` escuadrón mock → **cablear** a `useEmergencyBrigade(projectId)` real + estado vacío honesto (datos reales, no ficticios). (comp) → ✅ #672 (`EmergencySquadManager.tsx:74` consume `useEmergencyBrigade(projectId)`, sin mock).
- [x] 🔴 Declarar-emergencia falla en silencio: añadir `isEmergencyActive`/`activeEmergencyProtocol`/`emergencyStartTime` al `hasOnly` de `isValidProject`. (rules) → ✅ #660 (`firestore.rules:205` los 3 campos en el `hasOnly`).
- [x] 🔴 `pings` (baliza vida, `useSurvivalPing`) sin regla → reglas+tests+security_spec. (rules) → ✅ #662 (`firestore.rules:742` `match /pings/{pingUid}`).
- [x] 🔴 `deas`/`inspections` (DEA Ley 21.156) sin regla → reglas+tests. (rules) → ✅ #661 (`firestore.rules:514` `match /deas/`, `:520` inspections subcoll).
- [x] 🔴 ManDown sin push: **cablear** `useManDownDetection`→`triggerEmergency`+FCM + trigger server `mandown_events` (como FallDetection). (vitest/super) → ✅ #671 (`useManDownDetection.ts:216` `triggerEmergency('man_down', …)` + `mandown_events`).
- [x] 🟡 🔵 ~~BLOCKED: `AlertScheduler` `probes={[]}` (`RootLayout.tsx:467`) → **cablear** probes reales (Bernoulli predictivo).~~ → ✅ #798 (DESBLOQUEADO): AlertScheduler ahora recibe probes predictivos REALES — `structuralLoadProbe` evalúa la carga de viento Bernoulli sobre inputs físicos reales (area/Cp/límite NCh-432 de `projects/{pid}/structural_loads`) alimentados por viento HORARIO real de Open-Meteo en las coordenadas del proyecto; sin coordenadas/sin forecast/sin input físico ⇒ **NO probe** (la escalera predictiva queda honestamente en silencio, nunca dispara sobre un viento fabricado). Nueva colección `structural_loads` con reglas (createdBy inmutable, delete admin/supervisor) + rules-tests + Dirty-Dozen #67. (comp)
- [x] 🟡 `DynamicEvacuationMap` usa Gemini no A* → **cablear** a `gridAStar`. (vitest) → ✅ #673 (`DynamicEvacuationMap.tsx:26` importa `services/routing/evacuationGrid`; "A* sobre el Gemelo Digital", reemplaza la narrativa Gemini).
- [x] 🟡 ~~`useAccelerometer.ts` leak listener~~ **ya resuelto** (handleMotion estabilizado vía refs `[]`, el web listener se remueve con la MISMA referencia; comentario en `:27-37`); ~~SurvivalMode torch `setInterval` sin clear~~ **ya resuelto** (`torchIntervalRef` + cleanup que hace `clearInterval` y detiene los tracks del stream, `SurvivalMode.tsx:160-179`); ~~`useAcousticSOS` falsos positivos~~ **ya resuelto** (knock = flanco de subida con histéresis `armedRef`+`RELEASE_RATIO`+`KNOCK_COOLDOWN_MS`, ruido sostenido no acumula golpes fantasma, `useAcousticSOS.ts:24-58`); ~~`Asesor.tsx` prompt-injection~~ **✅ hecho** (el `query` del usuario se interpolaba crudo en un prompt cuyo propio encabezado decía "IGNORAR OTRAS INSTRUCCIONES" → un reporte malicioso podía anular las reglas tácticas del asesor de emergencia; ahora `buildAsesorPrompt()` (nuevo `asesorPrompt.ts`, puro) cerca el reporte en `<situacion_reportada>` como DATOS, instruye NUNCA obedecer instrucciones internas, reafirma reglas no-anulables y `sanitizeAsesorQuery()` elimina tags de cerca forjados + capa longitud (anti-breakout) — patrón canónico de `gemini/chat.ts`; +8 tests, 8 verde · PR #726). (comp/vitest)
- [~] 🟡 ~~`manDownTimer` un stage/tick~~ **✅ hecho** (`tickManDownEvent` avanzaba **una sola etapa por tick** → si se perdían ticks (cron saltado, device offline+reconnect) un trabajador posiblemente incapacitado quedaba **sub-escalado** —p.ej. 600s pero solo level_1, SAMU/brigada nunca paginados—; ahora salta al stage que el tiempo amerita y **registra cada escalación cruzada** (notifica supervisor+CPHS+brigada según corresponda); +2 tests salto-total/parcial, 19 verde, 2026-06-06 · PR #723); ~~`buildPostmortem` >100%~~ **✅ hecho** (la cobertura de evacuación usaba `drill.scans.length` (eventos crudos) / esperados → re-scans o visitantes no-esperados daban >100%; ahora `totalSafe` = scanners ÚNICOS (`safeUids.size`) y `finalCoveragePercent` = esperados-contabilizados/esperados, garantizado 0..100; +test re-scan+visitante → 33% no 150%, 11 verde, 2026-06-06 · PR #717); ~~training fecha-NaN vigente~~ **✅ hecho** (`emergencyBrigadeService.buildBrigadeCoverageReport:79`: `Date.parse(trainedAt)` NaN → `NaN < now` false → el miembro NO iba a `expiredTrainings` y SÍ sumaba a `byRole` → `meetsMinimum=true` con brigada sin cobertura real —falso positivo de vida—; ahora **fail-closed**: `Number.isNaN(trainedMs)` ⇒ vencido, no cuenta; +test, 10 verde, 2026-06-06 · PR #718. Nota: `restrictedZonesEngine:63-66` ya falla-cerrado por la dirección de la comparación, no requiere cambio); ~~`gemini/emergency.ts:185` JSON.parse (F2)~~ **✅ hecho** (`generateEmergencyPlanJSON` hacía `JSON.parse(response.text || '{}')` → si Gemini se cae/safety-blockea o devuelve JSON malformado, el trabajador en plena emergencia recibía `{}` o un 502, NO un plan utilizable —inaceptable para vida—; ahora degrada con gracia a `baselineEmergencyPlan()` determinístico y conforme: normas chilenas REALES (Ley 16.744, Art. 184 Código del Trabajo, DS 594/1999, DS 44/2024), números de emergencia reales (SAMU 131/Bomberos 132/Carabineros 133/ACHS 1404), fórmula $MR = P \times C$ y cadena de mando; marcado `generadoSinIA:true` para que la UI sea honesta y el prevencionista lo revise. Distinción clave para el circuit breaker COMPARTIDO (ADR 0019): **upstream-respondió-pero-texto-vacío/malformado** ⇒ baseline + `success` (el upstream está sano); **el request mismo RECHAZA** (503/red/safety-block de transporte) ⇒ se lanza `GeminiDegradedError` (nuevo `src/services/gemini/degraded.ts`) que lleva el baseline: el dispatcher registra `failure` (el breaker se abre → failover al SLM on-device) **y aun así** responde 200 con el baseline, así el trabajador nunca queda sin plan. Además, **breaker YA abierto** (apagón sostenido): `assertGeminiAllowed` corta con 503 ANTES del dispatch, así que se añadió un carve-out `CIRCUIT_OPEN_FALLBACKS` en el dispatcher que sintetiza el baseline desde los args SIN tocar Gemini (200 `degraded:true`, no 503) — el plan de vida se entrega justo en el escenario de outage que lo motiva; +tests pure-function baseline/fromResponse + degraded + router supertest (degraded→200+failure, circuit-open→200 baseline), 63 verde, 2026-06-06 · PR #724); ~~`emergencyContextAdapter` void emit+Date.now~~ **✅ hecho** (la idempotencyKey usaba `Date.now()` al emitir → única por llamada → la ring de idempotencia de 1h del eventLog NUNCA deduplicaba: un remount, un StrictMode double-invoke o un toggle activo→inactivo→activo emitía `sos_triggered` DUPLICADO para la MISMA emergencia; ahora `EmergencyContext` expone `emergencyStartTime` (sellado en `triggerEmergency`, limpiado en `resolveEmergency`) y la clave se basa en ese timestamp de activación → estable+determinística. Además el `void emit().catch()` no veía los `{ok:false}` (emit no lanza en fallos de validación/cola → evento SOS de auditoría perdido en silencio = brecha de compliance); ahora se `await`ea vía IIFE y se surface tanto el rechazo como el `!result.ok` con `logger.error`; +5 tests (transición única, clave estable, no re-emit, not-ok surface, no-op sin tenant/user), 9 verde · PR #725). (vitest)
- [x] 🔵 ~~BLOCKED: `FirstResponderDispatchPanel` huérfano → falta fuente de datos real~~ → ✅ #791 (DESBLOQUEADO): se construyó el **feed real de presencia de respondedores** que faltaba — combina el roster de brigada (`useEmergencyBrigade`) con las **balizas de vida en vivo** (`pings`/`useSurvivalPing`, que SÍ aportan `currentPosition` + frescura) para derivar `Responder[]` con `availability` real (presente/ausente por antigüedad del ping) y la taxonomía de primer-respondedor desde los roles de brigada; sin fabricar posiciones (un miembro sin ping reciente = no-disponible honesto, no inventado). El panel huérfano queda **montado** y alimentado con datos reales, respetando "hacer real, no fabricar" y la sensibilidad de privacidad Ley 19.628 (geolocalización on-device, opt-in del ping de supervivencia).

### B7 — Salud ocupacional & Vigilancia 🛟🔐  · ref `DEEP-B7` + `DEEP-EX-04/05/06`
- [x] 🔴 `VitalityMonitor.tsx:29-62,131` inferencia CIE-10 (ADR 0012) → **reconvertir** a alerta NO-diagnóstica conforme (señales HR/ambiente como recomendación de pausa/hidratación, **sin código CIE-10**) + `MedicalDisclaimer` + cablear a `clinical_alerts` con reglas. (comp) → ✅ #668 (`VitalityMonitor.tsx:15-17` sin CIE-10, recomienda pausa/hidratación; `:271` `MedicalDisclaimer`; `:82` write a `clinical_alerts`).
- [x] 🔴 Extender `precommit-medical-guard.cjs` SCOPED_DIRS a `hygiene/`+`occupational-health/`+`*Backend.ts` raíz. (vitest) → ✅ #670/#773 (`precommit-medical-guard.cjs:63` hygiene/, `:68` occupational-health/, `:77-79` los 3 `*Backend.ts` raíz).
- [x] 🔴 `clinical_alerts` (client-write) sin regla → reglas+tests. (rules) → ✅ #669 (`firestore.rules:532` `match /clinical_alerts/{alertId}`).
- [x] 🔴 `Medicine.tsx:134,137,141` MedicalAnalyzer/DifferentialDiagnosis/DrugInteractions → **reconvertir a función conforme ADR 0012**. (comp) → ✅ #674/#676/#677 (`Medicine.tsx:133` `SymptomDocumenter` documenta síntomas; `:136` `DifferentialDiagnosis` = referencia educativa CIE-10 con `MedicalDisclaimer`; `:140` `DrugInteractions` = Vademécum ATC referencia, "No es indicación médica").
- [x] 🔴 `health_vault`/`health_vault_shares` sin reglas → reglas + ≥5 rules-tests + security_spec + KMS; `HealthVaultShare.tsx:60` listado → endpoint server. (rules) → ✅ #762 (`firestore.rules:312`/`:329` owner-gated + collectionGroup index) + #780 (acceso a archivo re-valida `validateShareAccess` en cada `/view`, revocado/expirado→410, `healthVault.test.ts`).
- [x] 🟡 `personalized_plans`(`PersonalizedSafetyPlan.tsx:60`) y `users/{uid}/morning_checkins`(`MorningRoutine.tsx:60`) sin reglas. (rules) → ✅ #665 (`firestore.rules:581` personalized_plans, `:457` morning_checkins).
- [x] 🟡 `VigilanciaScheduler` DEMO_EXAMS (`Medicine.tsx:140`) → **cablear a exámenes reales**; `Hygiene.tsx` métricas hardcoded → **cablear a métricas reales**. (comp) → ✅ #763 (`VigilanciaScheduler.tsx:60` filtra `LegalObligation.kind==='medical_exam'`, DEMO_EXAMS eliminado, estado vacío honesto) + ✅ #787 (`Hygiene.tsx` bar-chart hardcoded `[40,65,45,80,…]` reemplazado por datos REALES: `computeMonthlyHygieneTrend` deriva la tendencia mensual de exposición de las mediciones de higiene reales (valor/límite-legal por mes; vacío → estado vacío honesto, no barras falsas) y `computeMedicalExamCompliance` deriva el cumplimiento de exámenes del calendario de obligaciones legales (sin datos → "Sin datos"); `hygieneMetrics.ts` puro + tests + i18n en/es/pt-BR).
- [~] 🟡 `Login.tsx:10` biometría débil → `useBiometricAuth` (F4) **✅ PARCIAL (web)** (Login usaba `verifyBiometric()` con challenge generado en cliente y retornaba true ante cualquier assertion; ahora la ruta **web** cablea `useBiometricAuth().authenticate(reason,'login')` → /challenge + /verify reales (@simplewebauthn/server + replay-protection por contador + audit), step-up server-verified fail-closed; +Login.test.tsx; PR #775). **PENDIENTE (nativo):** en Capacitor iOS/Android el path `isNative` (`useBiometricAuth.ts:249-258`) retorna `true` apenas pasa el prompt biométrico del SO, SIN /challenge ni /verify → Login mantiene la sesión Firebase con sólo biometría local del dispositivo (riesgo original sigue abierto en builds móviles); `AptitudeCertificateForm.tsx:59` egress geo → on-device; `medicalAptitude` stub → implementar (F4). (super/vitest)
  → ✅ #788 limpieza: `src/utils/biometrics.ts` (helper de weak-auth client-side, **0 importers** en todo `src`) eliminado;
  Login ya autentica por el path server-verified `useBiometricAuth` (WebAuthn), así que el util era peso muerto (typecheck:ci 0 lo prueba; any-ratchet 160→159).
- [~] 🔵 ~~`AnnualReview.tsx:220` Math.random→randomId~~ **✅ hecho** (id por-objetivo → `randomId()` crypto, #15; PR #779); `Ds109/Ds67` RUT en claro en nodo ZK **✅ PARCIAL** (NO se hasheó —supersedido por mejor enfoque—: la regla de lectura de `nodes` con `metadata.workerRut` se restringió a autor/admin/supervisor vía `nodeHasWorkerRut()`, +7 rules-tests + Dirty-Dozen #53; PR #776). **PENDIENTE:** el gate de lectura (`firestore.rules:714-719`) concede lectura si `existing().isPublic == true` ANTES de aplicar `!nodeHasWorkerRut(...)`, y `isValidNode` permite `isPublic` en cualquier nodo → un nodo con RUT marcado `isPublic:true` queda legible por cualquier usuario verificado (bypass PII). ~~Falta negar lectura pública a nodos `nodeHasWorkerRut`~~ **✅ #795 (half 2 cerrado):** la rama pública del gate de lectura de `nodes` ahora es `(existing().isPublic == true && !nodeHasWorkerRut(existing()))` → un nodo con RUT NUNCA es legible públicamente sin importar `isPublic`; nodos públicos sin RUT siguen legibles (sin regresión); +rules-tests `nodesWorkerRut.rules.test.ts` (describe `isPublic bypass`) + Dirty-Dozen 60/61; ~~`HealthVaultViewer.tsx:215` fileUri post-revocación~~ **✅ hecho** (el `/view` mandaba el `fileUri` crudo y el viewer lo renderizaba como `<a href>` → el navegador bajaba el blob directo, saltándose la revocación; ahora `/view/:token/:secret/file/:recordId` re-valida `validateShareAccess` en cada fetch dentro de runTransaction y streamea por el Admin SDK; revocado→410; PR #780); `telemetry_events`/`uv_exposures` scope; `medicineBackend.ts:81,139,202`+`psychosocialBackend.ts:68` JSON.parse (F2).

### B3 — Ergonomía & Protocolos MINSAL 🛟🔐  · ref `DEEP-B3` + `DEEP-EX-07`
- [x] 🔴 `BioAnalysis.tsx:411` frame de cámara VIVA a Gemini (#12) → **cableado al path on-device** (`ColorBasedEppDetector` + `inspectImage`; `src/services/bio/onDeviceBioReport.ts` puro + 7 tests). La imagen ya NO sale del equipo; `analyzeBioImage` de-whitelisted en `gemini.ts`. (Fase 5, 2026-06-05)
- [~] 🔴 `BioAnalysis.tsx` `findings` ~~sin regla~~ + sin audit → reglas+audit. **REGLAS ✅ (verificado):** regla `findings` owner-gated en `firestore.rules:568-571` + 5 rules-tests F1 en `findingsPlacedObjects.rules.test.ts` + Dirty-Dozen #29 en `security_spec.md`. **PENDIENTE (audit):** el write cliente (`BioAnalysis.tsx` `addDoc` directo) no emite `auditServerEvent` server-side → falta ruta server o trigger que estampe identidad+audit del token (el `reportedBy` actual es displayName no-verificado). (rules)
- [x] 🟡 `AIPostureAnalysisModal.tsx` → análisis postural **100% on-device** (MediaPipe→REBA/RULA): se **retiró el fallback Gemini** que subía la foto del trabajador (decisión usuario: a la nube va el RESULTADO, no la imagen — privacidad). `analyzePostureWithAI` de-whitelisted. El crash de `bodyParts` desaparece (siempre lo llena MediaPipe). (Fase 5, 2026-06-05)
- [x] 🔵 ~~`prexor.ts:35` comentario 10dB stale; reba/rula 500→400; `pulmonaryErgonomics` escribe en render→effect; **corregir DEEP-B3** (protocols.ts SÍ expone tmert/prexor).~~ → ✅ #797: comentario PREXOR corregido, las rutas reba/rula devuelven **400** ante input inválido (no 500), y el efecto de render de `pulmonaryErgonomics` movido a `useEffect`; +tests. DEEP-B3 corregido (protocols.ts expone tmert/prexor).

### B16 — Offline / PWA / Mesh / Sensores 🛟🔐  · ref `DEEP-B16` + `DEEP-EX-08`
- [x] 🔴 `syncStateMachine.ts:313` y `genericOutboxEngine.ts:248` descartaban datos de seguridad en silencio (give-up/TTL/maxRetries → `delete`) → **dead-letter (patrón sosOutbox B1)**: se retienen marcados `deadLettered`, dejan de reintentarse, se excluyen de `pending` y se exponen vía `deadLetters()` / `clearDeadLetter()`. Capacidad nunca evicta un dead-letter; el scheduler no hace busy-loop con dead-letters. +13 tests (40 en ambas suites). (Fase 5, 2026-06-05)
- [x] 🟡 `conflictQueue.ts` (real, sin consumidor/reglas) → **cablear** (consumidor + reglas+tests). (rules/vitest) → ✅ #767 (router `conflictQueue.ts` enqueue/list/resolve approver-gated + audited; `firestore.rules:1312` `match /conflict_queue/{queueId}` server-only + supervisor read; 7 rules-tests + supertest + Dirty-Dozen 45-47).
- [x] 🟡 `meshPacket.ts:237` firma `'unsigned-dev'` → firmar+verificar; ~~`offlineStorage.ts` `encryptData` base64 → **cifrado real**~~ **✅ HECHO** (`src/utils/offlineCrypto.ts`: AES-256-GCM real con clave no-extraíble device-bound en IndexedDB, IV aleatorio por payload, autenticado (tamper→null); migration-safe (lee base64 legacy); 4 tests crypto + 41 offlineStorage verdes; PR #761). → ✅ #768 (mesh) (`src/services/mesh/meshPacketSigner.ts` HMAC `signPacket`/`verifyPacket` real, cableado en `meshPacket.ts:277`, cierra el stub `unsigned-dev`; tamper/impersonation tests). (vitest)
- [ ] 🔵 `useSyncStatus`/`SyncQueueBadge` huérfanos → **montar** (badge de cola en UI).

### B2 — Riesgo & IPER 🛟  · ref `DEEP-B2` + `DEEP-EX-14/15`
- [x] 🔴 `Matrix.tsx` banding ad-hoc P×S (4 sitios) → **cableado a `calculateIper` (DS44)**
  vía adapter canónico `iperCriticidad.ts` que preserva el contrato `criticidad` de 4 bandas
  (leído por ~10 módulos). `RiskMatrix5x5.severityForCell` (tercer esquema inline) →
  promovido a motor puro `iso31000Band.ts` (re-export delgado, back-compat). **Refinamiento
  del plan original** (decisión usuario 2026-06-05): DS44 e ISO 31000 **coexisten** como
  estándares de primera clase (no se colapsa ISO en DS44) — toggle por régimen vía
  `TenantRegulatoryContext` como follow-up. Documentado en **ADR 0020**. +14 tests puros.
  (Fase 5, 2026-06-05)
- [x] 🔴 `control_validations` (controles críticos) → **YA resuelto en #663** (doc-drift en esta línea):
  regla en `firestore.rules:505` (create con `validatedByUid==auth.uid`, update inmutable, delete admin/supervisor),
  6 rules-tests reales (`src/rules-tests/controlValidations.rules.test.ts`), Dirty Dozen `security_spec.md:152`. (Fase 5)
- [x] 🟡 `lineOfFireChecker.ts:124` match **por primera palabra → exacto** (frase completa normalizada;
  fail-closed para gate de bloqueo): "guardarropa" ya **no** limpia "guarda física en partes móviles".
  +regresión. · `safetyEngineBackend.ts:129` JSON.parse → **YA usa `parseGeminiJson`** (F2, doc-drift). ·
  `residualRisk.ts` `safeRead` → **surface error** (rethrow → 500; antes enmascaraba lectura fallida como
  lista vacía = falso "sin riesgos residuales"). +2 tests `_failReads`. (Fase 5, 2026-06-05)
- [x] 🔵 `useRiskRanking` 3 idle stubs → **implementar+cablear COMPLETO** (fuente canónica = Zettelkasten, ADR 0020 ext). Los 3 hooks son pull-hooks reales montados en `Risks.tsx`:
  - [x] **top-risks (backend)**: motor puro `riskNodeRanking.ts` (rankea `NodeType.RISK` por IPER DS44) + endpoint
    real `GET /api/insights/:projectId/top-risks` (lee `tenants/{tid}/zettelkasten_nodes`, no las colecciones planas
    vacías) + 12 tests. Hallazgo: el endpoint legacy leía colecciones que ningún writer puebla (dashboards vacíos).
  - [x] **top-risks (UI)**: `useTopRisks` cableado al endpoint real (`useEndpoint` con abort/refetch); `TopRisksWidget`
    reformado a `RankedRiskNode[]` (sin re-rank por contadores; dot por criticidad + score IPER); `TopRisksDashboardCard`
    pasa-through; **montado en `Risks.tsx`**. typecheck 0, lint 0, tests verdes. (Fase 5, 2026-06-05)
  - [x] **weak-controls (backend)**: motor puro `controlValidationAggregation.ts` (agrupa `control_validations` por
    controlId → verificaciones/fallas/overdue → `rankWeakControls`) + endpoint `GET /api/insights/:projectId/weak-controls`
    (lee `projects/{pid}/control_validations`, labels desde la biblioteca) + 12 tests. UI (hook+widget+montar) pendiente.
  - [x] **weak-controls (UI)**: `useWeakControls` cableado al endpoint real; `WeakControlsWidget` reformado a
    `ControlWeakness[]` (sin round-trip a ControlRecord; % falla + ícono de verificación vencida);
    `WeakControlsDashboardCard` pass-through; **montado en `Risks.tsx`** junto a top-risks.
  - [x] **timeseries (backend #693)**: motor puro `findingsTimeseries.ts` (agrupa `NodeType.FINDING` por día UTC,
    ventana móvil con gaps en 0, total+críticos) + endpoint `GET /api/insights/:projectId/risk-timeseries` + 9 tests.
  - [x] **timeseries (UI)**: `useRiskTimeseries` cableado al endpoint real; `RiskTimeseriesChart` **montado en `Risks.tsx`**;
    removidos `idleResult`/`NOOP` (ya no hay stubs). Los 3 rankings quedan reales end-to-end. (Fase 5, 2026-06-05)
  - [ ] `shiftRiskPanel` → **consolidar** con `preShiftRisk`: HALLAZGO — ya están consolidados a nivel de motor
    (ambos usan `composeShiftRiskPanel`); son complementarios (push `shift-risk-panel/compose` vs pull
    `pre-shift-risk` server-agregado, usado por `PreShiftRisk.tsx`). Residual = decisión de producto sobre el hook
    huérfano `useShiftRiskPanel` (pendiente input usuario).

### B17 — Admin / Auth / RBAC / Privacidad 🔐  · ref `DEEP-B17` + `DEEP-EX-09/10`
- [x] 🔴 `externalAuditPortal.ts` 4 endpoints admin (create/list/revoke/access-log) **sin gate de rol** (cualquier
  usuario autenticado del tenant podía crear/revocar portales de auditor externo = escalada de privilegios) →
  **`assertAdminCaller`** (`isAdminRole(customClaims.role)`, server-authoritative, espeja `admin.ts`). `resolveTenantIdForAdmin`
  ya acotaba al tenant propio (sin riesgo cross-tenant); el gap era puramente el rol. +7 supertests sobre el **router real**
  (403 no-admin en los 4, 200/201 admin). El test previo reimplementaba los handlers (anti-patrón wire-up). (Fase 5, 2026-06-05)
- [x] 🔴 `auditPortalStore.savePortal` token EN CLARO → **eliminado el path roto** (mejor que hashearlo): la investigación
  (pedida por usuario) probó que el path cliente estaba MUERTO — `findPortalByPublicToken` busca por `accessTokenHash` y
  rechaza rutas que no sean `tenants/…`, así que los portales escritos por `savePortal` (token en claro, `projects/{pid}/
  audit_portals`) eran **inutilizables** por el auditor. Fix: la página routeada `/audit-portals` ahora monta el manager
  CANÓNICO server-wired `PortalManager` (huérfano hasta hoy) que crea/lista/revoca vía `/api/audit-portal/*`
  (`useExternalAuditPortal`) — hashea el token + ruta verificable + gate de rol (#695). Se **retiró** `auditPortalStore.ts`
  (sin consumidores, footgun de token en claro). Supersesión documentada en `AuditPortals.tsx`. typecheck/lint 0.
  RESIDUAL: master-gate read (`firestore.rules:257`) que no exponga — sub-ítem de reglas, follow-up. (Fase 5, 2026-06-05)
- [x] 🔴 `projects.ts` claim global `gerente/admin` → membresía por-proyecto. **HECHO**: helpers `callerCanManageProject`/`callerIsProjectMember` (`src/server/routes/projects.ts:101-128`) consolidan los **4** bloques de auth duplicados (invite/list/remove/cancel); el privilegio de gestión deriva de `memberRoles[uid]` de ESTE proyecto + creador, **nunca de un claim global** — cierra el IDOR donde un `gerente` de cualquier proyecto gestionaba TODOS. Self-leave preservado. Reimplementación-disfrazada `test-server.ts:1031` sincronizada al mismo modelo. Tests reales `projects.router.test.ts`: gerente per-proyecto invita/remueve 200 · global-admin no-miembro 403 (regresión IDOR) · miembro sin rol 403 (45/45 verde). (super, 2026-06-06 · PR #700)
- [x] 🔴 `WebAuthnKeysSection.tsx:73` borrado MFA client-side → **RECONVERTIDO por directriz de producto/seguridad del usuario (2026-06-06): NO borrado self-serve**. Hallazgo al investigar: la UI leía/borraba `users/{uid}/webauthn_credentials` (subcolección fantasma) mientras el store canónico que gatea el login es el top-level `webauthn_credentials` (server-only) — sin regla Firestore → la lista Y el borrado ya estaban **muertos** (default-deny). Decisión del usuario: en una app de prevención, si roban el teléfono un ladrón NO debe poder borrar las llaves y dejar a la persona sin acceso/recuperación; el usuario puede **cambiar/rotar** (registrar nueva) o **recuperar**, nunca eliminar. Fix: (a) nuevo `GET /api/auth/webauthn/credentials` read-only (server, uid del token, sin `publicKey`) en `webauthnChallengeRouter` reusando `getCredentialsByUid`; (b) `WebAuthnKeysSection` reconectado al endpoint real + **botón Eliminar removido** + nota de protección anti-robo + se mantiene "Registrar nueva llave" (rotación); (c) tests: real-router `webauthnCredentials.router.test.ts` (401/uid-scope/no-publicKey/empty) + comp test "no self-delete affordance". (comp/super, 2026-06-06 · PR #701)
- [x] 🔴 WebAuthn **recuperación admin-asistida** (cierra el "recuperar" de la directriz anti-robo): `POST /api/admin/webauthn/revoke {targetUid, credentialId?}` admin-gated (`assertAdminCaller`) + audit (#3/#14) + revoca refresh tokens — un operador autorizado revoca la(s) llave(s) de un dispositivo perdido/robado en nombre del trabajador (un ladrón no es admin). `deleteCredentialById` agregado al store (única ruta de borrado, server-only). Razón de NO permitir self-delete con step-up: un teléfono robado DESBLOQUEADO pasa el step-up con su propia llave. Tests: store unit + `admin.router.test.ts` (401/403/400/200-una/404-cross-user/200-todas). (super, 2026-06-06 · PR #704)
- [~] 🔴 Reglas #650 (lote, parcial): ~~`documents_for_read` authorUid~~ **✅ ya tenía anti-spoof** (`firestore.rules:559-565`: create/update gatean `authorUid==auth.uid`/inmutable — resuelto en PRs additive previos); ~~`lone_worker_sessions`/`lone_worker_events` update sin owner-check~~ **✅ HECHO** (update ahora exige `existing().workerUid==auth.uid || isAdmin/Supervisor` — antes cualquier miembro del proyecto podía mutar la sesión de OTRO trabajador, p.ej. marcar a un trabajador en peligro como "safe"; +3 rules-tests por colección en `projectScopedStores.rules.test.ts`: otro-miembro→deny, dueño→allow, supervisor-rescate→allow; verificado por el job CI "Firestore rules tests" — el emulador no corre localmente, sin `firebase` CLI). PENDIENTE (sub-ítems, requieren investigación/decisión): `site_book_counters` sin regla (folios DS76); `root_cause_analyses` vs regla `root_causes` (mismatch de nombre — `rootCauseStore.ts`); `exceptions/legal_obligations/shifts` laxos (sin campo owner-uid confirmado — decisión de esquema, TODO `dahosandoval@` en `firestore.rules:566`). (rules, 2026-06-06 · PR #702)
- [x] 🟡 ~~`pinSign` PinCredential del body→Firestore~~ **✅ hecho** (el surface era "stateless" y recibía la `PinCredential` COMPLETA en el body → un atacante fabricaba un hash para un PIN elegido y "verificaba", y reseteaba `consecutiveFailures:0` anulando el lockout. Ahora la credencial se persiste **server-side** en la colección top-level `pin_credentials/{projectId}__{workerUid}` (server-only, default-deny — NO subcolección de `projects/` para evitar el master-gate read que filtraría el hash a los miembros); `register` la escribe + audita; `verify`/`sign-item` la LEEN de Firestore (404 si no registrada) y persisten el contador en una `runTransaction`; el cliente ya no envía ni recibe la credencial (`usePinSign`/`PinSignModal` actualizados); `deleteCredentialById`-equivalente N/A. +audit `pinSign.register`/`pinSign.signItem` (#3/#14). 38 tests reescritos al modelo persistido, typecheck/lint 0, 2026-06-06 · PR #705); ~~`import.ts` assertProjectMember~~ **✅ hecho** (commit endpoint gateado con `assertProjectMember` — antes cualquier user escribía a cualquier projectId; +2 tests miembro/no-miembro. OBSERVACIÓN: `import.ts:338 tenantId = uid` escribe al namespace personal del caller — posible legacy/bug separado, no tocado); ~~OAuth refresh_token envelope default-ON~~ **✅ hecho** (`oauthTokenStore.envelopeEnabled()` ahora default-ON: el refresh_token se cifra con envelope salvo `OAUTH_ENVELOPE_ENABLED=false`; el read-path ya aceptaba plaintext-legacy + envelope → sin migración. Degradación elegante: si el adapter KMS no está disponible —p.ej. `cloud-kms` sin `KMS_KEY_RESOURCE_NAME`— loguea `oauth_envelope_adapter_unavailable` y cae a plaintext en vez de romper el flujo OAuth. +6 tests `oauthTokenStore.test.ts` (default-ON cifra, opt-out plaintext, degradación, round-trip unwrap, legacy plaintext); KMS_ROTATION.md actualizado, 2026-06-06 · PR #706); ~~`webauthnAssertion.ts:204` clone-detection~~ **✅ hecho** (bypass de anti-clon: la guarda `newCounter !== 0` permitía que un atacante con counter reportado 0 pasara aunque el counter almacenado fuera >0; corregido a `stored.counter > 0 && newCounter <= stored.counter` — alineado con el gate canónico de `curriculum.ts:866`; +4 vitest RED→GREEN, incluye el caso bypass; consumidores —suseso/sitebookSign/ds67ds76/medicalAptitude/aptitudeCertSigner— 91 tests verde, 2026-06-06 · PR #703); ~~`admin.ts:124,199` audit sin try/catch (#14)~~ **✅ hecho** (helper `safeAudit` aplicado a los **7** writes de `audit_logs` de admin.ts → fallo de auditoría no rompe la operación ya completada; +1 test directive-#14, 2026-06-05); ~~Math.random IDs (`PortalManager.tsx:521`)~~ **✅ hecho** (id de portal → `randomId()` crypto, #15, 2026-06-05). (super/vitest)

### B5 — Cumplimiento & SUSESO 🔐  · ref `DEEP-B5` + `DEEP-EX-11/12/13`
- [x] 🔴 DTE firma WebAuthn nunca verificada (`dte.ts:349`) (F4). (super) → ✅ #765 (`dte.ts:404` `verifyWebAuthnAssertion` antes de firmar el DTE; rechazo→warn+abort).
- [x] 🔴 `suseso.ts`/`ds67ds76.ts` tenantId del body → token (F3). **suseso.ts ✅ hecho** (helper compartido `src/server/auth/callerTenant.ts` `resolveCallerTenant`/`callerTenantOr403`: el tenantId ahora es autoritativo desde `req.user.tenantId` —estampado por `verifyAuth` del claim verificado—; si el body/query trae tenantId DEBE coincidir, si no 403 `tenant_mismatch`; sin claim → 403 `no_tenant_binding`. Antes un usuario del tenant A pasaba `tenantId:B` y creaba/firmaba/mutaba DIAT/DIEP del tenant B. Aplicado a los 4 endpoints autenticados —create/sign/submit/mark-submitted—. +tests cross-tenant 403 + token-stamped, 52 verde, typecheck/lint 0, 2026-06-06 · PR #707). **`ds67ds76.ts` ✅ hecho** (mismo helper `callerTenantOr403` aplicado a los **6** endpoints —ds67/ds76 create, pdf, sign—; tenantId del token, no del body/query; +4 tests cross-tenant/no-binding 403, 19 verde, 2026-06-06 · PR #708). (super)
- [x] 🔴 `SusesoReports.tsx:419` RUT falso `12.345.678-9` → exigir RUT real (no fabricar dato legal). (comp) → ✅ #759 (`SusesoReports.tsx:62-63` nunca renderiza un RUT fabricado; warning "datos del empleador incompletos" si falta).
- [x] 🔴 `documents` y `workers/{wid}/documents` sin reglas → reglas+tests; `SusesoReports.tsx:143` "Guardado en Drive" falso → fix try/catch. (rules/comp) → ✅ #770 (`firestore.rules:928` `match /workers/{workerId}/documents/{documentId}` owner-gated; top-level `documents` `:544` vía #667) + #764 (`deriveDriveSaveStatus`: "saved" solo desde upload verificado, fin del falso éxito) + ✅ #786 (bug runtime hallado en make-real: `DocsModal` subía docs SIN el campo `archived`, pero el listener `onSnapshot` filtra `where('archived','==',false)` → los docs recién subidos nunca aparecían en la lista viva hasta recargar; ahora se escribe `archived:false` en el upload).
- [ ] 🟡 `siiPreflightCheck` env names; `profiles.ts` régimen privacidad; `noopSiiAdapter` guard NODE_ENV; `mark-paid` → **activar tier**; **adapters SII LibreDTE/OpenFactura/SimpleAPI + `dteIssueQueue` → implementar+cablear** (no dejar stub). (super/vitest)
- [ ] 🟡 `generateSusesoFormMetadata` validar catálogo; legal-calendar "Marcar cumplida" → server+audit (#3); kms-sign-rsa verify (F4); thresholds CPHS≥25/Depto≥100. (vitest)
- [ ] 🔵 `susesoBackend`/`legalBackend` JSON.parse (F2); `committee_minutes`/`training_record` /emit stubs → **implementar generación PDF real** (#13); dte audit (#14)/err.message 5xx (#8).

### B12 — CPHS & Comités 🔐  · ref `DEEP-B12` + `DEEP-EX-18`
- [x] 🔴 `comite_actas` regla de write → **HECHO** (`firestore.rules` member-gated create/update + schema `isValidComiteActa` (hasOnly 5 campos, no PII smuggle) + `createdAt`/`fecha` inmutables en update + delete admin/supervisor; 10 rules-tests `comiteActas.rules.test.ts` verdes en emulador local; Dirty-Dozen 38-40 en `security_spec.md`; PR #760). Antes default-deny rompía el guardado de actas. **Consolidación con `cphs_meetings` queda como follow-up** (migración de datos separada — no fabricar). (rules)
- [x] 🔴 `cphs_meetings:1175` append-only no preserva prefijo del array de firmas **✅ COMPLETO** (post-firma **✅ #774**: la rama APPEND, Caso B, validaba sólo que el array creciera en 1 sin asegurar el prefijo → un miembro podía reescribir/forjar co-firmas previas; ahora Caso B exige array nuevo == array viejo + 1 elemento appendeado (concat-equality), firmas previas inmutables; +7 rules-tests RED→GREEN + Dirty-Dozen 53-55). **Primera firma ✅ #796:** Caso A se dividió en **A1** (borrador: `signatures` sigue vacío, cuerpo libremente editable) y **A2** (primera firma: EXACTAMENTE una, `tail.uid == request.auth.uid` self-binding, cuerpo bit-a-bit idéntico); `committeeId`/`scheduledAt`/`signatures is list` hoisted como invariantes sobre los tres sub-casos → cierra el spoof de identidad en la firma inaugural, el batch-plant de N firmas pre-forjadas, y el body-tamper simultáneo; +rules-tests `cphsMeetings.rules.test.ts` + Dirty-Dozen 64/65/66. (rules)
- [ ] 🟡 `cphsService` client-side sin audit (#3) → ruta server; `culturePulse.respondSurvey:657` audita userId → anonimizar/hash. (super/vitest)
- [ ] 🔵 `organic.ts` err.message (#8); `comiteBackend.ts:37,75` JSON.parse (F2); `useAgenda`/`useMeetingPack`/`useRaciMatrix` huérfanos → **montar**.

### B4 — Incidentes & Investigación 🛟  · ref `DEEP-B4` + `DEEP-EX-16/17`
- [x] 🔴 `sif.ts` `reviewedByUid`/`reviewedAt` del body → token (F3). **HECHO**: el endpoint `executive-review` de precursores SIF (lesión grave/fatalidad) estampaba el revisor y la fecha desde el BODY → un caller podía atribuir la revisión a otro ejecutivo y antedatarla. Ahora `reviewedByUid = req.user.uid` (token) y `reviewedAt = new Date().toISOString()` (reloj server); el schema solo acepta `reviewNotes`. +test real-router `sif.router.test.ts` (401/403-no-miembro/204-estampa-caller-ignora-body-forjado/404-sin-tenant), typecheck/lint 0, 2026-06-06 · PR #709. (super)
- [~] 🟡 `incidentFlow.ts:77` `flowDepsFor` sin `createEdge` → grafo PDCA conectado (PENDIENTE); ~~writeAudit shape → canónico~~ **✅ hecho** (el `writeAudit` hand-rolled escribía `{kind, actorUid, createdAt}` → los lectores de audit (que filtran por `action`/`userId`/`timestamp`/`module`) saltaban silenciosamente esos eventos de incident-flow; ahora emite la forma canónica `{action, module:'incidentFlow', userId, projectId, details{tenantId}, timestamp}` en el `audit_logs` top-level; +assert de forma canónica en `incidentFlow.test.ts`, 5 verde, typecheck/lint 0, 2026-06-06 · PR #715). (vitest)
- [~] 🟡 `root_cause_analyses` vs regla `root_causes`; `incidentPostmortem` audita a `tenants/{tid}/audit_log`→root; incidents path mismatch; ~~`pdca.ts` /advance sin runTransaction (#19)~~ **✅ hecho** (el handler hacía `get()`→computar transición de fase→`set()` sin atomicidad → dos `/advance` concurrentes podían leer el mismo `currentStage` y doble-transicionar el PDCA; ahora envuelto en `db.runTransaction` que retorna union discriminado y mapea a HTTP afuera; +2 tests —commit atómico de la fase, 400 no_entry—, 10 verde, typecheck/lint 0, 2026-06-06 · PR #713); ~~`lessonsLearned` adoptionCount del body→server~~ **✅ hecho** (el create aceptaba `adoptionCount` del body y lo guardaba → cualquier miembro inflaba la adopción de una lección para gamear el ranking `listTopAdopted`; ahora se quita del schema y se fuerza `adoptionCount: 0` server-side —la adopción solo se incrementa por el path del adapter al reusar—; +test real-router `lessonsLearned.router.test.ts`: 99999 forjado → guardado 0, 4 verde, typecheck/lint 0, 2026-06-06 · PR #714). PENDIENTE: `root_cause_analyses`/`incidentPostmortem`/incidents path (rules — emulador). (rules/super)
- [~] 🔵 ~~`incidentRagService.ts:299`/`incidentCommands` Math.random→randomId~~ **✅ hecho** (ambos minteaban ids del PRNG; ahora derivan el componente random de `randomId()` preservando las SHAPES `inc_<ts>_<6alnum>`/`evt`; +tests shape+unicidad×50; PR #779); ~~custody appendEvent doc-id colisión~~ **✅ hecho** (`CustodyChainAdapter.appendEvent` keyaba por `event.at` (ISO) → dos eventos en el mismo ms sobrescribían el doc en una cadena de custodia legal; ahora doc-id `${event.at}_${randomId()}`, prefijo `at` mantiene orden temporal, randomId garantiza unicidad; +2 tests TDD RED→GREEN; PR #778); **CQRS in-memory → persistente** (cablear, PENDIENTE).
- [x] 🔴 ~~H8 — Subsistema Cadena de Custodia (J.7) inerte: motor `custodyChainService.ts` + adapter sin caller productivo, sin ruta `verifyAuth`, sin mount, colección `evidence_artifacts` sin regla (default-deny dead-code)~~ → ✅ **#800** (`src/server/routes/custodyChain.ts`: 5 endpoints bajo `/api/sprint-k` —GET artifact+chain, POST register/replace/access/export—, cada uno `verifyAuth` + `assertProjectMember`, identidad server-stampeada del token (`uploadedByUid`/`actorUid`, nunca del body), `audit_logs` awaited try/catch por op; mount en `server.ts`; reglas `tenants/{tid}/evidence_artifacts/{hash}`(+`/events/{eid}`) member-read + write server-only + `/events` APPEND-ONLY inmutable; `src/rules-tests/evidenceArtifacts.rules.test.ts` 9 casos harness F1 + `src/__tests__/server/custodyChain.router.test.ts` 20 casos supertest motor+adapter reales; Dirty-Dozen #67–69; DEEP-EX-16 H8 ✅). (rules/super)

### B8 — Permisos de trabajo & LOTO 🛟  · ref `DEEP-B8` + `DEEP-EX-19`
- [x] 🔴 ~~LOTO write-path: `loto.ts:55` solo GET → **implementar+cablear** endpoints apply-lock/verify-zero-energy/release + adapter + audit + **montar** `LotoStatusPanel`.~~ → ✅ **verified complete** (ya en `main`): `src/server/routes/loto.ts` expone los POST `:projectId/loto/:appId/apply-lock` / `verify-zero-energy` / `release` (todos `verifyAuth`, gate de release firmado vía `validateRelease`) y `src/components/loto/LotoStatusPanel.tsx` existe con tests. (super/comp)
- [ ] 🟡 `exceptions/legal_obligations/shifts` laxos (con B17); stoppage/softBlocking compute-only → persist+audit. (rules/super)
- [ ] 🔵 `exceptionFirestoreAdapter`/`stoppageFirestoreAdapter` (real, sin caller) → **cablear** al flujo.

### B9 — Inspecciones, Checklists & Observaciones  · ref `DEEP-B9` + `DEEP-EX-20/21`
- [x] 🔴 `site_book` firmado mutable (gate `signedAt` top-level vs `signature.signedAt`, `siteBookSigning.ts:247`) → fix gate + **fix test falso-verde** (`projectScopedStores.rules.test.ts:181`). (rules) → ✅ #771 (`firestore.rules:629-632` el `update` exige `existing().status != 'signed' && !('signature' in existing())` → entrada firmada inmutable; el test ahora siembra la forma real `status:'signed'`+`signature.signedAt` anidado, sin `signedAt` fantasma — muere el falso-verde).
- [~] 🔴 `lighting_audits` mutable post-firma (`LightPollutionAudit.tsx:123`) **✅ #794 (gate cerrado):** la regla gateaba la inmutabilidad sobre `existing().metadata.signedAt == null`, campo que NINGÚN write-path setea (el writer persiste un boolean TOP-LEVEL `signed`) → la cláusula era vacuamente verdadera y un certificado firmado quedaba mutable (e incluso `signed` reseteable). Ahora gatea sobre el campo REAL: `existing().signed != true` deniega TODO update post-firma y `signed` sólo puede ir false→true (correcciones = auditorías NUEVAS); +rules-tests + Dirty-Dozen 62/63. **PENDIENTE:** SiteBook 3 paths disjuntos → unificar. (rules/super)
- [ ] 🟡 `photoEvidenceFirestoreAdapter.save` nunca escribe `linkageKeys` (queried) → fix; `photo_evidence`/`positive_observations`/`quota_usage`/`sitebook_crdt_drafts` sin reglas; `siteBookStore.nextSequenceForYear` no transaccional (folios DS76). (rules/vitest)
- [ ] 🔵 `iso_documents`/`iso_improvements` schema/audit+owner bug; qrSignature 500→503; `sitebookSignRoutes` assertProjectMember.

### B6 — Capacitación & Currículum  · ref `DEEP-B6` + `DEEP-EX-22/23`
- [x] 🔴 `gamification.ts:35` auto-otorga puntos (amount del cliente) → whitelist/cota server. **HECHO**: el endpoint sumaba `req.body.amount` al puntaje del caller → cualquier user se auto-otorgaba puntos ilimitados (abuso de leaderboard + umbrales de medallas). Ahora el monto es **server-authoritative**: catálogo único `src/services/gamification/pointValues.ts` (`POINT_VALUES`), el server otorga `POINT_VALUES[reason]` e **ignora el amount del cliente**; reason no-whitelisted → 400 `invalid_reason`. Consolidado: el catálogo (antes duplicado en `gamificationService.ts` cliente) es ahora la única fuente, reusada por cliente (UI) y server. +tests: amount forjado ignorado (otorga 50), invalid_reason 400, sin-reason 400; 13 verde, typecheck/lint 0, 2026-06-06 · PR #712. (super)
- [x] 🔴 Referee co-sign WebAuthn nunca verificada (`RefereeAccept.tsx:82`/`claims.ts:306`) (F4). (super) → ✅ #766 (honest-label: `curriculum.ts:631-651` — el path público no tiene credencial enrolada ni uid, así que un intent `webauthn` se registra como `device_attested` con `webauthnVerified:false`, JAMÁS como firma cripto-verificada; ya no sobre-afirma).
- [x] 🔴 ~~`read_receipts` (DS44/RIOHS) sin regla → reglas+tests; `microtraining.ts:187` `grantCert(body.workerUid)` → callerUid (F3)~~ → ✅ **ya hecho (verificado, sin marcar)**: regla `read_receipts` owner-gated en `firestore.rules:595-602` (workerUid inmutable, delete denegado) + 6 rules-tests F1 en `drivingAndReceipts.rules.test.ts`; `microtraining.ts:85` usa `callerUid = req.user!.uid` (NO el body) con `auditServerEvent` awaited (`microtraining.ts:196`) + supertest `microtraining.router.test.ts`. (rules/super)
- [~] 🟡 `trainingCertificate` sobre-afirma legal → **añadir firma/QR/hash verificable** (PENDIENTE); training root client-write (PENDIENTE); ~~`gamificationBackend` field-path injection~~ **✅ hecho** (`awardPoints` interpolaba `reason` en un field-path Firestore `completedChallenges.${reason}` → un `reason` con punto creaba campos anidados arbitrarios; ahora valida `reason` contra `^[A-Za-z0-9_]{1,64}$` —y uid/amount— antes de tocar Firestore, defense-in-depth aunque la ruta ya whitelist-ea post-#712; +4 tests `gamificationBackend.test.ts`, 2026-06-06 · PR #716); ~~`onboarding.ts:268` audit (#14)~~ **✅ ya satisfecho** (línea 268 ya hace `await auditServerEvent(...)`, no `void`; `auditServerEvent` nunca throwea). (vitest)
- [ ] 🔵 `PublicNodeView` colección `zettelkasten` huérfana → cablear; **7 hooks + 5 componentes huérfanos → montar** (microtraining/spacedRep/skillGap…); duplicación pyme → **consolidar**.

### B10 — EPP, Activos & Mantenimiento  · ref `DEEP-B10` + `DEEP-EX-24/25`
- [ ] 🟡 `horometerEngine.ts:69,117` lógica de bloqueo contradice directiva #2 → **reconvertir a ADVERTENCIA** (no bloqueo) y cablear su consumidor honestamente. (vitest)
- [ ] 🟡 `eppFlow.ts:240` órdenes en Map volátil → store durable; order-pdf sin `signedNodeId`; `EPPVerificationModal.tsx:63` foto a Gemini (#12) → on-device; eppFlow WebAuthn TODO server (F4). (vitest/comp)
- [~] 🔵 `maintenanceScheduler.completeMaintenanceTask` RMW sin runTransaction (#19); montar UIs admin EPP huérfanas. **`EquipmentAdminPanel` ✅ #814** (estaba sin import → inalcanzable; `Assets.tsx` montaba solo `MaquinariaManager`; ahora tabs Maquinaria|Equipos, backed by `listEquipmentBySite`/`registerEquipmentQr` reales; +`Assets.test.tsx` 3 casos jsdom de wiring). **PENDIENTE:** `Horómetro` (el `HorometroEntryForm` exige prop `equipment` → necesita un contenedor lista-de-equipos que NO existe) y `HazmatStorageManager` (solo estado local, sin persistencia → montar surfacearia data-loss) → follow-ups; `completeMaintenanceTask` runTransaction sigue pendiente.

### B11 — Contratistas, Visitas & Acreditación  · ref `DEEP-B11` + `DEEP-EX-26`
- [~] 🔴 `visitors.ts:112` sin `assertProjectMember` → **✅ hecho** (helper `assertMemberAndResolveTenant` aplicado a los **4** endpoints —check-in/check-out/acknowledge-induction/GET list—; antes cualquier user autenticado registraba/cerraba/listaba visitas de CUALQUIER projectId porque solo resolvía el tenant del proyecto sin verificar membresía. +tests: no-miembro→403 sin escribir, miembro-sin-tenant→400, happy-paths re-seedeados con membership; 30 verde, typecheck/lint 0, 2026-06-06 · PR #711). PENDIENTE: `driving_incidents` (`SafeDriving.tsx:94`) sin regla → reglas (emulador). (super/rules)
- [ ] 🟡 colisión ruta `safe-driving` → resolver (ambos componentes cableados a su ruta); `ClimateRoutes:215` botón "Calcular Ruta" → **cablear** al cálculo real. (comp)
- [ ] 🔵 `resolveObservation` → **exponer/cablear UI**; DS76 duplicado → **consolidar**; stack `visitor_accesses` → **cablear o consolidar** en el canónico.

### B13 — MOC & Operaciones críticas  · ref `DEEP-B13` + `DEEP-EX-27/28`
- [x] 🔴 ~~UI MOC/handover escribe por store cliente sin audit (`OperationalChanges.tsx:46`) → **re-cablear a endpoints auditados** (o trigger server) (#3)~~ → ✅ **ya hecho (verificado, sin marcar)**: `src/server/routes/operationalChange.ts` montado en `server.ts:1042` (`/api/sprint-k/:projectId/moc/*`), cada ruta `verifyAuth` + `assertProjectMember` (`:95`) + `auditServerEvent` awaited (`:153` `moc.declare`); `OperationalChanges.tsx` ahora llama `operationalChangeApi` (endpoints server), SIN write al store cliente; supertest `operationalChange.test.ts`. (super)
- [ ] 🟡 `shiftHandover` compute-only + adapter huérfano (#606) → **cablear** persist+audit; acuse mutable (rules:475) → post-sign deny; `shiftBackend.ts:66` JSON.parse (F2). (super/rules)
- [ ] 🔵 `changeMgmt` → **consolidar** en `operationalChange` (preservar capacidades); `continuity`/`criticalRoles` UI huérfana → **montar** (SpofPanel, CriticalRoleCoverageCard).

### B14 — IA / Gemini / SLM & Copilots 🔐  · ref `DEEP-B14` + `DEEP-EX-30/31/32/33`
- [ ] 🔴 `networkBackend.ts:41,77` RAG-poisoning + cross-tenant → F3 + scope (`vector_store` por tenant). (super)
- [ ] 🔴 `KnowledgeIngestion.tsx:60` nodos global/master sin gate; `ragService.queryCommunityKnowledge` self-poisoning → score-gate+audit. (super/vitest)
- [x] 🟡 SLM integridad: ~~`loader.ts` pesos CDN sin sha256 → verificar como `slmRuntime.ts`; `onnxAdapter` tinyllama → **corregir registry**; `searchRelevantContext` fallback hardcoded → **cablear** a `safeNormativeQuery` real~~ → ✅ **#801** (`loader.ts` corre `assertModelIntegrity` SHA-256 en cache-hit Y download antes de persistir/retornar —fail-closed como `slmRuntime.ts`, null-hash staging permitido; `onnxAdapter` registry corregido de `q4` fabricado a `int8` real —nombre/quant/URL/cache-key; el artefacto descargado es `decoder_model_merged_quantized.onnx` int8, no 4-bit; `searchRelevantContext` ya NO retorna el string legal hardcodeado "Ley 16.744…" → delega a `safeNormativeQuery` (coseno ≥0.75, snippet `[Fuente:]` verificado o mensaje canónico "sin info verificada", nunca ley inventada). +fix regresión `slmAdapter.test` (stub `loadModel`) y `gemini.ts` `contextUsed`; SLM+RAG 341/341, consumers gemini 122/122). (vitest)
- [~] 🟡 SLM offline OFF + Phi-3/Gemma CDN → **bundlear** modelos; `resilientAiOrchestrator` flag OFF → **encender** (ADR 0019); `designHazmatStorage` export collision → cablear versión RAG; 6 JSON.parse (F2). (vitest)
  → ✅ #792 (degradación real Gemini→SLM, directiva #2/ADR 0019 §2): cuando una acción TEXT whitelisteada de `/api/gemini` devuelve completion vacío/undefined o lanza error upstream empty/parse, el dispatcher ya **no** entrega un 502 seco — ahora intenta la **escalera resiliente server-realizable** RAG (`safeNormativeQuery`, guard COSINE ≥0.75 anti-alucinación) → canned-por-dominio (`CANNED_BY_DOMAIN`, normas chilenas reales + disclaimer) vía nuevo `src/services/gemini/geminiSlmFallback.ts`; `recordGeminiOutcome('failure')` preservado (el breaker sigue abriendo), todo el intento en try/catch (un bug del fallback nunca convierte 502→500). Tests: `geminiSlmFallback.test.ts` + `gemini.slmFallback.test.ts` (router real, empty→degraded, parse-error→degraded, both-fail→502, unmapped/non-empty→sin cambio).
  **PENDIENTE `[~]`:** opt-in en sólo **3 acciones** representativas (`getSafetyAdvice`/`getChatResponse`/`queryBCN`) — quedan ~80 acciones TEXT sin mapear; el SLM on-device real (`src/services/slm/*`, browser-only Web Worker, 0 importers en `src/server`) **no corre en Express**, así que **bundlear** Phi-3/Gemma (CDN→bundle) y encender el `resilientAiOrchestrator` cliente siguen pendientes.

### B15 — Facturación, Suscripciones & Tier-gating 🔐  · ref `DEEP-B15` + `DEEP-EX-29`
- [~] 🔴 Tier-gating por-feature solo client-side (`SubscriptionContext.tsx:64`) → middleware server (#11). **PRIMITIVO HECHO**: `PLAN_RANK`+`planRank`/`planMeetsMinimum` consolidados en el canónico `services/pricing/subscriptionPlan.ts` (antes el rank vivía duplicado en `SubscriptionContext`, ahora ambos —cliente UX + server— comparan los MISMOS ranks); nuevo middleware `src/server/middleware/requireTier(minPlan)` que lee `users/{uid}.subscription.planId` (Admin SDK) y compara: 401 sin caller, **402 `upgrade_required`** bajo el mínimo, fail-CLOSED 403 si la lectura falla, plan ausente→free. +7 tests `requireTier.test.ts` (al/sobre mínimo, exacto, bajo→402, sin-plan→free, alias legacy, fail-closed). typecheck/lint 0, 2026-06-06 · PR #719. **PRIMERA RUTA CABLEADA ✅** (PR #720): `GET /api/drive/auth/url` (integración Google Drive/Workspace) gateada con `requireTier('titanio')` — el cliente `GoogleDriveIntegrationManager` ya ocultaba la UI bajo `canUseGoogleWorkspaceAddon` (titanio) y un comentario pedía explícitamente "tighten the route"; ahora el server lo ENFORCA (no rompe integraciones ya conectadas, que refrescan con el token guardado, no por esta ruta de inicio). +2 tests en `oauthGoogle.test.ts` (free→402, titanio→200). **GUARDRAIL ✅** (ADR 0021 + PR #722): principio codificado — las funciones que **salvan vidas son gratis en TODOS los tiers**; el tier-gating es solo de gestión/escala/integración. Test de gobernanza `tierGatingGovernance.test.ts` **falla CI** si alguien monta `requireTier` en una ruta life-safety (SOS/emergencia/evacuación/ManDown/brigada/DEA/incidente/lone-worker). **PENDIENTE**: el resto de features premium (SSO/API-access/branding/analytics avanzado) NO tienen ruta server hoy (son cliente/aún no construidas); se gatean cuando existan, reusando `requireTier`. (super)
- [ ] 🟡 `mark-paid` → **activar** `users/{uid}.subscription`; Khipu sin checkout → **implementar endpoint**; Apple SSN leaf-only → chain verify; `BILLING_TIER_FALLBACK` añadir `global-titanio`. (super/vitest)
- [ ] 🔵 `runB2dMrrSnapshot` job huérfano → **cablear** (scheduler/endpoint).

### B18 — Analítica / Reportes / Dashboards  · ref `DEEP-B18` + `DEEP-EX-34/35/36`
- [ ] 🟡 `dataConfidence.ts:302` `inconsistenciesCount:0` → **cablear cómputo real**; `SloErrorBudget`/`WeatherBulletin`/`CQRSArchitecture` dato falso → **cablear a datos reales**. (comp/vitest)
- [ ] 🟡 `insights.ts` colecciones top-level sin tenantId/regla → scope; `portableHistory.ts:231` fallback PII cross-tenant; `environmentBackend.client` API key en navegador → **proxy server**. (super/rules)
- [ ] 🔵 `reportsAutomation` `contentHash` → **computar**; `predictionBackend` metering Pro/Flash; `assertNoPII` → **cablear**; AlertScheduler probes (con B1).

### B-DigitalTwin (bloque nuevo)  · ref `DEEP-NH-services-infra` + `DEEP-EX-37/38`
- [x] 🔴 `reconstructions` storage+jobs reglas. **`reconstruction_jobs` ✅ #806**: regla `projects/{pid}/reconstruction_jobs/{jobId}` member read+create/update, admin/supervisor delete (mirror `placed_objects`; era default-deny → `createReconstructionJob()` fallaba ANTES del upload GLB) + 7 rules-tests F1 `reconstructionJobs.rules.test.ts` + Dirty-Dozen #70. **`placed_objects` ✅ ya hecho** (regla `firestore.rules:575-578` + tests en `findingsPlacedObjects.rules.test.ts` — la afirmación "sin regla" del ledger era incorrecta). **Storage ✅ #812:** TODO `storage.rules` reescrito. Hallazgo decisivo: Cloud Storage rules NO pueden leer Firestore, y el provisioning real acuña `assignedSiteIds` (project ids), NO un claim `tenantId` (`createProject` no estampa tenantId; `__GP_TENANT_ID__` nunca se asigna) → gatear por `isMemberOfTenant(tid)` habría **default-denegado uploads para casi todos** (lo opuesto a "make real"). DIVERGENCIA documentada del plan tenant-keying: se mantienen los paths REALES project-keyed que los 10+ uploaders YA usan (`projects/{pid}/**`, `ai_reports`, `blueprints`, `suseso_reports` PDF-inmutable vía `resource==null`, `reconstructions` GLB/USDZ, `documents/{workerId}` auth, `workers/{uid}` per-uid) gateados por `assignedSiteIds` (`memberOfSite`: claim-ausente→allow legacy, presente+listado→allow, presente+no-listado→deny, self-heal en token refresh). **CERO cambios en uploaders** → riesgo casi-nulo, uploads funcionan ya (antes TODOS default-denegados). Esquema aspiracional `tenants/`+`quarantine`→AV muerto eliminado; AV/quarantine + aislamiento full-claim DIFERIDOS (documentado in-file). **Primera cobertura storage-rules del repo:** `src/rules-tests/storageRules.rules.test.ts` 19 casos contra el Storage emulator REAL; `test:rules` + ci.yml ahora bootean `--only firestore,storage`; suite full 447/447; Dirty-Dozen storage #84-88. (rules)
- [ ] 🔴 `pages/BlueprintViewer.tsx` mock ruteado (#13) → **cablear la ruta a la versión real** (upload+Firestore de AIHub); `verifyTwinStepUp.ts` no cableado (ADR 0011) → **cablear**. (comp/super)
- [ ] 🔵 COLMAP infra: **NO eliminar a ciegas** — documentar como superseded por on-device (§2.28, que es la función real); consultar antes de tocar `infra/`.

---

## Fase 5.2 — Cross-cutting config/seguridad (bajo riesgo, intercalable temprano)
- [ ] 🔴 **Dominio/WebAuthn**: unificar `praeventio.app` (manifest/AASA/assetlinks) vs `app.praeventio.net` (server/WebAuthn) + `WEBAUTHN_RP_ID`/`WEBAUTHN_RPID` → un dominio canónico (passkeys+deep-links).
- [x] 🔴 ~~**iOS mesh `CBUUID` inválido** (`packages/capacitor-mesh/ios/.../Plugin.swift:34`) → replicar mapeo no-hex→hex de Android (interop BLE)~~ **✅ hecho** (iOS construía `CBUUID(string:)` desde el brand string `00001234-PRAE-VENTI-O123-...` (no-hex, 3er grupo 5 chars) → CBUUID lo rechaza y crashea al iniciar advertise/scan; además su characteristic UUID no coincidía con Android → peers iOS/Android nunca se descubrían; ahora reusa los UUID BLE-válidos que Android ya deriva (service `00001234-12AE-3E45-7123-...`, mesh-data `0000ABCD-12AE-...`) idénticos en todas las plataformas; PR #777).
- [x] 🔴 ~~**`render-well-known.mjs:31`** cert Play hardcodeado → exigir `ANDROID_CERT_SHA256` fail-closed~~ → ✅ **#802** (eliminado el fallback `?? '3D:AC:D9:…'`. `resolveAndroidSha`: valor PRESENTE pero placeholder/malformado SIEMPRE lanza; AUSENTE retorna null → assetlinks con fingerprints vacíos honestos + warning (builds web/dev/CI no requieren keystore), salvo `REQUIRE_ANDROID_CERT=1` (release) que falla closed. `render()` inyectable {env,fsImpl,log,warn}; +13 tests reales —fail-closed, rechazo placeholder/malformado incl. 31-byte/no-colon, prueba que el fingerprint prod hardcodeado nunca aparece. Cero cert fabricado en ningún path. Verificado: prebuild exit 0 sin cert, exit 1 con REQUIRE_ANDROID_CERT=1 sin cert. (+#803 chore: typecheck:ci heap 4→8 GB, arregla OOM intermitente que bloqueaba merges).
- [x] 🔴 **DR replication** (`firestoreCriticalReplicate.ts:154` `createdAt`→`timestamp`; invoices Timestamp) + fix test falso-verde. (vitest) → ✅ #735 (window critical-replica sobre el campo Timestamp real por colección).
- [x] 🔴 **voseo es-AR en `es/common.json`** (`Reintentá`/`Seleccioná`/`vos sos`) → "tú" chileno (Regla #2). → ✅ #736 (grep de `Reintentá`/`Seleccioná`/`vos sos` en `es/common.json` = 0).
- [ ] 🟡 **Cap de gasto IA por-pod** (`limiters.ts` MemoryStore) → store Firestore (ADR 0019).
- [ ] 🟡 **Gemini ADR 0019** (track): Vertex paga + orquestador resiliente ON + ruteo Flash + RAG-first + budget por tier.

## Épica Rubros SII — homologación de códigos de actividad económica (diseño 2026-06-10)
Precargar el perfil preventivo según el código de actividad económica del SII (clasificador
CIIU4.CL) al clasificar el proyecto en el onboarding. Reutiliza piezas existentes:
`INDUSTRY_SECTORS`/`EPP_BY_SECTOR` (`src/constants.ts`), paso `industry` del `OnboardingWizard`
(`src/components/onboarding/`) y el pack normativo CL (`src/data/normativa/cl.ts`).
- [x] **Slice 1 — datos + motores puros + tests** ✅ (rama `claude/sii-rubros-slice1`):
  - `src/data/sii/actividadesEconomicas.ts` — 110 códigos SII REALES (subset curado de los
    rubros objetivo), cada uno verificado 2026-06-10 contra DOS fuentes oficiales sii.cl
    (lista "códigos de actividad económica" + PDF de homologación CIIU4.CL 2012); descripción
    oficial verbatim + mapeo a sectorId GP-*. Cero códigos fabricados.
  - `src/services/sii/rubroSearch.ts` — búsqueda pura por código exacto, prefijo (forma
    canónica 6 dígitos con cero inicial) y texto con normalización de tildes; entrada
    `searchRubros()` para el autocompletado del wizard.
  - `src/services/sii/industryRiskProfile.ts` — `getRiskProfileForSector()` arma el perfil
    desde piezas existentes (regulaciones del pack CL por sector: minería→cl-ds-132,
    construcción→cl-ds-76+bitácora, agro→cl-ds-594+plaguicidas como texto, residuos→cl-ds-148,
    todos→cl-ley-16744+cl-ds-44; EPP de `EPP_BY_SECTOR`; 5-8 riesgos semilla es-CL por sector
    mayor) y `obligacionesPorDotacion()` deriva CPHS/delegado SST/Depto Prevención leyendo los
    umbrales del pack (no hardcodeados — test con pack sintético lo pinea).
  - TDD: 52 tests nuevos (catálogo: 6 dígitos, sin duplicados, sectorIds existentes,
    spot-checks 410010/040000/089110/492300; búsqueda exacta/prefijo/texto/tildes; perfil por
    sector con ids reales del pack; bordes de dotación 0/10/24/25/99/100).
- [ ] **Slice 2** — wiring wizard + autocompletado de rubro SII en el paso `industry` del
  `OnboardingWizard` (UI es-CL), persistir `codigoActividadSii` en el proyecto.
- [ ] **Slice 3** — instanciación de semillas al crear proyecto (riesgos típicos + obligaciones
  por dotación → registros iniciales del proyecto, con audit_logs).
- [ ] **Slice 4** — agregación anónima por rubro (benchmarks entre proyectos del mismo código
  SII, sin PII, k-anonimato).

## Fase 5.3 — Doc-drift sweep (bajo riesgo, intercalable)
- [ ] Actualizar: `ARCHITECTURE.md` (LOC/refs #20), `stubs-inventory.md` (mesh real + SystemEngine montado), `CLAUDE.md` (#13/#17), runbooks photogrammetry (superseded), `TRACKING_PLAN.md` (analytics impl), `BERNOULLI_EXTENSIONS.md` (16 motores), `gemini-split-plan.md`, `ADR 0013` (UUID mesh), `ADR 0005/0006` superseded, links rotos terraform/README.

## Track transversal — Calidad de tests (intercalar con cada bloque)  · ref `DEEP-EXT-INDEX`
- [ ] **Reescribir** los 144 tests "wire-up contract" de `src/server/routes/*.test.ts` para que ejerciten el router real (supertest), o asegurar companion en `__tests__/server/`.
- [ ] **Reescribir** la reimplementación-disfrazada (auditCoverage/mercadoPagoIpn/telemetry/webauthnVerify/externalAuditPortal/suseso/visitors…) para importar la ruta real.
- [ ] **Reescribir** tautologías "ID crypto contract" y mock-the-SUT (ragService/MorningRoutine). (No borrar tests; corregir que prueben código real.)

---

## Convenciones (no violar)
- **TDD estricto** RED→GREEN→REFACTOR; tests que ejercitan **código real** — prohibido: Admin-SDK en rules-tests, sembrar el campo del gate, reimplementar el handler en el test, tests "wire-up" solo `router.stack` (catálogo en `DEEP-EXT-INDEX.md`).
- **Hacer REAL, no eliminar** (ver Principio rector): huérfanos→montar, mocks→datos reales, stubs→implementar, duplicados→consolidar; ADR 0012→reconvertir; nada se borra sin consultar.
- Cada cambio de estado escribe `audit_logs`; el servidor estampa uid/tenant del token.
- Nueva colección = reglas explícitas + ≥5 rules-tests (`authenticatedContext`) + Dirty Dozen en `security_spec.md`.
- **Actualizar `TODO.md`** (resuelto con `file:line`) al cerrar cada ítem. **Un PR por bloque**; reusar utilidades existentes.

## Verificación (cada fix, antes de PR)
- `npx vitest run <test>` verde y que **falle sobre la impl vieja** (RED real).
- `npm run test:rules` (emulador, `authenticatedContext`) verde · `npm run typecheck` → 0 · `npm run lint` limpio · pre-commit PASS · copy es-CL "tú" · sin secretos.
