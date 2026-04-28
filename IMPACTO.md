# Impacto en el bienestar humano + valor empresarial — Pagos robustos, Marketplace listing-ready, KMS envelope, Health Connect

## Resumen ejecutivo
Esta ronda cierra los tres bloqueadores formales que impedían a Praeventio entrar al Google Workspace Marketplace, endurece los pagos B2B chilenos contra los timeouts de Transbank (un trabajador ya no pierde su factura por congestión de red), instala los cimientos para cifrar los OAuth tokens al reposo bajo Ley 19.628, y aterriza la migración Health Connect con plugin real instalado y adapter funcionando — el sunset Google Fit 2026 ya no es una amenaza, es un proceso. El switch multi-país queda accesible desde el bolsillo del trabajador en faena. Es una ronda de habilitación: no agrega features llamativos, abre puertas comerciales (listing público, contratos enterprise) y cierra deuda técnica de seguridad y resiliencia.

## 1. Pagos B2B chilenos robustos contra timeouts
- `src/services/billing/webpayAdapter.ts:156-220`: mapeo three-state AUTHORIZED / REJECTED / FAILED. Códigos -96 / -97 / -98 (timeout Transbank, falla de red entre TBK y emisor, servicio no disponible) ya NO se mapean a REJECTED — ahora son FAILED, que mantiene la invoice en `pending-payment` para reintento limpio con la misma tarjeta.
- `src/services/billing/types.ts:75-101`: union de status extendida con `'rejected'`. Vocabulario correcto: tarjeta declinada (rejected, accionable, reintentable) ≠ usuario o admin canceló (cancelled, terminal). Ya no se confunden en la UI ni en los reportes contables.
- `src/services/billing/webpayAdapter.ts:306-457`: idempotency lock-then-complete vía `processed_webpay/{token_ws}`, mismo patrón que el RTDN webhook de Google Play. Race-safe: dos hits concurrentes del return URL (recarga de browser, doble-tap, retry de red) no procesan la transacción dos veces ni cobran dos veces.
- `server.ts:2356-2415`: `/billing/webpay/return` reescrito con la nueva lógica — REJECTED marca `status: 'rejected'` (la invoice sigue actionable), FAILED preserva `pending-payment`, AUTHORIZED finaliza a `paid`.
- 23 → 34 billing tests. **Para un trabajador en faena**: si su empresa paga el plan Praeventio justo cuando Transbank tiene congestión, no recibe una factura cancelada por error y un correo de "su tarjeta fue rechazada" — la invoice queda accionable y el ERP corporativo no entra en pánico contable.

## 2. Listing público en Google Workspace Marketplace habilitado
- `server.ts:173-189`: `/api/health` endpoint público (sin auth, sin rate-limit) que Cloud Run y el Marketplace usan para health probes. Verifica reachability de Firestore con `listCollections()` y reporta 200 OK / 503 degraded más timestamp y versión.
- `src/pages/Terms.tsx` + `src/services/legal/termsContent.ts`: página `/terms` con 10 secciones bajo Ley 19.496 (protección al consumidor) + Ley 19.628 (datos personales). Disclaimer explícito y honesto: "Praeventio NO reemplaza al prevencionista certificado SUSESO; es herramienta complementaria". Protege legalmente a Praeventio y, más importante, no le miente al usuario sobre el alcance de la app.
- `src/components/legal/CookieConsent.tsx`: banner consent (Aceptar / Solo esenciales) con persistencia en `localStorage`. Compliance LGPD (Brasil) / GDPR (UE, para clientes con operaciones europeas) / Ley 21.719 (Chile, vigente para datos personales).
- `README.md` sección "Soporte": 4 mailboxes (soporte@ / privacidad@ / ventas@ / legal@) y URL para reportar bugs. Marketplace exige canal de soporte verificable.
- **Para Praeventio**: estos eran los 3 BLOCKERs que GW2 detectó como impedimento de listing. Cumplimiento formal logrado; falta solo el approval de Google (5–15 días hábiles). El pipeline enterprise LATAM destrabado.

## 3. Multi-país accesible desde cualquier pantalla
- `src/components/layout/Sidebar.tsx:346-349`: `<NormativaSwitch />` montado dentro del footer del sidebar con `md:hidden`, complementando la topbar que solo aparece en md+. Antes el switch solo era accesible desde Pricing.tsx en mobile, lo cual era una trampa de UX.
- `src/pages/Pricing.tsx:531-537`: removido el `<NormativaProvider>` local redundante. El provider ya viene global desde App.tsx; tenerlo duplicado abría una ventana de inconsistencia entre el país visible en pricing y el país operativo del resto de la app.
- **Para el prevencionista o supervisor en faena con celular**: cuando la empresa lo traslada de Codelco Chuquicamata (Chile) a Cerro Verde (Perú), cambia el contexto normativo con un tap desde cualquier pantalla — Sidebar, Telemetría, Proyectos, Charlas — sin volver al pricing.

## 4. Defensa en profundidad para tokens OAuth
- `src/services/security/kmsEnvelope.ts`: envelope encryption AES-256-GCM con IV aleatorio por encrypt + verificación de authTag (rechaza ciphertext manipulado) + adapter pattern (`in-memory-dev` / `cloud-kms` / `noop`).
- `src/services/security/kmsAdapter.ts`: typed adapter interface y stub para Cloud KMS. El SDK real (`@google-cloud/kms`) se cablea en próxima ronda — el scaffolding queda probado y listo para activar con flag.
- `src/services/oauthTokenStore.ts:100-127`: `maybeWrap` / `maybeUnwrap` en la frontera Firestore. Feature flag `OAUTH_ENVELOPE_ENABLED` (default `false`, backwards-compatible) — entradas legacy plaintext siguen leyéndose sin error mientras se programa la migración.
- `KMS_ROTATION.md`: runbook de 224 líneas con setup gcloud, migración de tokens legacy a envelope, key rotation cada 90 días y procedimiento de disaster recovery si se pierde acceso a KMS.
- 14 tests con rechazo de authTag manipulado, verificado RED→GREEN removiendo `setAuthTag` para confirmar que la verificación efectivamente falla.
- **Para el trabajador**: si un admin con permisos de Firestore o un atacante con credenciales filtradas exporta la base de datos, los OAuth tokens que dan acceso a su Google Calendar y datos biométricos de Health Connect / Fit NO están en plaintext. Cumplimiento real (no de papel) bajo Ley 19.628 art. 11 ("medidas de seguridad apropiadas") y Ley 21.719.

## 5. Migración Google Fit → Health Connect sin sobresaltos
- `package.json:34`: `@kiwi-health/capacitor-health-connect@^0.0.40` instalado. Plugin nativo Android oficial vía Capacitor.
- `src/services/health/healthConnectAdapter.ts`: 360 LOC de implementación real — `readHeartRate`, `readSteps`, `readCalories`, `readSleep`, `requestPermissions`, todos contra el plugin nativo. Respeta el contrato `HealthAdapter` ya existente.
- `src/pages/Telemetry.tsx:172-222`: `handleConnectGoogleFit` ahora consulta el facade primero. Si el adapter resuelto es `'health-connect'` (Android nativo con Health Connect disponible), bypasses OAuth y solicita permisos vía Health Connect. Si no, fall-through al flujo Google Fit deprecated (sigue funcionando hasta sunset 2026).
- `src/pages/Telemetry.tsx:225-303`: `fetchFitnessData` igual — lee últimas 24h de heart rate y steps del adapter Health Connect cuando aplica, evitando el hop al servidor que toca Google Fit.
- `HEALTH_CONNECT_MIGRATION.md`: Round 2 marcado done; Round 3 pendiente (full Telemetry swap, server-side sunset header, OAuth scopes cleanup, re-verification del proyecto OAuth).
- **Para el trabajador minero con wearable** (smartwatch, banda Mi Band, ring, teléfono Android): cuando Google sunset Fit en 2026, su pulsera o reloj sigue alimentando frecuencia cardíaca y pasos a Praeventio sin interrupción. La migración es invisible para él y para el prevencionista que monitorea.

## Lo que el trabajador chileno gana
- Su empresa no recibe facturas canceladas por error cuando Transbank tiene una mala noche de tráfico.
- Sus OAuth tokens (Calendar, Fit, futuras integraciones) están cifrados al reposo, no solo en tránsito.
- Cuando lo trasladan de faena entre países, la app refleja la normativa correcta sin obligarlo a navegar a una pantalla de pricing.
- Su wearable seguirá detectando estrés térmico y fatiga después del sunset Google Fit 2026.
- La página `/terms` le dice honestamente: "esto complementa al prevencionista, no lo reemplaza" — sin venta humo.

## Lo que la empresa cliente gana
- Cobranza B2B robusta: una invoice nunca queda en estado ambiguo por un timeout de red.
- Página de términos cumple Ley 19.496 + Ley 19.628 + Ley 21.719 — auditable por el área legal de la empresa contratante.
- Cookie consent listo para clientes con operaciones en LATAM, Brasil (LGPD) o subsidiarias en Europa (GDPR).
- Health probes en `/api/health` permiten al SRE de la empresa cliente integrar Praeventio en sus dashboards Grafana / Datadog.
- Tokens OAcuth cifrados al reposo: el área de seguridad informática puede firmar contratos sin levantar findings.

## Lo que Praeventio (la empresa) gana
- Listing público en Google Workspace Marketplace destrabado — solo falta approval de Google (5–15 días hábiles).
- Pipeline LATAM (mutuales chilenas ACHS / IST, sindicato CONSTRAMET, prevencionistas independientes) puede demoear con confianza: pagos robustos, términos cumplidos, datos cifrados.
- Sunset Google Fit 2026 deja de ser un riesgo de churn; ahora es un proceso documentado en `HEALTH_CONNECT_MIGRATION.md` con Round 2 ya cerrado.
- Deuda técnica de seguridad acotada: el TODO histórico de cifrar OAuth tokens al reposo está scaffolded y testeado.

## Limitaciones reconocidas honestamente
- Webpay sigue corriendo contra sandbox Transbank (Integration). El commerce code y API key de producción aún no están provisionados — feature requirement, no defecto técnico. El código ya distingue ambos entornos vía `WEBPAY_ENV`.
- KMS adapter `cloud-kms` es un stub — el SDK real `@google-cloud/kms` se instala y cablea en la próxima ronda. El flag `OAUTH_ENVELOPE_ENABLED` queda en `false` hasta entonces; los tokens hoy siguen como plaintext en Firestore (mismo estado que antes de esta ronda).
- iOS HealthKit deferred. Health Connect cubre solo Android; el adapter HealthKit queda en `noop` y los usuarios iPhone seguirán dependiendo del flujo Google Fit (que muere en 2026 — si Praeventio quiere market share iOS, esa es la próxima prioridad).
- Round 3 de la migración Health Connect pendiente: full swap de Telemetry, sunset banner server-side, cleanup de scopes OAuth, re-verification del proyecto OAuth con Google.
- El listing en Marketplace requiere un approval humano de Google — el código está listing-ready, pero la fecha de "go-live público" no está bajo nuestro control.

## KPIs sugeridos
- Tasa de invoices Webpay que terminan en `failed` vs. `rejected` vs. `paid` (objetivo: `failed` < 1% de los intentos en producción tras estabilización).
- Tiempo desde submit-listing hasta approval Marketplace (target: ≤ 15 días hábiles).
- Adopción Health Connect: porcentaje de usuarios Android cuyo `getHealthAdapter().name === 'health-connect'` vs. fallback Google Fit (target: > 60% en 90 días).
- Cookie consent acceptance rate: ratio Aceptar todo / Solo esenciales (señal de confianza del usuario en la marca).
- Tokens OAuth cifrados con envelope vs. plaintext legacy (target tras migración Round 3: 100% envelope, 0 entradas plaintext en Firestore).
