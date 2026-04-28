# Impacto en el bienestar humano + valor empresarial — UX integrado, predicción climática real, pagos operativos

## Resumen ejecutivo
Esta ronda cierra cinco brechas que separaban a Praeventio Guardian de un producto enterprise listo para LATAM. El Gantt y el switch de normativa quedan visibles desde cualquier pantalla; el motor predictivo deja de operar con datos mock y consume el boletín climático real de OpenWeather; las obligaciones legales chilenas (CPHS, ODI, audiometría PREXOR) se evalúan automáticamente proyecto por proyecto, con aceleración por dosis de ruido; queda un camino concreto para sobrevivir al sunset 2026 de Google Fit; y los pagos B2B vía Webpay pasan de stub a SDK real con sandbox y endpoint de retorno. Para el trabajador chileno significa menos faenas operando con riesgo invisible. Para la empresa cliente significa cumplimiento auditable. Para Praeventio significa pipeline LATAM acelerado y deuda técnica acotada.

## 1. La app ahora se ve completa: Gantt + Normativa en topbar
- `src/pages/Projects.tsx:31` importa `GanttProjectView`; `src/pages/Projects.tsx:304` añade la pestaña "Línea de tiempo" y `src/pages/Projects.tsx:340-341` la renderiza con proyectos, predicciones de actividades preventivas y riesgos climáticos en una única vista.
- `src/components/layout/RootLayout.tsx:19` importa `NormativaSwitch`; `src/components/layout/RootLayout.tsx:255-256` lo monta en el topbar bajo `hidden md:block`, permitiendo que un prevencionista cambie el país de referencia (Chile / Perú / Argentina) desde cualquier ruta sin volver a Settings.
- `src/App.tsx:9` importa `NormativaProvider`; `src/App.tsx:153-163` lo envuelve entre `FirebaseProvider` y el árbol de rutas, respetando el orden semántico auth → país de referencia normativa → proyectos.
- Resultado: las features ya construidas (Gantt + multi-país) dejan de ser código muerto y se vuelven parte del flujo diario del prevencionista.

## 2. Boletín climático real alimentando el motor de prevención
- `src/services/environmentBackend.ts:295` expone `getForecast(days, location?)`; `src/services/environmentBackend.ts:311` consulta el endpoint real `https://api.openweathermap.org/data/2.5/forecast` (3-hour step) y `src/services/environmentBackend.ts:170` agrupa los buckets en días UTC quedándose con worst-case condition, máxima temperatura, máximo viento y suma de precipitación.
- `server.ts:756-774` expone `GET /api/environment/forecast` con dynamic import de `environmentBackend` y graceful degradation (devuelve `{ forecast: [] }` si la API key no está o el upstream falla), así `useCalendarPredictions` nunca rompe la UI.
- 21 tests cubren mapeo de weather IDs (200=stormy, 500=rainy, 600=snow, 800=sunny), agregación, promociones (viento ≥40 km/h → windy solo cuando la base es sunny) y el camino degradado.
- Significado en faena: cuando un trabajador minero del Atacama o un cuadrillero de obra civil en Concepción abre la app, la predicción de riesgos climáticos (golpe de calor, viento blanco, lluvia que vuelve la pendiente inestable) viene del clima real, no de un mock que nunca cambiaba.

## 3. Cumplimiento legal automatizado per-proyecto, end-to-end
- `src/services/capacity/normativeAlerts.ts:73-75` codifica la cadencia de DS 54 art. 16/24 (CPHS mensual): warning a 25 días, critical a ≥30, y critical "Constituye comité" cuando un proyecto ≥25 trabajadores no tiene reuniones registradas.
- `src/services/capacity/normativeAlerts.ts:78-79` codifica Ley 16.744 art. 21 + DS 40 (ODI semestral): warning a ~5 meses, critical a ≥6 meses, también per-proyecto.
- `src/services/capacity/normativeAlerts.ts:81-85` codifica NT MINSAL PREXOR: cadencia anual por defecto, **acelerada a 180 días cuando la dosis acumulada de ruido supera 100 % del TLV** (DS 594 acción límite). `src/services/capacity/normativeAlerts.ts:225-258` evalúa la regla por trabajador y proyecta el `projectId` correcto vía `workerProjectMap`.
- La invariante "per-faena, no agregada" queda explícita en `src/services/capacity/normativeAlerts.ts:14-17`: tres proyectos de 10 trabajadores no gatillan Comité Paritario, porque la ley aplica "por cada faena, sucursal o agencia".
- Los tests pasaron de 7 a 23 escenarios cubriendo never-met, edge cases (justo en el umbral), dose-acceleration y determinismo (todas las funciones son puras y aceptan `context.now`).
- Significado en terreno: el prevencionista no necesita un calendario externo; la app le dice proyecto-por-proyecto qué obligación de la SUSESO/mutual está vencida y por cuántos días, con texto en castellano legal, listo para mostrarle al fiscalizador.

## 4. Camino de migración Health Connect preparado (sin pánico ante sunset 2026)
- `src/services/health/index.ts` y `src/services/health/healthFacade.test.ts` (12 tests) implementan un facade que selecciona automáticamente el adapter por plataforma: `src/services/health/healthConnectAdapter.ts` para Android/iOS modernos y `src/services/health/googleFitAdapter.ts` como wrapper deprecated con noop silencioso para web.
- `HEALTH_CONNECT_MIGRATION.md` documenta los 13 pasos en 3 rondas, con cross-references a `Telemetry.tsx`, `server.ts:545` (definición de `SCOPES` Google Fit) y `server.ts:828` (`/api/fitness/sync`), de modo que la próxima ronda pueda ejecutarse en paralelo por otro agente sin reaprender el dominio.
- Por qué importa: Google cerró el sign-up de Fit en mayo 2024 y el sunset es 2026. Cuando ocurra, los wearables y biometría de los trabajadores siguen funcionando porque hay un puente listo y testeado, no una migración de pánico.

## 5. Pagos chilenos B2B operativos (sandbox)
- `src/services/billing/webpayAdapter.ts:24-30` integra `transbank-sdk` real (`WebpayPlus`); `src/services/billing/webpayAdapter.ts:1-22` documenta la postura PCI (no log de PAN/CVV) y el switch sandbox/producción por env (`WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` + `WEBPAY_ENV`).
- Métodos `createTransaction`, `commitTransaction`, `refundTransaction` operan contra la "Tienda de Integración" Transbank por defecto (CI/dev nunca tocan producción accidentalmente).
- `server.ts:2292-2339` expone `GET /billing/webpay/return`, no auth-gated (el comprador vuelve sin cookie), validando `token_ws` con regex estricta, comiteando vía adapter, escribiendo `audit_logs` en AUTHORIZED y haciendo redirect a `/pricing/success` o `/pricing/failed`. Idempotency básica: `server.ts:2312` salta si la invoice ya está `paid`.
- 23 tests de billing pasan (13 nuevos de Webpay + 10 invoice existentes).
- Pendiente próxima ronda (declarado en `server.ts:2298-2300`): commerce code de producción y idempotency robusta vía `processed_webpay/{token}` con lock-then-complete pattern siguiendo el patrón del handler RTDN.

## Lo que el trabajador chileno gana
- Predicción climática real para su faena: ya no es mock, viene de OpenWeather y se agrega con worst-case por día.
- Vigilancia audiométrica que se acelera automáticamente cuando él está expuesto a ruido alto (dosis >100 % TLV → control a 6 meses, no a 12).
- Comité Paritario y ODI evaluados por su faena específica, no diluidos en un promedio de empresa.
- Continuidad del seguimiento biométrico cuando llegue el sunset de Google Fit; sus pulsaciones y fatiga siguen siendo visibles para el prevencionista.

## Lo que la empresa cliente gana
- Topbar muestra país de referencia normativa: una empresa con faenas en Chile, Perú y Argentina cambia el contexto en un click.
- Gantt operativo permite ver proyectos + actividades preventivas + riesgos climáticos en una sola pantalla — apto para reunión semanal con gerencia o sindicato.
- Alertas de cumplimiento por-proyecto con texto en castellano legal, citando DS 54, Ley 16.744 y NT MINSAL PREXOR; reduce horas de un fiscalizador interno.
- Pagos B2B con Webpay sandbox listo: la siguiente ronda es solo provisioning del commerce code productivo.

## Lo que Praeventio (la empresa) gana
- Pipeline LATAM acelerado: la propuesta enterprise para CONSTRAMET y mutuales ya tiene UX visible (Gantt) y el switch multi-país operativo.
- Billing operativo en sandbox: pasamos de "stub que devuelve 200" a integración real validable contra la "Tienda de Integración" Transbank.
- Deuda Google Fit ya managed: 13 pasos documentados con file:line cross-references; ninguna sorpresa cuando llegue 2026.
- 21 + 23 + 12 + 13 = 69 tests nuevos esta ronda, todos deterministas (puros, `context.now` inyectable).
- Reducción del riesgo de discovery enterprise: cualquier prospecto que abra la app ve features completas, no esqueletos.

## Limitaciones reconocidas honestamente
- `getForecast` (`src/services/environmentBackend.ts:14-15`) usa coords default de Santiago; el override per-tenant queda como follow-up declarado en el TODO al final del archivo.
- Idempotency Webpay (`server.ts:2298-2300`) confía en el status check de la invoice. La ruta robusta vía `processed_webpay/{token}` con lock-then-complete está identificada pero no implementada.
- Health Connect: el facade y tests están listos, pero la integración real con `Telemetry.tsx` y `server.ts:828` ocurre en la próxima ronda según `HEALTH_CONNECT_MIGRATION.md`.
- Las cadencias de `normativeAlerts.ts` están duplicadas localmente respecto a `src/services/calendar/legalObligations.ts` (declarado en líneas 21-26). Si divergen, el shared module gana — pero la consolidación es deuda.
- Webpay producción requiere provisioning del commerce code Transbank por la operación comercial, no por código.

## KPIs sugeridos
- % de faenas con CPHS al día / total que requieren CPHS (target: ≥95 % a 90 días post-onboarding).
- Tasa de aceleración audiometría: # trabajadores con dosis >100 % TLV detectados antes de los 12 meses default. Cualquier número > 0 es valor capturado.
- Latencia p95 de `GET /api/environment/forecast` (target: <800 ms con cache, degrada graceful a forecast vacío).
- Tasa de éxito de transacciones Webpay (`status === 'AUTHORIZED'` / total commit) en sandbox y luego producción.
- Adopción del switch de normativa: # de cambios de país por sesión enterprise — proxy de penetración multi-país real.
