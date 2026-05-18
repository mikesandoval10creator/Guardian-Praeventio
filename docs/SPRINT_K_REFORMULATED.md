# Sprint K — Reformulación arquitectónica

**Fecha:** 2026-05-17
**Estado:** propuesta para validación (no ejecutar hasta confirmar)
**Autor de la directiva:** usuario (sesión 2026-05-17)

---

## Principios (directiva inviolable del usuario)

> "Sprint K es el cómo debería hacerse las cosas, lo que está pendiente, lo que nos falta. La forma de incorporarlo debe seguir las directrices de la aplicación, usar el sistema Zettelkasten cuando se pueda, que cada módulo que explica el Sprint K tenga su propio menú y sub menú. Si debes hacer más páginas o colocar la información o funciones donde corresponde hazlo."

> "Cada función que se dice en Sprint K debe ser considerada y creada donde corresponde de acuerdo a la lógica que tiene ese aspecto del código... son funciones pendientes, se deben implementar donde corresponde precisamente para que no sea un monolito... que cada aspecto pendiente del código, cada promesa sea real, considerando la factibilidad técnica."

**Reglas de ejecución:**
1. Sprint K = lista de **promesas/funciones por implementar**, NO un archivo.
2. Cada item vive donde **corresponde según la lógica de su dominio**:
   - `src/services/{domain}/` — lógica pura
   - `src/server/routes/{domain}.ts` — endpoints HTTP (NO monolito)
   - `src/pages/{Feature}.tsx` — UI dedicada
   - `src/hooks/use{Feature}.ts` o `src/hooks/{domain}/` — hook cliente
   - Sidebar entry + sub-menú cuando aplique
   - Zettelkasten integration cuando el feature genere/consume nodos del Risk Network
3. **Eliminar** el monolítico `src/server/routes/sprintK.ts` + `src/hooks/useSprintK.ts` gradualmente, una vez todo migrado.
4. Cada migración: **commit atómico** + **test verde** + **typecheck verde**.
5. Respetar restricciones inviolables (directiva 1-4 + Reglas 1-3 de TODO.md):
   - No bloquear maquinaria.
   - No push automático a APIs estatales.
   - No XP negativo.
   - Fail-closed por defecto.
   - Citation discreta de fuentes externas.

---

## Diagnóstico del monolito actual

| Componente | Estado | Problema |
|---|---|---|
| `src/services/` | 🟢 Bien organizado (60+ carpetas de dominio) | Ninguno |
| `src/pages/` | 🟢 201 páginas, mayoría correctamente ubicadas | Algunas pendientes (ver tabla) |
| `src/routes/` | 🟢 Agrupado por dominio (AI/Compliance/Emergency/Health/Operations/Risk/Training) | Ninguno |
| `src/server/routes/sprintK.ts` | 🔴 **MONOLITO 13230 líneas + bad merges** | TODOS los endpoints Sprint K aquí — refactor obligatorio |
| `src/hooks/useSprintK.ts` | 🔴 **MONOLITO 3600 líneas + bad merges** | TODOS los hooks Sprint K aquí — refactor obligatorio |
| Sidebar | 🟡 Tiene entradas pero faltan submenús | Reorganizar agrupando por dominio |
| Zettelkasten integration | 🟡 `useZettelkastenIntegration` existe pero no todos los features lo usan | Cablear donde aplique |

---

## Plan de migración por dominio (estructura objetivo)

Cada dominio Sprint K se reorganiza así:

```
src/services/{domain}/                       # YA EXISTE — lógica pura
  {domain}Service.ts                         # service principal
  {domain}Service.test.ts                    # tests
  ...

src/server/routes/{domain}.ts                # NUEVO o YA EXISTE — endpoints HTTP
                                              # (NO en sprintK.ts monolito)

src/hooks/use{Feature}.ts                    # NUEVO — hook cliente
                                              # (NO en useSprintK.ts monolito)

src/pages/{Feature}.tsx                      # YA EXISTE — UI
src/pages/{Feature}.test.tsx                 # tests UI

src/routes/{Group}Routes.tsx                 # YA EXISTE — wire Route<lazy(...)>
src/components/Sidebar/SidebarItems.ts       # NUEVO o YA EXISTE — agrupación menú

src/services/zettelkasten/families/          # YA EXISTE — nodos ZK
  {domain}NodeFactory.ts                     # NUEVO si feature genera/consume nodos
```

---

## Tabla maestra Sprint K (270+ items agrupados por dominio funcional)

> Leyenda Estado:
> - 🟢 **Implementado correctamente** (service + page + route + sidebar)
> - 🟡 **Implementado en monolito** (debe migrarse a su carpeta de dominio)
> - 🟠 **Implementado parcial** (servicio sí, falta wire UI o ruta)
> - ⚪ **No implementado** (sin código aún)
> - 🔴 **Bloqueado** por input externo (keystores, cuentas, secrets)
> - ⏭ **Descartado** por directiva usuario

> Leyenda Factibilidad: ⭐ Trivial · ⭐⭐ Fácil · ⭐⭐⭐ Medio · ⭐⭐⭐⭐ Difícil · ⭐⭐⭐⭐⭐ Multi-mes

---

### 🧑 Dominio: Personal, Acceso, Aprendizaje

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | PR/Notas |
|---|---|---|---|---|---|
| §23-24 | Control visitas + inducción QR | 🟡 → 🟢 | `services/visitorControl/` + `pages/Visitors.tsx` + `server/routes/visitorControl.ts` (NEW) + menú Personal>Visitas + ZK: link Worker | ⭐⭐ | PR #350 mergeado en monolito; migrar endpoint a ruta propia |
| §26 | Evaluación previa tarea crítica | ⚪ | `services/criticalControls/` (existe) + `pages/PreTaskValidation.tsx` (NEW) + ruta `routes/RiskRoutes.tsx` + ZK: link Task→Control | ⭐⭐⭐ | Existe `criticalControlsLibrary` (Sprint I.2); falta UI |
| §244-250 | Aprendices + mentoría + autorización progresiva + exposición + rotación + repetitivo + EP | 🟡 → 🟢 | `services/apprenticeship/` (existe) + `pages/Apprenticeship.tsx` (existe) + `server/routes/apprenticeship.ts` (NEW, ahora en sprintK) + ZK: link Worker→Mentor | ⭐⭐⭐ | PR #337 mergeado en monolito con bad merges. **Crítico: migrar** |
| §251-257 | Datos médicos sensibles + reintegro + restricciones por tarea + carga mental + nocturno + sueño | ⚪ | `services/medical/` + `pages/MedicalSensitive.tsx` (NEW) + ZK: link Worker→Aptitude + ADR 0012 (no diagnóstico) | ⭐⭐⭐⭐ | Bloqueado por Health Vault wire (ADR 0012) |
| §59 | Control de charlas por tema | ⚪ | `services/training/` (existe) + `pages/TalkLog.tsx` (NEW) + reusar `talkTopicSuggester` (Sprint J) | ⭐⭐ | |
| §85-89 | Aprendizaje post-capacitación + repetición espaciada + casos reales | ⚪ | `services/spacedRepetition/` (NEW) + `pages/SpacedRepetition.tsx` + ZK: link Training→Worker | ⭐⭐⭐ | Perdido en reboot, re-implementar |

---

### 🦺 Dominio: EPP y Controles de Ingeniería

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §42-44 | Inventario controles ingeniería + jerarquía ISO 31000 + auditoría calidad EPP | 🟡 → 🟢 | `services/engineeringControls/` (existe) + `pages/EngineeringControls.tsx` (existe) + `server/routes/engineeringControls.ts` (NEW) | ⭐⭐ | PR #319 mergeado; migrar endpoint |

---

### 📚 Dominio: Capacitación y Conocimiento

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §97-99 | Glosario + FAQ + feedback utilidad | ⚪ | `services/glossary/` (NEW) + `pages/Glossary.tsx` (NEW) + integración Coach IA (`coach/`) | ⭐⭐ | Perdido en reboot |
| §105 | PYME Wizard rápido | ⚪ | `services/pymeWizard/` (NEW) + `pages/PymeWizard.tsx` (NEW) + flujo onboarding | ⭐⭐⭐ | Perdido en reboot |
| §109-112 | Plantillas industria + diagnóstico madurez + plan 30d + migración papel | ⚪ | `services/industryRules/` (existe — Sprint J) + `pages/IndustryDiagnostic.tsx` (NEW) | ⭐⭐⭐ | |
| §185-190 | Knowledge Base + Curador + Obsolescencia + reutilización + pack supervisor + resumen reunión | 🟡 → 🟢 | `services/knowledgeBase/` (existe) + `pages/KnowledgeBase.tsx` (existe) + `server/routes/knowledgeBase.ts` (NEW) + ZK: link KnowledgeNode→Worker | ⭐⭐ | PR #324 mergeado; migrar |

---

### ⚠️ Dominio: Riesgos e Incidentes

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §191-194 | Modo investigación causa raíz + árbol visual + comparador + detector control fallido | ⚪ | `services/rootCause/` (existe — Sprint I.3) + `pages/RootCauseWizard.tsx` (NEW) + reusar `controlComparator/` (existe) | ⭐⭐⭐⭐ | Acopla con Sprint I.3 ya cerrado |
| §214-215 | Observaciones positivas + balance positivo/correctivo | 🟡 → 🟢 | `services/positiveObservations/` (existe) + `pages/PositiveObservations.tsx` (existe) + `server/routes/positiveObservations.ts` (NEW) + ZK: link Worker→Observation | ⭐⭐ | PR #320 mergeado; migrar |
| §296-301 | Riesgo Residual + Aceptación Formal + Criticidad Sospechosa | 🟡 → 🟢 | `services/residualRisk/` (existe) + `pages/ResidualRisk.tsx` (existe) + `server/routes/residualRisk.ts` (NEW) + ZK: link Risk→ControlMeasure | ⭐⭐ | PR #329 mergeado; migrar |
| **F.13** | Repeating Risks Radar | 🟡 → 🟢 | `services/riskRadar/` (existe) + `pages/RepeatingRisks.tsx` (existe) + `server/routes/riskRadar.ts` (NEW) | ⭐⭐ | PR #312 mergeado; migrar |
| **F.14** | Mapa Calor Hallazgos | 🟡 → 🟢 | `services/findingsHeatmap/` (NEW) + `pages/FindingsHeatMap.tsx` (existe) + `server/routes/findingsHeatmap.ts` (NEW) + reusar Mapbox | ⭐⭐⭐ | PR #352 mergeado; migrar |
| **F.29** | Incident Trends + Leading Indicators (regresión lineal + sparkline) | 🟡 → 🟢 | `services/incidentTrends/` (NEW) + `pages/IncidentTrends.tsx` (existe) + `server/routes/incidentTrends.ts` (NEW, ahora en sprintK con bad merge) | ⭐⭐⭐ | PR #336 mergeado con bad merge. **Crítico: migrar** |

---

### 🚧 Dominio: Maquinaria, LOTO, Permisos

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §31-32 | Registro energías peligrosas + LOTO digital | ⚪ | `services/loto/` (NEW) + `pages/Loto.tsx` (NEW) + integrar con `workPermits/` existente + ZK: link Equipment→Lockout | ⭐⭐⭐ | Crítico industria minería/eléctrica |
| **F.15** | Centro Permisos Trabajo (altura/caliente/confinado/LOTO/excavación/izaje crítico) | 🟡 → 🟢 | `services/workPermits/` (existe) + `pages/WorkPermits.tsx` (existe) + `server/routes/workPermits.ts` (NEW) + ZK: link Task→Permit | ⭐⭐⭐ | PR #318 mergeado; migrar |
| **F.16** | Score Preparación Trabajador (no-bloqueante) | 🟡 → 🟢 | `services/workerReadiness/` (existe) + `pages/WorkerReadiness.tsx` (existe) + `server/routes/workerReadiness.ts` (NEW) | ⭐⭐ | PR #315 mergeado; migrar |
| **F.20** | Gestor Simulacros | 🟡 → 🟢 | `services/drillsManager/` (existe) + `pages/DrillsManager.tsx` (existe) + `server/routes/drillsManager.ts` (NEW) | ⭐⭐⭐ | PR #316 mergeado; migrar |
| **F.21** | Panel Riesgo Pre-Turno (weather+workers+tasks+equipment+brigade+permits) | 🟡 → 🟢 | `services/shiftRiskPanel/` (existe) + `pages/PreShiftRisk.tsx` (existe — verificar) + `server/routes/preShiftRisk.ts` (NEW) | ⭐⭐⭐ | PR #311 mergeado; migrar |

---

### 📄 Dominio: Documentos y Firmas

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §261-270 | Constructor checklists + campos condicionales + validación evidencia + puntuación + plantillas + firma múltiple + exportación legal + bloqueo edición + rectificaciones + modo mutualidad | ⚪ | `services/checklistBuilder/` (existe) + `pages/ChecklistBuilder.tsx` (NEW) + reusar `documents/legalDocTemplates.ts` (existe) + Zettelkasten link Checklist→Task | ⭐⭐⭐⭐ | Trabajo grande pero base existe |
| **F.5** | Firma QR Recepción (HMAC + biometría) | 🟡 → 🟢 | `services/qrSignature/` (existe) + `pages/QRSignature.tsx` (NEW) + `server/routes/qrSignature.ts` (NEW) | ⭐⭐⭐ | PR #313 mergeado; migrar + crear página |
| **F.6** | Modo Sin Señal Inspecciones (offline-first) | 🟡 → 🟢 | `services/inspections/` (existe) + `pages/OfflineInspection.tsx` (existe) + `server/routes/offlineInspection.ts` (NEW) + reusar `genericOutboxEngine` | ⭐⭐⭐ | PR #322 mergeado; migrar |
| **F.7** | Minuta CPHS Automática (DS 54 art. 24) | 🟡 → 🟢 | `services/cphs/` (existe) + `pages/CphsMinute.tsx` (NEW) + reusar `cphsMinuteAutogenerator.ts` + `server/routes/cphs.ts` (existe?) | ⭐⭐⭐ | PR #317 mergeado; migrar |
| **F.18** | Historial Profesional Portátil (Ley 19.628 consent) | 🟡 → 🟢 | `services/portableHistory/` (NEW) + `pages/WorkerPortableHistory.tsx` (existe) + `server/routes/portableHistory.ts` (NEW, ahora en sprintK con bad merge) + ZK: link Worker→AllHistory | ⭐⭐⭐⭐ | PR #338 mergeado con bad merge. **Crítico: migrar** |
| **F.24** | Custody Chain | 🟡 → 🟢 | `services/custodyChain/` (existe — Sprint J) + `pages/CustodyChain.tsx` (existe) + `server/routes/custodyChain.ts` (NEW) | ⭐⭐⭐ | Sprint J cerrado servicio puro; falta wire |
| **F.25** | PIN Sign | ⚪ | `services/pinSign/` (NEW) + componente reusable | ⭐⭐ | Para firmar sin biometría en faena |

---

### ⚖️ Dominio: Cumplimiento Legal Específico

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §195-200 | PDCA + No Conformidades (ISO 45001 §10.2) | 🟡 → 🟢 | `services/pdca/` (existe) + `pages/PdcaModule.tsx` (existe) + `server/routes/pdca.ts` (NEW) | ⭐⭐⭐ | PR #325 mergeado; migrar |
| §211-213 | Reportes Confidenciales / Ley Karin 21.643 (3-layer anonimato + retaliation detector) | 🟡 → 🟢 | `services/confidentialReports/` (existe) + `pages/ConfidentialReports.tsx` (existe) + `server/routes/confidentialReports.ts` (NEW, ahora en sprintK con bad merge) | ⭐⭐⭐⭐ | PR #332 mergeado con bad merge. **Crítico: migrar** |
| §229-236 | Residuos + manifiestos + ESG + permisos ambientales + alertas externas | ⚪ | `services/environmental/` (NEW) + `pages/Environmental.tsx` (NEW) + ZK: link Site→Waste | ⭐⭐⭐⭐ | Importante en minería/química |
| §291-295 | Annual SGI Review (ISO 45001 §9.3) | 🟡 → 🟢 | `services/annualReview/` (existe) + `pages/AnnualReview.tsx` (existe) + `server/routes/annualReview.ts` (NEW) | ⭐⭐⭐ | PR #327 mergeado; migrar |

---

### 🚨 Dominio: Emergencias y Crisis

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §74-78 | Brigada emergencia + recursos (extintores/AED/eyewash) + mapa + QR puntos | 🟡 → 🟢 | `services/emergencyBrigade/` (existe) + `pages/EmergencyBrigade.tsx` (existe) + `server/routes/emergencyBrigade.ts` (NEW) + ZK: link Site→Resource | ⭐⭐⭐⭐ | PR #321 mergeado; migrar |
| §216-221 | Mapa comunicación + escalamiento + contactabilidad + prueba mensual + radios + plan B | ⚪ | `services/commsDrill/` (existe) + `pages/CommsDrill.tsx` (NEW) + ZK: link Worker→Contact | ⭐⭐⭐ | Acopla con simulacros F.20 |

---

### 🚗 Dominio: Operaciones de Terreno

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §69-71 | Conducción Segura + Rutas Críticas + Alertas | 🟡 → 🟢 | `services/drivingSafety/` (NEW) + `pages/DrivingSafety.tsx` (existe) + `server/routes/drivingSafety.ts` (NEW) | ⭐⭐⭐ | PR #331 mergeado en monolito; migrar |
| §222-228 | Rutas alternativas + validación + señalética + mapa + detector faltante + 5S + ranking | ⚪ | `services/sitePlanning/` (NEW) + integrar con `commsDrill/` | ⭐⭐⭐ | |
| §237-243 | Continuidad operacional + punto único falla + simulador escenario + sustitución personal + polivalencia + plan capacitación brecha | 🟠 | `services/continuity/` (existe) + `pages/Continuity.tsx` (NEW) + reusar `criticalRoles/` (existe) | ⭐⭐⭐⭐ | Servicio existe, falta wire UI |
| §258-260 | Clima laboral preventivo + carga administrativa + automatizador admin | 🟠 | `services/adminBurden/` (existe) + `pages/AdminBurden.tsx` (NEW) | ⭐⭐⭐ | |

---

### 📊 Dominio: Cultura y Engagement

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §61-63 | Encuesta percepción + índice cultura + reconocimiento (Culture Pulse) | 🟡 → 🟢 | `services/culturePulse/` (existe) + `pages/CulturePulse.tsx` (NEW — verificar) + `server/routes/culturePulse.ts` (NEW) + anonimato n<5 by design | ⭐⭐⭐ | PR #323 mergeado; migrar |
| **F.12** | Biblioteca Lecciones Aprendidas (LESSON nodes navegables) | 🟡 → 🟢 | `services/lessonsLearned/` (existe) + `pages/LessonsLearned.tsx` (existe — verificar) + `server/routes/lessonsLearned.ts` (NEW) + ZK: LESSON nodes son first-class | ⭐⭐⭐ | PR #310 mergeado; migrar |
| **F.26** | Índice Madurez Preventiva (1-5: Reactivo→Autónomo) | 🟡 → 🟢 | `services/maturity/` (existe) + `pages/MaturityIndex.tsx` (existe) + `server/routes/maturity.ts` (NEW) | ⭐⭐⭐ | PR #314 mergeado; migrar |

---

### 🏆 Dominio: Liderazgo y Decisiones

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §276-277 | Bitácora decisiones supervisión + ranking impacto | 🟡 → 🟢 | `services/leadership/` (existe) + `pages/LeadershipDecisions.tsx` (existe) + `server/routes/leadership.ts` (NEW) | ⭐⭐ | PR #328 mergeado; migrar |
| §131-138 | Cierre proyecto + lecciones transferibles + decisiones críticas + resúmenes multi-rol + multi-lenguaje | 🟡 → 🟢 | `services/projectClosure/` (NEW) + `pages/ProjectClosure.tsx` (existe) + `server/routes/projectClosure.ts` (NEW) + acopla con F.12 lessons | ⭐⭐⭐⭐ | PR #330 mergeado; migrar |

---

### 🤖 Dominio: IA, Coach, Guardrails

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §155-160 | Guardrails IA + prompts versionados + regresión + dataset eval + control alucinaciones + citas | 🟠 | `services/aiGuardrails/` (existe — `hallucinationGuard.ts`) + `pages/AiGuardrailsAdmin.tsx` (NEW) + Coach citation discreta (directiva 4) | ⭐⭐⭐⭐ | PR #348 cerró parcial; verificar gaps |
| §161-163 | Modo sin IA + IA local (SLM) + drift reglas | 🟠 | `services/aiToggle/` (existe?) + `services/slm/` (existe) + `pages/AiToggle.tsx` (NEW) | ⭐⭐⭐⭐ | Acopla con `resilientAiOrchestrator` 5-tier (TODO.md §7) |
| §104 | Panel Confianza Datos (calidad pre-IA) | 🟡 → 🟢 | `services/dataConfidence/` (existe) + `pages/DataConfidence.tsx` (existe) + `server/routes/dataConfidence.ts` (NEW, ahora en sprintK con bad merge) | ⭐⭐⭐ | PR #333 mergeado con bad merge. **Crítico: migrar** |

---

### 💰 Dominio: Pricing, Comercial, Adopción

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §116 | Sugerencias upsell por dolor real | ⚪ | `services/upsell/` (existe?) + integración con `PremiumFeatureGuard` | ⭐⭐ | Reusar tier-evaluation |
| §164-170 | Adopción módulos + embudo conversion + churn + onboarding por rol + first value + venta consultiva | 🟠 | `services/adoption/` (existe) + `services/consultativeSale/` (existe) + `pages/AdoptionFunnel.tsx` (NEW) | ⭐⭐⭐⭐ | |
| §171-179 | Pricing calculadora + simulador + overages + facturación + costos + ROI + presupuesto EPP + OC sugerida | 🟡 → 🟢 | `services/pricing/` (existe) + `pages/PricingCalculator.tsx` (existe) + `pages/OcSugerida.tsx` (existe) + `server/routes/pricing.ts` (NEW) | ⭐⭐⭐ | PR #354 mergeado en monolito; migrar. **H21**: OC PDF formal pendiente |
| §180-184 | Proveedores + evaluación + recomendado + servicios críticos + SLA | ⚪ | `services/contractors/` (existe) + `services/suppliers/` (existe) + `pages/SupplierManagement.tsx` (NEW) | ⭐⭐⭐ | Servicio Sprint J cerrado |

---

### 📈 Dominio: Reportes y Analítica

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §90-91 | KPI contratistas + ranking riesgo contratistas | 🟡 → 🟢 | `services/contractors/` (existe) + `services/suppliers/` + `pages/SupplierQuality.tsx` (existe) + `server/routes/suppliers.ts` (NEW) | ⭐⭐ | PR #326 mergeado; migrar |
| §119-120 | Reporte mensual cliente + alertas reputacional | 🟠 | `services/clientReporting/` (existe) + `pages/MonthlyClientReport.tsx` (NEW) + `server/routes/clientReporting.ts` (NEW) | ⭐⭐⭐ | Servicio existe, falta UI |

---

### 🗂️ Dominio: Datos, Auditoría, Privacidad

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §121-128 | Privacidad PII + datos médicos separados + consentimiento + retención | 🟠 | `services/privacy/` (existe) + `services/medical/` (existe) + ADR 0012 health vault | ⭐⭐⭐⭐⭐ | Compliance Ley 19.628 + GDPR multi-jurisdicción |
| §146-150 | Panel salud sistema + prueba campo + reintentos + conflictos offline | 🟠 | `services/observability/` + `pages/SystemHealth.tsx` (NEW) | ⭐⭐⭐ | Reusar sentry + resilience cron |
| §151-154 | Eventos dominio auditables + replay + snapshots mensuales | 🟠 | `services/cqrs/` (existe) + `services/eventStore/` (existe) + `pages/EventReplay.tsx` (NEW) | ⭐⭐⭐⭐ | Reusar `incidentReadModel` ya cerrado |
| §201-210 | Agenda + bloques foco + recordatorios + preferencias + digests + escalamiento + SLA cierre | 🟠 | `services/agenda/` (existe) + `pages/Agenda.tsx` (NEW) — PR #349 hizo focus blocks core | ⭐⭐⭐⭐ | Parcial; faltan recordatorios + escalation |

---

### 📥 Dominio: Importación y Constructor

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §106-108 | Importador Excel + validador + deduplicador | 🟡 → 🟢 | `services/excelImporter/` (NEW) + `services/deduplication/` (existe) + `pages/ExcelImporter.tsx` (existe) + `server/routes/excelImporter.ts` (NEW) | ⭐⭐⭐ | PR #351 mergeado en monolito; migrar. **Causa H1 lockfile** |

---

### ♿ Dominio: UI/UX y Accesibilidad

| ID | Descripción | Estado | Ubicación correcta | Factibilidad | Notas |
|---|---|---|---|---|---|
| §139-145 | Modos lectura fácil + alto contraste + guantes + baja conectividad + batería + bundle perf | 🟡 → 🟢 | `services/uxModes/` (existe) + `contexts/UxModeContext.tsx` (NEW) + integración global | ⭐⭐⭐ | PR #353 mergeado en monolito; migrar |

---

### 🔧 Dominio: Wire UI Cards (Sprint K/L servicios puros sin UI)

> Estos servicios YA existen como puros (Sprint A-J + K mergeado), pero les falta su componente UI consumidor. Migración: crear componente o página.

| ID | Servicio | UI requerida | Estado |
|---|---|---|---|
| Sprint G | `readReceiptService` | `<DocumentReadConfirmModal />` | ⚪ |
| Sprint G | `exceptionEngine` | `<ExceptionRequestModal />` + Inbox card | ⚪ |
| Sprint G | `consistencyAuditor` | Inbox card "Inconsistencias detectadas" | ⚪ |
| Sprint G | `aiAuditLog` | Banner "Esta es sugerencia IA, registrada" | ⚪ |
| Sprint G | `faenaStateEngine` | `<FaenaStateBanner />` en Dashboard | ⚪ |
| Sprint G | `hazmatInventory` | `<HazmatStorageManager />` | ⚪ |
| Sprint G | `exposureRegistry` | `<ExposureLogForm />` (técnico) | ⚪ |
| Sprint G | `restrictedZonesEngine` | overlay en mapa + `<ZoneEntryGate />` | ⚪ |
| Sprint G | `loneWorkerService` | check-in widget mobile + admin dashboard | ⚪ |
| Sprint G | `evacuationHeadcount` | `<EvacuationDashboard />` + QR scanner | ⚪ |
| Sprint G | `faenaOnboardingBundle` | `<OnboardingChecklist />` + mandante review UI | ⚪ |
| Sprint H | `externalAuditPortal` | `<PortalManager />` (admin) + portal público | ⚪ |
| Sprint H | `siteBookService` | `<SiteBookViewer />` + `<NewEntryForm />` | ⚪ |
| Sprint H | `syncQueueTracker` | badge en header + Centro Sincronización | ⚪ |
| Sprint I | `stoppageEngine` | `<StoppageBanner />` + reanudación modal | ⚪ |
| Sprint I | `criticalControlsLibrary` | `<PreTaskValidationModal />` (terreno mobile) | ⚪ |
| Sprint I | `rootCauseClassifier` | `<RootCauseWizard />` en investigación incidentes | ⚪ |
| Sprint I | `fatigueMonitor` | tarjeta dashboard worker + bloqueo soft | ⚪ |
| Sprint I | `equipmentQrService` | `<PreUseChecklistMobile />` + QR scanner | ⚪ |
| Sprint I | `riskRankingEngine` | `<TopRisksWidget />` + `<WeakControlsWidget />` | ⚪ |
| Sprint J | `industryRuleEngine` | wizard onboarding nuevo proyecto | ⚪ |
| Sprint J | `legalObligationsCalendar` | `<LegalCalendarView />` + reminders | 🟠 |
| Sprint J | `preventionCostCalculator` | `<CostSimulator />` (módulo gerencia) | 🟠 |
| Sprint J | `roleViewBuilder` | reemplaza/extiende Dashboard actual | 🟠 |
| Sprint J | `talkTopicSuggester` | tarjeta "Sugerido para hoy" en supervisor | ⚪ |
| Sprint J | `operationalChangeService` | `<ChangeDeclarationForm />` + ack flow | ⚪ |
| Sprint J | `custodyChainService` | hooks en upload de evidencias | ⚪ |
| Sprint J | `shiftHandoverService` | `<ShiftHandoverPanel />` cambio turno | ⚪ |

---

### ⏭️ Descartado por directiva usuario

| Item | Razón |
|---|---|
| Vertex AI Trainer custom | Solo tier mega-enterprise; mantener stub o documentar oficial |
| Stripe | Reemplazado por Transbank/Webpay + MercadoPago + Google Play |
| Push automático SUSESO/SII/MINSAL/OSHA | Empresa firma+entrega manualmente |
| Bloqueo de maquinaria | Solo recomendar científicamente |
| Generación dinámica rutas A* por LLM | Reemplazada por A* determinista |
| Fatiga humana → reasignar tareas automáticamente | Solo notificar al supervisor |

---

## Resumen ejecutivo

**Estado actual estimado:**
- ~30 features ya implementadas EN MONOLITO 🟡 (necesitan migración a su carpeta de dominio)
- ~25 servicios puros existentes SIN UI ⚪ (necesitan wire UI)
- ~20 features no implementadas ⚪ (necesitan implementación + ubicación correcta)
- ~10 features parciales 🟠
- ~6 features descartadas oficialmente ⏭

**Volumen de trabajo:**
- **Migración monolito** (30 features × ~1h cada): ~30 horas → repartir en 5-7 PRs por dominio
- **Wire UI servicios puros** (25 × ~1 día cada): ~5 semanas
- **Implementar items nuevos** (20 × variable): 3-6 meses

**Patrón de migración por feature:**
```
Para cada feature 🟡 (en monolito):
  1. Crear src/server/routes/{domain}.ts con endpoints del feature
  2. Crear src/hooks/use{Feature}.ts con hook cliente
  3. Eliminar del sprintK.ts + useSprintK.ts
  4. Verificar page existente
  5. Verificar entrada Sidebar (agregar submenú si aplica)
  6. Agregar test contractual
  7. Verificar Zettelkasten integration si aplica
  8. Commit atómico + push + CI verde
```

**Orden recomendado de migración** (priorizar los 5 que rompen typecheck por bad merges):
1. **incident-trends** (F.29) — más simple, romper monolito por aquí
2. **data-confidence** (§104) — acopla con `dataConfidence/` ya existente
3. **portable-history** (F.18) — Ley 19.628 crítico
4. **confidential-reports** (§211-213) — Ley Karin crítico
5. **apprentices+mentors** (§244-250) — más complejo de los 5

**Después de los 5 críticos**, continuar por dominio:
6. Domain Riesgos (5 features Sprint K)
7. Domain Compliance (4 features)
8. Domain Personal (3 features)
9. ... etc.

---

## Próximos pasos

1. **Validar este documento con el usuario** (PRÓXIMA RESPUESTA).
2. Si aprueba: crear branch dedicada `refactor/sprint-k-migrate-domain-{N}` por dominio.
3. Primera migración: incident-trends (F.29) como prueba de patrón.
4. Cada migración → PR atómico → CI verde → merge → siguiente.
5. Después de migrar los 5 críticos, el monolito sprintK.ts pierde su razón de ser y se elimina gradualmente.
6. Features ⚪ no implementados se agendan según prioridad ROI / criticidad legal / facilidad técnica.

---

*Documento generado por Claude durante la sesión 2026-05-17 tras la corrección del usuario sobre la naturaleza arquitectónica de Sprint K. Es el plan ejecutable del refactor, NO un cambio de código en sí.*
