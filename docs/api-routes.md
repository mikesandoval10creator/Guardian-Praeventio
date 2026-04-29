# Praeventio Guard — API Routes Catalog

Catálogo completo de los endpoints HTTP expuestos por `server.ts`.
Auto-extraído al cierre de Round 16 / 2026-04-28 desde el HEAD `7b907d8`.

**Total: 43 rutas.** Si agregaste una ruta y este número no cuadra,
actualiza el catálogo en el mismo PR.

Convenciones:
- Todas las rutas montan bajo el rate limiter global `/api/*` (100 req /
  15 min / IP) excepto `/billing/webpay/return` y `/auth/google/callback`
  (no llevan prefijo `/api`) y los webhooks que pasan por el limitador
  pero usan secretos compartidos como auth.
- "Auth" = `verifyAuth` (Firebase Bearer token) salvo indicación contraria.
- "Audit" = entrada en colección `audit_logs`.
- Tenant isolation: `assertProjectMember` significa que el server verifica
  que el `req.user.uid` está en `projects/{projectId}.members[]` o es
  `createdBy`. Sin esa guarda, un atacante autenticado puede polucionar
  datos de proyectos ajenos.

Group navigation:
1. [Health](#health)
2. [Admin](#admin)
3. [Audit](#audit)
4. [OAuth (Google)](#oauth-google)
5. [Calendar / Environment / Fitness](#calendar--environment--fitness)
6. [Drive](#drive)
7. [ERP](#erp)
8. [Telemetry (IoT)](#telemetry-iot)
9. [Seed](#seed)
10. [Projects + Invitations](#projects--invitations)
11. [Gamification](#gamification)
12. [Coach (chat IA)](#coach-chat-ia)
13. [Legal](#legal)
14. [Reports (PDF)](#reports-pdf)
15. [Ask Guardian (RAG)](#ask-guardian-rag)
16. [Gemini proxy](#gemini-proxy)
17. [Billing — Google Play](#billing--google-play)
18. [Billing — Webpay (CLP)](#billing--webpay-clp)
19. [Billing — MercadoPago (LATAM)](#billing--mercadopago-latam)
20. [Curriculum claims](#curriculum-claims)

---

## Health

### `GET /api/health` — public health probe
- **server.ts:222** · público (no auth).
- **Body**: ninguno.
- **Response 200**: `{ status: 'ok', timestamp, version, checks: {firestore: 'ok'} }`.
- **Response 503**: mismo shape con `status: 'degraded'`, `checks.firestore: 'fail'`.
- **Audit**: ninguno (probe a alta frecuencia, sería ruido).
- **Rate limit**: bypassa el limiter global (montado antes del middleware).
- **Tenant**: N/A.

---

## Admin

### `POST /api/admin/revoke-access` — revocar refresh tokens
- **server.ts:322** · `verifyAuth` + role admin.
- **Body**: `{ targetUid: string (≤128, regex ^[A-Za-z0-9_-]+$) }`.
- **Response 200**: `{ success: true, message }`.
- **Errors**: 400 invalid uid · 403 caller no es admin · 500.
- **Audit**: `revoke_access`, target uid, ip, ua.
- **Side effects**: `admin.auth().revokeRefreshTokens` + escribe
  `user_sessions/{targetUid}.revokedAt`.

### `POST /api/admin/set-role` — set custom claim role
- **server.ts:362** · `verifyAuth` + role admin.
- **Body**: `{ uid: string, role: 'admin'|'gerente'|...}` (validado por
  `isValidRole`).
- **Response 200**: `{ success: true }`.
- **Errors**: 400 invalid uid/role · 403 caller no es admin · 500.
- **Audit**: `set_role`, oldRole→newRole.
- **Side effects**: `setCustomUserClaims` + `revokeRefreshTokens` para
  forzar re-auth.

---

## Audit

### `POST /api/audit-log` — server-side audit log writer
- **server.ts:605** · `verifyAuth`.
- **Body**: `{ action: string (≤64), module: string (≤64), details?: object,
  projectId?: string (≤128) }`.
- **Response 200**: `{ success: true }`.
- **Errors**: 400 invalid fields · 403 si `projectId` y caller no es member
  (via `assertProjectMember`) · 500.
- **Audit**: este *es* el endpoint que escribe `audit_logs`. El cliente
  usaba `addDoc` directo; las reglas Firestore lo deniegan ahora.
  - Server estampa `userId` y `userEmail` desde el token, **no** desde el body.
- **Tenant**: `assertProjectMember` cuando hay `projectId`.

---

## OAuth (Google)

### `POST /api/oauth/unlink` — desvincular tokens Google
- **server.ts:661** · `verifyAuth`. Idempotente.
- **Body**: ninguno.
- **Response 200**: `{ success: true }`.
- **Errors**: 500.
- **Audit**: ninguno (operación de cleanup; debería loggearse — TODO post-R16).
- **Side effects**: borra `oauth_tokens/{uid}/{google,google-drive}`.

### `GET /api/auth/google/url` — iniciar flow OAuth Google (calendar+fit)
- **server.ts:679** · `verifyAuth`.
- **Response 200**: `{ url: 'https://accounts.google.com/...' }`.
- **Side effects**: graba `req.session.oauthState` y `oauthInitiator.uid`
  para validar callback CSRF.

### `GET /auth/google/callback` — callback OAuth (popup)
- **server.ts:705** · público (auth via session cookie + state param).
- **Query**: `code, state`.
- **Response 200**: HTML con `postMessage` al opener.
- **Errors**: 403 state mismatch · 500 token exchange failed.
- **Side effects**: `saveTokens` (envelope-encrypted) bajo
  `oauth_tokens/{uid}/google`.
- **Audit**: ninguno (TODO).

### Scopes solicitados
Ver `marketplace/scope-justifications.md` para la justificación detallada
de cada scope OAuth.

---

## Calendar / Environment / Fitness

### `GET /api/calendar/list` — próximos 30 días Calendar
- **server.ts:775** · `verifyAuth`.
- **Response 200**: `{ items: CalendarEvent[] }`. Si no hay tokens
  vinculados → `{ items: [] }` (graceful).
- **Errors**: ninguno (degrada a `[]`).
- **Audit**: ninguno.
- **Tenant**: scope solo a uid del caller (Google Calendar `primary`).

### `POST /api/calendar/sync` — crear eventos Calendar
- **server.ts:837** · `verifyAuth`.
- **Body**: `{ challenges: string[] }`.
- **Response 200**: `{ success: true, results: GoogleCalendarEvent[] }`.
- **Errors**: 401 no Google linked · 500.
- **Audit**: ninguno (TODO — esto modifica el calendario del usuario).

### `GET /api/environment/forecast` — pronóstico climático 1-7 días
- **server.ts:817** · público.
- **Query**: `days: 1..7` (default 3).
- **Response 200**: `{ forecast: ClimateForecastDay[] }`. Best-effort;
  si OpenWeather falla → `{ forecast: [] }`.
- **Errors**: ninguno (graceful).
- **Audit**: ninguno (lectura pública).

### `POST /api/fitness/sync` — Google Fit (DEPRECATED)
- **server.ts:895** · `verifyAuth`.
- **Headers de respuesta**: `Sunset: 2026-12-31`, `Deprecation`, `Link`
  apuntando a `/api/health-data` (Health Connect/HealthKit on-device).
- **Body**: ninguno (lee últimos 7 días).
- **Response 200**: `{ success, data: GoogleFitAggregate }`.
- **Errors**: 401 no Google linked · upstream-status passthrough · 500.
- **Audit**: ninguno; emite `logger.warn('fitness_sync_deprecated_called')`.

---

## Drive

### `GET /api/drive/auth/url` — iniciar flow OAuth Drive
- **server.ts:959** · `verifyAuth`.
- **Response 200**: `{ url }`. Scope: `drive.file`.

### `GET /api/drive/auth/callback` — callback Drive
- **server.ts:982** · público (auth via session cookie + state param).
- **Query**: `code, state`.
- **Response 200**: HTML con `postMessage`.
- **Errors**: 403 state mismatch · 500.

---

## ERP

### `POST /api/erp/sync` — mock sync SAP/Defontana
- **server.ts:1045** · `verifyAuth`.
- **Body**: `{ erpType: 'SAP'|'Defontana', action, payload }`.
- **Response 200**: `{ success, message, data: {syncId, timestamp, status} }`.
- **Errors**: 500.
- **Audit**: escribe a `erp_sync_logs` (no a `audit_logs`). Consideración
  pendiente: unificar con audit_logs para una traza consistente.

---

## Telemetry (IoT)

### `POST /api/telemetry/ingest` — webhook IoT
- **server.ts:1090** · público pero gated por `X-IoT-Secret`
  (timing-safe vs `IOT_WEBHOOK_SECRET`); fallback en body deprecado.
- **Body**: `{ type ∈ {iot,wearable,machinery,environmental,machine},
  source (≤64), metric (≤64), value: number, unit?, status?, projectId? }`.
- **Response 200**: `{ success, aiValidation }`.
- **Errors**: 400 missing/invalid fields · 401 secret · 500.
- **Audit**: `telemetry_events.add(...)` (colección dedicada, no audit_logs).
  La auto-validación AI emite `aiValidation.isAnomalous` que dispara
  alertas downstream.
- **Tenant**: `projectId` aceptado del body sin verificación de membership
  porque la fuente es un gateway IoT (no un usuario) — el secret compartido
  es la guarda. **Hardening pendiente** post-R16: gateways deberían tener
  per-tenant secrets.

---

## Seed

### `POST /api/seed-glossary` — seed glosario (gerente-only)
- **server.ts:1171** · `verifyAuth` + role `gerente` exacto.
- **Response 200**: `{ success, message }`.
- **Errors**: 403 · 500.

### `POST /api/seed-data` — seed proyecto demo (gerente-only)
- **server.ts:1187** · `verifyAuth` + role `gerente` exacto.
- **Response 200**: `{ success, message }`.
- **Errors**: 403 · 500.

---

## Projects + Invitations

### `POST /api/projects/:id/invite` — invitar miembro
- **server.ts:1241** · `verifyAuth`. Solo `createdBy` o role
  `gerente`/`admin` puede invitar.
- **Body**: `{ invitedEmail, invitedRole }`.
- **Response 200**: `{ success, inviteId, token, expiresAt }`. Email
  enviado vía Resend (no bloqueante).
- **Errors**: 400 missing · 403 not creator · 404 project · 409 ya member
  / invitación pendiente · 500.
- **Audit**: ninguno directo; la creación del documento `invitations`
  queda en Firestore.
- **Tenant**: lectura del `projects/{id}` para verificar `createdBy`.

### `GET /api/invitations/info/:token` — preview pública
- **server.ts:1322** · público (token actúa como bearer).
- **Response 200**: `{ projectName, invitedRole, invitedEmail, expiresAt }`.
- **Errors**: 404 not found · 410 expired · 500.

### `POST /api/invitations/:token/accept` — aceptar invitación
- **server.ts:1346** · `verifyAuth`. El email del token verificado
  debe coincidir con `invite.invitedEmail`.
- **Response 200**: `{ success, projectId, role }`.
- **Errors**: 403 email mismatch · 404 not found · 410 expired · 500.
- **Side effects**: `projects.{id}.members += [uid]`, `memberRoles[uid] = role`.

### `GET /api/projects/:id/members` — listar miembros + invitaciones
- **server.ts:1390** · `verifyAuth`. Caller debe ser member o
  `gerente`/`admin`.
- **Response 200**: `{ success, members: MemberDetail[], pendingInvitations }`.
- **Errors**: 403 not member · 404 project · 500.

### `DELETE /api/projects/:id/members/:uid` — remover miembro
- **server.ts:1449** · `verifyAuth`. Solo creator, self, o `gerente`/`admin`.
- **Response 200**: `{ success }`.
- **Errors**: 400 cannot remove creator · 403 · 404 · 500.

### `DELETE /api/projects/:id/invite` — cancelar invitación pendiente
- **server.ts:1485** · `verifyAuth`. Solo creator o `gerente`/`admin`.
- **Body**: `{ inviteId }`.
- **Response 200**: `{ success }`.
- **Errors**: 400 missing · 403 not creator / not owner of invite · 404 · 500.

---

## Gamification

### `POST /api/gamification/points` — otorgar puntos
- **server.ts:1526** · `verifyAuth`.
- **Body**: `{ amount: number, reason: string }`.
- **Response 200**: `{ success }`.
- **Errors**: 500.
- **Audit**: ninguno (TODO — la auto-asignación de puntos al propio uid
  necesita guardrail anti-abuse).

### `GET /api/gamification/leaderboard` — top users
- **server.ts:1537** · `verifyAuth`.
- **Response 200**: `{ success, leaderboard }`.
- **Tenant**: actualmente global (no por proyecto). Post-R20 introducir
  `?projectId=...`.

### `POST /api/gamification/check-medals` — recalcular medallas
- **server.ts:1546** · `verifyAuth`.
- **Response 200**: `{ success, newMedals }`.

---

## Coach (chat IA)

### `POST /api/coach/chat` — Safety Coach personalizado
- **server.ts:1557** · `verifyAuth`.
- **Body**: `{ message, projectContext: { id } }`.
- **Response 200**: `{ success, response: string }`.
- **Errors**: 500.
- **Tenant**: lee `incidents` filtrado por `projectId` — **falta**
  `assertProjectMember`. Tracker post-R16.

---

## Legal

### `GET /api/legal/check-updates` — escanear normativa BCN
- **server.ts:1574** · `verifyAuth`.
- **Response 200**: `{ results: { lawId, title, lastUpdated, ... }[] }`.
- **Errors**: 500.
- **Cost note**: corre N llamadas a Gemini en paralelo (una por ley en
  `bcnKnowledgeBase`). Considerar caching agresivo.

---

## Reports (PDF)

### `POST /api/reports/generate-pdf` — generar PDF SUSESO/general
- **server.ts:487** · `verifyAuth`. Body limit elevado a **2 MB**
  (vs 64 KB global) para incluir contenido markdown extenso.
- **Body**: `{ incidentId?, title, content (markdown), type, metadata }`.
- **Response 200**: `application/pdf` stream (Content-Disposition:
  attachment).
- **Errors**: 500.
- **Audit**: ninguno (TODO — generar PDFs es "exporta data" y debería
  loggearse).

---

## Ask Guardian (RAG)

### `POST /api/ask-guardian` — chat con contexto legal
- **server.ts:416** · `verifyAuth`.
- **Body**: `{ query: string, stream?: boolean }`.
- **Response 200**: si `stream=true` → `text/event-stream`
  (`data: {"text":"..."}`); si no → `{ response, contextUsed }`.
- **Errors**: 500 si `GEMINI_API_KEY` no configurada · 500 upstream.
- **Audit**: ninguno (queries son alta frecuencia; loggearse selectivamente
  si se introduce análisis de uso).
- **Modelo**: `gemini-3.1-pro-preview` con prompt-system + RAG context vía
  `searchRelevantContext`.

---

## Gemini proxy

### `POST /api/gemini` — invocador whitelist
- **server.ts:1680** · `verifyAuth` + `geminiLimiter` (30 req/15min/uid).
- **Body**: `{ action: string, args: any[] }`.
- **Whitelist**: 85 acciones en `ALLOWED_GEMINI_ACTIONS`
  (server.ts:1593-1678). Cualquier otra → 403.
- **Response 200**: `{ result: any }` (shape depende de la acción).
- **Errors**: 400 acción no encontrada en módulo · 403 acción no whitelisted · 500.
- **Cost note**: el rate limit per-uid es la única protección — un usuario
  con tier alto puede consumir mucho. Cap de costo agregado vive en
  `BILLING.md` §"Gemini quota".

---

## Billing — Google Play

### `POST /api/billing/verify` — verificar compra Play
- **server.ts:1717** · `verifyAuth`.
- **Body**: `{ purchaseToken, productId, type: 'subscription'|'product' }`.
- **Response 200**: `{ success, data }` (passthrough del Play Developer API).
- **Errors**: 500 si `playAuth` o `GOOGLE_PLAY_PACKAGE_NAME` no configurados.
- **Audit**: escribe a `transactions` (no a `audit_logs`) y actualiza
  `users/{uid}.subscription`.

### `POST /api/billing/webhook` — RTDN webhook (Pub/Sub push)
- **server.ts:1797** · público pero gated por `?token=<WEBHOOK_SECRET>`
  (timing-safe).
- **Body**: `{ message: { data: base64, messageId, ... } }` (Pub/Sub).
- **Response 200**: `OK` siempre que se pueda procesar idempotentemente
  (incluyendo replays). 401 secret · 500 procesamiento.
- **Audit**: `logger.info('rtdn_received', ...)` con metadata no-sensible
  (NUNCA `purchaseToken`).
- **Idempotencia**: lock en `processed_pubsub/{messageId}` via
  `withIdempotency` helper.

---

## Billing — Webpay (CLP)

### `POST /api/billing/checkout` — crear invoice + Webpay/Stripe/manual
- **server.ts:1972** · `verifyAuth`.
- **Body**: `{ tierId (≤64), cycle: monthly|annual, currency: CLP|USD,
  paymentMethod: webpay|stripe|manual-transfer, totalWorkers (0..1M),
  totalProjects (0..100K), cliente: {nombre,email,rut?} }`.
- **Cross-validation**: CLP requiere webpay/manual; USD requiere
  stripe/manual.
- **Response 200**: `{ invoiceId, invoice, paymentUrl?, status:
  'awaiting-payment'|'pending-config' }`.
- **Errors**: 400 cualquier campo inválido · 500.
- **Audit**: ninguno directo; el `invoices/{id}` queda con `createdBy`,
  `createdByEmail`, `createdAt`.
- **Tenant**: scope a uid del caller (no es operación de proyecto).

### `POST /api/billing/invoice/:id/mark-paid` — admin manual fallback
- **server.ts:2120** · `verifyAuth` + role admin (`isAdminRole`).
- **Path**: `:id` validado regex `^[A-Za-z0-9_-]{1,128}$`.
- **Response 200**: `{ success, alreadyPaid? }`.
- **Errors**: 400 invalid id · 403 no admin · 404 not found · 409 si
  status cancelled/refunded · 500.
- **Audit**: `billing.mark-paid` con `{invoiceId, total, currency}`.

### `GET /api/billing/invoice/:id` — status poll (≤1Hz uid)
- **server.ts:2208** · `verifyAuth` + `invoiceStatusLimiter` (600 req/15min/uid).
- **Response 200**: shape **whitelisted** — solo `{id, status, totals,
  emisorRut, issuedAt, paidAt?, rejectionReason?}`. Nunca expone
  `webpayToken`, `webpayAuthCode`, `lineItems`, `createdByEmail`.
- **Errors**: 400 invalid id · 404 (también para `createdBy != uid` —
  nunca 403, evita enumeration) · 500.
- **Audit**: ninguno (read-only poll).

### `GET /billing/webpay/return` — Transbank return URL
- **server.ts:2321** · público (auth via `token_ws` Transbank-firmado).
- **Query**: `token_ws` (validado regex `^[A-Za-z0-9_-]{1,128}$`).
- **Response**: `302` redirect a `/pricing/{success|failed|retry}?invoice=...`.
- **Errors**: 400 token_ws inválido · redirect a `/pricing/failed?error=webpay` en error.
- **Audit**: `billing.webpay-return.authorized` con `{invoiceId, amount,
  authCode}` cuando Transbank responde AUTHORIZED.
- **Idempotencia**: lock en `processed_webpay/{token_ws}` via
  `acquireWebpayIdempotencyLock` / `finalizeWebpayIdempotencyLock`.
- **Métrica**: `praeventio/webpay/return_latency_ms` histograma con label
  `outcome=success|failure|invalid`.

---

## Billing — MercadoPago (LATAM)

### `POST /api/billing/checkout/mercadopago` — checkout PE/AR/CO/MX/BR
- **server.ts:2488** · `verifyAuth`.
- **Body**: `{ tierKey (≤64), billingCycle: monthly|annual, country:
  PE|AR|CO|MX|BR, currency: PEN|ARS|COP|MXN|BRL }`.
- **Cross-validation**: `(country, currency)` debe matchear
  `MP_CURRENCY_BY_COUNTRY` exactamente.
- **Response 200**: `{ preferenceId, init_point, invoiceId }`.
- **Errors**: 400 tier/cycle/country/currency inválido · 503 MP no
  configurado · 502 MP API failure · 500.
- **Audit**: `billing.mercadopago.preference.created` con
  `{invoiceId, preferenceId, tierKey, billingCycle, country, currency, amount}`.
- **Idempotencia**: ninguna a nivel server — el cliente NO debe retry-ear
  en 5xx sin verificar primero. Round 16 agregará webhook IPN dedicado.

---

## Curriculum claims

### `POST /api/curriculum/claim` — worker crea claim firmado
- **server.ts:2901** · `verifyAuth`.
- **Body**: `{ claim: string (≤500), category: experience|certification|
  incident_record|other, referees: [{name,email}, {name,email}] (length=2,
  distinct emails), signedByWorker: {method, signature} }`.
- **Response 200**: `{ success, claimId }`.
- **Errors**: 400 cualquier validación falla (mensaje específico) · 500.
- **Audit**: `curriculum.claim.created` con metadata no-PII (longitud del
  claim, referee emails). El servicio en
  `src/services/curriculum/claims.ts` emite el log.
- **Side effects**: 2 emails Resend (best-effort, no bloquean).

### `GET /api/curriculum/claims` — listar mis claims
- **server.ts:2973** · `verifyAuth`.
- **Response 200**: `{ success, claims: Claim[] }`.
- **Errors**: 500.
- **Tenant**: scope automático a `req.user.uid`.

### `POST /api/curriculum/claim/:id/resend` — re-emitir magic-link
- **server.ts:2986** · `verifyAuth`. Cool-down per `(claimId, refereeIndex)`
  de 30s en memoria.
- **Body**: `{ refereeIndex: 0|1 }`.
- **Response 200**: `{ success }`.
- **Errors**: 400 invalid index · 403 not your claim · 404 claim · 409
  status no es `pending_referees` o slot ya respondió · 429 cool-down · 500.
- **Side effects**: rota el token (nuevo raw + nuevo hash). El token viejo
  queda inerte — nunca se reusa.

### `GET /api/curriculum/referee/:token` — preview pública del claim
- **server.ts:3058** · público + `refereeLimiter` (30 req/15min).
- **Path**: token regex `^[0-9a-f]{64}$`.
- **Response 200**: `{ claimText, workerName, workerEmail, refereeName,
  refereeEmail, category, status, alreadySigned, expiresAt }`.
- **Errors**: 400 invalid token · 404 no match · 500.
- **Side effects**: lazy-expire si `expiresAt < now`.

### `POST /api/curriculum/referee/:token` — co-firmar o declinar
- **server.ts:3115** · público + `refereeLimiter`.
- **Body**: `{ action: cosign|decline, method: webauthn|standard,
  signature: string (≤1024) }`.
- **Response 200**: `{ success, verified, declined? }`.
- **Errors**: 400 invalid action/method/signature · 404 no match · 409
  already · 410 expired · 500.
- **Audit**: `curriculum.referee.signed` o `curriculum.referee.declined`
  con `{claimId, refereeEmail}`. El service en
  `src/services/curriculum/claims.ts` lockea el doc post-verify (append-only).

---

## Notas finales

### Rutas con audit log faltante (TODO post-R16)
- `/api/oauth/unlink` — operación destructiva, debe loggearse.
- `/auth/google/callback` — vinculación de cuenta externa.
- `/api/calendar/sync` — escribe en calendar del usuario.
- `/api/coach/chat` — falta `assertProjectMember` para `projectContext.id`.
- `/api/gamification/points` — auto-asignación necesita guardrail.
- `/api/reports/generate-pdf` — exfil de data sensible vía export.

### Rutas deprecadas
- `POST /api/fitness/sync` — Sunset 2026-12-31 (Health Connect / HealthKit
  on-device los reemplazan).

### Webhooks
Endpoints que NO usan `verifyAuth` y dependen de secretos compartidos:
- `POST /api/telemetry/ingest` (`X-IoT-Secret` vs `IOT_WEBHOOK_SECRET`).
- `POST /api/billing/webhook` (`?token=` vs `WEBHOOK_SECRET`).
- `GET /billing/webpay/return` (Transbank firma el `token_ws`).
- `GET /api/curriculum/referee/:token` + POST (256-bit token = bearer).

### Verificación
Si agregaste/quitaste una ruta, verifica el conteo:
```bash
grep -nE "^app\.(get|post|put|delete|patch)\s*\(" server.ts | wc -l
```
Y actualiza el "Total" en la línea 7 de este archivo.
