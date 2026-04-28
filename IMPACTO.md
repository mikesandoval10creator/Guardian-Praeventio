# Impacto en el bienestar humano + valor empresarial — Pricing global y normativa multi-país

## Resumen ejecutivo

Esta ronda cierra el modelo de pricing definitivo (10 tiers, IVA 19% reconciliado al .990 que el trabajador ve, multi-país sin recargo) y deja la infraestructura para escalar fuera de Chile: 6 packs LATAM más ISO 45001 como respaldo universal. El cumplimiento legal ahora se evalúa per-proyecto — no por suma agregada — resolviendo el dolor del contratista PYME con 3 obras de 10 trabajadores cada una. Calendar Predictions amarra DS 54, Ley 16.744, PREXOR e ISO 45001 cláusula 9.3 a una vista Gantt que integra actividades preventivas predichas y riesgos climáticos del Knowledge Graph. La facturación B2B chilena (RUT `78231119-0`, IVA exacto, scaffolding Webpay/Stripe) queda lista para integración real en la próxima ronda.

## 1. Pricing transparente y respetuoso del trabajador

- Single source of truth con 10 tiers en `src/services/pricing/tiers.ts:51-170` — todos los precios CLP terminan en `.990` (Gratis $0, Comité $11.990, Dpto. Prevención $30.990, Plata $50.990, Oro $90.990, Titanio $249.990, Diamante $499.990, Empresarial $1.499.990, Corporativo $2.999.990, Ilimitado $5.999.990).
- `withIVA()` en `tiers.ts:230-240` usa `Math.ceil` para que `subtotal + IVA(19%) === total .990` exacto (ej. neto $10.075 + IVA $1.915 = $11.990).
- `calculateMonthlyCost()` en `tiers.ts:255-292` cobra overage solo en tiers básicos (Comité→Oro); Premium lanzan error explícito y exigen upgrade.
- `suggestUpgrade()` en `tiers.ts:299-333` recomienda subir solo cuando el overage supera el delta al siguiente tier — la app te dice cuándo NO conviene upgradear.
- Calculadora live: `src/components/pricing/PricingCalculator.tsx:26-50` recomienda el tier mínimo y compara contra prevencionista part-time ($550.000 CLP/mes) y accidente grave ($50.000.000 CLP).
- Página `/transparencia` en `src/pages/Transparencia.tsx:1-50` documenta el bucket 2D y los 4 tiers con overage abierto (`OVERAGE_TIER_IDS`, línea 20).
- Multi-país sin recargo: ningún tier cobra extra por país adicional.

## 2. Cumplimiento legal automático per-proyecto

- `src/services/capacity/normativeAlerts.ts:33-34` codifica los thresholds Ley 16.744: Comité Paritario ≥25 trabajadores, Departamento Prevención ≥100, **per-project** (líneas 41-65). Tres faenas de 10 trabajadores no gatillan Comité — la regla es "por cada faena, sucursal o agencia" (DS 54 art. 1).
- `evaluateCapacity()` en `src/services/capacity/tierEvaluation.ts:77-154` separa hard-block (Gratis y Premium, sin overage; líneas 117-128) del soft-block (básicos con overage flexible; líneas 130-139), con sugerencia de upgrade solo cuando upgradear es más barato que seguir pagando overage.
- Overage decreciente premia escala: `tiers.ts:73, 86, 99, 112` — trabajador extra baja de $990 (Comité) a $190 (Oro), proyecto extra de $5.990 a $2.990.
- `src/hooks/useProjectCapacity.ts:1-27` envuelve la lógica pura sin filtrar tier prices ni thresholds en la UI.

## 3. Cobertura mundial con ISO 45001 como fallback

- `src/services/normativa/locationNormativa.ts:139-181` orquesta la cascada: override manual → GPS con consentimiento explícito (`opts.consent`, línea 143) → bbox LATAM (líneas 58-71) → `navigator.language` (líneas 118-128) → ISO 45001.
- 7 country packs en `src/data/normativa/`: `cl.ts` (134 líneas, ~12 regulaciones), `br.ts` (119), `mx.ts` (107), `ar.ts` (100), `pe.ts` (92), `co.ts` (97) y `iso.ts` (97 — cláusulas 4-10 universales).
- `src/components/normativa/NormativaSwitch.tsx:1-40` provee `NormativaProvider` + dropdown + banner GPS-mismatch ("Detectamos que estás en Perú. ¿Cambiar normativa?") sin forzar al usuario.
- ISO 45001 como fallback significa que un trabajador en Indonesia, China o UK abre la app y tiene cobertura mínima aunque no exista pack local todavía.

## 4. Vista Gantt integrada con riesgo climático predictivo

- `src/services/calendar/predictions.ts:22-38` define 6 tipos de actividad predicha (`cphs-meeting`, `odi-training`, `audiometria`, `iper-review`, `management-review-iso45001`, `climate-risk-review`).
- `src/services/calendar/legalObligations.ts:7-15` cita las fuentes legales: DS 54 (sesión CPHS mensual), Ley 16.744 + DS 40 (ODI), ISO 45001 cláusula 9.3 (revisión por la dirección anual), NT MINSAL TMERT/PREXOR (audiometría que se acelera de 12 a 6 meses cuando dosis >100% del límite).
- `src/services/zettelkasten/climateRiskCoupling.ts:26-33` mapea condición climática → factor de riesgo (`slippery-surface`, `lightning-exposure`, `heat-stress`, `falling-objects`, `electrical-hazard`); el detector de trabajo eléctrico/altura está en líneas 68-80 (heurísticas en español/inglés).
- `src/components/projects/GanttProjectView.tsx:1-40` consume `PredictedActivity[]` + `ClimateRiskAssessment[]` y los renderiza como bloques de color (azul=activo, ámbar=warning, rojo=critical) en una sola línea de tiempo.
- `src/hooks/useCalendarPredictions.ts:1-30` cablea `/api/calendar/sync` + contexto de proyecto + clima a las funciones puras.

## 5. Facturación B2B chilena con tu RUT

- `server.ts:2018` expone `POST /api/billing/checkout` con `verifyAuth` (scaffold; persiste a `invoices/{id}` vía Admin SDK con default-deny en Firestore rules).
- `server.ts:2166` expone `POST /api/billing/invoice/:id/mark-paid` admin-gated + audit_logs para fallback manual.
- `src/services/billing/invoice.ts:1-14` documenta la regla de redondeo: `total = Math.ceil(subtotal * 1.19)`, `iva = total - subtotal` — invariante exacto cruzado con `withIVA()` de `pricing/tiers.ts`.
- RUT emisor literal: `src/services/billing/types.ts:67` (campo `emisorRut: '78231119-0'`) y constante `PRAEVENTIO_EMISOR_RUT` en línea 100.
- `BILLING.md:1-23` deja explícito el estado: math + contratos listos; integración Transbank/Stripe/SII boleta electrónica pendiente para próxima ronda.

## Lo que el trabajador chileno gana

- El contratista PYME con 3 faenas de 10 trabajadores ya no es forzado a montar Comité Paritario que la ley no le exige (`normativeAlerts.ts:41-65`); la regla aplica per-faena como dice DS 54 art. 1.
- El minero del Atacama recibe recordatorio automático de audiometría PREXOR adelantada cuando la dosis acumulada supera el TLV (`legalObligations.ts:11-14`).
- El precio en pantalla es el precio que se paga: $11.990 incluye IVA — sin "+IVA al final" del SaaS opaco (`withIVA()` en `tiers.ts:230-240`).
- Calendar Predictions entrega al CPHS la fecha exacta de la próxima sesión mensual (DS 54 art. 24) sin leer el cuerpo legal.
- El boletín climático genera nodos `CLIMATE_RISK` que conectan lluvia + trabajo eléctrico, calor + faena exterior, viento + altura — alertas accionables.

## Lo que la empresa gana

- Predictibilidad: tiers Premium (Titanio→Ilimitado) sin overage (`tiers.ts:267-274`) — el CFO sabe el costo exacto del año.
- Multi-país sin recargo en TODOS los tiers — diferenciador frente a competencia internacional que cobra por país.
- Trazabilidad SUSESO + ISO 45001: cada actividad predicha guarda `legalReference` (`predictions.ts:36`); la auditoría se reduce a exportar el log.
- Facturación con RUT chileno (`78231119-0`) e IVA reconciliado al peso (`invoice.ts:8-14`) — listo para SII boleta electrónica sin reescribir math.
- Cero fee de marketplace: el modelo es venta directa, sin la comisión 15-30% del Workspace Marketplace en el cap mensual.

## Lo que Praeventio gana

- Márgenes 45-77% por tier según el modelo de cost-passthrough (Tier P3 del plan): los tiers altos amortizan workspace SSO/CASA/Vertex fine-tuned (`tiers.ts:122-168`).
- Workspace-native como moat: tier Empresarial+ ofrece multi-tenant + CSM + modelo Vertex AI fine-tuned (`workspaceTier`, líneas 27-34) que competidores no Workspace-native no replican.
- Pipeline LATAM via ISO 45001: con 6 packs locales + ISO universal, una empresa minera multinacional puede contratar una sola plataforma para sus operaciones en CL/PE/CO/MX/AR/BR (`locationNormativa.ts:58-71`).
- Calculadora honesta como herramienta de venta: comparar contra $550.000/mes de prevencionista part-time (`PricingCalculator.tsx:39`) hace evidente el ROI.
- IVA reconciliado al precio .990 reduce fricción de checkout — el usuario chileno reconoce el precio inmediatamente.

## Limitaciones reconocidas (honestas)

- Webpay/Transbank y Stripe siguen siendo `*NotImplementedError` — `BILLING.md:17-22` lista lo que falta (`transbank-sdk` install, SII boleta electrónica, Stripe SDK).
- Packs LATAM no chilenos son stubs de 5-9 entradas cada uno (`pe.ts` 92 líneas vs `cl.ts` 134) — útiles como fallback ISO-equivalente, pero no aún equivalentes en profundidad al pack chileno.
- `GanttProjectView.tsx` aún no está montado en `src/pages/Projects.tsx` — el componente existe y compila, falta wiring final para que el usuario lo vea.
- `NormativaSwitch` y `NormativaProvider` no están wired en `App.tsx`/`main.tsx` — la cascada GPS funciona como librería pero la UI no aparece todavía.
- `evaluateNormativeAlerts()` (`normativeAlerts.ts:71-89`) tiene TODO de reglas time-based (CPHS mensual, ODI semestral, PREXOR por dosis) tipadas pero no implementadas — quedan para próxima ronda.

## KPIs sugeridos para medir el impacto

- Tasa de upgrade Gratis→Comité Paritario en los primeros 60 días (target: ≥12% — calculadora honesta debiera convertir, no manipular).
- Latencia entre vencimiento legal real y notificación in-app de Calendar Predictions (target: ≤7 días anticipación para CPHS, ≥30 días para ODI).
- Cobertura de packs: % de sesiones con `detectionSource = 'gps'` o `'language'` (vs `'default'` ISO) — mide adopción multi-país.
- Reconciliación IVA: 0 facturas con `subtotal + iva ≠ total` (invariante de `invoice.ts`).
- Climate risk → control implementado: % de nodos `CLIMATE_RISK` que generan al menos una acción registrada en el proyecto vinculado dentro de las 72h.
