# PLAN MAESTRO 2026-Q3 — Nodos 321-512 (scoping ratificado)

> **Decisión usuario 2026-05-21:** §12.4.1 marcado como "implementar sí o sí". Este documento reemplaza el `PLAN_MAESTRO.md` perdido (referenciado en `docs/archive/2026-05/PLAN_PARTE3_PROTOTIPO2.md:155-173`) y ratifica las 4 categorías arquitectónicas para los 192 nodos 321-512.
>
> **Estado:** SCOPING RATIFICADO. La implementación es iterativa por categoría según `prioridad` × `esfuerzo`. Items con `🔵 BLOQUEADO` requieren input externo (cuentas, partners, decisiones). Items `🟢 IMPLEMENTABLE` pueden arrancarse en escritorio con skills.

---

## Distribución por categoría

| Rango | Categoría | Count | Foco |
|---|---|---|---|
| **321-368** | Inteligencia Colectiva | 48 | Multi-empresa anonimizado + benchmarks + lecciones cross-tenant |
| **369-416** | Ecosistema Enterprise | 48 | B2B integraciones + multi-país plans + SSO + API gateway |
| **417-464** | Expansión Regional | 48 | LatAm + UK/CA/AU/JP/KR/IN + EU AI Act + multilenguaje |
| **465-512** | AI Avanzada | 48 | Generativa + Computer Vision edge + Risk Forecaster + Digital Twin completo |

---

## CATEGORÍA 1 — Inteligencia Colectiva (321-368)

> Aprovechar el corpus multi-tenant ANONIMIZADO para entregar valor (benchmarks, lecciones cross-empresa, alertas tempranas) sin violar Ley 19.628 ni tenant isolation. Inspirado en `services/ai/incidentRagPipeline` ya existente.

| Nodo | Concepto | Spec mínima | Prioridad | Esfuerzo |
|---|---|---|---|---|
| 321 | Benchmarking anónimo industria | Tasa accidentabilidad propia vs media sector (k-anon ≥5) | ALTA | M 1 día |
| 322 | Lecciones cross-tenant | Lessons learned anonimizadas, citables sin atribuir | ALTA | M 5 días |
| 323 | Alerta temprana sectorial | Spike incidentes en industria → notificación supervisor | ALTA | L 1 sem |
| 324 | Ranking de controles efectivos | Top controles que reducen TRIR en cada industria | MEDIA | L 1 sem |
| 325 | Patrón estacional incidentes | ML detect estacionalidad accidentes por sector | MEDIA | L 2 sem |
| 326 | Cluster trabajadores alto riesgo | Anonimizado: perfil socio-laboral × incidente | MEDIA | XL 3 sem |
| 327 | EPP fallido cross-empresa | Modelos EPP con tasa falla > p95 → alert | ALTA | M 5 días |
| 328 | Contractor risk score | Score reputacional contratista (anonymizado) | MEDIA | M 1 sem |
| 329 | Predicción accidente fatal | ML predice probabilidad fatal próximos 30 días | ALTA | XL 4 sem |
| 330 | Causa raíz patrón global | ICAM/Bowtie agregado sector → top 5 causas | ALTA | L 2 sem |
| 331 | Geo-cluster riesgo | Heatmap regional incidentes (anonimizado) | MEDIA | L 1 sem |
| 332 | Trend detector emergente | Nuevos tipos incidente (Lithium Li-ion, etc.) | MEDIA | XL multi-mes |
| 333 | Benchmarking turnover personal | Rotación promedio sector vs propia | BAJA | M 3 días |
| 334 | Best practices wiki cross-tenant | Wiki de soluciones probadas (con consent) | MEDIA | L 2 sem |
| 335 | Auditoría comparada | "Tu empresa vs top decil sector" | ALTA | M 1 sem |
| 336 | Sugerencias acción colectiva | Si 10+ empresas tienen mismo issue → comité industrial | BAJA | M 1 sem |
| 337 | Conectividad supply-chain risk | Riesgos cascade por proveedor común | MEDIA | XL 4 sem |
| 338 | Pulse cultural anónimo | CEAL-SM agregado vs benchmark sector | MEDIA | L 1 sem |
| 339 | Trabajador embajador (gamified) | Workers anónimos top-aportadores observaciones | BAJA | M 3 días |
| 340 | Knowledge graph público | Subset ZK anonimizado disponible para B2D | MEDIA | L 2 sem |
| 341 | Programa retraining cross-empresa | Trabajadores reentrenados detectables anonim | BAJA | L 2 sem |
| 342 | Causa raíz IA explainable | Causes + counterfactuals legibles | ALTA | L 2 sem |
| 343 | Score salud organizacional | Compuesto: cultura + cumplim + clima | MEDIA | M 1 sem |
| 344 | Predicción rotación faena | ML predice quién renunciará próximos 30d | MEDIA | XL 3 sem |
| 345 | Network effect badge | "1 de cada X empresas en tu industria usa Guardian" | BAJA | S 1 día |
| 346 | Reportes consolidados Mutual | Para mutualidad anonimizado | MEDIA | L 2 sem |
| 347 | DEI scoring laboral | Indicadores diversidad/inclusión sector | BAJA | L 2 sem |
| 348 | Comparador madurez | Tu madurez ISO 45001 vs benchmark | ALTA | M 5 días |
| 349 | Pulse Ley Karin sectorial | Reportes Karin agregados sector | MEDIA | L 1 sem |
| 350 | Datos abiertos públicos | Dashboard público con datos anonimizados (transparencia) | BAJA | XL 3 sem |
| 351 | Riesgos emergentes IA | LLM analiza tendencias media + LinkedIn industry | MEDIA | XL multi-mes |
| 352 | Recurrencia incidente | Detección "mismo accidente 3 veces en 6 meses" cross-empresa | ALTA | M 1 sem |
| 353 | Topología supply-chain | Visualización proveedores comunes con riesgo | MEDIA | L 2 sem |
| 354 | Hot-spot trabajadores | Workers que cambian empresa con incidentes | BAJA | XL 3 sem |
| 355 | Best-in-class sector | Top 10% empresas anonymized + sus prácticas | MEDIA | L 1 sem |
| 356 | Riesgo macroeconómico | Recesión → estrés laboral → incidentes (correlación) | BAJA | XL multi-mes |
| 357 | Predicción huelga | Indicadores tempranos conflicto laboral | BAJA | XL multi-mes |
| 358 | Score sustentabilidad operación | ESG-aware safety scoring | MEDIA | L 2 sem |
| 359 | Anonymized incident database | Para investigación académica con consent | BAJA | L 2 sem |
| 360 | Benchmark CPHS performance | Comités paritarios sector comparativa | ALTA | M 1 sem |
| 361 | Climate-incident correlation | Datos meteo + accidentes cross-empresa | MEDIA | L 2 sem |
| 362 | Anomaly detection sector | ML detecta atípico vs sector | ALTA | L 2 sem |
| 363 | Lessons cross-industria | Aprendizajes minería aplicables a construcción | BAJA | L 2 sem |
| 364 | Survey design generator | IA genera encuestas validadas según contexto | BAJA | M 1 sem |
| 365 | Adaptive maturity roadmap | Plan crecimiento basado en pares anónimos | MEDIA | L 1 sem |
| 366 | Workers compensation forecast | Predicción costo Mutualidad próximo año | MEDIA | L 2 sem |
| 367 | Compliance gap forecast | Predicción de no-conformidades antes audit | ALTA | L 2 sem |
| 368 | Knowledge marketplace | Empresas comparten templates con créditos | BAJA | XL multi-mes |

---

## CATEGORÍA 2 — Ecosistema Enterprise (369-416)

> B2B integraciones con ERPs, SSO, API gateway, multi-país plans, certificaciones formales y partner ecosystem.

| Nodo | Concepto | Prioridad | Esfuerzo |
|---|---|---|---|
| 369 | API Gateway Enterprise (REST/GraphQL) | ALTA | XL 3 sem |
| 370 | SAP S/4HANA integration | MEDIA | XL multi-mes 🔵 partner |
| 371 | Buk HRM integration (CL) | ALTA | L 2 sem |
| 372 | Workday HCM integration | MEDIA | XL multi-mes 🔵 |
| 373 | Microsoft Dynamics 365 | MEDIA | L 3 sem |
| 374 | Oracle EBS connector | BAJA | XL multi-mes |
| 375 | SSO SAML 2.0 + OIDC | ALTA | L 2 sem |
| 376 | SCIM 2.0 user provisioning | ALTA | L 1 sem |
| 377 | Azure AD integration | ALTA | M 5 días |
| 378 | Google Workspace SSO | ALTA | M 3 días |
| 379 | Okta SCIM | MEDIA | M 5 días |
| 380 | OneLogin SAML | BAJA | M 3 días |
| 381 | SOC 2 Type I path | ALTA | XL multi-mes 🔵 auditor |
| 382 | ISO 27001 audit ready | ALTA | XL multi-mes 🔵 |
| 383 | GDPR DPO portal | ALTA | L 3 sem |
| 384 | HIPAA-equivalente CL | BAJA | XL multi-mes |
| 385 | Marketplace Partners | MEDIA | L 4 sem |
| 386 | White-label revendedores | BAJA | XL multi-mes |
| 387 | Plan Enterprise Global pricing | ALTA | M 5 días |
| 388 | Multi-currency support (CLP/USD/EUR/BRL) | ALTA | M 1 sem |
| 389 | Multi-language UI (16 idiomas) | ALTA | L 2 sem |
| 390 | Tenant federation enterprise | MEDIA | XL 4 sem |
| 391 | Custom branding por tenant | MEDIA | L 1 sem |
| 392 | Custom domains (cliente.praeventio.app) | MEDIA | L 1 sem |
| 393 | SLA enterprise 99.99% | ALTA | XL multi-mes (infra) |
| 394 | Multi-region failover (us-east1 + eu-west1) | MEDIA | XL multi-mes |
| 395 | Dedicated GPU pool enterprise | BAJA | XL multi-mes 🔵 |
| 396 | Custom data retention (1-7 años) | MEDIA | M 1 sem |
| 397 | BYO encryption keys (CMEK) | MEDIA | L 2 sem |
| 398 | Audit trail exportable (compliance ready) | ALTA | M 1 sem |
| 399 | Forensic chain inmutable enterprise | MEDIA | L 1 sem |
| 400 | Customer Success portal | ALTA | L 3 sem |
| 401 | Onboarding white-glove (training in situ) | MEDIA | XL multi-mes 🔵 |
| 402 | Premium support 24/7 (turnos rotativos) | ALTA | XL multi-mes 🔵 staff |
| 403 | Dedicated solutions engineer | BAJA | XL multi-mes 🔵 |
| 404 | Custom integrations DevOps | BAJA | XL multi-mes |
| 405 | Quarterly business reviews (QBR) | MEDIA | M 1 sem (process) |
| 406 | Renewal forecasting CSM | MEDIA | M 1 sem |
| 407 | Health score enterprise (consumo, engagement) | MEDIA | L 2 sem |
| 408 | Procurement portal RFP responder | BAJA | L 2 sem |
| 409 | Master Service Agreement template | ALTA | M (legal review) |
| 410 | Data Processing Agreement (DPA) ready | ALTA | M (legal review) |
| 411 | Acceptable Use Policy enterprise | ALTA | M (legal) |
| 412 | NDA bilateral templates | MEDIA | S |
| 413 | InfoSec questionnaire pre-filled | ALTA | M 5 días |
| 414 | SOC 2 report shareable (post-audit) | ALTA | post-SOC 2 |
| 415 | Penetration test report quarterly | ALTA | XL multi-mes 🔵 vendor |
| 416 | Bug bounty program (HackerOne) | BAJA | XL multi-mes 🔵 |

---

## CATEGORÍA 3 — Expansión Regional (417-464)

> Multi-país con compliance específico, multilenguaje, multi-currency, jurisdicciones reales implementadas (no solo esqueletos).

| Nodo | Concepto | Prioridad | Esfuerzo |
|---|---|---|---|
| 417 | UK adapter generators reales (RIDDOR PDF + folio HSE) | ALTA | XL 3-4 sem |
| 418 | CA adapter generators reales (WCB Form 7 + provincial) | ALTA | XL 3-4 sem |
| 419 | AU adapter generators (Notifiable Incident WHS) | ALTA | XL 3-4 sem |
| 420 | JP adapter (労働者死傷病報告 + hanko digital) | MEDIA | XL multi-mes |
| 421 | KR adapter (SAPA + accident investigation) | MEDIA | XL multi-mes |
| 422 | IN adapter (Form 18 Factories Act + OSHWC 2020) | MEDIA | XL multi-mes |
| 423 | US adapter (OSHA Form 300/301) | ALTA | XL 4 sem |
| 424 | BR adapter (CAT + eSocial integration) | ALTA | XL 4 sem |
| 425 | MX adapter (STPS + IMSS reportes) | MEDIA | XL 4 sem |
| 426 | AR adapter (ART + Notificación SRT) | MEDIA | XL 3 sem |
| 427 | CO adapter (ARL + FURAT) | MEDIA | XL 3 sem |
| 428 | PE adapter (SUNAFIL + accidente trabajo) | MEDIA | XL 3 sem |
| 429 | EU AI Act compliance audit | ALTA | XL multi-mes 🔵 antes expansion EU |
| 430 | EU GDPR adapter dedicado | ALTA | L 3 sem |
| 431 | UK GDPR adapter (post-Brexit) | MEDIA | L 2 sem |
| 432 | BR LGPD adapter | MEDIA | L 2 sem |
| 433 | CCPA/CPRA adapter (California) | MEDIA | L 2 sem |
| 434 | Multilanguage 16 → 30 idiomas | BAJA | XL multi-mes (traduciones humanas) |
| 435 | Regionalización fechas/números (12 locales) | MEDIA | M 1 sem |
| 436 | Multi-currency Webpay equivalentes | ALTA | XL multi-mes 🔵 partners pagos |
| 437 | Asociación Mutuales LatAm | MEDIA | XL multi-mes 🔵 partners |
| 438 | OSHA Form 301 auto-completar | ALTA | L 3 sem |
| 439 | OSHA Form 300A annual summary | MEDIA | L 2 sem |
| 440 | eSocial BR XML emission | ALTA | XL 4 sem |
| 441 | STPS MX NOM-035 compliance | MEDIA | L 3 sem |
| 442 | Saúde e segurança Lei 14.831 BR | MEDIA | L 2 sem |
| 443 | Ley 24.557 ART AR | MEDIA | L 2 sem |
| 444 | Resolución 1401 ARL CO | MEDIA | L 2 sem |
| 445 | SST DS-26 RD | BAJA | L 2 sem |
| 446 | LATAM compliance dashboard | ALTA | L 2 sem |
| 447 | EU regulatory updates feed | MEDIA | M 1 sem |
| 448 | US OSHA inspector portal | BAJA | XL multi-mes 🔵 |
| 449 | Ley regional minería (Chile DS 132, Perú DS 024) | ALTA | XL 4 sem |
| 450 | Ley Forestal LatAm (Chile DS 101, BR portaria 86) | MEDIA | L 3 sem |
| 451 | Ley Pesca/Acuicultura LatAm | MEDIA | L 3 sem |
| 452 | Ley Portuaria LatAm (cabotaje + cargas) | BAJA | L 3 sem |
| 453 | Indigenous data sovereignty (AU/CA/NZ) | BAJA | XL multi-mes 🔵 partners |
| 454 | Geo-fencing regional (data residency) | ALTA | XL 4 sem |
| 455 | Multi-region Cloud Run deployments | ALTA | XL multi-mes |
| 456 | Multi-region Firestore replication | MEDIA | XL multi-mes |
| 457 | LATAM tax compliance (IVA + retenciones) | MEDIA | L 2 sem |
| 458 | Regional pricing tiers (PPP-adjusted) | MEDIA | M 1 sem |
| 459 | Regional partner channel program | BAJA | XL multi-mes |
| 460 | LATAM customer events | BAJA | XL multi-mes 🔵 |
| 461 | Regional regulatory advisory board | MEDIA | XL multi-mes 🔵 |
| 462 | Translated documentation 10 idiomas core | MEDIA | XL multi-mes |
| 463 | Local hosting opt-in (BR, MX, CL data residency) | MEDIA | XL multi-mes 🔵 |
| 464 | Cross-border data transfer compliance | ALTA | XL multi-mes |

---

## CATEGORÍA 4 — AI Avanzada (465-512)

> Computer Vision edge, IA generativa para contenido, Risk Forecaster ML, Voice AI manos libres, Digital Twin completo, AR/VR mantenimiento.

| Nodo | Concepto | Prioridad | Esfuerzo |
|---|---|---|---|
| 465 | Computer Vision EPP detection edge (TFLite) | ALTA | XL 4 sem |
| 466 | CV Postura RULA/REBA streaming | ALTA | XL 3 sem |
| 467 | CV detección líquidos (derrames) | MEDIA | XL 4 sem |
| 468 | CV detección humo (incendio temprano) | ALTA | XL 4 sem |
| 469 | CV near-miss capture automático | ALTA | XL 4 sem |
| 470 | CV reconocimiento facial supervisor (consent) | BAJA | XL multi-mes 🔵 legal |
| 471 | CV PPE compliance walking inspection | ALTA | XL 4 sem |
| 472 | Voice AI "Hey Guardian" Wake Word | MEDIA | XL multi-mes 🔵 hardware |
| 473 | Voice command terreno (handsfree) | ALTA | XL 3 sem |
| 474 | Voice transcription incident reports | ALTA | L 2 sem |
| 475 | Voice translation multilenguaje en terreno | MEDIA | L 3 sem |
| 476 | Risk Forecaster ML (clima+tareas+historial) | ALTA | XL multi-mes |
| 477 | Predictive maintenance ML | MEDIA | XL 4 sem |
| 478 | Fatigue prediction (turnos+sueño+heart rate) | ALTA | XL 4 sem |
| 479 | Stress prediction psicosocial CEAL-SM ML | MEDIA | XL 4 sem |
| 480 | Generative AI safety posters | BAJA | L 2 sem |
| 481 | Generative AI video capacitación | BAJA | XL multi-mes 🔵 |
| 482 | LLM-driven training plans personalizados | MEDIA | L 3 sem |
| 483 | GenAI policy document drafting | MEDIA | L 2 sem |
| 484 | GenAI risk assessment auto-completar | ALTA | XL 4 sem |
| 485 | Multimodal LLM análisis foto+texto incidente | ALTA | L 3 sem |
| 486 | AI Coach 5 dominios con persona | ALTA | L 2 sem |
| 487 | AI Coach RAG normativa por país | ALTA | XL 4 sem |
| 488 | AI counterfactual analysis ("what-if") | MEDIA | XL 4 sem |
| 489 | Digital Twin 3D faena completo (interactivo) | ALTA | XL multi-mes |
| 490 | DT BIM integration (IFC) | MEDIA | XL multi-mes 🔵 |
| 491 | DT live IoT overlay sensors | ALTA | XL 4 sem |
| 492 | DT replay incident reconstruction | ALTA | XL multi-mes |
| 493 | AR mantenimiento step-by-step (WebXR real) | ALTA | XL multi-mes |
| 494 | AR PPE inspector overlay | MEDIA | XL multi-mes |
| 495 | AR rescue assist (rutas evacuación) | ALTA | XL multi-mes |
| 496 | VR safety training inmersivo | MEDIA | XL multi-mes 🔵 hardware |
| 497 | VR simulacro emergencia | MEDIA | XL multi-mes 🔵 |
| 498 | Photogrammetry on-device WASM (ADR-0005 v4) | ALTA | XL multi-mes |
| 499 | NeRF rendering faena 3D | BAJA | XL multi-mes |
| 500 | Gaussian Splat photogrammetry | BAJA | XL multi-mes |
| 501 | LiDAR scan iOS (ARKit integration) | MEDIA | XL multi-mes 🔵 iOS |
| 502 | Edge AI on-device Gemma Nano | ALTA | XL multi-mes |
| 503 | Federated learning multi-tenant (privacy-safe) | BAJA | XL multi-mes |
| 504 | Differential privacy training | BAJA | XL multi-mes |
| 505 | Explainable AI dashboard (SHAP/LIME) | MEDIA | L 3 sem |
| 506 | AI hallucination detector advanced | MEDIA | L 2 sem |
| 507 | Adversarial robustness testing AI | BAJA | XL multi-mes |
| 508 | AI red-teaming continuous | MEDIA | XL multi-mes |
| 509 | LLM cost optimizer (cache + prompt compression) | MEDIA | L 2 sem |
| 510 | Multimodal embeddings (foto+texto+sensor) | MEDIA | L 3 sem |
| 511 | Time-series anomaly LSTM | MEDIA | L 3 sem |
| 512 | Quantum-resistant cryptography migration | BAJA | XL multi-mes (post-NIST) |

---

## Roadmap implementación recomendado

### Q3 2026 (jul-sep)
**Prioridad ALTA + esfuerzo ≤L:**
- Cat 1: 321 benchmarking + 322 lecciones cross + 327 EPP fallido + 348 madurez + 367 compliance gap forecast (~5 nodos, 4 sem)
- Cat 2: 375 SSO SAML + 377 Azure AD + 378 GW SSO + 387 Enterprise pricing + 388 multi-currency + 398 audit trail (~6 nodos, 4 sem)
- Cat 3: 430 EU GDPR adapter + 446 LATAM compliance dashboard (~2 nodos, 3 sem)
- Cat 4: 486 AI Coach persona + 474 voice transcription + 485 multimodal incident (~3 nodos, 4 sem)

### Q4 2026 (oct-dic)
**Prioridad ALTA + esfuerzo XL:**
- Cat 1: 323 alerta temprana + 329 predicción fatal + 330 causa raíz patrón + 335 auditoría comparada (~4 nodos)
- Cat 2: 369 API Gateway + 371 Buk HRM + 376 SCIM + 393 SLA 99.99% (~4 nodos)
- Cat 3: 417 UK + 418 CA + 419 AU + 423 US (~4 nodos)
- Cat 4: 465 CV EPP edge + 466 CV postura + 468 humo + 469 near-miss + 484 risk auto (~5 nodos)

### Q1 2027 (ene-mar)
**Prioridad MEDIA + bloqueados externos resolved:**
- Cat 1: 324-326, 331-334, 338-343
- Cat 2: 370 SAP, 372 Workday, 381 SOC2, 393-394 multi-region
- Cat 3: 420 JP, 421 KR, 422 IN, 424-428 LatAm full
- Cat 4: 472 wake word, 476 risk forecaster, 478 fatigue, 489 DT completo

### 2027+ — Long-tail
Resto de nodos por prioridad descendente + decisiones usuario.

---

## Restricciones inviolables aplicables

1. **Tenant isolation absoluto** — nodos 321-368 Inteligencia Colectiva DEBEN aplicar k-anonimato ≥5 antes de cualquier agregación cross-tenant.
2. **Ley 19.628 Chile + GDPR + LGPD** — exposición datos personales prohibida sin consent explícito.
3. **No-push policy** — nodos 423 OSHA + 424 eSocial + 425 STPS + 440 eSocial XML producen documentos LOCALES; empresa cliente firma+entrega.
4. **AI explainability obligatoria** — todos los nodos 465-512 deben generar audit log + cited sources cuando AI toma decisión.
5. **OSS-first** — preferir librerías OSS auditables (`@huggingface/transformers`, `viem`/`ethers.js`, `@tensorflow/tfjs`) sobre managed services cuando la calidad sea equiparable.
6. **Sprint K = lista de pendientes, NO archivo** — cada nodo se implementa en su carpeta de dominio respectiva (`src/services/{domain}/`).
7. **DS 44/2024 vigente** — todas las referencias normativas en nodos Cat 3 deben anotar DS 40 como derogado.

---

## Métricas de éxito

- **Q3 2026 cierre:** 15-20 nodos implementados (priorizando ALTA × ≤L)
- **Q4 2026 cierre:** 30-40 nodos
- **Q1 2027 cierre:** 50-60 nodos (acumulado)
- **Day-1+ global (2028):** 100+ nodos
- **Largo plazo:** 192/192 nodos según prioridad + factibilidad

Cada nodo implementado debe:
1. Tener tests con cobertura ≥80%
2. Pasar lint + typecheck (0 errors)
3. Documentar en ADR si es decisión arquitectónica
4. Wire UI consumer (si aplica)
5. Test E2E si toca user journey crítico

---

## Decisión documentada

**El usuario directivó 2026-05-21:** "12.4.1 implementar si o si". Este documento ratifica que los 192 nodos 321-512 NO son abandonados; son scope formal del producto con prioridades + esfuerzos asignados.

**Próximo paso:** comenzar implementación Q3 2026 según roadmap arriba. Cada nodo será un sprint independiente con su propio ADR si afecta arquitectura.

**Documentos relacionados:**
- `docs/architecture-decisions/0017-per-country-emission-adapters.md` (cubre nodos 417-428)
- `docs/architecture-decisions/0005-photogrammetry-pipeline.md` v4 (cubre 498)
- `docs/architecture-decisions/0019-google-ecosystem-foundation-oss-critical-complement.md`
- `docs/architecture-decisions/0020-peer-to-peer-heavy-compute-via-google-drive.md`
- `TODO.md §16` (originales del recovery + §17 cross-check verificado)

---

**Última actualización:** 2026-05-21 — Scoping ratificado per directiva usuario §12.4.1 "implementar sí o sí".
