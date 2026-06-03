# DEEP — B17 Admin/Multi-tenant/Auth/RBAC/Audit/Privacidad · 2026-06-02

**Archivos revisados:** 72 (ledger `block === "B17-Admin"`) + `firestore.rules` (1182 LOC) y los middleware `verifyAuth` / `assertProjectMemberMiddleware` / `auditLog`. Lectura a fondo de ~24 ficheros código-fuente, lectura completa de `firestore.rules`, y verificación de los 5 bug-threads (Codex #650) y la deuda `console.*`.

Estados: ✅ implementado y cableado · 🟡 parcial/flag-off · 🏚️ legacy/incompleto · 🔵 doc/test/script · 🔑 cripto/secreto · 🔴 bug real.

---

## 1. Lo que YA HACE (implementado y real)

- **`verifyAuth` (middleware/verifyAuth.ts) es sólido.** Bearer-only en prod; `verifyIdToken(token, true)` con `checkRevoked=true` (revoca tokens al desactivar usuario, cierra ventana de 1h de ex-empleados, `verifyAuth.ts:115`). Session-cap absoluto de 8h desde `auth_time` (`verifyAuth.ts:124-142`). El `req.user` solo se puebla desde el token verificado — nada del body puede falsear identidad. Guard de boot module-level que **lanza** si `NODE_ENV=production && E2E_MODE=1` (`verifyAuth.ts:49-54`) — el bypass E2E es imposible en prod. ✅🔑
- **`firestore.rules` default-deny catch-all real:** `match /{document=**} { allow read, write: if false; }` (`firestore.rules:17-19`) es la primera regla; toda colección sin regla explícita queda denegada. ✅
- **`audit_logs` append-only correcto:** `read: isAdmin`, `create: if false` (server-only vía Admin SDK), `update, delete: if false` (`firestore.rules:558-569`). El invariante de inmutabilidad se cumple a nivel de reglas. ✅
- **`auditServerEvent` (middleware/auditLog.ts)** sella `userId`/`userEmail` desde `req.user` (token verificado), nunca del body; permite `actorOverride` documentado para callbacks unauthed (OAuth); swallows errores con `logger.error` → nunca rompe el request path. ✅
- **Master-gate de subcolecciones read-only:** `projects/{projectId}/{subCollection=**}/{docId}` concede solo `read` a project-members (`firestore.rules:258-260`); las escrituras requieren reglas por-colección. ✅
- **Tenant isolation server-side real:** `tenants/{tenantId}` read gated por `isMemberOfTenant(tenantId)` (claim `tenantId` o `tenants[tid]`), writes server-only (`firestore.rules:944-947`). El catch-all de subcolección **excluye** `supervisor_only`/`suseso_forms`/`suseso_counters` para que la regla estricta hermana sea la única aplicable (fix 2026-05-15 del bug OR-merge, `firestore.rules:958-963`). ✅
- **`isSupervisorOfTenant` NO cruza tenants** (fix 2026-05-15): para claim multi-tenant exige rol supervisor-tier POR-TENANT (`token.tenants[tid] in [...]`), no el rol global. Un usuario global=worker pero `tenants.A=supervisor` lee `/tenants/A/supervisor_only/*` pero un supervisor en tenant B NO entra a tenant A (`firestore.rules:83-109`). ✅
- **WebAuthn con verificación criptográfica REAL** en `verifyWebAuthnAssertion` (server/auth/webauthnAssertion.ts): consume challenge atómico single-use (`webauthnAssertion.ts:135`), valida ownership uid↔credential (`:160`), llama `verifyAuthenticationResponse` de `@simplewebauthn/server` con `requireUserVerification:true` (`:168-193`), y exige counter monotónico anti-clon (`:204-207`). Usado por curriculum self-sign (`curriculum.ts:856`) y sitebookSign (`sitebookSign.ts:253`). ✅🔑
- **Challenge cache server-issued, single-use, TTL 5min, consume atómico** (`webauthn_challenges` server-only, `firestore.rules:848-850`; engine `webauthnChallenge.ts`). ✅🔑
- **TOTP real RFC 6238/HOTP RFC 4226** (`services/auth/totp.ts`) — HMAC-SHA1, base32, ventana de tolerancia; no es stub. ✅🔑
- **OAuth Google con CSRF state real:** `crypto.randomBytes(16)` session-bound, 403 en mismatch (`oauthGoogle.ts:133/443-444`, drive `:369-375`). ✅🔑
- **Admin RBAC autoritativo:** `/api/admin/set-role` y `/revoke-access` re-leen `admin.auth().getUser(callerUid).customClaims.role` con `isAdminRole()` (NO confían en el token), revocan refresh tokens al cambiar rol (`admin.ts:108/174-196`). ✅
- **`assertProjectMember`** restaura paridad con reglas para el Admin SDK (que las bypasea); member = `members[]` OR `createdBy`; fast-path por claim `assignedSiteIds` solo positivo, jamás rechaza por ausencia (`projectMembership.ts:68-100`, `customClaims.ts:70-78`). NO swallow de errores de infra (no enmascara alertas). ✅
- **External Audit Portal token model banking-grade:** token hex-64 = `sha256(randomBytes(32))`, plaintext devuelto UNA vez, en Firestore solo el hash; lookup por collectionGroup sobre `accessTokenHash`; 403 parejo (no_token/expired/revoked/scope) anti-oracle (`externalAuditPortal.ts:32-45/132-153`). ✅🔑
- **Self-promotion bloqueada en `users/{uid}`:** update deniega `affectedKeys().hasAny(['subscriptionPlan','subscription'])` salvo Admin SDK (`firestore.rules:236-241`). ✅
- **`telemetry_events` / `oauth_tokens` / `processed_webpay` / `webauthn_challenges` / `suseso_counters`** todos server-only correctos. ✅

---

## 2. Lo que está PENDIENTE (deuda de este bloque)

- 🔴 **`documents_for_read` rule-vs-schema desalineado (bug Codex #650 vigente).** La regla exige `incoming().authorUid == request.auth.uid` (`firestore.rules:456-460`) pero el tipo `DocumentForRead` (`readReceiptService.ts:34-43`) **no tiene campo `authorUid`**, y `createProjectScopedStore.save()` solo escribe `{...item, updatedAt}` sin estampar uid (`createProjectScopedStore.ts:197`). `saveDocumentForRead()` pasa el doc sin authorUid (`readReceiptStore.ts:38`, caller `DocumentReadConfirm.tsx:133`). Resultado: **todo `save()` cliente queda default-denied** → colección no funcional desde cliente. Igual síntoma que el HALLAZGO CRÍTICO Sprint-K de TODO.md §17.
- 🔴 **`site_book_counters` SIN regla (bug Codex #650 vigente).** Solo existen `site_book` y `site_book_entries` (`firestore.rules:410/418`). No hay `match /site_book_counters` → si el cliente lee/escribe el contador de folios, default-deny. Falta la regla.
- 🔴 **Lone-worker ownership débil (bug Codex #650 vigente).** `lone_worker_sessions`/`lone_worker_events` update solo exige que `workerUid` no cambie (`incoming().workerUid == existing().workerUid`, `firestore.rules:431-432/438-439`) pero permite a CUALQUIER project-member actualizar la sesión de OTRO trabajador. No hay `existing().workerUid == request.auth.uid`. Un member puede mutar la sesión lone-worker ajena (p.ej. apagar alertas) mientras no toque el owner-field.
- 🔴 **External Audit Portal admin SIN gate de rol ni project-scoping.** `POST /audit-portal/create|revoke`, `GET list|access-log` solo exigen `verifyAuth` + tenant resuelto — **no** `isAdmin/isSupervisor` ni `assertProjectMember(scopeProjectIds)` (`externalAuditPortal.ts:234-300/355/428`). Cualquier miembro autenticado del tenant puede mintear un token de auditor externo que expone documents/iper_matrix/incidents de cualquier proyecto del tenant. Tenant-isolation se mantiene (tenantId server-side) pero falta privilegio intra-tenant + scope a proyectos del caller.
- 🟡 **OAuth refresh_token plaintext por defecto.** Envelope KMS gated tras `OAUTH_ENVELOPE_ENABLED` (default OFF); con flag off los refresh_tokens se guardan en claro en `oauth_tokens` (`oauthTokenStore.ts:85-97/144-147`). Read-path permisivo legacy. En prod debe estar ON + `KMS_ADAPTER=cloud-kms`; verificar deploy.
- 🟡 **Curriculum referee co-sign NO verifica firma criptográfica.** `method:'standard'` acepta cualquier `signature` string ≤1024 (`curriculum.ts:567-572`) y `recordRefereeEndorsement` la guarda opaca; `verified` = "todos los slots tienen `signedAt`" — posesión del magic-link-token, NO prueba de firma (`claims.ts:303-334`). El co-sign de referees es modelo consume-only/token-possession, a diferencia del self-sign que sí usa `verifyWebAuthnAssertion`. (Documentado en el comentario de rules `firestore.rules:861-866`, pero el aviso "WebAuthn" en UI puede confundir.)
- 🟡 **`exceptions`/`legal_obligations`/`shifts` sin anti-spoof creator-uid** (`firestore.rules:466-477`): create/update plain member-gated; sin owner-field. El propio TODO inline (`firestore.rules:463-465`) lo marca para revisión de dahosandoval@. Cualquier member puede crear/editar; delete admin/supervisor.
- 🟡 **`admin.ts` audit writes legacy y `await` sin try/catch.** `/set-role` y `/revoke-access` escriben `audit_logs` con shape legacy (`actor`/`action`/`ts`, `admin.ts:124/199`) en vez de `auditServerEvent`, y el `await` no está envuelto → un fallo de Firestore cae al catch externo y devuelve 500, bloqueando la acción (contra invariante #14 "audit failure non-blocking"). Doble esquema de audit_logs en el repo.
- 🏚️ **`console.*` en 13 archivos de `src/server/`** (deuda confirmada): `verifyAuth.ts`(1), `sessionStore/firestoreSessionStore.ts`(4), `rateLimit/firestoreRateLimitStore.ts`(4), `triggers/healthCheck.ts`(2), `triggers/backgroundTriggers.ts`(1), `routes/{billing,dte,gemini,healthVault,misc,oauthGoogle,projects,reports}.ts`(1 c/u). Debe migrar a `logger`.
- 🟡 **`ar_anchors` project-scope NO enforced en rules** (auto-documentado, `firestore.rules:1038-1046`): cualquier member del tenant lee TODAS las anclas del tenant; el `projectId` es solo organización UI, no privacy boundary fuerte. Aceptado pero divergente de la directiva "información privada por proyecto".

---

## 3. Tabla por archivo (TODOS)

| Archivo | LOC | Estado | Cableado | Propósito real + hallazgo file:line |
|---|---|---|---|---|
| firestore.rules | 1182 | 🔴 | prod | Default-deny `:17`; audit_logs append-only `:558-569`; tenant gate `:944`; supervisor no-cross-tenant `:83-109`. 3 bugs vivos: documents_for_read schema mismatch `:456`, falta site_book_counters, lone_worker ownership `:431` |
| src/server/middleware/verifyAuth.ts | 178 | ✅🔑 | prod | Bearer+checkRevoked `:115`, 8h cap `:124`, E2E boot-guard `:49`. 1 console `:42` |
| src/server/middleware/auditLog.ts | 94 | ✅ | prod | auditServerEvent sella uid del token `:65-68`, no-throw `:83` |
| src/server/middleware/assertProjectMemberMiddleware.ts | 95 | ✅ | prod | Wrapper body/param sobre assertProjectMember; body opcional no-op `:48` |
| src/services/auth/projectMembership.ts | 101 | ✅ | prod | member=members[]∨createdBy `:94-95`; fast-path claim positivo `:76-81`; no swallow infra |
| src/services/auth/customClaims.ts | 116 | ✅ | prod | assignedSiteIds fast-path solo positivo `:70-78`; cap 100 IDs `:90-107` |
| src/server/routes/admin.ts | 704 | 🟡 | prod | set-role/revoke leen customClaims server-side `:108/175`; audit legacy shape + await sin try/catch `:124/199` |
| src/server/auth/webauthnAssertion.ts | 216 | ✅🔑 | prod | Verificación cripto real `:168-193`; counter anti-clon `:204`; ownership `:160` |
| src/services/auth/webauthnChallenge.ts | ~120 | ✅🔑 | prod | Challenge single-use TTL 5min consume atómico |
| src/services/auth/webauthnCredentialStore.ts | ~ | ✅🔑 | prod | findByCredentialId/updateCounter/decodePublicKey |
| src/services/auth/webauthnClient.ts | ~ | ✅ | prod | Wrapper cliente WebAuthn |
| src/services/auth/totp.ts | ~ | ✅🔑 | prod | TOTP RFC6238 real HMAC-SHA1 `:1-9` |
| src/services/auth/totpEnrollment.ts | ~ | ✅🔑 | prod | Enrolamiento TOTP |
| src/server/routes/oauthGoogle.ts | 513 | 🟡 | prod | CSRF state crypto session-bound `:133/443`; 1 console |
| src/services/oauthTokenStore.ts | 223 | 🟡🔑 | prod | Envelope KMS gated OAUTH_ENVELOPE_ENABLED default OFF `:85-97` → refresh_token plaintext por defecto |
| src/server/routes/auditChain.ts | 203 | ✅ | prod | Hash-chain stateless; actor forzado a callerUid `:108` anti-ghost-sign; verifyAuth+guard |
| src/server/routes/auditPortal.ts | 312 | ✅ | prod | In-app portal; verifyAuth+assertProjectMember `:49` en todos los POST |
| src/server/routes/externalAuditPortal.ts | 597 | 🔴 | prod | Token model banking-grade `:132`; PERO admin endpoints sin isAdmin ni scope-proyecto `:234/355/428` |
| src/server/routes/pymeWizard.ts | 105 | ✅ | prod | verifyAuth+guard `:90`; engine puro buildOnboardingPlan |
| src/services/auditPortal/externalAuditPortal.ts | ~ | ✅🔑 | prod | createPortal/derivePortalStatus/checkAccess; createdByUid `:52` |
| src/services/auditPortal/auditPortalFirestoreAdapter.ts | ~ | ✅ | prod | hashAccessToken sha256; collectionGroup; tenant-scoped adapter |
| src/services/auditPortal/auditPortalStore.ts | ~ | 🟡 | parcial | createProjectScopedStore('audit_portals') — alias del path simplificado `:13` |
| src/server/sessionStore/firestoreSessionStore.ts | ~ | ✅ | prod | Store express-session Firestore _sessions/{sid} + TTL; 4 console |
| src/hooks/useAuditChain.ts | ~ | ✅ | prod | Cliente hash-chain |
| src/hooks/useAuditPortal.ts | ~ | ✅ | prod | createdByUid server-side `:43` |
| src/hooks/useExternalAuditPortal.ts | ~ | ✅ | prod | Cliente external portal |
| src/hooks/usePymeWizard.ts | ~ | ✅ | prod | Cliente pyme wizard |
| src/hooks/useSessionExpiry.ts | ~ | ✅ | prod | 8h cap cliente `:5` + reset stale 24h; espejo UX de verifyAuth |
| src/hooks/useTenantId.ts | ~ | ✅ | prod | Resuelve tenantId del claim |
| src/hooks/useBiometricAuth.ts | ~ | ✅ | prod | (fuera de ledger, relacionado) WebAuthn cliente |
| src/pages/AuditPortals.tsx | ~ | ✅ | prod | UI portales |
| src/pages/AuditTrail.tsx | ~ | ✅ | prod | UI audit trail |
| src/pages/Login.tsx | ~ | ✅ | prod | signInWithGoogle + biometría opcional `:50/53` |
| src/pages/RefereeAccept.tsx | ~ | 🟡 | prod | Co-sign referee — method standard sin cripto (ver §2) |
| src/components/admin/CreateApiKeyModal.tsx | ~ | ✅ | prod | UI API key |
| src/components/admin/MrrChart.tsx | ~ | ✅ | prod | Dashboard MRR |
| src/components/admin/RevenueByTierChart.tsx | ~ | ✅ | prod | Dashboard revenue |
| src/components/admin/SentryTestButton.tsx | ~ | 🔵 | dev | Test Sentry |
| src/components/ar/XRSession.tsx | ~ | ✅ | prod | Sesión AR (ar_anchors) |
| src/components/auditPortal/ExternalAuditPortalCard.tsx | ~ | ✅ | prod | Card portal externo |
| src/components/auditPortal/PortalManager.tsx | ~ | ✅ | prod | CRUD portales |
| src/components/auditPortal/PortalPublicView.tsx | ~ | ✅ | prod | Vista pública auditor (sin cuenta) |
| src/components/auth/MFASetupModal.tsx | ~ | ✅ | prod | Setup MFA/biometría |
| scripts/migrate-auth-headers.mjs | ~ | 🔵 | script | Codemod headers auth |
| scripts/migrate-oauth-tokens-to-envelope.cjs | ~ | 🔵 | script | Migración one-shot a envelope KMS |
| docs/architecture-decisions/0011-…auth.md | ~ | 🔵 | doc | ADR triple-gate digital twin |
| marketplace/oauth-consent-screen.md | ~ | 🔵 | doc | Consent screen OAuth |
| src/__tests__/server/{admin,auditLog,auditPortal,externalAuditPortal,oauthGoogle,verifyAuthE2E,coachChatTenant,admin.router}.test.ts | — | 🔵 | test | Supertest 401/200/403; tenant isolation |
| src/server/middleware/verifyAuth.test.ts | — | 🔵 | test | Pins boot-guard prod+E2E `:42` |
| src/server/auth/webauthnAssertion.test.ts | — | 🔵 | test | Pins cripto + counter |
| src/rules-tests/tenantScoped.test.ts | — | 🔵 | test | Rules tenant-scoped |
| src/services/auth/*.test.ts (customClaims/projectMembership/totp/totpEnrollment/webauthnChallenge/webauthnCredentialStore) | — | 🔵 | test | Unit cripto/RBAC |
| (resto .test.* del ledger) | — | 🔵 | test | Cobertura adapter/hooks/e2e fixtures |

---

## 4. Para decisión del usuario (❓/⚠️)

- ⚠️ **`documents_for_read` está roto desde el cliente** (regla exige `authorUid` inexistente en el schema y el factory no lo estampa). Decidir: (a) añadir `authorUid` al tipo + estamparlo en el caller, o (b) relajar la regla a member-gated. Mismo patrón que el HALLAZGO CRÍTICO Sprint-K. `firestore.rules:456` / `readReceiptService.ts:34` / `createProjectScopedStore.ts:197`.
- ⚠️ **`site_book_counters` no tiene regla** → folio counter default-denied. ¿Server-only (Admin SDK) o member-write con anti-spoof? Falta el `match`.
- ⚠️ **External Audit Portal: cualquier member del tenant puede exponer datos de cualquier proyecto a un auditor externo.** Recomiendo gate `isAdmin/isSupervisor` + validar que el caller sea member de cada `scopeProjectIds`. `externalAuditPortal.ts:234`.
- ⚠️ **Lone-worker session ajena editable por otro member** (`firestore.rules:431`). ¿Añadir `existing().workerUid == request.auth.uid` al update, dejando ack/resolución a supervisores vía endpoint server?
- ❓ **Referee co-sign de curriculum es token-possession, no firma cripto.** ¿Es aceptable para evidencia legal anti-fraude, o debe exigir WebAuthn real al referee como en self-sign? `claims.ts:303`.
- ❓ **OAUTH_ENVELOPE_ENABLED — confirmar que está ON en prod** (si no, refresh_tokens en claro). `oauthTokenStore.ts:85`.
- ⚠️ **`admin.ts` audit_logs legacy + await sin try/catch** (rompe invariante #14 y mantiene doble esquema). Migrar a `auditServerEvent`. `admin.ts:124/199`.
- 🏚️ **Limpiar `console.*` en 13 archivos de `src/server/`** → `logger`.
