# Auditoria tecnica Codex - Guardian Praeventio

Fecha: 2026-05-07  
Rama auditada: `dev/sp39-eonet-rebased`  
Repositorio: `mikesandoval10creator/Guardian-Praeventio`  
Auditor: Codex, revision local con apoyo de GitHub y Context7  

Este informe no reemplaza `docs/audits/AUDIT_2026-05-05_FULL.md`: lo actualiza con el estado actual del codigo y con una mirada mas severa sobre los riesgos de una aplicacion de prevencion de riesgos. Guardian Praeventio no es solo una app de productividad; maneja emergencias, datos ocupacionales, evidencias legales, seguridad de trabajadores, billing, identidad y cumplimiento normativo. Para este tipo de producto, "compila" no basta: los flujos criticos deben fallar cerrado, estar testeados y respetar aislamiento de proyecto/tenant.

## Como funciona el proyecto hoy

Guardian Praeventio es una plataforma React/Vite/PWA con ruta mobile por Capacitor, backend Express sobre Node, Firebase Auth/Firestore, reglas de Firestore, billing multi-proveedor, WebAuthn para acciones sensibles, modulos de compliance laboral, IA online/offline, telemetria, emergency flows y una capa importante de servicios predictivos.

La arquitectura tiene mucha potencia construida:

- Frontend: cientos de paginas y componentes para seguridad, medicina laboral, ergonomia, emergencia, driving, digital twin, capacitacion, CPHS, analytics, Zettelkasten y billing.
- Backend: `server.ts` monta rutas Express para auth, billing, emergency, compliance, reports, telemetry, OAuth, jobs y health.
- Seguridad: Firebase Auth, middlewares de headers/rate-limit/auth, WebAuthn, KMS envelope encryption y auditoria.
- Datos: Firestore con reglas extensas, proyecto/miembro/tenant como eje de autorizacion, y Storage rules en preparacion.
- Operacion: GitHub Actions con CI, rules-tests con emulador, e2e, deploy a Cloud Run, mobile workflows, mutation workflow y runbooks.

Lo positivo: `npm.cmd run typecheck` pasa, `npm.cmd run build` pasa, hay muchas pruebas, WebAuthn registration ya existe, el webhook de MercadoPago esta montado, Apple/Google billing tienen rutas server-to-server mas maduras que el informe Word original sugeria, y el repo ya trae documentos de arquitectura y auditoria.

Lo preocupante: todavia hay deuda de seguridad y operacion que puede convertir funciones "casi listas" en riesgo real si se despliegan a produccion.

## Verificaciones ejecutadas

Comandos usados durante esta auditoria:

- `npm.cmd run typecheck`: pasa.
- `npm.cmd run validate:env:test`: pasa, pero con muchas advertencias de secretos/vars ausentes para prod/test.
- `npm.cmd run build`: pasa. Vite advierte bundles grandes, WASM pesado y modulos `node:crypto` externalizados en rutas browser.
- `npm.cmd run test -- --reporter=dot`: falla. El run completo reporto 102 fallas, principalmente porque los tests de reglas Firestore ahora se incluyen en Vitest default sin emulador y tambien por timeouts en smoke/auth/oauth/webauthn.
- `npm.cmd run security:review`: pasa, pero informa `Files scanned: 0` porque compara contra `origin/main` y no detecta cambios.

## Estado del informe Word

El documento `# Auditoria de Deuda Tecnica - Guardian Praeventio.docx` sigue siendo util como historial, pero varios hallazgos ya quedaron obsoletos:

- WebAuthn registration ya existe (`/webauthn/register/options` y `/webauthn/register/verify`).
- MercadoPago webhook ya esta montado en `POST /api/billing/webhook/mercadopago`.
- Las rutas IAP ya no parecen otorgar acceso confiando solo en recibos del cliente; los endpoints `validate-receipt` registran y responden 202, mientras la concesion real pasa por verify/webhooks.
- `firebase.json` y `storage.rules` aparecen modificados/no trackeados en el working tree, asi que parte de la deuda de hosting/storage esta siendo trabajada.

Pero hay deuda nueva o aun abierta que es mas importante que varios puntos del Word.

## Hallazgos P0

### P0-1 - WebAuthn verifica challenge, pero el cliente no envia el credential id

Evidencia:

- `src/hooks/useBiometricAuth.ts:176-187` envia a `/api/auth/webauthn/verify` solo `challengeId`, `clientDataJSON`, `authenticatorData` y `signature`.
- No envia `id`, `rawId`, `type` ni `clientExtensionResults`.
- `src/server/routes/curriculum.ts:763-766` solo entra al camino criptografico completo si recibe `credentialId`.
- `src/server/routes/curriculum.ts:847-849` mantiene un fallback legacy que consume el challenge y responde `verified: true`.

Context7 con SimpleWebAuthn confirma que el servidor debe recibir el `body.id`, buscar la passkey almacenada por ese id y llamar a `verifyAuthenticationResponse` con la respuesta completa. Hoy el backend tiene el camino correcto, pero el cliente no lo usa. En acciones sensibles, esto permite que un flujo quede "verificado" por challenge single-use sin validar la firma contra una llave publica registrada.

Impacto: critico para firmas, claims, CPHS, curriculum, acciones legales o cualquier flujo que dependa de biometria/WebAuthn como prueba fuerte.

Accion recomendada:

1. Cambiar `verifyAssertionWithServer` para enviar `assertion.id`, `rawId`, `type`, `clientExtensionResults` y response completa.
2. Rechazar server-side cualquier verificacion sensible sin `credentialId`.
3. Mantener fallback legacy solo para rutas no sensibles y con feature flag temporal.
4. Agregar tests que prueben: sin `id` falla, con credential correcto pasa, con credential de otro uid falla.

### P0-2 - Produccion puede arrancar con KMS de desarrollo

Evidencia:

- `server.ts:138-150` default a `KMS_ADAPTER=in-memory-dev` y en produccion solo emite warning.
- `scripts/validate-env.cjs:55-61` permite `in-memory-dev` en prod y no exige `KMS_KEY_RESOURCE_NAME`.
- `src/services/security/kmsAdapter.ts:202-215` tambien cae a `in-memory-dev` para valores no esperados.
- `.github/workflows/deploy.yml:68-69` setea `KMS_ADAPTER=cloud-kms` y `KMS_KEY_RESOURCE_NAME`, pero si falta el secret el boot no falla en `server.ts`.

Impacto: datos sensibles y tokens OAuth pueden quedar protegidos con KEK efimera/dev o fallar en runtime al primer cifrado. Para una app con datos ocupacionales y legales, esto debe ser fail-fast.

Accion recomendada:

1. En `NODE_ENV=production`, exigir `KMS_ADAPTER=cloud-kms`.
2. En boot, exigir `KMS_KEY_RESOURCE_NAME` no vacio cuando `KMS_ADAPTER=cloud-kms`.
3. En `validate-env.cjs`, quitar `in-memory-dev` de prod o marcarlo solo para preview explicita.
4. Agregar test de boot/env para impedir regresion.

### P0-3 - El contrato de tests esta roto: reglas Firestore entran en Vitest default sin emulador

Evidencia:

- `vitest.config.ts:31` incluye `src/**/*.test.ts`, lo que arrastra `src/rules-tests`.
- `src/rules-tests/firestore.rules.test.ts:151` ahora lanza error si no hay emulador.
- `.github/workflows/ci.yml:56-57` ejecuta `npm run test:ci` sin emulador.
- `.github/workflows/ci.yml:79-105` si tiene un job separado con `firebase emulators:exec`.
- El run local `npm.cmd run test -- --reporter=dot` fallo con 102 fallas.

Impacto: la suite default deja de ser confiable. O los PRs fallan por infraestructura, o el equipo termina ignorando tests rojos.

Accion recomendada:

1. Excluir `src/rules-tests/**` de `vitest.config.ts` default.
2. Crear `vitest.rules.config.ts` o script `test:rules` dedicado.
3. Mantener fail-fast dentro de rules-tests, pero solo en el job con emulador.
4. Ajustar CI para que `test:ci` y `rules-tests` tengan responsabilidades separadas.

## Hallazgos P1

### P1-1 - Supervisor/prevencionista actua como miembro global de todos los proyectos

Evidencia:

- `firestore.rules:45-49` define `isSupervisor()` por claim/role global.
- `firestore.rules:63-69` hace que `isProjectMember(projectId)` sea true para cualquier supervisor.
- `firestore.rules:199-200` permite lectura de subcolecciones de cualquier proyecto a `isProjectMember`.
- `src/services/auth/projectMembership.ts:64-85` es mas estricto en backend: solo `members[]` o `createdBy`.

Impacto: un rol global `supervisor`, `prevencionista`, `director_obra` o `medico_ocupacional` puede leer muchos datos de proyectos donde no es miembro. Si el modelo esperado es multi-tenant, esto rompe aislamiento.

Accion recomendada: separar `admin` global real de roles operativos por proyecto/tenant. Agregar tests de reglas donde supervisor de proyecto A no puede leer proyecto B.

### P1-2 - MercadoPago esta implementado, pero produccion no inyecta el access token

Evidencia:

- `src/services/billing/mercadoPagoAdapter.ts:127-129` exige `MP_ACCESS_TOKEN`.
- `src/services/billing/mercadoPagoAdapter.ts:163-164` solo esta configurado si existe ese env.
- `src/server/routes/billing.ts:792-795` devuelve 503 si el adapter no esta configurado.
- `.github/workflows/deploy.yml:93` inyecta `MP_IPN_SECRET`, pero no `MP_ACCESS_TOKEN` ni `MP_ENV`.
- `.env.example` y `scripts/validate-env.cjs` tampoco declaran `MP_ACCESS_TOKEN`.

Impacto: checkout LATAM por MercadoPago fallara en produccion aunque el webhook y la ruta existan.

Accion recomendada: agregar `MP_ACCESS_TOKEN` y `MP_ENV` a `.env.example`, `validate-env.cjs`, Secret Manager/runbook y `deploy.yml`.

### P1-3 - Mobile no esta listo para lanzamiento store

Evidencia:

- No existe carpeta `android/`.
- `public/.well-known/assetlinks.json:8` contiene `REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD`.
- `public/.well-known/apple-app-site-association:6` contiene `TEAMID.com.praeventio.guard`.
- `capacitor.config.ts:34-51` documenta que el intent filter Android debe agregarse manualmente despues de `npx cap add android`.

Impacto: Android App Links, Play Store build y iOS Universal Links no estan listos para Day-1 mobile.

Accion recomendada: generar `android/`, configurar intent filters, reemplazar SHA256 real, reemplazar TEAMID real, y correr mobile signing pipeline con Fastlane/GHA.

### P1-4 - Storage rules son demasiado amplias y no estan alineadas al modelo de tenant/proyecto

Evidencia:

- `storage.rules` esta no trackeado en el working tree.
- `storage.rules:5-7` permite read/write total bajo `/workers/{uid}/**` al propietario.
- `storage.rules:9-13` usa `companyId` claim, mientras Firestore usa mucho `projectId`/`tenantId`.
- No hay restricciones de `contentType`, tamano, ruta immutable, quarantine ni segregacion de documentos medicos/legales.

Impacto: puede bloquear usuarios legitimos por claim incorrecto o permitir archivos de tipo/tamano riesgoso. En prevencion de riesgos, documentos medicos, evidencias e incidentes necesitan reglas mas finas.

Accion recomendada: redisenar rutas por tenant/proyecto, limitar tipo/tamano, separar medical/legal/evidence, y agregar tests con Storage emulator.

### P1-5 - Build pasa, pero el peso offline y los chunks son riesgo operacional

Evidencia:

- `npm.cmd run build` pasa, pero Vite advierte chunks grandes.
- El build genera WASM `ort-wasm-simd-threaded.jsep` de alrededor de 21 MB y 25 MB.
- `vite.config.ts:69-72` permite precache Workbox hasta 100 MB.
- Vite advierte dynamic imports que no pueden partir chunks porque los mismos modulos tambien son importados estaticamente.
- `ds67Service.ts:142` y `ds76Service.ts:107` importan `node:crypto` como fallback en modulos que terminan en bundle browser.

Impacto: primera carga pesada, cache offline riesgoso y comportamiento fragil en terreno con conectividad mala. Una app de seguridad debe cargar rapido y de forma predecible.

Accion recomendada: mover ONNX/SLM a lazy route explicita, no precachear WASM gigante por defecto, corregir imports estaticos que rompen code splitting y separar hashing browser-safe de hashing Node.

### P1-6 - El gating de calidad aun es parcial

Evidencia:

- `src/components/admin/CreateApiKeyModal.test.tsx` tiene 3 `it.skip`.
- `src/components/digital-twin/Site25DPanel.test.tsx:205` usa `describe.skip`.
- `tests/e2e/landing.spec.ts:13` usa `test.describe.skip`.
- `.github/workflows/mutation.yml:35` tiene `continue-on-error: true` y `scripts/check-mutation-thresholds.cjs || true`.
- El run Vitest completo tambien mostro timeouts en smoke/auth/oauth/webauthn.

Impacto: hay cobertura abundante, pero no toda bloquea regresiones reales. El riesgo no es "faltan tests"; es que el semaforo operativo todavia no representa con fidelidad el estado de flujos criticos.

Accion recomendada: matriz explicita `unit`, `rules`, `smoke`, `e2e-full`, `mutation-informational`; quitar skips de superficies criticas; y promover mutation gradualmente a required cuando sea estable.

## Deuda de producto y arquitectura

Hay dos categorias distintas:

1. Deuda bloqueante: seguridad, identidad fuerte, tenant isolation, KMS, env/deploy, CI rojo, mobile signing.
2. Deuda de valor: muchos servicios potentes existen pero no estan conectados a UI, eventos o jobs.

La segunda categoria no debe tapar la primera. El producto tiene vision fuerte: IA preventiva, Zettelkasten, compliance multi-pais, emergencias offline, mesh, SLM local, digital twin, ergonomia, CPHS y billing multi-region. Pero para avanzar correctamente, primero hay que estabilizar las garantias basicas.

## Roadmap recomendado

### Sprint 0 - Cierre de riesgo antes de seguir features

1. Corregir WebAuthn client/server y eliminar fallback legacy en flujos sensibles.
2. Hacer fail-fast de KMS prod y validar `KMS_KEY_RESOURCE_NAME`.
3. Separar tests default vs rules-tests con emulador.
4. Agregar `MP_ACCESS_TOKEN`/`MP_ENV` a contrato prod.
5. Revisar reglas Firestore para que roles operativos sean por proyecto/tenant.

Criterio de salida: `typecheck`, `build`, `test:ci` y `rules-tests` pasan en sus jobs correctos; WebAuthn sensible falla cerrado; prod no puede arrancar con KMS dev.

### Sprint 1 - Aislamiento y evidencia legal

1. Storage rules por tenant/proyecto con tamano/tipo/quarantine.
2. Tests de Firestore/Storage para datos medicos, incidentes, proyectos y CPHS.
3. Auditoria de rutas server que confian en roles o project membership.
4. OpenAPI o contrato Zod para endpoints criticos.

Criterio de salida: un usuario de tenant A no lee/escribe tenant B por cliente ni por API.

### Sprint 2 - Preparacion de lanzamiento real

1. Android folder, App Links, SHA256 real, TEAMID real.
2. Secret Manager/runbook completo para prod.
3. Smoke deploy mas fuerte que `/api/health`.
4. Billing LATAM/IAP probado end-to-end en sandbox.

Criterio de salida: build mobile y web deploy tienen credenciales y checks reproducibles.

### Sprint 3 - Recuperar valor construido

1. Event bus interno para que incidents/emergency/compliance/gamification/Zettelkasten se escuchen.
2. Wires de alto impacto: SOS auto-relay, REBA/RULA a folio SUSESO, climate risk a DS76, CPHS a claims/curriculum.
3. Lazy loading serio para IA/SLM/ONNX.
4. Dashboard operativo que muestre senales reales, no solo modulos aislados.

Criterio de salida: flujos preventivos completos de deteccion, accion, evidencia y aprendizaje.

## Orden de prioridad

Si solo se puede atacar una cosa: WebAuthn.  
Si se pueden atacar tres: WebAuthn, KMS y test matrix.  
Si se puede cerrar un sprint completo: sumar Firestore tenant isolation y MercadoPago prod env.

El proyecto ya tiene una base seria. La deuda principal no es falta de ambicion ni falta de codigo; es que algunas garantias de seguridad, despliegue y pruebas aun no estan al nivel de responsabilidad que exige una aplicacion que puede influir en decisiones de seguridad laboral.
