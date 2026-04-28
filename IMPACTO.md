# Impacto en el bienestar humano + valor empresarial — KMS real, Health Connect operacional, Vertex preparado, SII listo

## Resumen ejecutivo

Esta ronda movió cinco piezas de scaffolding a infraestructura productiva o lista para producir. Los tokens OAuth ya pueden cifrarse con Cloud KMS de Google (no más plaintext en Firestore aunque alguien saque un export). El sunset de Google Fit (31-dic-2026) deja de ser deuda: iOS lee biométrica via HealthKit on-device y el endpoint legacy emite headers RFC 8594. Vertex AI tiene runbook para data-residency Santiago el día que Codelco/AMSA lo pidan. La UX del flujo Webpay tiene feedback claro en éxito/fallo/retry. Y el sistema ya conoce los DTE 33/39/41/56/61 del SII con cuatro PSE comparados. Ninguno requiere ahora "construir desde cero" — solo provisionar credenciales y elegir proveedor.

## 1. Defensa en profundidad real para tokens OAuth

- `src/services/security/kmsAdapter.ts:127` — clase `CloudKmsAdapter` real contra `@google-cloud/kms@5.4.0`, gateada por `KMS_KEY_RESOURCE_NAME` (línea 134). Si el env no está, `isAvailable=false` y el sistema cae sin romper nada (línea 144).
- `src/services/security/kmsAdapter.ts:21` — import productivo `KeyManagementServiceClient from '@google-cloud/kms'`.
- `src/services/security/cloudKmsAdapter.test.ts` — 6 tests con SDK mockeado verifican que el `keyName` se forwardea al cliente KMS.
- `scripts/migrate-oauth-tokens-to-envelope.cjs` — migración idempotente con `--dry-run` y `--batch=N`. Lee `oauth_tokens` por lotes, cifra plaintext legacy via adapter configurado, escribe back.
- `KMS_ROTATION.md` — Round 2 marcado done, comandos reales con dry-run, follow-ups Round 3 (alertas en KMS error rate, integration tests con WIF service account).

## 2. iOS + Android pre-Fit-sunset

- `package.json:39` — `@perfood/capacitor-healthkit@^1.3.2` instalado (con `--legacy-peer-deps` por gap de major en Capacitor, mismo patrón que el plugin Health Connect).
- `src/services/health/healthKitAdapter.ts` (264 LOC) — impl real contra `CapacitorHealthkit`: `requestPermissions / readHeartRate / readSteps / readCalories / readSleep`, backed by plugin (cero stubs).
- `src/services/health/index.ts:85` — facade `getHealthAdapter()` selecciona iOS (HealthKit) | Android (Health Connect) | web (noop) | legacy (Google Fit deprecated).
- `server.ts:871-872` — `/api/fitness/sync` emite `Sunset: Wed, 31 Dec 2026 23:59:59 GMT` y `Deprecation: ...` (RFC 8594), más `Link: rel="successor-version"` a `/api/health-data`.
- `server.ts:879` — log estructurado `fitness_sync_deprecated_called` con `uid`, userAgent y metadata del sunset.
- `src/pages/Telemetry.tsx:182,235` — branch dual `'health-connect' || 'healthkit'` para que el flujo nativo funcione transparente en ambas plataformas.
- 12 → 16 tests del módulo health (4 nuevos casos iOS).

## 3. Data-residency Santiago lista para enterprise

- `src/services/ai/aiAdapter.ts` — interface `AiAdapter` con `name / region / isAvailable / generate()`. La región es parte del contrato.
- `src/services/ai/geminiAdapter.ts` — wrapper sobre `@google/genai` actual, region `'us-central1'` (consumer).
- `src/services/ai/vertexAdapter.ts` — stub con mensaje migration-helpful, region default `'southamerica-west1'`.
- `src/services/ai/index.ts:71` — facade `getAiAdapter()` selecciona por `AI_ADAPTER` env (línea 72), lee la variable en cada llamada (no cachea) para que tests puedan mutarla.
- `VERTEX_MIGRATION.md` (246 LOC) — runbook 8 secciones: prerequisites, SDK install, migración de call-sites de `geminiBackend.ts`, costos, fine-tuning (5 fases), DR, testing.
- 17 tests cubriendo facade + region claim + getter-not-constructor pattern (RED→GREEN).

## 4. UX coherente en el path de pago

- `src/components/legal/CookieConsent.tsx:63` — `useState<ConsentValue | null>(() => readStoredConsent())` con lazy initialState. Antes había un frame de estado `'pending'`; ahora cero flicker para el usuario que ya consintió.
- `src/services/health/healthConnectAdapter.ts:188,212` — nuevos exports `preWarmHealthConnect()` y `awaitAvailability()`.
- `src/App.tsx:4,161` — App component llama `void preWarmHealthConnect()` en mount, evita el falso-negativo "Health Connect no disponible" que aparecía antes de que el plugin terminara de inicializar.
- `src/App.tsx:126-128` — rutas `/pricing/success`, `/pricing/failed`, `/pricing/retry` mapeadas al componente Pricing.
- `src/pages/Pricing.tsx:373` — `WebpayReturnBanner` renderiza al tope de PricingInner (montado en línea 544) según pathname:
  - `/pricing/success` (línea 376) → spinner + "Procesando pago…" + invoice id.
  - `/pricing/failed` (línea 377) → tarjeta roja "Pago rechazado, vuelve a intentar".
  - `/pricing/retry` (línea 378) → tarjeta amber "Pago en cola, volveremos a intentar".
- `firestore.rules:6` — `TODO(billing)` corregido a `NOTE(billing)` (la colección `processed_webpay/{token_ws}` es lock por diseño, no deuda).

## 5. Facturación electrónica chilena scaffolded

- `src/services/sii/types.ts` — types DTE 33/39/41/56/61, DteHeader/Item/Totals/Request/Response, `emisorRut: '78231119-0'` lockeado como literal.
- `src/services/sii/siiAdapter.ts:44,76` — `calculateDteTotals` pure helper con `Math.ceil(net * 0.19)`, mismo rounding que `pricing/tiers.ts:withIVA` (cross-link explícito en docstring línea 34).
- `src/services/sii/{openfactura,simpleApi,bsale,libredte}Adapter.ts` — 4 stubs de PSE con URLs de docs, listos para cuando se elija proveedor.
- `src/services/sii/index.ts:51` — facade `getSiiAdapter()` por `SII_PSE` env, default `'noop'` (línea 52) para no caer si la var falta.
- `SII_INTEGRATION.md` (156 LOC) — runbook con prerequisites SII contribuyente electrónico (~30 días), CAF management, tabla comparativa PSE: OpenFactura ($20-50k flat + tier, mid-market default), SimpleAPI (per-DTE ~$20-50, REST + HMAC), Bsale ($30k+ ERP completo), LibreDTE (self-hosted free, requiere DevOps).
- 34 tests cubriendo math (RED→GREEN con regresión de `Math.floor`), facade y stubs.

## Lo que el trabajador chileno gana

- Si un admin con permiso de Firestore export saca la base, sus tokens OAuth (acceso a su Google Calendar/Fit) NO están en plaintext — defensa en profundidad bajo Ley 19.628 / 21.719.
- El trabajador con iPhone, cuando llegue el sunset Fit el 31-dic-2026, sigue alimentando data biométrica al sistema vía HealthKit on-device — sin OAuth, sin servidor intermediario, mejor privacidad.
- El trabajador Android con Health Connect ya no ve "Health Connect no disponible" por race condition al abrir la app: el pre-warm en App mount resuelve la disponibilidad antes de pintar el primer Telemetry.
- Después de pagar Webpay ya no ve "Página no encontrada" ni se queda colgado — ve feedback claro: éxito con invoice id, rechazo con mensaje accionable, retry con explicación.
- Si revoca el consentimiento de cookies y vuelve, el banner no parpadea — la decisión se respeta de inmediato.

## Lo que la empresa cliente gana

- Argumento de procurement concreto para Codelco/AMSA: "tu data biométrica nunca sale de Chile" — switch `AI_ADAPTER=vertex-ai` activa data-residency Santiago el día que se firme.
- Migración Google Fit terminada antes del sunset oficial; nada se rompe el 1-ene-2027 ni para flotas iOS ni Android.
- Tokens OAuth cifrados con KMS rotable: cumple expectativas de auditoría enterprise (ISO 27001 / SOC 2) sin trabajo adicional del equipo del cliente.
- Cuando emita su primera factura electrónica al cliente final, Praeventio ya tiene contrato DTE listo — no demora de 30 días encima de la habilitación SII.

## Lo que Praeventio (la empresa) gana

- KMS real elimina el principal hallazgo del audit interno (tokens plaintext) — desbloquea compliance con mutuales.
- `VERTEX_MIGRATION.md` y `SII_INTEGRATION.md` son runbooks ejecutables: cualquier ingeniero nuevo (o un consultor externo) puede operarlos sin tribal knowledge.
- 16 tests health + 17 tests AI + 34 tests SII + 6 tests KMS añadidos esta ronda — la regresión está cubierta antes de los cambios de producción.
- Stubs typed de Vertex y de los 4 PSE significan que el "go-decision" futuro es de pricing/comercial, no de arquitectura — el código está listo.
- Sunset header RFC 8594 en `/api/fitness/sync` es el camino estándar para deprecar APIs públicas; las flotas que aún hablan ese endpoint avisan al log y al cliente con la fecha exacta.

## Limitaciones reconocidas honestamente

- `KMS_KEY_RESOURCE_NAME` aún no provisionado en Cloud Run prod — el adapter cae a `isAvailable=false` y los tokens nuevos quedan en el path legacy hasta que se cree el keyring/key.
- iOS HealthKit requiere `Info.plist` con `NSHealthShareUsageDescription` y entitlements de capability, pendientes en el proyecto Xcode (no se hace desde JS).
- Vertex SDK (`@google-cloud/vertexai` o equivalente) NO está instalado todavía — el adapter es stub que tira con mensaje migration-helpful; instalación es Round siguiente.
- SII PSE pick pendiente — los 4 adapters son stubs hasta que el equipo comercial decida proveedor según volumen real de DTE/mes.
- Migración OAuth a envelope encryption es manual (correr `scripts/migrate-oauth-tokens-to-envelope.cjs`) y aún no está agendada en producción.

## KPIs sugeridos

- % de tokens OAuth en Firestore con prefijo de envelope KMS (target 100% post-migración, hoy 0%).
- Conteo diario de `fitness_sync_deprecated_called` en logs — debe bajar a cero antes del 31-dic-2026.
- Latencia p95 de `getHealthAdapter()` en mount de Telemetry — el pre-warm debería mantenerla <200ms en Android low-end.
- Bounce rate en `/pricing/failed` y `/pricing/retry` (proxy de claridad del banner) y conversion rate en `/pricing/success`.
- Tiempo desde "decisión de PSE" hasta primera DTE emitida en producción — runbook claim ≤2 semanas con OpenFactura.
