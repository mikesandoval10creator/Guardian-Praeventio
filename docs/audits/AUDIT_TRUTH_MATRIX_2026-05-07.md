# Auditoria de verdad operacional - Guardian Praeventio

Fecha: 2026-05-07  
Alcance: repo local `D:\Guardian Praeventio\repo`, auditoria DOCX entregada por el usuario, PRs recientes de GitHub, foco especial PR #84.  
Objetivo: separar promesa comercial, documentacion, codigo real, deuda vigente y deuda obsoleta.

## Resumen ejecutivo

Guardian Praeventio ya tiene una base seria: hay modulos reales de emergencia, Webpay, MercadoPago IPN, Khipu, Google Play RTDN, Apple SSN, RAG normativo, MediaPipe, SLM offline, Zettelkasten, DTE/SII, B2D APIs, telemetria, auditoria y Firestore rules.

Pero la narrativa documental esta por delante del runtime. No conviene vender ni presentar el producto como "81%", "99%", "todo operativo", "14 dominios todos operativos" o "formidable enterprise" hasta cerrar los P0/P1 de seguridad, pagos, pricing, aislamiento multi-tenant, pruebas y verdad comercial.

El problema principal no es falta de ambicion; es falta de contrato de verdad entre docs, UI, pricing, backend, tests y despliegue.

## PRs y merges revisados

- PR #84: `docs: Informe de avance al 81.29% para NotebookLM`, merged 2026-05-07 18:01 UTC. Solo cambia `INFORME_AVANCE_NOTEBOOK_LLM.md`. No cambia runtime. No tuvo reviews. Riesgo: reintroduce narrativa optimista y contradice documentos honestos existentes.
- PR #85: `feat(todo): anadir 22 items de auditoria tecnica faltantes al manifiesto`, open. Solo cambia `TODO.md`. Usa el DOCX como fuente, pero varios items estan obsoletos o mal ubicados.
- PR #81: `docs(audit): Inventario verificado de deuda tecnica`, merged. Es el origen del DOCX/TECHNICAL_DEBT_AUDIT, pero ya quedo parcialmente stale frente al codigo local.
- PR #83/#82: docs/roadmap recientes. Aumentan roadmap y narrativa de vida-seguridad.
- PR #79/#78/#76/#75: features grandes mergeadas entre 2026-05-06 y 2026-05-07. Hay mucha superficie nueva en muy poco tiempo; esto explica parte del drift documental.

Lectura de riesgo: los PRs recientes mezclan avance real con claims que no quedan garantizados por tests ni por despliegue. Para una app de prevencion de riesgos, eso no es cosmetico: puede inducir decisiones operacionales equivocadas.

## Rectificaciones al DOCX

La auditoria DOCX ayuda, pero no debe copiarse a ciegas.

Items del DOCX que hoy son obsoletos o requieren matiz:

- "WebAuthn register no existe": obsoleto. Hay `/api/auth/webauthn/register/options` y `/api/auth/webauthn/register/verify` en `src/server/routes/curriculum.ts:887-1038`.
- "Servidor nunca valida firma WebAuthn": parcialmente obsoleto. Si el cliente envia `id`, el servidor usa `verifyAuthenticationResponse` en `src/server/routes/curriculum.ts:763-810`. El problema real es que el cliente actual no envia `id/rawId/type/clientExtensionResults` desde `src/hooks/useBiometricAuth.ts:182-187`, por lo que cae al legacy consume-only `verified:true` en `src/server/routes/curriculum.ts:847-849`.
- "IAP retorna true": obsoleto como fraude directo. Google/Apple receipt endpoints devuelven `202 Accepted` y no activan beneficio solo por recibo en `src/server/routes/billing.ts:1447-1500` y `1511-1555`. Aun falta validar receipt contra Google/Apple en esos endpoints.
- "MercadoPago IPN no montado": obsoleto. Esta montado en `/api/billing/webhook/mercadopago` via `server.ts:676` + `src/server/routes/billing.ts:959`.
- "firebase.json sin hosting/storage": localmente esta corregido, pero como cambios no committeados. Ver `firebase.json` modificado y `storage.rules` untracked.
- "Storage rules no existen": localmente existe `storage.rules`, pero no esta trackeado aun.
- "Nodos BioAnalysis/Hazmat/Structural no persisten": obsoleto en parte. Esos archivos ahora llaman `writeNodesDebounced`, aunque quedan comentarios TODO stale y el split `nodes` vs `zettelkasten_nodes` sigue siendo deuda arquitectonica.
- "MediaPipe solo CDN": parcialmente obsoleto. `useMediaPipePose` prueba `/models/mediapipe` primero y cae a CDN si no hay assets locales. Falta asegurar `npm run prebuild`/deploy y no depender de CDN en entornos regulados.

Items del DOCX que siguen siendo reales:

- KMS dev permitido en production.
- WebAuthn legacy consume-only debe fallar cerrado.
- Android folder no existe y `assetlinks.json` sigue con placeholder.
- Vertex Trainer sigue con `NOT_ENABLED`.
- SLM URLs Qwen/Gemma tienen TODO de confirmacion.
- `Site25DPanel.test.tsx` sigue con `describe.skip`.
- Hay `@ts-ignore` en produccion.

## Hallazgos P0/P1

### P0 - WebAuthn cae al camino legacy sin firma real

Evidencia:
- Cliente envia solo `challengeId`, `clientDataJSON`, `authenticatorData`, `signature`: `src/hooks/useBiometricAuth.ts:182-187`.
- Servidor solo activa crypto path si recibe `id`: `src/server/routes/curriculum.ts:763-766`.
- Si no recibe `id`, consume challenge y responde `verified:true`: `src/server/routes/curriculum.ts:847-849`.

Estado real: WebAuthn crypto existe, pero el cliente no lo alimenta. Para acciones sensibles, esto debe fallar cerrado.

Siguiente PR:
- Enviar `id`, `rawId`, `type`, `clientExtensionResults`.
- Eliminar fallback consume-only en produccion o limitarlo a un flag temporal no-prod.
- Test HTTP que envie payload sin `id` y espere 400/401.

### P0 - Produccion puede arrancar con KMS dev

Evidencia:
- `server.ts:138-150` permite `KMS_ADAPTER=in-memory-dev` en `NODE_ENV=production` con warning.

Estado real: el boot no protege secretos ocupacionales, OAuth tokens ni evidencia legal si production se despliega con KMS dev.

Siguiente PR:
- En production exigir `KMS_ADAPTER=cloud-kms`.
- Exigir `KMS_KEY_RESOURCE_NAME`.
- Agregar test de boot/preflight.

### P0 - Test default no es confiable

Evidencia:
- `vitest.config.ts:31` incluye `src/**/*.test.ts`, por tanto incluye `src/rules-tests`.
- Rules tests requieren Firestore emulator.
- CI tiene job separado `rules-tests`, pero el default local `npm run test` queda vulnerable.

Estado real: hay separacion en `.github/workflows/ci.yml`, pero la config default sigue mezclando unit y rules tests.

Siguiente PR:
- Excluir `src/rules-tests/**` del include default.
- Crear config/script `test:rules`.
- Asegurar que CI ejecute ambos jobs.

### P0 - Activacion de suscripcion escribe IDs canonicos que el frontend no entiende

Evidencia:
- `SubscriptionPlan` solo acepta ids legacy: `free`, `comite`, `departamento`, `plata`, `oro`, etc. en `src/contexts/SubscriptionContext.tsx:8-18`.
- Pricing envia `tier.id` canonico a checkout: `src/pages/Pricing.tsx:725-731`.
- Webpay confirmado escribe `subscription.planId = tierId`: `src/server/routes/billing.ts:1164-1177`.
- MercadoPago IPN hace lo mismo: `src/services/billing/mercadoPagoIpn.ts:538-550`.
- `PLAN_MIGRATION` solo migra `premium` y `basic`: `src/contexts/SubscriptionContext.tsx:145-151`.

Estado real: un cliente pagado puede quedar con `planId='comite-paritario'`, `departamento-prevencion` o `diamante`, valores no cubiertos por el frontend legacy. Eso puede romper features, limites o rankings.

Siguiente PR:
- Crear `canonicalTierToSubscriptionPlan`.
- Usarlo en Webpay, MercadoPago, subscription upgrade y polling.
- Agregar tests de activacion para `comite-paritario`, `departamento-prevencion`, `diamante`, `global-titanio`.

### P0 - Webpay genera returnUrl equivocada

Evidencia:
- Checkout Webpay usa `${APP_BASE_URL}/billing/return`: `src/server/routes/billing.ts:555`.
- Handler real y docs esperan `/billing/webpay/return`: `src/server/routes/billing.ts:1074`, `docs/runbooks/TRANSBANK_RUNBOOK.md:43`.

Estado real: si Transbank usa ese returnUrl, el pago puede no cerrar contra el handler idempotente.

Siguiente PR:
- Cambiar return URL a `/billing/webpay/return`.
- Agregar test que cubra create transaction con URL exacta.

### P1 - Aislamiento multi-tenant debilitado por roles globales

Evidencia:
- `isProjectMember(projectId)` permite `isSupervisor()` para cualquier proyecto: `firestore.rules:63-69`.
- `nodes` permite read/update/delete por `isSupervisor()` global: `firestore.rules:307-322`.

Estado real: si `supervisor` es rol global, puede cruzar tenants/proyectos. Si se pretendia rol operativo por proyecto, la regla esta demasiado amplia.

Siguiente PR:
- Definir si los roles son tenant/project-scoped.
- Reemplazar permisos globales por membership/tenant claims.
- Agregar rules tests de supervisor de tenant A contra proyecto tenant B.

### P1 - Pricing no tiene una sola verdad

Evidencia:
- `src/services/pricing/tiers.ts` define 11 tiers, incluido `global-titanio`.
- `PRICING.md:20-33` dice "10 tiers definitivos" y omite `global-titanio`.
- `PRICING.md:106` dice no Stripe, pero `src/server/routes/billing.ts:183-185` aun permite `stripe`.
- `src/pages/Pricing.tsx:957-960` reconoce Stripe scaffold no expuesto.
- `handleContactSales` es solo `mailto`: `src/pages/Pricing.tsx:1071-1081`.

Estado real: el pricing esta avanzado, pero no esta cerrado comercialmente. Los planes altos no tienen checkout real; dependen de ventas manuales.

Siguiente PR:
- Declarar `tiers.ts` como fuente unica.
- Regenerar `PRICING.md` desde `tiers.ts` o validar drift en CI.
- Decidir: Stripe eliminado o scaffold internacional activo. No ambas narrativas.

### P1 - MercadoPago esta montado, pero el contrato prod esta incompleto

Evidencia:
- Adapter exige `MP_ACCESS_TOKEN`: `src/services/billing/mercadoPagoAdapter.ts:126-130`.
- `.env.example`, `scripts/validate-env.cjs` y `.github/workflows/deploy.yml` solo declaran `MP_IPN_SECRET`, no `MP_ACCESS_TOKEN` ni `MP_ENV`.
- Checkout devuelve 503 si no esta configurado: `src/server/routes/billing.ts:792-795`.

Estado real: MercadoPago IPN existe y esta montado, pero produccion puede desplegar sin el token que permite crear preferencias.

Siguiente PR:
- Agregar `MP_ACCESS_TOKEN`, `MP_ENV`, `MP_JWKS_URL` si aplica, al contrato de secrets.
- Runbook de MercadoPago test/prod.
- Smoke de checkout en modo sandbox.

### P1 - DTE/SII: autoemision documentada, no cableada

Evidencia:
- `tryAutoIssueDte` existe: `src/services/billing/invoice.ts:220-245`.
- `rg tryAutoIssueDte` no muestra ningun caller productivo.
- `docs/dte-sii.md` describe `invoice.paid -> tryAutoIssueDte`.
- `src/server/routes/dte.ts:3-17` dice "NO push a SII", pero `BsaleAdapter` es un PSE que emite DTE autorizado.

Estado real: hay generador y adapter, pero la autoemision tras pago no esta cableada. Ademas hay una contradiccion conceptual: "no push a SII" vs Bsale/PSE.

Siguiente PR:
- Decidir juridicamente si Praeventio emite por PSE o solo genera artefactos para firma/envio del cliente.
- Cablear `tryAutoIssueDte` despues de Webpay/MP/mark-paid si se decide autoemision.
- Agregar env DTE a deploy/validate-env o marcar manual-only.

### P1 - SUSESO no debe ofrecerse como envio automatico productivo

Evidencia:
- Frontend importa `SusesoApiClient` directo: `src/pages/SusesoReports.tsx:27-33`.
- `fromEnv()` lee `process.env.SUSESO_API_KEY` y `SUSESO_EMPLOYER_RUT`: `src/services/sii/susesoApiClient.ts:131-139`.
- En Vite, env no `VITE_` no estara disponible en browser; si se expone, seria secreto en cliente.
- El propio cliente dice que la URL real debe verificarse con documentacion SUSESO vigente: `src/services/sii/susesoApiClient.ts:9-12`.

Estado real: PDF DIAT/DIEP/exportacion existe; envio SUSESO productivo no esta listo. Debe ir por backend/proxy con secretos server-side.

Siguiente PR:
- Quitar cliente SUSESO del browser o convertirlo en server route admin.
- Validar contra especificacion oficial actual.
- Tests de payload obligatorio y rechazos.

### P1 - Zettelkasten esta dividido en tres fuentes

Evidencia:
- Server Bernoulli escribe `zettelkasten_nodes`: `src/server/routes/zettelkasten.ts:191`.
- Knowledge graph lee/escribe `nodes`: `src/contexts/UniversalKnowledgeContext.tsx:108` y `224`.
- Risk engine lee `nodes`: `src/hooks/useRiskEngine.ts:44`.
- Digital twin markers leen `tenants/{tenantId}/zettelkasten_nodes`: `src/components/digital-twin/RiskNodeMarkers.tsx:79`.
- Incident postmortem usa tenant-scoped `zettelkasten_nodes`.

Estado real: hay Zettelkasten vivo, pero no hay una fuente unica. Un nodo generado por Bernoulli puede no aparecer donde la UI principal espera `nodes`.

Siguiente PR:
- Definir canonical collection.
- Crear materializer/bridge entre `zettelkasten_nodes` y `nodes` o migrar consumidores.
- Tests E2E: generar nodo desde calculadora y verlo en RiskNetwork/AI Hub/Digital Twin.

## Matriz de promesas documentales

| Promesa | Evidencia real | Estado | Accion |
|---|---|---|---|
| "81.29% / 77.33%" en PR #84 | PR doc-only, sin runtime/tests | No certificable | Sustituir por matriz por dominio |
| "99% end-to-end" en README antiguo | README tambien contiene 62% honesto; docs/audits lo recalibran | Contradictorio | Unificar docs canonical |
| "RAG procesa BCN como fuente de verdad" | `bcnService` usa LeyChile XML; `ragService` usa Firestore vector si inicializado | Parcial real | Documentar prerequisitos: GEMINI_API_KEY, index vector, seed |
| "A-Star real" | `routingBackend` es interpolacion deterministica; no A* | No real | Renombrar o implementar A* |
| "Ruta dinamica offline" | `calculateDynamicEvacuationRoute` lanza sin GEMINI_API_KEY antes de usar ruta deterministica | No offline | Mover fallback deterministico antes de Gemini |
| "Mesh Bluetooth operativo" | Android plugin dice STUB; web es simulator | No productivo | BLE real + foreground service |
| "Edge AI verifica EPP local" | EPP modal llama Gemini; MediaPipe local es para postura | No para EPP | Cambiar claim o implementar EPP on-device |
| "Digital Twin reconstruccion real" | UI ahora apunta a `/api/photogrammetry/jobs`; worker acepta `videoUrl` y extrae frames con ffmpeg; LingBot-Map sigue no integrado | Parcial mejorado | Deploy worker + smoke mesh real + decision LingBot |
| "DIAT/DIEP automaticos SUSESO" | PDF/export existe; SUSESO cliente browser no productivo | Parcial/no prod | Server-side SUSESO o manual-only |
| "DTE incluido" | Adapter Bsale existe; autoemision no caller | Parcial | Cablear o declarar manual |
| "MercadoPago LATAM" | Checkout/IPN existe; faltan MP_ACCESS_TOKEN/MP_ENV prod | Parcial | Completar secrets y smoke |
| "Khipu transferencia bancaria" | Adapter existe y webhook; requiere KYC/credenciales | Parcial | Runbook entidad financiera |
| "Pricing cerrado" | 11 tiers en codigo, 10 en PRICING, Stripe contradictorio | Drift | Fuente unica y CI drift |
| "B2D Climate Open-Meteo/USGS/OpenAQ" | Endpoint retorna deterministic-stub | No real prod | Conectar APIs o renombrar beta |
| "B2D Gemini AI Coach" | Suite coach es deterministico, sin Gemini | No real | Cambiar marketing o implementar |
| "Multi-tenant operativo" | Hay RBAC/memberships, pero supervisor global cruza proyectos | Riesgo | Reglas tenant-scoped |

## Pagos, pricing y entidades financieras

### Que esta real

- Webpay adapter + return handler idempotente existen.
- MercadoPago checkout + IPN existen.
- Khipu adapter + webhook existen.
- Google Play RTDN y Apple SSN existen.
- Factura/DTE tiene calculo, Bsale adapter y rutas admin.
- Pricing service tiene tests y 11 tiers.

### Que falta antes de cobrar con confianza

- Corregido en esta tanda: returnUrl Webpay apunta a `/billing/webpay/return`.
- Corregido en esta tanda: plan IDs post-pago se normalizan con `subscriptionPlan.ts`.
- Completar secrets prod de MercadoPago.
- Decidir Stripe: eliminado o internacional.
- Definir flujo real de planes altos: mailto no es checkout.
- Definir DTE/SII juridico y tecnico.
- Cerrar IAP store SKUs: hoy native usa un solo `praeventio_premium_monthly` para todos los tiers en `src/pages/Pricing.tsx:1003-1008`.
- Crear reconciliacion contable: pagos, invoices, suscripciones, DTE, refunds.
- No encontre codigo de Mercado Libre marketplace. Lo que existe es MercadoPago. Si se habla de "Mercado Libre", debe separarse marketplace/business partnership de payment rail.

## Tests omitidos, vulnerados o con riesgo de falsa confianza

Skips directos:

- `src/components/digital-twin/Site25DPanel.test.tsx:205` usa `describe.skip`.
- `tests/e2e/landing.spec.ts:13` usa `test.describe.skip`.
- `src/components/admin/CreateApiKeyModal.test.tsx:38,51,78` usa `it.skip` justo en flujo B2D API key.
- E2E de SOS, fall detection, process lifecycle, offline resilience y accessibility dependen de `E2E_FULL_STACK=1`.

CI warning-only:

- `.github/workflows/mutation.yml:35` tiene `continue-on-error: true`.
- `.github/workflows/mutation.yml:60` ejecuta thresholds con `|| true`.

Falsa confianza:

- Muchos tests server usan harness paralelo en `src/__tests__/server/test-server.ts`. Sirven, pero pueden divergir del router productivo.
- `security:review` en corrida previa paso, pero escaneo 0 archivos. No debe contarse como auditoria de seguridad efectiva hasta corregir configuracion.
- Corregido en esta tanda: Vitest default excluye `src/rules-tests/**` y existe `npm run test:rules` para emulador Firestore.

## Que NO deberia prometerse aun

- "Todo operativo".
- "A-Star real".
- "EPP on-device".
- "BLE mesh real".
- "SUSESO automatico productivo".
- "DTE automatico despues de pago".
- "Pricing definitivo".
- "B2D Climate con Open-Meteo/USGS/OpenAQ".
- "B2D Gemini AI Coach".
- "Global multi-tenant enterprise aislado" sin corregir reglas de supervisor.
- "99% end-to-end".

## Que SI puede prometerse, con lenguaje honesto

- Base PWA de prevencion de riesgos con modulos amplios.
- Motor normativo/RAG con integracion BCN condicionada a seed y claves.
- Webpay/MercadoPago/Khipu scaffold avanzado con partes productivas y partes de configuracion pendientes.
- Emergencia con FCM/SOS y fallback mesh logico, no BLE real aun.
- MediaPipe para postura/ergonomia con fallback local/CDN.
- Zettelkasten persistente en varias rutas, pendiente de unificacion.
- DTE/SII con generacion/adapters, pendiente de decision de emision productiva.
- Pricing tecnico de 11 tiers en codigo, pendiente de cierre comercial/documental.

## Orden recomendado de PRs

1. `truth-contract`: corregir docs/README/PRICING/TODO para que no prometan lo no productivo.
2. `billing-critical-fixes`: Webpay returnUrl + plan ID normalization + tests. (Aplicado parcialmente en esta tanda)
3. `webauthn-fail-closed`: cliente completo + eliminar fallback production. (Aplicado en esta tanda)
4. `kms-prod-guard`: production boot fail sin cloud-kms. (Aplicado en esta tanda)
5. `tests-split`: Vitest unit vs rules-tests + mutation sin `|| true`. (Vitest/rules aplicado; mutation pendiente)
6. `tenant-isolation`: roles tenant/project scoped en Firestore rules.
7. `mp-prod-contract`: MP_ACCESS_TOKEN/MP_ENV + smoke sandbox.
8. `pricing-single-source`: PRICING generado/validado desde `tiers.ts`.
9. `zettelkasten-canonical`: una fuente de verdad o materializer.
10. `suseso-dte-decision`: manual-only vs PSE server-side, sin secretos en browser.

## Conclusion

La aplicacion puede llegar a ser formidable, pero aun no debe hablar como si ya lo fuera en todos los dominios. La base es potente; el riesgo es que el discurso vaya mas rapido que la evidencia. En prevencion de riesgos eso no es solo deuda tecnica: es deuda de responsabilidad.

El siguiente paso correcto no es sumar otra feature grande. Es estabilizar verdad, seguridad, pagos y pruebas. Despues de eso, cada nuevo avance tendra piso real.
