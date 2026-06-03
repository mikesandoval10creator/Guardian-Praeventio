# DEEP-EX #9 — B17-Admin [0:55] · 2026-06-02

**Atestación:** leídos 55/55 línea por línea (server/auth/RBAC al 100% completo;
modales worker + componentes security al 100%; resto de pages/hooks/components UI
leídos completos o escaneados línea-por-línea con grep dirigido sobre patrones de
escritura/auth/random/role — ninguno mostró superficie de mutación o auth fuera de
lo aquí reportado).

Slice derivado: `category` ∈ FEAT* && `block === "B17-Admin"`, orden por `path`,
`[0:55]` (de 108 totales). Foco: hallazgos NUEVOS no presentes en
`DEEP-B17-Admin.md` (que cubrió set-role/revoke, verifyAuth, webauthnAssertion
cripto, externalAuditPortal admin-sin-isAdmin, oauth, firestore.rules).

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| src/components/settings/WebAuthnKeysSection.tsx:70-74 | 🔴 | **Eliminación de credencial WebAuthn (factor MFA) por Web SDK cliente, sin re-auth ni audit.** `defaultDeleteCredential` hace `deleteDoc(doc(db,'users',uid,'webauthn_credentials',credentialId))` directo. Asimetría: el REGISTRO va por servidor verificado (`registerNewAuthenticator` con `authHeader`, :128-133), pero el BORRADO bypasea el servidor — un click, sin step-up auth, sin `audit_logs`. Sesión secuestrada (dispositivo desbloqueado en faena) ⇒ atacante elimina passkeys de la víctima en silencio. Quitar un factor MFA es operación sensible que debería exigir re-auth WebAuthn + audit server-stamped. | `await deleteDoc(doc(db, 'users', uid, 'webauthn_credentials', credentialId));` :73 |
| src/pages/Login.tsx:34-43 | 🟡 | **`biometricKeys` escrito al user-doc por cliente sin verificación cripto WebAuthn.** `syncBiometricToCloud` hace `updateDoc(userRef,{ biometricKeys: arrayUnion(credId) })` con un `credId` provisto por el cliente. El registro WebAuthn real es server-verificado, pero este array paralelo es client-writable: si algún consumidor lo usa como allowlist de credenciales/factor de auth, el cliente puede inyectar IDs arbitrarios en su propio doc. Validar consumidores; si es load-bearing, mover a colección server-only. | `await updateDoc(userRef, { biometricKeys: arrayUnion(credId) });` :37 |
| src/server/auth/webauthnAssertion.ts:204 | 🟡 | **Bypass parcial de detección de clon en counter.** Guard `if (newCounter <= stored.counter && newCounter !== 0)`. La excepción `newCounter !== 0` (pensada para passkeys cloud-synced que no implementan counter) aplica INCLUSO cuando el counter almacenado ya es > 0. Authenticator clonado que reporta `newCounter === 0` con `stored.counter === 5` ⇒ `0<=5 && 0!==0` = false ⇒ pasa. La excepción counter-0 sólo debería valer cuando `stored.counter === 0` también. | `if (newCounter <= stored.credential.counter && newCounter !== 0)` :204 |
| src/components/auditPortal/PortalManager.tsx:521 | 🟡 | **`Math.random()` en generación de ID de portal de auditoría externa (directiva #15).** `portalId = ap_${Date.now()}_${Math.random().toString(36).slice(2,8)}` se envía al server como doc `id` Y `idempotencyKey` (:526/535). Aunque el TOKEN de acceso es server-generado (banking-grade, prior audit), el identificador del portal es predecible y colisionable. #15 prohíbe `Math.random()` en "any ID-generation code". Usar `crypto.randomUUID()` / dejar que el server acuñe el id. | `Math.random().toString(36).slice(2, 8)` :521-523 |
| src/pages/AuditPortals.tsx:139 | 🟡 | **`Math.random()` en ID de portal (directiva #15), idéntico al anterior.** `id: portal_${Date.now()}_${Math.random().toString(36).slice(2,8)}`. Mismo riesgo de predictibilidad para identificadores de portal de auditoría. | `Math.random().toString(36).slice(2, 8)` :139 |
| src/pages/SSOConfig.tsx (header :15 / cuerpo) | 🟡 | **Doc-drift / claim de audit incumplido.** El comentario de cabecera promete "5. Audit log de successful logins con ISO timestamps" pero NO existe ninguna escritura a `audit_logs` en la página — los logins SSO/SAML/OIDC no quedan auditados (viola invariante #3 para una operación de auth privilegiada). Además `fetchSignInMethodsForEmail` (:208) es vector de enumeración de usuarios/providers. | `// 5. Audit log de successful logins…` vs. cero `audit_logs` en 528 LOC |
| src/server/routes/admin.ts:267,303,567,645 | 🟡 | **Nuevos endpoints admin con `await audit_logs.add(...)` sin try/catch (directiva #14).** Prior audit notó el patrón sólo en set-role/revoke (:124/199). Los endpoints AÑADIDOS — replicate-critical (:267), weekly-digest (:303), quotas/reset (:567), sync/clear-user-queue (:645) — repiten el `await` desnudo: un fallo de Firestore en el audit lanza y devuelve 500 al operador pese a que la acción ya se ejecutó (revoca/reset ya aplicados). Envolver en try/catch + Sentry, no-bloqueante. | `await admin.firestore().collection('audit_logs').add({ … })` :267,303,567,645 |
| src/server/routes/admin.ts:148-152,218-227 | 🟡 | **Identificador de actor sin hashear emitido a analytics como `*_user_id_hash`.** El catálogo define `revoked_by_user_id_hash`/`granted_by_user_id_hash` como hash, pero se emite `callerUid` crudo (comentario lo admite :138-143). Campo etiquetado "hash" contiene PII de identidad cruda en el sink de analytics/Sentry breadcrumb. | `revoked_by_user_id_hash: callerUid` :150 |
| src/components/workers/AccessControlModal.tsx:44-47 | 🟡 | **Escritura cliente de datos de control de acceso físico sin audit.** `updateDoc(projects/{pid}/workers/{id}, { medicalClearanceDate, certifications })` directo. `medicalClearanceDate` gatea el "Torniquete Virtual" (acceso físico a faena minera, :111/132). Operación state-changing de seguridad SIN `audit_logs` (#3) — y al ser write directo de cliente, el actor no puede sellarse server-side. Patrón sistémico en todos los modales worker (ver nota abajo). | `await updateDoc(workerRef, { medicalClearanceDate, certifications })` :44 |
| src/components/workers/MassImportModal.tsx:26-78 | 🟡 | **Importación masiva: parse CSV ingenuo + sin cota de filas + sin audit.** `split(',')` sin manejo de comillas (un nombre con coma corrompe la fila), bucle sin límite superior (miles de docs/nodos), `addDoc` directo cliente, sin `audit_logs`. Robustez + invariante audit. | `const values = lines[i].split(',')…` :33; bucle `for (i=1; i<lines.length; i++)` sin cap :32 |
| src/components/workers/QRCodeModal.tsx:17,73-84 | 🔵 | **QR apunta a URL pública de identidad sin auth + botones stub.** `qrValue = ${origin}/public/node/${nodeId}` expone identidad/EPP/certs sin autenticación. Botones Bajar/Imprimir/Compartir (:73-84) sin `onClick` — stubs visibles al usuario (roza #13: placeholder visible). | `const qrValue = \`${window.location.origin}/public/node/${worker.nodeId || worker.id}\`` :17 |
| src/pages/Workers.tsx:80 | 🔵 | **Borrado de worker por `deleteDoc` cliente sin audit.** `await deleteDoc(doc(db, collectionPath, deleteWorkerId))` — eliminación de personal sin `audit_logs` (#3). Parte del patrón sistémico de escritura directa cliente. | `await deleteDoc(doc(db, collectionPath, deleteWorkerId));` :80 |

### Nota sistémica (no contada como hallazgo único)
Todos los modales worker (`Add`, `Edit`, `AccessControl`, `LaborManagement`,
`MassImport`) y `Workers.tsx` ejecutan **escrituras Firestore directas vía Web
SDK** (`addDoc`/`updateDoc`/`deleteDoc`) sin ruta servidor y **sin entrada en
`audit_logs`** (invariante #3). La autorización se delega 100% a
`firestore.rules`. `LaborManagementModal:79` escribe `odiSigned` /
`digitalSignatureStatus` (estado de firma ODI — relevante legal Ley 16.744) por
esta vía. Es arquitectura offline-first deliberada, pero el invariante de audit
no puede sellarse server-side en este camino: o se enrutan estas mutaciones
sensibles por endpoints con `auditServerEvent`, o se documenta la excepción en
`security_spec.md`.

### Confirmaciones (persisten, ya cubiertas por DEEP-B17-Admin — no re-contadas)
- `src/server/routes/externalAuditPortal.ts:306-309` (fuera de slice, consumido por
  `useExternalAuditPortal`): `/audit-portal/admin/list` tiene `verifyAuth` + scope
  por `tenantId` pero **sin `isAdminRole`** — cualquier miembro del tenant (incl.
  `operario`) lista portales externos con `internalNotes` + PII de auditor. Coincide
  con el hallazgo 🔴 previo "admin endpoints sin isAdmin". Sigue vivo.

## Limpios / sólidos: 41

**Server/auth sólidos (defensa confirmada):**
- `src/server/middleware/verifyAuth.ts` — Bearer+checkRevoked (:115), cap 8h desde
  `auth_time` (:128-141), boot-guard prod+E2E (:49). E2E `!==` no-constant-time pero
  gated a no-prod.
- `src/server/middleware/auditLog.ts` — actor desde token, no-throw, swallow→false.
- `src/server/middleware/verifySchedulerToken.ts` — fail-closed 503 sin secret,
  `timingSafeEqual` constant-time.
- `src/server/auth/webauthnAssertion.ts` — cripto real (salvo edge-case counter arriba).
- `src/server/routes/adminBurden.ts` — verifyAuth + assertProjectMember + zod + 500 no-leak.
- `src/server/routes/adminJobs.ts` — verifySchedulerToken, 500 no-leak.
- `src/server/jobs/runConsistencyAudit.ts` — DI puro, sin auth surface.

**UI/hooks limpios:** MrrChart, RevenueByTierChart, SentryTestButton (dev), XRSession,
ExternalAuditPortalCard, PortalPublicView (token-based, sin verifyAuth por diseño),
RoleViewCards, TwinIntegrationPanel, IndustrySelectorWizard, TraceabilityModal,
UserProfileModal (lee audit_logs por userId, no escribe), useAdminBurden, useAuditChain,
useAuditPortal, useExternalAuditPortal, useIndustryIntegration, useMultiRoleSummary,
usePymeWizard, useRoleViews (userUid forzado server-side), useSessionExpiry (espejo UX
del cap server), useTenantId, Accessibility, AuditPortals (salvo Math.random), AuditTrail,
B2dAdminPanel (authedFetch→server), ERPIntegration, GoogleDriveIntegrationManager, Help,
Notifications, Profile, SecurityShield (TOTP RFC6238 real), Settings (admin UI gated
isAdmin UX-only, enforcement server-side confirmado en /api/admin/set-role), SiteMap,
CreateApiKeyModal (key server-gen, show-once + ack), MFASetupModal (SMS-bypass removido,
biometría/TOTP reales), KekRotationPanel (rotación on-device).

🔴 = explotable / pérdida de control auth · 🟡 = debilidad real a corregir ·
🔵 = higiene / robustez / doc-drift
