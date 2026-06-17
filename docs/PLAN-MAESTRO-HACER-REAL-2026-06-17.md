# Plan Maestro — "Hacer Real Toda la App" · Guardian Praeventio

> **Estado: BORRADOR consolidado para revisar juntos.** No es compromiso de ejecución.
> **Norte del fundador:** hacer real la aplicación **entera** — nada que finje funcionar.
> No es "elegir 3 módulos de un vertical" (eso fue una lectura del 1er informe que NO es la intención).
> Consolida **3 fuentes**, todas reconciliadas contra HEAD posterior a #965:
> 1. **Inventario sistemático** (workflow 8 lentes, 93 hallazgos verificados file:line contra HEAD actual) — backbone.
> 2. **Informe MimoClaw** (verificado vs #955; deuda P0-P3 + arquitectura/seguridad/UX con esfuerzo) — Track C.
> 3. **Review "perspectiva"** (encuadre estratégico módulo×módulo) — ya absorbido en los WP.
> Supersede el borrador `PROPUESTA-POST-REVIEW-2026-06-17.md`. Al aprobarse, se vuelca a `PHASE5-REMEDIATION.md`.

---

## 0. Reconciliación de las 3 fuentes (qué aportó cada una · qué estaba stale)

- **Coinciden y es la verdad:** la app **es real en sus flujos core** (SOS, evacuación, incidentes, ergonomía, IPER, facturación, capacitación, cumplimiento-CL) — no es prototipo. P0-vida = 0 abiertos.
- **Lo que el inventario encontró y los informes NO** (porque miraron flujos, no superficie completa): **~140 componentes huérfanos + ~100 hooks `use*` huérfanos** (features enteros construidos: engine+API+hook+componente, sin montar en página); **144 tests `router.stack` + 66 routers sin cobertura conductual + ~15 tests mock-the-SUT** (código que *parece* testeado y no lo está); **datos falsos aún vivos** (GamifiedHUD CO/HP como vitales, "Simular IoT" inyecta evento Gemini al pipeline real sin tag, Digital-Twin 4 trabajadores default alimentan la ruta de evacuación, chips verdes "EPP Detectado").
- **Stale / ya resuelto (excluido del plan):** PDCA→ZK edges (incidentFlow.ts:89/91 createEdge real — #957 lo confirmó); mesh BLE GATT signing; REBA auto-medida; SloErrorBudget Math.sin; root_cause_analyses rules; RiskNodeMarkers tenant bug; + los 10 PRs de hoy (#956-#965: zone-entry, circadiano, survival-breadcrumb, SOS-parallel, DTE-retry, emergency-a11y, Ley-Karin-SLA, weeklyDigest…).
- **Reconciliaciones de contradicción:**
  - **Tier-gating:** ambos informes dicen "report-only por defecto" — **impreciso**. El middleware `requireTier.ts:82` default-ea a **enforce** (`enforce !== false`). Real = auditar call-sites montados con `enforce:false` (fase-1 rollout) y flipearlos; NO un flip global (ADR 0021: vida nunca gated).
  - **WebAuthn stubs en compliance builders (MimoClaw P2.8):** el marcador `STUB_REPLACE_WITH_WEBAUTHN_ASSERTION` **ya no aparece** en HEAD → probablemente resuelto post-#955 (vía #937). El inventario sí halló un hueco análogo real: `dteSigner.test.ts` deja pasar una **firma falsa** (WP-L14a) — ese es el riesgo vivo.
  - **SII:** ambos correctos — `bsale` es real; `openfactura/simpleapi/libredte` son stubs que tiran `NotImplemented`; en prod fail-closes a `noop` (un DTE no-emitido nunca se ve emitido). Acción = decidir bsale-only vs implementar otro (WP-L1).

---

## 1. Track A — Cierre de deuda hygiene (ya en curso · yo ejecuto, sin decisión tuya)

6 bloques verificados (workflow previo), 1 PR c/u, TDD + review en el sensible. Cierran el backlog de mejoras a 23/23:
`N16 jsPDF dynamic · N15 ExecutiveDashboard useMemo · N6mural comentarios/kebab/like · N13 N+1 sweep · N18 Settings toggles→/security-shield · N7b2d cron MRR + regla b2d_mrr_snapshots (review)`.

---

## 2. Track B — Hacer Real Toda la App (63 paquetes · 6 fases) — **esto revisamos juntos**

Tags: **[P]** prioridad (vida>legal>integridad>ux/perf>release) · **[D]** dependencia (none/credencial/hardware/decisión) · **[E]** esfuerzo (S≤0.5d, M≤2d, L>2d).

### FASE 0 — Emergencias de honestidad (datos fabricados en superficies de seguridad) · **primero**
Pequeños, máximo impacto de confianza. *Un número de CO o trabajadores inventados en una pantalla de seguridad es la mentira más peligrosa de la app.*
- **WP-V1** Matar trabajadores/maquinaria default del Digital-Twin (`twinStateMapper.ts:11-39`) [vida·none·S] — raíz; también limpia la ruta de evacuación.
- **WP-V2** Gatear ruta de evacuación a fuente de trabajadores REAL (`Evacuation.tsx:143`) [vida·none·M] (dep WP-V1).
- **WP-I1** GamifiedHUD CO/HP: quitar el juego de gas de Telemetry prod o drivear de `telemetry_events` reales + badge "simulación" [integridad·none·M].
- **WP-I2** "Simular IoT": taggear `simulated:true` en origen; gas-gate + `triggerEmergency` ignoran simulados; arreglar 401 tragado [integridad·none·M].
- **WP-I7** EPP color detector: chips con % confianza + tier + disclaimer "no es certificación" [integridad·none·S].
- **WP-U3** PortableCurriculum: construir lista real desde `audit_logs` + **quitar "próximamente"** [ux·none·M].

### FASE 1 — Cableado de vida + reglas + crons de vida
- **WP-V3** Montar `LoneWorkerAdminPanel` + `EmergencyBrigadePanel` (punto ciego del supervisor) [vida·none·S].
- **WP-V4** Wire del event-bus + A2 fatiga→soft-block (recomendar, no bloquear) + A6 handover→pre-turno [vida·none·M].
- **WP-V5** C5 adjuntar DEA/refugio más cercano al payload de escalación lone-worker [vida·none·S].
- **WP-V6** VectorialEvacuationMap: reemplazar plano falso por `site_geometry` real [vida·none·M].
- **WP-V7** Calendar pre-warn: reemplazar 8 loaders no-op por Firestore real (`maintenance.ts:201-212`) [vida·none·M].
- **WP-V10** Priorización de cola de sync offline (emergencia>incidente>médico>…) [vida·none·S].
- **WP-V11** Montar `LineOfFireValidationCard` + reword bloqueo→recomendación [vida·none·M].
- **WP-L3** Regla `site_book_counters` + preferible folio server-side `runTransaction` (secuencia legal DS44 hoy forjable) [legal·none·S· **review rules**].
- **WP-L4** Provisionar cron `daily-housekeeping` en deploy.yml (hoy expiry/recordatorios legales NO corren) [legal·scheduler·S· **review deploy**].
- **WP-I12** `commute_sessions`: quitar write cliente, enrutar por `/api/commute` [integridad·none·S· **review rules**].

### FASE 2 — Correctitud legal + tests legales huecos
- **WP-L1** Decisión SII: lock a bsale O implementar openfactura (quitar adapters que tiran) [legal·decisión+credencial·M-L].
- **WP-L5** Consolidar generador PDF DIAT (susesoCertificate vs diatPdfRenderer) [legal·none·M].
- **WP-L6** Dashboard de ciclo de vida/vencimientos de EPP [legal·none·M].
- **WP-L7** Montar `HazmatStorageManager` (DS 43/2016) + C4 OCR→HDS feed [legal·none·M-L].
- **WP-L8** Pre-calificación de contratistas: persistir + `ContractorRankingTable` + acreditación (recomendar) [legal·none·L].
- **WP-L9** B2 incidente→DIAT prellenada + reloj legal (generar doc, **nunca push SUSESO**) [legal·none·L].
- **WP-L10** LTIFR/TRIR en ExecutiveDashboard + motor de tendencia real [legal·dato horas-hombre·M].
- **WP-L11** A4 firma de permiso lee currículum portátil verificado (no bool del cliente) [legal·none·M].
- **WP-L12** Widget "exámenes ocupacionales vencidos/próximos" en Dashboard [legal·none·S].
- **WP-L13** `ConfidentialReportInbox` Ley Karin: una sola fuente (montar o borrar) [legal·decisión·S].
- **WP-L14** Tests legales huecos: (a) `dteSigner` firma falsa debe fallar [**review crypto**]; (b) `auditCoverage` extraer 7 handlers de server.ts a routers reales; (c) consolidar CPHS; (d) decisión MOC orphan-half [legal·none·L].

### FASE 3 — Integridad: consolidaciones, aristas, tests honestos
- **WP-I3** Montar `PredictiveAlertsList` + test conductual [integridad·none·S].
- **WP-I4** incidentFlow cluster vs IncidentReport canónico (cerrar loop Consolidación) [integridad·decisión·L].
- **WP-I5** C2 excepciones-repetidas→MOC (regla R13) + cron consistency-audit [integridad·scheduler·M].
- **WP-I6** C7 cierre-proyecto→ranking proveedores auto-feed [integridad·none·M].
- **WP-I8** Consolidar event-store (×3→1) preservando snapshot+replay [integridad·none·M].
- **WP-I9** Consolidar Coach IA (legacy `coachBackend` → `coach/` + SLM fallback) [integridad·none·M].
- **WP-I10/U1** Glosario: 1 fuente (`glossaryEngine`), reemplazar HOC roto + 2 parsers [integridad/ux·none·M].
- **WP-I11** Tests reimplementados→routers reales: webauthnVerify, mercadoPagoIpn, telemetryCanonical, coachChatTenant, externalAuditPortal, iotDeviceRegister, hazmat, visitors, backlinks [integridad·none·L· **review crypto/payments**].
- **WP-I13** 8 tests "contrato" Gemini → conductuales (prompt + JSON-parse fallback) [integridad·none·M].
- **WP-I14** ZK materializer assert-vs-title + SLM proxy + DR dry-run + telemetry tautologías [integridad·none·S-M].
- **WP-I15** Provisionar crons: aggregate-ai-feedback, consolidateZettelkasten, run-consistency-audit [integridad·scheduler·M].
- **WP-I16** Reconciliar 9 páginas duplicate-orphan + RiskMatrix5x5 (montar el rico o borrar el inline) [integridad·none·L].
- **WP-V8** Supertest conductual routers de VIDA primero (evacuation/refuges/fatigue/predictive/qrAck/routing…) [vida·none·L].
- **WP-V9** Des-fixme 3 e2e de seguridad (sos-button, process-lifecycle, offline-resilience) [vida·none·L].
- **WP-I17** ⭐ **Gate knip/ts-unused-exports** (ratchet huérfanos→0, whitelist hooks API-only) — **corre AL FINAL**, bloquea regresión de todo lo montado [integridad·none·M].

### FASE 4 — UX/perf: surfaceo, dashboards, consolidación IA
- **WP-U2** WeatherBulletin AQI real (Open-Meteo air-quality) o "sin dato" [ux·endpoint·M].
- **WP-U4** TierDowngradeModal archive/export real [ux·none·M].
- **WP-U5** Montar SafetyMetrics/SPI dashboards [ux·none·M].
- **WP-U6** EvacuationStatusBoard: confirmar supersesión y borrar [ux·none·S].
- **WP-U7** Montar huérfanos conocimiento/training/QA (KnowledgeBase, SpacedRepetition, LightningTrainingPlayer, 5S) [ux·none·L].
- **WP-U8** Montar tarjetas legal/compliance huérfanas (LegalObligation, NonConformity, ResidualRisk, RACI, ISO45001) [legal/ux·none·L].
- **WP-U9** Montar ShiftHandover orphan-half [ux·none·S].
- **WP-U10** C6 SunTracker→factores pre-turno [ux·none·M].
- **WP-U11** Consolidar subsistema Driving (4 páginas + 2 dirs) [ux·decisión·L].
- **WP-U12** Risk hub: modelo de riesgo compartido para 7 dirs fragmentados (consolidación, preservar engines) [ux·decisión·L].
- **WP-U13** Panel "Costo del Riesgo" operacional (Heinrich + ROI sobre datos reales) [ux·campo directCost·M].

### FASE 5 — Release/enhancement + gate
- **WP-R4** Montar widgets monetización/PYME (ROICalculator, TierComparator, Pyme onboarding) [release·none·L].
- **WP-R5** Consolidar SUSESO monthlyReport vs clientReporting [release·none·M].
- **WP-R3** Crons aggregate-ai-feedback + b2d-mrr (con WP-I15) [release·scheduler·S].

### FASE 6 — Needs-founder / external (listados, NO abandonados; en paralelo según lleguen insumos)
- **WP-L2** Secretos Bsale + certificación SII → enciende DTE real (sin código) [credencial+cert].
- **WP-R1** Adapters ERP SAP/Buk/Talana [credencial cliente].
- **WP-R2** capacitor-mesh Wi-Fi Direct [hardware multi-device].
- **WP-X1** Observability GCP/Prometheus (Sentry ya es real) [decisión].
- **WP-X2** Vertex Trainer (tombstone descartado) [decisión+budget].
- **WP-X3** Gemma 2 2B SHA-256 pin (Qwen es el default real) [token HF].
- **WP-X4** CAD DWG converter deploy (DXF ya anda on-device) [infra].
- **WP-X5** Proximity sensor native bridge [hardware].
- **WP-X6** wisdomCapsules: feature viva (agregar writer) vs superseded (borrar) [decisión].
- **WP-X7** 3D twin path + dual-write `incidents` (revisión de integridad DS67) [decisión].

---

## 3. Track C — Deuda técnica / arquitectura (de MimoClaw · ortogonal a "no-real")
Estos NO son "fake vs real" sino calidad/arquitectura/seguridad — los integro para no dejarlos afuera. Se intercalan entre fases (o como su propio frente):
- **Arquitectura:** A1 completar split `server.ts` (1552 LOC/222 mounts → routers) · A2 componer middleware `verifyAuth+assertProjectMember` (×218) en wrapper · A3 versionado `/api/v1/` · A4 lógica-de-negocio en componentes→servicios.
- **Robustez/perf (MimoClaw P2):** `as any` ×18 en `KnowledgeGraph.tsx` · virtualización KG >1k nodos (react-window+worker) · code-splitting eager (KG/Site25D/PortableCurriculum) · **background triggers `Promise.all` sin límite → p-limit** (`backgroundTriggers.ts`) · Stryker CI crash Windows · seeds determinísticos (8 archivos).
- **Seguridad (MimoClaw S):** CSP nonce dinámico (regex frágil) · evaluar WAF.
- **UX (MimoClaw U):** onboarding wizard (backend existe, falta UI — solapa con WP-U7/R4) · banner offline persistente.
- **Limpieza (MimoClaw P3):** 214 branches sin fusionar · ~40 .md en raíz→docs/ · console.log `runWithGuardrails.ts` · @ts-ignore `SafetyCoach.tsx`.
- **i18n:** expandir es-AR/MX/PE (5-8%) + pt-BR (87%→paridad) — solapa con lanzamiento global.

---

## 4. Totales
- **~63 paquetes Track B** (56 accionables + 7 needs-founder) + **~20 ítems Track C** + 6 bloques Track A.
- **Esfuerzo Track B accionable:** S≈16 · M≈24 · L≈16 (≈216 effort-units; el grueso = montar huérfanos + 66 routers + consolidación 7-dirs).
- **Doable-ahora (sin dependencia externa):** ~48 paquetes Track B (toda la fase vida, casi toda integridad/legal/ux).
- **Bloqueado-externo:** ~15 (credencial: WP-L1/L2/R1/X3 · scheduler-IAM: L4/I5/I15/R3 · hardware: R2/X5 · infra: X4 · datos: U2/L10/U13 son "agregar campo/endpoint", no bloqueo real).

## 5. Las 6 decisiones que son tuyas (gates de negocio/arquitectura)
1. **SII:** bsale-only vs implementar un 2º PSE (WP-L1).
2. **Ley Karin inbox:** montar `ConfidentialReportInbox` vs mantener inline (WP-L13).
3. **incidentFlow:** montar el cluster completo vs consolidar con IncidentReport inline (WP-I4).
4. **Driving:** qué superficie es la de lanzamiento (WP-U11).
5. **Risk hub:** unificar los 7 dirs en una IA (WP-U12).
6. **3D twin / wisdomCapsules:** feature viva vs descartar (WP-X6/X7).

## 6. Mayor riesgo/valor + mandatos de review adversarial
**Top valor (vida×honestidad / legal):** (1) WP-V1/V2 trabajadores fabricados envenenando la ruta de evacuación — **lo más peligroso**; (2) WP-L3 folio libro-de-obras forjable sin regla; (3) WP-L4+I15 crons no provisionados → recordatorios legales/expiry NO corren en prod hoy; (4) WP-L14a/I11 firma falsa que pasa tests verdes.
**Review obligatorio (no merge en una pasada):** rules (WP-L3, WP-I12) · crypto (dteSigner, webauthnVerify) · payments (mercadoPagoIpn, Bsale) · life-safety+directiva no-bloquear (WP-V4/V11, evacuación V2/V6/V7/V8) · deploy (crons L4/I5/I15) · legal (L8/L9/L13) · integridad (WP-I17 ratchet — whitelist o borra código real).

## 7. Orden recomendado de arranque
1. **Ahora:** Track A (hygiene) — en curso.
2. **FASE 0 honestidad** (WP-V1/V2/I1/I2/I7/U3) — chico, máxima confianza, ataca la mentira más peligrosa.
3. **FASE 1 vida** + las reglas/crons legales de vida.
4. Luego FASE 2 (legal) → 3 (integridad, con WP-I17 ratchet al final) → 4 (ux) → 5 (release).
5. Track C se intercala (background-triggers p-limit y CSP-nonce son seguridad temprana; el resto oportunista).
6. FASE 6 / needs-founder en paralelo según tus desbloqueos.

> **Decime qué ajustas** (orden de fases, las 6 decisiones, alcance) y lo vuelvo el plan de ejecución definitivo + lo vuelco a `PHASE5-REMEDIATION.md`. Cero ejecución de Track B hasta tu OK; Track A (hygiene) sigue como deuda autónoma salvo que digas lo contrario.
