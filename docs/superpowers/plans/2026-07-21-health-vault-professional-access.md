# Health Vault Professional Access Implementation Plan

**Estado de ejecución:** implementado; verificación focalizada, reglas, typecheck, ratchets y bundle verdes. La regresión global queda delegada a GitHub CI porque la corrida local excedió cinco minutos sin producir fallos ni resumen final.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el acceso anónimo por QR del Health Vault por un acceso explícitamente consentido, destinado a un profesional de salud externo verificado, confirmado con WebAuthn y mediado por sesiones revocables.

**Architecture:** La identidad profesional será una capacidad global server-only independiente de tenants y roles laborales. Los grants v2 congelarán los IDs consentidos y vincularán un destinatario. El secreto del QR viajará en el fragmento y sólo podrá intercambiarse, junto con una aserción WebAuthn verificable, por una sesión opaca corta. Todos los registros y archivos se servirán desde el servidor tras revalidar grant, destinatario, identidad y sesión.

**Tech Stack:** TypeScript, Express, Firebase Admin/Firestore, Firebase Auth, React, React Router, WebAuthn (`@simplewebauthn/server`), AES-256-GCM envelope encryption, HMAC-SHA256, Vitest, Firebase Rules emulator.

## Global Constraints

- Una tarea Notion y un PR. No mezclar la portabilidad laboral ni el bug de consentimiento de `portableHistory`.
- Nunca conceder acceso por tenant, rol laboral `medico_ocupacional`, QR o biometría local por sí solos.
- Sólo el titular crea, confirma y revoca un grant.
- El stub de SuperSalud nunca devuelve `verified`; sólo `not_configured` o `unavailable`.
- El RUT no se persiste en claro y requiere KMS + clave HMAC dedicada. En producción no hay fallback criptográfico.
- No incluir RUT, PHI, purpose, record IDs ni nombres clínicos en logs, Sentry, audit o analytics.
- Las rutas v1 quedan revocables y visibles para el titular, pero jamás vuelven a revelar datos.
- Cada error clínico debe tener código cerrado y mensaje humano; no mostrar `403` crudo.
- Cada cambio de comportamiento comienza con un test rojo y termina con evidencia verde.

---

### Task 1: Dominio de identidad profesional y proveedor stub

**Files:**
- Create: `src/services/health/professionalIdentity.ts`
- Create: `src/services/health/professionalIdentity.test.ts`
- Create: `src/services/health/professionalRegistryProvider.ts`
- Create: `src/services/health/professionalRegistryProvider.test.ts`

- [ ] Escribir tests para estados `pending`, `provisional`, `verified`, `suspended`, `revoked`, transiciones permitidas y denegación de acceso.
- [ ] Escribir tests que demuestren que `StubProfessionalRegistryProvider.verifyPhysician()` sólo devuelve `not_configured`/`unavailable` y nunca `verified`.
- [ ] Ejecutar `npm.cmd run test -- src/services/health/professionalIdentity.test.ts src/services/health/professionalRegistryProvider.test.ts --reporter=dot` y confirmar RED por módulos ausentes.
- [ ] Implementar tipos cerrados, máquina de estados pura, `canReceiveHealthGrant()` y DTO público mínimo sin RUT/email/tenant.
- [ ] Implementar la interfaz `ProfessionalRegistryProvider` y el stub fail-closed.
- [ ] Repetir el comando y confirmar GREEN.
- [ ] Commit: `feat(health): model verified professional identity`

### Task 2: Persistencia server-only, cifrado e índice de identidad

**Files:**
- Create: `src/server/services/healthProfessionalIdentityStore.ts`
- Create: `src/server/services/healthProfessionalIdentityStore.test.ts`
- Modify: `src/services/security/kmsAdapter.ts` only if a narrowly scoped factory seam is required for tests.

- [ ] Escribir tests con un Firestore fake y `inMemoryKmsAdapter`: RUT normalizado cifrado mediante `envelopeEncrypt`, índice HMAC determinista, ningún campo RUT en claro y búsqueda por índice.
- [ ] Cubrir configuración ausente de `HEALTH_PROFESSIONAL_LOOKUP_KEY`: enrolamiento falla cerrado con `professional_security_unavailable`.
- [ ] Cubrir producción: KMS no disponible falla cerrado y nunca cae a in-memory.
- [ ] Ejecutar el test y confirmar RED.
- [ ] Implementar `createProfessionalIdentityStore(deps)` con dependencias inyectables, HMAC constant-time donde corresponda y DTOs minimizados.
- [ ] No implementar descifrado en rutas de búsqueda/listado; sólo el flujo de revisión podrá solicitarlo explícitamente.
- [ ] Ejecutar test y typecheck focalizado; confirmar GREEN.
- [ ] Commit: `feat(health): secure professional identity storage`

### Task 3: Enrolamiento, búsqueda y revisión provisional auditada

**Files:**
- Create: `src/server/routes/healthProfessionals.ts`
- Create: `src/server/routes/healthProfessionals.test.ts`
- Modify: `server.ts`

- [ ] Escribir tests de rutas: enrolamiento sólo propio; búsqueda sólo devuelve profesionales elegibles; `me` no filtra RUT; revisión requiere admin global; revisión registra actor/método/referencia/hash y sólo produce `provisional`.
- [ ] Cubrir rechazo de nombres/RUT/registro inválidos, duplicados, KMS/HMAC ausentes y stub no configurado con mensajes humanos.
- [ ] Cubrir que un profesional no necesita `tenantId`, proyecto ni rol laboral de médico.
- [ ] Ejecutar test y confirmar RED.
- [ ] Implementar router con `verifyAuth`, esquemas Zod, rate limiting apropiado, auditoría awaited y logging con IDs opacos.
- [ ] Montar `/api/health-professionals` en `server.ts` sin tocar el hotspot `FirebaseContext.tsx`.
- [ ] Ejecutar test y confirmar GREEN.
- [ ] Commit: `feat(health): add professional verification routes`

### Task 4: Grants v2 y sesiones efímeras puras

**Files:**
- Modify: `src/services/health/vaultShare.ts`
- Modify: `src/services/health/vaultShare.test.ts`
- Create: `src/services/health/vaultAccessSession.ts`
- Create: `src/services/health/vaultAccessSession.test.ts`

- [ ] Añadir tests rojos para `version: 2`, `ownerUid`, destinatario, finalidad enumerada, snapshot `resourceIds`, hash/version del consentimiento, estados y URL `${base}/vault/share/${id}#${secret}`.
- [ ] Cubrir que `full|recent|topic` nunca implican registros futuros: v2 exige `resourceIds` no vacío, único y acotado.
- [ ] Cubrir destinatario incorrecto, identidad no elegible, expiración, revocación y máximo de sesiones con códigos cerrados.
- [ ] Cubrir sesión aleatoria cuyo secreto crudo no se persiste, TTL corto, vínculo a grant+profesional y verificación constant-time.
- [ ] Mantener todas las pruebas y exports v1 existentes sin borrarlos.
- [ ] Implementar `createHealthAccessGrant`, `validateGrantClaim`, `activateGrantSession`, `createVaultAccessSession`, `validateVaultAccessSession` y `revokeVaultAccessSession`.
- [ ] Ejecutar ambas suites y confirmar GREEN.
- [ ] Commit: `feat(health): add consent-bound vault grants`

### Task 5: Prueba WebAuthn con propósito clínico

**Files:**
- Modify: `src/services/auth/webauthnChallenge.ts`
- Modify: `src/services/auth/webauthnChallenge.test.ts`
- Modify: `src/server/routes/curriculum.ts`
- Modify: `src/__tests__/server/webauthnVerify.test.ts`
- Modify: `src/hooks/useBiometricAuth.ts`
- Modify: `src/hooks/useBiometricAuth.test.ts`

- [ ] Escribir tests para que el challenge persista `purpose: health_professional_access` y contexto opaco `grantId`, y para que consume rechace purpose/context incorrectos.
- [ ] Escribir tests de ruta que el verify clínico no responda con un booleano reutilizable sino con un proof opaco, de un solo uso y TTL corto, ligado a UID+grant.
- [ ] Escribir tests de hook para `BiometricPurpose = health-professional-access`, WebAuthn web fail-closed y rechazo explícito de biometría nativa local como autorización clínica server-side.
- [ ] Ejecutar suites y confirmar RED.
- [ ] Extender el challenge sin romper login/claim-signing/enroll-test y sin aceptar purpose libre enviado por clientes no autorizados.
- [ ] Implementar un helper del hook que devuelva la aserción serializada al caller clínico; no usar el resultado booleano local como prueba de servidor.
- [ ] Repetir suites y confirmar GREEN.
- [ ] Commit: `feat(auth): bind webauthn proof to health access`

### Task 6: Rutas clínicas v2 y cierre del endpoint anónimo

**Files:**
- Modify: `src/server/routes/healthVault.ts`
- Modify: `src/server/routes/healthVault.test.ts`
- Modify: `src/__tests__/server/healthVault.fileProxy.test.ts`

- [ ] Escribir tests de creación v2 sólo por titular: el servidor valida que cada `resourceId` pertenezca al UID autenticado y persiste snapshot.
- [ ] Escribir tests de `claim`, `session`, `records`, `file`, confirmación de destinatario y revocación.
- [ ] Cubrir médico externo provisional/verified sin tenant, médico distinto, no profesional, identidad suspendida, QR robado, sesión expirada, grant revocado y auditoría fallida.
- [ ] Cubrir doble claim/confirmación mediante transacción y revalidación en cada registro/archivo.
- [ ] Cambiar el GET v1 público para que nunca cargue records ni blobs y devuelva `legacy_share_reissue_required` con 410 y mensaje humano.
- [ ] Implementar rutas v2 autenticadas; el secreto sólo entra en body de claim/session, nunca en path/log.
- [ ] Establecer `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer` y CSP defensiva.
- [ ] Auditar antes de emitir sesión/records/file y fallar cerrado si la auditoría crítica falla.
- [ ] Ejecutar ambas suites y confirmar GREEN.
- [ ] Commit: `feat(health): mediate verified vault access`

### Task 7: Firestore Rules sin permisos médicos globales

**Files:**
- Modify: `firestore.rules`
- Modify: `src/__tests__/firestore/health-vault.rules.test.ts` (or the existing canonical Health Vault rules suite found by `rg`).

- [ ] Añadir tests con dos titulares, dos empresas y dos profesionales: ningún profesional/admin lee `health_vault`, `health_vault_shares`, `medical_exams` o `morning_checkins` ajenos por Client SDK.
- [ ] Añadir tests de `health_professional_identities`: deny read/write para todos los clientes.
- [ ] Confirmar que el titular conserva las operaciones personales ya permitidas y la lectura de sus resúmenes de share.
- [ ] Ejecutar rules tests y confirmar RED.
- [ ] Cambiar `health_vault_shares` a owner-read/server-write, eliminar `isDoctor()` de `medical_exams` y `morning_checkins`, y añadir deny explícito top-level para identidades profesionales.
- [ ] Ejecutar rules tests y confirmar GREEN.
- [ ] Commit: `fix(rules): remove global clinical data access`

### Task 8: UI de paciente y profesional sin fuga de secretos

**Files:**
- Modify: `src/pages/HealthVaultShare.tsx`
- Create or modify: `src/pages/HealthVaultShare.test.tsx`
- Modify: `src/pages/HealthVaultViewer.tsx`
- Create or modify: `src/pages/HealthVaultViewer.test.tsx`
- Modify: `src/AppRoutes.tsx`
- Modify: `src/AppRoutes.test.tsx` or the canonical routing suite.

- [ ] Escribir tests de selección de profesional elegible, registros explícitos, finalidad y consentimiento legible antes de crear.
- [ ] Escribir tests de extracción del secret desde `location.hash`, limpieza inmediata con `history.replaceState` y ausencia del secret en DOM/logs/requests GET.
- [ ] Escribir tests para estados humanos: login, onboarding profesional, pending, confirmación del paciente, WebAuthn, autorizado, reissue v1, expirado, revocado y dispositivo incompatible.
- [ ] Cubrir que un profesional ya validado no repite onboarding y que `/vault/share/:tokenId` evita sólo el onboarding empresarial sin marcar al usuario como onboarded.
- [ ] Ejecutar suites y confirmar RED.
- [ ] Implementar cliente API autenticado, selector granular, onboarding profesional liviano, intercambio de prueba WebAuthn y descargas fetch->object URL revocable.
- [ ] Conservar la ruta legacy `/vault/share/:tokenId/:secret` sólo para limpiar/migrar el secreto a fragment y mostrar reissue; no leer datos.
- [ ] Ejecutar suites y confirmar GREEN.
- [ ] Commit: `feat(health): deliver consented professional vault UX`

### Task 9: Analytics mínimos, regresión y entrega

**Files:**
- Modify: `src/services/analytics/types.ts`
- Modify: `src/services/analytics/types.test.ts` or canonical analytics contract suite.
- Modify: `docs/superpowers/specs/2026-07-21-health-vault-professional-access-design.md`

- [ ] Añadir eventos cerrados sin UID/RUT/PHI/purpose/resource IDs; testear allowlist de propiedades.
- [ ] Marcar el diseño como aprobado e implementado sólo después de verificación final.
- [ ] Ejecutar targeted suites de Tasks 1-8.
- [ ] Ejecutar `npm.cmd run typecheck:ci`.
- [ ] Ejecutar `npm.cmd run lint:connectivity` y los ratchets relevantes.
- [ ] Ejecutar rules tests, build y la suite de integración proporcional al riesgo.
- [ ] Revisar `git diff --check`, `git status`, y buscar secretos/RUT/PHI en logging/analytics.
- [ ] Usar `superpowers:verification-before-completion` y `superpowers:requesting-code-review`.
- [ ] Publicar `codex/health-vault-professional`, crear un único PR listo para revisión y actualizar Notion a `Review` con URL y comandos exactos.
