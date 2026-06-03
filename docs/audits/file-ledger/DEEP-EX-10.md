# DEEP-EX #10 — B17-Admin [55:108] · 2026-06-02

**Atestación:** leídos 53/53 línea por línea (admin/auth/RBAC/identidad).

Lote derivado de `ledger.json`: `category` empieza con "FEAT" && `block==="B17-Admin"`,
ordenado por `path`, slice `[55:108]` (53 archivos). El doc previo `DEEP-B17-Admin.md`
cubrió la mayoría a nivel resumen; aquí solo van hallazgos NUEVOS de la lectura exhaustiva.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/services/auditPortal/auditPortalStore.ts:13-23` + `src/pages/AuditPortals.tsx:149` | 🔴 | **Token de auditor externo persistido en PLANTEXTO y legible por cualquier miembro del proyecto.** El store cliente `savePortal()` escribe el `AuditPortalConfig` completo —incluido `accessToken` (la llave bearer del auditor)— en `projects/{projectId}/audit_portals/{id}`. El adapter servidor hermano (`auditPortalFirestoreAdapter.ts:47-52`) **deliberadamente** elimina `accessToken` y guarda solo `accessTokenHash` ("Storing the accessToken in plaintext leaks the auditor's key to anyone with Firestore read access"). El cliente NO lo hashea. | `createProjectScopedStore<AuditPortalConfig>('audit_portals')` guarda el objeto íntegro; `AuditPortals.tsx:149 await savePortal(selectedProject.id, portal)` donde `portal.accessToken` es el token claro de `createPortal()`. |
| `firestore.rules:257-259` (Master Gate) ↔ `audit_portals` | 🔴 | La regla recursiva `match /{subCollection=**}/{docId} { allow read: if isProjectMember(projectId) }` deja **leer todas las subcolecciones** a cualquier miembro, incluida `audit_portals`. Combinado con el hallazgo anterior → **cualquier operario miembro lee el token de cualquier auditor y lo suplanta en `/audit-portal/{token}`**. La regla explícita `:449` solo restringe create/update (anti-spoof `createdByUid`), no el read del token. | `sed firestore.rules:257-259` + `:449-454`. |
| `src/pages/AuditPortals.tsx:138` | 🟡 | **`Math.random()` en generación de ID** de un doc sensible (portal de auditoría): `id: \`portal_${Date.now()}_${Math.random().toString(36).slice(2,8)}\``. Viola directiva #15 ("Math.random banned in any ID-generation code"; usar `randomId()`). Cliente, pero la cláusula de la directiva abarca ID-generation en general; además colisión/predecibilidad del id. | Línea literal en `handleCreate`. |
| `src/server/routes/import.ts:174-249,316-344` | 🟡 | Endpoints `/import/excel` y `/import/commit` aceptan `projectId` en body/options pero **NO llaman `assertProjectMember`** (viola convención #6). Mitigado parcialmente porque `tenantId = uid` (`:338`) fuerza la escritura a `tenants/{uid}/projects/{projectId}/...` → un usuario solo escribe en su propio árbol; pero puede poblar un `projectId` arbitrario bajo su tenant sin validar membresía/existencia del proyecto. Modelo de tenancy "per-uid" cuestionable pero by-design. | `colRef = db.collection('tenants').doc(tenantId=uid).collection('projects').doc(projectId)...`; sin guard de membresía. |
| `src/server/routes/projects.ts:153-163,297-305,372-384,443-454` | 🟡 | **Escalada cross-project vía claim global `role`.** Las checks de autorización para invite/list/remove usan `callerRecord.customClaims?.role === 'gerente' \|\| 'admin'`, que es un claim **global** (no por-proyecto; `assertProjectMember`/`customClaims.ts` confirman que el scope per-project es `assignedSiteIds`, no `role`). Un usuario con `role:'gerente'` en su token puede invitar/listar/expulsar miembros en **cualquier** proyecto donde NO es miembro ni creador. | `customClaims.ts` solo scope-ea `assignedSiteIds`; `role` se lee de `admin.auth().getUser().customClaims.role` sin atar a `projectId`. |
| `src/server/routes/pinSign.ts:184-221,235-255` | 🟡 | **Lockout de PIN evadible (brute-force offline).** `verify`/`sign-item` reciben el `PinCredential` —con `consecutiveFailures`/`lockedUntil`— desde el **body del cliente**, no desde Firestore server-side. El engine (`pinSignService.ts`) es puro y correcto, pero un cliente que nunca persista los fallos resetea el contador en cada llamada → fuerza bruta de PIN 4-6 dígitos. Mitigación parcial: PBKDF2 600k iter encarece cada intento. | `verifyPin({ credential: body.credential, ... })` con credential controlado por el caller; `:199` solo valida `workerUid===callerUid`, no la integridad del contador. |
| `src/server/routes/roleViews.ts:60,89-92` | 🟡 | **Doc-vs-code drift + role-view escalation.** El comentario `:11-12` afirma "`userUid` and `userRole` ... forced from the authenticated caller (anti-impersonation)", pero el código solo fuerza `userUid` (`:90`); `userRole` se toma de `body.state` (`:60`). Un worker puede pedir `userRole:'management'` y obtener la vista de cards de gerencia. Impacto bajo (engine puro sobre métricas del body, sin fuga de datos del servidor) pero contradice la directiva declarada. | `state = { userUid: callerUid, ...body.state }` — `userRole` del body sobrevive. |
| `src/services/audit/tamperProofChain.ts:55-60` | 🔵 | **Doc-vs-code drift en GENESIS_HASH.** El comentario dice `Valor: SHA-256("praeventio:audit-genesis:v1")` y "cualquier auditor puede recalcularlo y verificar". El valor real `6e6f…c4b` NO es ese hash (el real es `8843b1aa…21f251eb`); es un patrón repetitivo tipeado a mano. La seguridad de la cadena no depende del anchor, pero un auditor que siga la doc concluiría que la cadena es inválida. | `node -e crypto.createHash('sha256')...` → `8843b1aa…` ≠ constante. |
| `src/server/routes/leadership.ts:136-162` | 🔵 | GET `/leadership/decisions?supervisorUid=` y `/ranking` exponen **rationale/decisiones de cualquier supervisor** a cualquier miembro del proyecto (sin restricción de rol). El POST sí fuerza `supervisorUid=callerUid` (`:235`, correcto). Probablemente by-design (ranking compartido) pero la bitácora de decisiones puede ser sensible. | `q.where('supervisorUid','==', supervisorUid)` con uid arbitrario del query. |
| `src/services/auth/webauthnCredentialStore.ts:34-41` | 🔵 | Stub-documentado: la ruta de registro WebAuthn "deferred to R20; for MVP we manually seed credentials via Firebase Admin SDK". `registerCredential()` es función pura real (no stub disfrazado). Nota: `webauthnClient.ts:175,207` ya referencia `/api/auth/webauthn/register/options|verify`, sugiriendo que la ruta ya existe — posible desfase doc/realidad entre módulos. | Comentario `:34-41` vs llamadas en `webauthnClient.ts`. |

## Archivos limpios: 43

Rutas (engine puro, `verifyAuth` + `guard`/`assertProjectMember`, error bodies sin
internals #8, audit `await` correcto): `audit.ts` (actor sellado del token, projectId
membership-checked), `consistency.ts`, `dataQuality.ts`, `deduplication.ts`,
`eventReplay.ts` (auditorUid forzado `:122`), `multiProject.ts`, `multiRoleSummary.ts`,
`retaliationProtection.ts`, `oauthGoogle.ts` (CSRF state session-bound; `code as string`
sin crash), `pymeWizard.ts`, `auditChain.ts`, `auditPortal.ts`, `externalAuditPortal.ts`
(ruta), `consistency*`.

Servicios cripto/RBAC reales y correctos: `customClaims.ts` (fast-path solo positivo,
cap 100), `projectMembership.ts` (no swallow infra), `totp.ts` (RFC 6238 real,
constant-time), `totpEnrollment.ts` (recovery codes hash SHA-256 single-use; disable
exige código), `webauthnChallenge.ts` (single-use TTL 5min, atomic consume,
timingSafeEqual), `webauthnCredentialStore.ts` (counter anti-clon, base64url validado),
`webauthnClient.ts`, `pinSignService.ts` (PBKDF2 600k, trivial-PIN reject, timing-safe),
`oauthTokenStore.ts` (envelope KMS gated OFF por default — ya en doc previo),
`userLifecycle.ts` (revokeRefreshTokens + claim inactive).

Persistencia/engines puros sin side-effects ni anti-patterns (#13/#14/#15): `auditService.ts`
(wrapper cliente, actor server-side), `auditPortalFirestoreAdapter.ts` (hash del token —
el modelo CORRECTO), `externalAuditPortal.ts` (engine), `consistencyAuditor.ts`,
`consistencyStateBuilder.ts`, `incompletenessScanner.ts`, `recordDeduplicator.ts`,
`domainEventStore.ts`, `csvAdapter.ts`, `schemas.ts`, `eventReplayAuditTool.ts`
(hash determinístico, "NO usa Math.random"), `excelImporter.ts`, `excelImporter/{deduplicator,
index,recordValidator,xlsxReader}.ts`, `deviationNormalizationRadar.ts`,
`supervisionDecisionTrail.ts`, `roleViewBuilder.ts`, `retaliationDetector.ts`,
`adminBurdenTracker.ts`, `automationSuggester.ts`, `firestoreSessionStore.ts` (fail-soft;
5 `console.warn` eslint-disabled — cosmético).

## Notas menores (no-finding)
- `firestoreSessionStore.ts`: 5 `console.warn` (eslint-disabled inline) — el doc previo
  contó "4 console". Cosmético.
- `oauthGoogle.ts:374,443` y `externalAuditPortal.ts:235`: comparación de token/state con
  `!==` (no constant-time). Tokens de 64-hex random server-issued → timing impracticable.
