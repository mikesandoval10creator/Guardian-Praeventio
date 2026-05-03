# ZETTELKASTEN V2 — Especificación de Arquitectura del Grafo de Conocimiento

> Documento creado: 2026-05-02 | Branch: `dev/zettelkasten-archeology-multi-week`
> Estado: spec normativa — guía las Sprints 9 a 15.
> Autoridad: este documento gobierna las decisiones de schema. Las desviaciones requieren ADR adjunto.

---

## 1. VISIÓN Y PRINCIPIOS

Guardian Praeventio modela su conocimiento como un **grafo dirigido bidireccional con aristas tipadas y nodos discriminados**. Esta sección justifica por qué un grafo (no una BD relacional, no un vector store) y enuncia los invariantes que toda implementación debe respetar.

### 1.1 Por qué grafo

- **DB relacional**: las relaciones OHS son n-a-m con semántica heterogénea (un EPP `mitiga` un riesgo, `requiere` certificación, `regula_por` norma). Las JOINs explotan combinatoria.
- **Vector store puro**: excelente para similitud semántica, malo para causalidad ("¿qué causó este near-miss?"). Lo conservamos como índice secundario para búsqueda fuzzy de descripciones, no como almacenamiento primario.
- **Grafo tipado**: cada nodo es una unidad atómica de conocimiento; cada arista codifica una relación operativa o normativa. El recorrido del grafo (BFS, DFS, shortest path) **es** el razonamiento del Asesor antes de invocar al LLM.

### 1.2 Invariantes inmutables

1. **Bidireccionalidad obligatoria**. Toda arista `causes` tiene su recíproca `caused_by` automática. La capa de persistencia denormaliza ambas direcciones para evitar lecturas O(N).
2. **Auto-coupling como columna vertebral**. Cada módulo productor (climateRiskCoupling, bernoulliEngine, IPER, VisionAnalyzer, ergonomic-assessment) **debe** emitir nodos vía la API canónica. Cada módulo consumidor (RiskNetwork, ask-guardian, EmergenciaAvanzada) **debe** consultar via la query interface (§5), nunca leer documentos sueltos.
3. **Productor + consumidor**. Ningún módulo es solo productor: aun el motor Bernoulli consume (lee `project.workTypes`, lee sensores IoT) antes de producir.
4. **Privacidad por aislamiento de tenant**. Los nodos viven bajo `tenants/{tenantId}/zettelkasten_nodes/{nodeId}`. Las Firestore rules garantizan que ningún read cruza tenants, ni siquiera para usuarios con rol `general`.
5. **Determinismo de los productores**. Los servicios que emiten nodos son funciones puras (ver `[climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts:8)`). El IO (Firestore write) ocurre en una capa adapter, fuera del módulo de coupling.

---

## 2. TAXONOMÍA DE TIPOS DE NODOS — 512 tipos en 8 familias

Total objetivo: **512 tipos**. Estado: 320 implementados via servicios actuales; 60 por entregar en Sprint 9 desde `[BERNOULLI_EXTENSIONS.md](BERNOULLI_EXTENSIONS.md)`; 132 derivados (familias OHS, Personal, Events, Assets, Workflow, AI).

```ts
// src/services/zettelkasten/nodeTypes.ts (a crear)
export type NodeType =
  // 1. CLIMATE & ENVIRONMENT (50)
  | 'climate-risk' | 'venturi-warning' | 'windload-warning'
  | 'seismic-event' | 'seismic-aftershock-window' | 'lightning-strike-proximate'
  | 'uv-extreme-window' | 'cold-snap-window' | 'heat-wave-window'
  | 'air-quality-pm10' | 'air-quality-pm25' | 'air-quality-co'
  | 'air-quality-so2' | 'air-quality-no2' | 'air-quality-o3'
  | 'volcanic-ash-fallout' | 'tsunami-warning' | 'flood-watch'
  | 'wildfire-proximity' | 'snowfall-event' | 'hail-event'
  | 'fog-low-visibility' | 'humidity-extreme' | 'pressure-anomaly-baro'
  | 'altitude-hypoxia-risk' | 'wind-funnel-topographic' | 'gas-dispersion-plume'
  | 'plume-zone-red' | 'plume-zone-orange' | 'plume-zone-yellow'
  | 'piezometer-anomaly' | 'seepage-zone' | 'slope-instability'
  | 'soil-moisture-saturation' | 'frost-heave-zone' | 'glacier-retreat-marker'
  | 'river-flood-stage' | 'tide-extreme' | 'storm-surge'
  | 'dust-storm-event' | 'sandstorm-event' | 'icefall-zone'
  | 'rockfall-zone' | 'avalanche-corridor' | 'lahar-corridor'
  | 'sinkhole-detected' | 'permafrost-thaw' | 'ozone-depletion-local'
  | 'noise-environmental' | 'vibration-environmental' | 'em-field-anomaly'

  // 2. PHYSICS & FLUIDS (60) — 15 use cases × 4 nodos hijos cada uno
  // A.1 Hidrantes: q-din / dp-static / Q-flow / alert
  | 'hydrant-q-dynamic' | 'hydrant-dp-static' | 'hydrant-q-flow' | 'hydrant-alert'
  // A.2 Misting / dust suppression
  | 'misting-q-dynamic' | 'misting-dp-static' | 'misting-q-flow' | 'misting-alert'
  // A.3 Cubierta succión (uplift) — extiende windload-warning
  | 'uplift-q-dynamic' | 'uplift-dp-static' | 'uplift-q-flow' | 'uplift-alert'
  // A.4 HVAC confinado
  | 'hvac-q-dynamic' | 'hvac-dp-static' | 'hvac-q-flow' | 'hvac-alert'
  // A.5 Fugas gas industrial
  | 'gasleak-q-dynamic' | 'gasleak-dp-static' | 'gasleak-q-flow' | 'gasleak-alert'
  // B.6 Venturi mina
  | 'mineventuri-q-dynamic' | 'mineventuri-dp-static' | 'mineventuri-q-flow' | 'mineventuri-alert'
  // B.7 Tuberías hazmat
  | 'hazmatpipe-q-dynamic' | 'hazmatpipe-dp-static' | 'hazmatpipe-q-flow' | 'hazmatpipe-alert'
  // B.8 Cargas viento estructuras
  | 'windload-q-dynamic' | 'windload-dp-static' | 'windload-q-flow' | 'windload-alert'
  // B.9 Respiradores NIOSH
  | 'respirator-q-dynamic' | 'respirator-dp-static' | 'respirator-q-flow' | 'respirator-alert'
  // B.10 Ergonomía pulmonar altitud
  | 'altitude-resp-q-dynamic' | 'altitude-resp-dp-static' | 'altitude-resp-q-flow' | 'altitude-resp-alert'
  // C.11 Micro-eólica
  | 'microwind-q-dynamic' | 'microwind-dp-static' | 'microwind-q-flow' | 'microwind-alert'
  // C.12 Suelos / hidrostática evacuación
  | 'soilflow-q-dynamic' | 'soilflow-dp-static' | 'soilflow-q-flow' | 'soilflow-alert'
  // C.13 SLAM / digital twin
  | 'slamflow-q-dynamic' | 'slamflow-dp-static' | 'slamflow-q-flow' | 'slamflow-alert'
  // C.14 Diques / piezómetros
  | 'damflow-q-dynamic' | 'damflow-dp-static' | 'damflow-q-flow' | 'damflow-alert'
  // C.15 Dispersión gas Pasquill
  | 'plumeflow-q-dynamic' | 'plumeflow-dp-static' | 'plumeflow-q-flow' | 'plumeflow-alert'

  // 3. OHS & NORMATIVA (80) — solo enumeración crítica; las 80 son instancias normativas
  | 'norma-DS-54' | 'norma-DS-40' | 'norma-DS-76' | 'norma-DS-132'
  | 'norma-DS-594' | 'norma-DS-66' | 'norma-DS-43' | 'norma-DS-248'
  | 'norma-DS-144' | 'norma-DS-28' | 'norma-Ley-16744' | 'norma-ISO-45001'
  | 'norma-OHSAS-18001' | 'norma-NCh-432' | 'norma-NCh-1646' | 'norma-NCh-Elec-4'
  | 'norma-NIOSH-42-CFR-84' | 'norma-NFPA-14' | 'norma-NFPA-30' | 'norma-OSHA-1926-451'
  | 'norma-OSHA-1910-146' | 'norma-IEC-61400-2' | 'norma-Eurocodigo-7' | 'norma-Pasquill-Gifford'
  | 'norma-art' /* genérica: art X de norma Y */ | 'norma-resolucion-1500-SERNAGEOMIN'
  // ... 54 más se enumeran en src/services/zettelkasten/normaTypes.ts (registro plano)

  // 4. PERSONAL & EPP (50)
  | 'worker-profile' | 'worker-medical-clearance' | 'worker-altitude-clearance'
  | 'worker-confined-space-clearance' | 'worker-hot-work-permit' | 'worker-hv-electrical-permit'
  | 'epp-helmet' | 'epp-harness' | 'epp-respirator-half' | 'epp-respirator-full'
  | 'epp-respirator-papr' | 'epp-eye-protection' | 'epp-hearing-double' | 'epp-hearing-single'
  | 'epp-gloves-cut-A' | 'epp-gloves-chemical' | 'epp-boots-dielectric' | 'epp-boots-steel'
  | 'epp-flame-retardant' | 'epp-arc-flash' | 'epp-hi-vis' | 'epp-fall-arrest'
  | 'cert-iperc' | 'cert-altura' | 'cert-confinado' | 'cert-rigger'
  | 'cert-grua' | 'cert-soldador' | 'exam-audiometria' | 'exam-espirometria'
  | 'exam-vista' | 'exam-altura-geografica' | 'exam-musculo-esqueletico' | 'exam-psicosensometrico'
  | 'training-induccion' | 'training-charla-5min' | 'training-evacuacion'
  | 'fatigue-alert' | 'biometric-anomaly' | 'manual-handling-load'
  | 'epp-exposure-pairing' | 'epp-fit-test' | 'epp-replacement-due'
  | 'epp-stockout-warning' | 'epp-non-compliance-detected'
  | 'worker-vacation-window' | 'worker-shift-pattern' | 'worker-overtime-alert'
  | 'subcontractor-credential' | 'visitor-induction' | 'medical-emergency-contact'

  // 5. EVENTS & INCIDENTS (60)
  | 'man-down-event' | 'man-down-cancelled-by-user' | 'man-down-confirmed'
  | 'geofence-breach-entry' | 'geofence-breach-exit' | 'geofence-restricted-zone-violation'
  | 'near-miss' | 'first-aid-event' | 'lost-time-injury' | 'restricted-work-injury'
  | 'medical-treatment-injury' | 'fatality' | 'property-damage'
  | 'environmental-spill' | 'fire-event' | 'explosion-event'
  | 'electric-arc-event' | 'fall-from-height' | 'struck-by' | 'caught-in-between'
  | 'overexertion-event' | 'exposure-acute' | 'exposure-chronic-flag'
  | 'asphyxiation-risk-event' | 'crush-event' | 'cut-laceration'
  | 'burn-thermal' | 'burn-chemical' | 'burn-electrical'
  | 'gas-release-event' | 'lel-proximity-warning' | 'odor-anomaly-report'
  | 'noise-overexposure-event' | 'vibration-overexposure-event'
  | 'evacuation-triggered' | 'evacuation-completed' | 'shelter-in-place-triggered'
  | 'lockdown-triggered' | 'rescue-team-dispatched' | 'medevac-dispatched'
  | 'iper-finding' | 'iper-finding-closed' | 'iper-corrective-action-overdue'
  | 'audit-finding' | 'audit-non-conformity' | 'audit-observation'
  | 'inspection-pre-task' | 'inspection-equipment' | 'inspection-area'
  | 'permit-issued' | 'permit-revoked' | 'permit-expired'
  | 'stop-work-issued' | 'stop-work-lifted'
  | 'sif-precursor' /* serious-injury-fatality precursor */
  | 'lessons-learned-published' | 'safety-alert-broadcast'
  | 'incident-investigation-opened' | 'incident-investigation-closed'

  // 6. ASSETS & FAENA (80)
  | 'asset-grua-torre' | 'asset-grua-movil' | 'asset-grua-pluma' | 'asset-grua-puente'
  | 'asset-andamio-tubular' | 'asset-andamio-colgante' | 'asset-andamio-multidireccional'
  | 'asset-plataforma-elevadora' | 'asset-tijera' | 'asset-brazo-articulado'
  | 'asset-hidrante' | 'asset-bie' | 'asset-rociador' | 'asset-extintor'
  | 'asset-tanque-hazmat' | 'asset-tanque-combustible' | 'asset-tanque-glp'
  | 'asset-cilindro-gas' | 'asset-bombona-soldadura'
  | 'asset-tuberia-proceso' | 'asset-tuberia-incendio' | 'asset-ducto-ventilacion'
  | 'asset-bomba-centrifuga' | 'asset-compresor-aire' | 'asset-generador'
  | 'asset-tablero-electrico-bt' | 'asset-tablero-electrico-mt' | 'asset-tablero-electrico-at'
  | 'asset-transformador' | 'asset-ups' | 'asset-banco-baterias'
  | 'asset-camion-tolva' | 'asset-camion-cisterna' | 'asset-camion-pluma'
  | 'asset-cargador-frontal' | 'asset-bulldozer' | 'asset-excavadora'
  | 'asset-perforadora' | 'asset-jumbo' | 'asset-lhd'
  | 'asset-soldadora-arc' | 'asset-soldadora-mig' | 'asset-soldadora-tig'
  | 'asset-radial' | 'asset-taladro-percutor' | 'asset-sierra-circular'
  | 'sensor-iot-co' | 'sensor-iot-co2' | 'sensor-iot-h2s' | 'sensor-iot-o2'
  | 'sensor-iot-lel' | 'sensor-iot-pm25' | 'sensor-iot-pm10' | 'sensor-iot-noise'
  | 'sensor-iot-vibration' | 'sensor-iot-temperatura' | 'sensor-iot-humedad'
  | 'sensor-iot-presion' | 'sensor-iot-flujo' | 'sensor-iot-piezometro'
  | 'sensor-iot-uv' | 'sensor-iot-radiacion'
  | 'beacon-ble-mandown' | 'beacon-ble-geofence' | 'tag-rfid-asset' | 'tag-rfid-worker'
  | 'site-faena' | 'site-zona' | 'site-frente-trabajo' | 'site-acceso'
  | 'site-bodega' | 'site-comedor' | 'site-banos' | 'site-enfermeria'
  | 'site-sala-mando' | 'site-helipuerto' | 'site-punto-encuentro'
  | 'site-via-evacuacion' | 'site-zona-segura' | 'site-zona-restringida'
  | 'site-zona-explosion-atex' | 'site-zona-confinada-declarada'

  // 7. WORKFLOW & COMPLIANCE (80)
  | 'diat' | 'diep' /* enfermedad profesional */ | 'libro-obras-entry'
  | 'acta-cphs' | 'plan-evacuacion' | 'plan-emergencia' | 'plan-prevencion'
  | 'simulacro-evacuacion' | 'simulacro-incendio' | 'simulacro-rescate-confinado'
  | 'simulacro-derrame-quimico' | 'simulacro-medevac'
  | 'permit-trabajo-altura' | 'permit-trabajo-caliente' | 'permit-espacio-confinado'
  | 'permit-electrico-bt' | 'permit-electrico-mt-at' | 'permit-izaje-critico'
  | 'permit-excavacion' | 'permit-buceo' | 'permit-radiografia'
  | 'permit-trabajo-nocturno' | 'permit-aislamiento-loto'
  | 'matriz-iper' | 'matriz-aspectos-ambientales' | 'matriz-legal-aplicable'
  | 'procedimiento-trabajo-seguro' | 'instructivo-tarea' | 'estandar-operacional'
  | 'check-list-pre-uso' | 'check-list-cinco-pasos' | 'ats-analisis-trabajo-seguro'
  | 'auditoria-interna' | 'auditoria-externa' | 'certificacion-iso-45001'
  | 'certificacion-ohsas-18001' | 'mutual-rate-cotizacion'
  | 'denuncia-mutual' | 'investigacion-causa-raiz' | 'plan-accion-correctivo'
  | 'plan-accion-preventivo' | 'verificacion-eficacia-accion'
  | 'comunicado-cphs' | 'reglamento-interno' | 'rio-reglamento-interno-orden-higiene'
  | 'mof-manual-organizacion-funciones' | 'organigrama-prevencion'
  | 'comite-paritario-acta' | 'comite-paritario-eleccion' | 'comite-paritario-capacitacion'
  | 'derecho-saber' | 'derecho-saber-recibido' | 'odi-obligacion-informar'
  | 'capacitacion-anual-plan' | 'capacitacion-evidencia' | 'capacitacion-evaluacion'
  | 'kpi-tasa-frecuencia' | 'kpi-tasa-gravedad' | 'kpi-tasa-accidentabilidad'
  | 'kpi-cumplimiento-ipercs' | 'kpi-cumplimiento-charlas' | 'kpi-cumplimiento-inspecciones'
  | 'reporte-mensual-cphs' | 'reporte-mensual-mutual' | 'reporte-anual-superintendencia'
  | 'multa-recibida' | 'fiscalizacion-dt' | 'fiscalizacion-seremi'
  | 'fiscalizacion-sernageomin' | 'observacion-seremi' | 'orden-paralizacion'
  | 'levantamiento-paralizacion' | 'cierre-faena' | 'apertura-faena'
  | 'aviso-faena-dt' | 'aviso-faena-seremi'
  | 'contrato-trabajador' | 'finiquito-trabajador'
  | 'historial-medico-pre-ocupacional' | 'historial-medico-ocupacional'
  | 'historial-medico-egreso'

  // 8. AI & ANALYTICS (52)
  | 'ai-prediction-accident' | 'ai-prediction-equipment-failure' | 'ai-prediction-weather'
  | 'ai-prediction-fatigue' | 'ai-prediction-non-compliance'
  | 'ai-recommendation-epp' | 'ai-recommendation-stop-work' | 'ai-recommendation-training'
  | 'ai-recommendation-route' | 'ai-recommendation-control'
  | 'ai-alert-triggered' | 'ai-alert-acknowledged' | 'ai-alert-dismissed'
  | 'ai-alert-escalated' | 'ai-alert-false-positive-flag'
  | 'audit-trail-prompt' | 'audit-trail-response' | 'audit-trail-tool-call'
  | 'audit-trail-decision' | 'audit-trail-override-by-human'
  | 'rag-citation' | 'rag-chunk-retrieved' | 'rag-context-augmented'
  | 'env-context-snapshot' /* fetchEnvironmentContext output, ver §3 PARTE3 */
  | 'orchestrator-call-weather' | 'orchestrator-call-seismic' | 'orchestrator-call-aqi'
  | 'gran-maestro-output-json' /* JSON estricto causa_raiz/riesgos/plan_accion */
  | 'vision-detection-epp-present' | 'vision-detection-epp-missing'
  | 'vision-detection-posture-bad' | 'vision-detection-zone-intrusion'
  | 'vision-detection-fire' | 'vision-detection-smoke'
  | 'embedding-document' | 'embedding-incident-narrative' | 'embedding-image'
  | 'cluster-similar-incidents' | 'cluster-similar-near-misses'
  | 'anomaly-detection-sensor' | 'anomaly-detection-behavior' | 'anomaly-detection-shift'
  | 'forecast-accident-risk-7d' | 'forecast-fatigue-rolling-72h'
  | 'forecast-weather-coupled-risk' | 'forecast-seismic-aftershock'
  | 'model-drift-warning' | 'model-retrain-event' | 'model-version-deployed'
  | 'feature-flag-experiment' | 'a-b-test-cohort' | 'a-b-test-result';
```

**Nota de scope**: las 8 familias suman 512 cuando se cuentan las instancias normativas planas (§3) y las instancias de site/zona (§6). Para no inflar la unión TS, los registros normativos largos viven en `normaTypes.ts` como string-literal subtype (`norma-${string}`) con runtime guard.

### 2.1 Familia 1 — CLIMATE & ENVIRONMENT (50)

Productores principales: `[climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts:270)`, `orchestratorService.ts` (weather, seismic), `sensorIngest.ts` (a crear, sensores ambientales).

```ts
export interface ClimateNodeBase {
  type: 'climate-risk' | 'venturi-warning' | /* ...etc */ string;
  title: string;
  description: string;
  metadata: {
    forecastDateISO: string;
    lat?: number; lng?: number;
    sourceAdapter: 'openweather' | 'usgs' | 'iot-sensor' | 'manual';
    severity: 1 | 2 | 3 | 4 | 5;
  };
}
```

Nodos canónicos ya implementados: `climate-risk`, `venturi-warning`, `windload-warning` (ver `[climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts:74)`). Los 47 restantes se entregan en Sprint 10–11.

### 2.2 Familia 2 — PHYSICS & FLUIDS (60)

Cada uno de los 15 use cases de `[BERNOULLI_EXTENSIONS.md](BERNOULLI_EXTENSIONS.md)` genera **4 nodos hijos**:

- `*-q-dynamic` — presión dinámica `q = ½ρv²` calculada (Pa).
- `*-dp-static` — `ΔP` estático (Pa) entre dos puntos del sistema.
- `*-q-flow` — caudal `Q` volumétrico (m³/s).
- `*-alert` — discreto: bool de cruce de umbral + recomendación.

```ts
export interface PhysicsFluidNode extends ClimateNodeBase {
  metadata: ClimateNodeBase['metadata'] & {
    bernoulliFn: 'dynamicPressure' | 'staticPressureDelta' | 'venturiFlowRate'
                | 'windLoadOnSurface' | 'respiratorPressureDrop';
    inputs: Record<string, number>;
    output: { value: number; unit: 'Pa' | 'm3/s' | 'N' | 'kN' };
    threshold: { triggerAt: number; norma: string };
    exceedsThreshold: boolean;
  };
}
```

Los 4 hijos comparten un `parentBernoulliRunId` (UUID) para colapsarse visualmente como un grupo en RiskNetwork (§6).

### 2.3 Familia 3 — OHS & NORMATIVA (80)

```ts
export interface NormaNode {
  type: `norma-${string}`;
  title: string;
  metadata: {
    cuerpoLegal: string;
    articulo?: string;
    inciso?: string;
    pais: 'CL' | 'PE' | 'AR' | 'CO' | 'MX' | 'INTL';
    vigenteDesde: string;
    derogadoPor?: string;
    referenceUrl?: string;
  };
}
```

Las 80 instancias incluyen los 26 troncos enumerados en §2 (líneas TS arriba) + 54 artículos específicos (DS 594 Art. 32, 41, 53, 61, 65, 78, ...). Listado plano en `src/services/zettelkasten/normaRegistry.ts` (a crear).

### 2.4 Familia 4 — PERSONAL & EPP (50)

```ts
export interface WorkerNode {
  type: 'worker-profile' | /* ... */;
  metadata: {
    workerId: string;          // mapeo a /tenants/{t}/workers/{id}
    role: string;
    activeSiteIds: string[];
    medicalClearanceStatus: 'valid' | 'expiring' | 'expired';
  };
}

export interface EppNode {
  type: `epp-${string}`;
  metadata: {
    norma: string;             // ref a NormaNode
    standardCode?: string;     // ej. EN-388, EN-12568, NIOSH-N95
    expiryDate?: string;
  };
}
```

Stubeados (TS válido pero sin productor wired): `epp-fit-test`, `epp-replacement-due`, `subcontractor-credential` — entregables Sprint 13.

### 2.5 Familia 5 — EVENTS & INCIDENTS (60)

```ts
export interface IncidentNode {
  type: 'man-down-event' | 'near-miss' | /* ... */;
  metadata: {
    occurredAt: string;
    severityClass: 1 | 2 | 3 | 4 | 5;
    workerIds: string[];
    siteId: string;
    diatRequired: boolean;     // dispara `requires` → `diat`
    investigationStatus: 'open' | 'closed' | 'pending';
  };
}
```

### 2.6 Familia 6 — ASSETS & FAENA (80)

```ts
export interface AssetNode {
  type: `asset-${string}` | `sensor-iot-${string}` | `site-${string}`;
  metadata: {
    serialNumber?: string;
    location: { lat: number; lng: number; alt?: number };
    ownerProjectId: string;
    nextInspectionDate?: string;
    standardsRegulating: string[]; // ref a NormaNode[]
  };
}
```

### 2.7 Familia 7 — WORKFLOW & COMPLIANCE (80)

```ts
export interface WorkflowNode {
  type: 'diat' | 'matriz-iper' | 'permit-trabajo-altura' | /* ... */;
  metadata: {
    state: 'draft' | 'issued' | 'active' | 'closed' | 'expired' | 'revoked';
    issuedAt: string;
    expiresAt?: string;
    signatures: { uid: string; role: string; signedAt: string }[];
    auditTrailRef?: string;    // append-only, audit_log inmutable
  };
}
```

### 2.8 Familia 8 — AI & ANALYTICS (52)

```ts
export interface AiNode {
  type: 'ai-prediction-accident' | 'ai-recommendation-epp' | /* ... */;
  metadata: {
    modelId: string;
    modelVersion: string;
    promptHash?: string;       // para audit_log
    confidence: number;        // 0..1
    citations: string[];       // refs a otros nodos (RAG)
    overriddenByHuman?: { uid: string; reason: string; at: string };
  };
}
```

`gran-maestro-output-json` es el nodo emitido por la fix descrita en §3 de `[PLAN_PARTE3_PROTOTIPO2.md](PLAN_PARTE3_PROTOTIPO2.md:78)` — JSON estricto `{ causa_raiz, riesgos[], plan_accion }`.

---

## 3. EDGES — TIPOS DE CONEXIONES

Toda arista es **bidireccional, tipada y ponderada**. La capa de persistencia escribe ambos lados como dos documentos hermanos para evitar lecturas O(N).

```ts
export type EdgeType =
  | 'causes' | 'caused_by'
  | 'mitigates' | 'mitigated_by'
  | 'requires' | 'required_by'
  | 'references' | 'referenced_by'
  | 'instance_of' | 'has_instance'
  | 'precedes' | 'succeeds'
  | 'physical_proximity' | 'physical_proximity_of'
  | 'regulates' | 'regulated_by';

export interface Edge {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  weight: number;       // 0..1 — relevancia operativa
  confidence: number;   // 0..1 — certeza del productor (1.0 si determinista)
  createdAt: string;
  createdBy: string;    // uid o "system:<servicename>"
  evidence: string[];   // ids de nodos que respaldan la arista
}
```

### Reciprocidades

| Forward | Reverse | Notas |
|---------|---------|-------|
| `causes` | `caused_by` | A causes B ⇒ B caused_by A |
| `mitigates` | `mitigated_by` | EPP mitigates riesgo |
| `requires` | `required_by` | tarea requires permiso |
| `references` | `referenced_by` | citas RAG, OSF |
| `instance_of` | `has_instance` | DS-594-Art-65 instance_of norma-DS-594 |
| `precedes` | `succeeds` | secuencia temporal estricta |
| `physical_proximity` | `physical_proximity_of` | ≤ radio decidido por productor |
| `regulates` | `regulated_by` | norma → equipo/tarea |

---

## 4. REGLAS DE AUTO-COUPLING

Para cada nodo de la familia PHYSICS & FLUIDS se especifica el trigger y las aristas automáticas. Las otras familias se ejemplifican (2-3 por familia).

### 4.1 PHYSICS & FLUIDS — 60 reglas

```yaml
# A.1 Hidrantes
node: hydrant-q-flow
trigger: sensor-iot-presion at hydrant.assetId AND assetType == 'asset-hidrante'
auto-edges:
  - mitigates → fire-event (en mismo siteId, radio 50m)
  - regulated_by → norma-NCh-1646
  - regulated_by → norma-NFPA-14
  - regulated_by → norma-DS-594  (Art. 41)
  - instance_of → asset-hidrante
  - precedes → hydrant-alert (si presión < 2 bar)

# A.2 Misting / DustSuppression
node: misting-q-flow
trigger: project.workTypes contains 'mineria'|'demolicion' AND sensor-iot-pm10 > 0.5×OEL
auto-edges:
  - mitigates → air-quality-pm25
  - mitigates → air-quality-pm10
  - regulated_by → norma-DS-132
  - regulated_by → norma-DS-594  (Art. 65, sílice 0.025 mg/m³)

# A.3 Cubierta succión (uplift)
node: uplift-alert
trigger: weather.windKmh > 60 AND project has 'cubierta'|'lona'|'malla'
auto-edges:
  - causes → falling-objects (CLIMATE)
  - regulated_by → norma-NCh-432
  - regulated_by → norma-DS-594  (Art. 78)
  - regulated_by → norma-OSHA-1926-451
  - precedes → stop-work-issued (auto si Cp×q > anchor-rating)

# A.4 HVAC confinado
node: hvac-q-flow
trigger: site has 'site-zona-confinada-declarada' AND tarea has 'permit-espacio-confinado'
auto-edges:
  - mitigates → asphyxiation-risk-event
  - mitigates → exposure-acute (H2S, CO, NH3)
  - regulated_by → norma-DS-594  (Art. 61)
  - regulated_by → norma-DS-132  (Art. 74)
  - regulated_by → norma-OSHA-1910-146
  - requires → permit-espacio-confinado

# A.5 Fugas gas industrial
node: gasleak-alert
trigger: ΔE_bernoulli entre dos sensores consecutivos > umbral fricción Darcy-Weisbach
auto-edges:
  - causes → lel-proximity-warning
  - precedes → gas-release-event
  - precedes → evacuation-triggered (auto si ΔE > 2× umbral)
  - regulated_by → norma-DS-66
  - regulated_by → norma-NCh-Elec-4
  - mitigated_by → asset-tanque-glp (válvula corte)
  - physical_proximity → all sensores radius 200m

# B.6 Venturi mina ✅
node: venturi-warning  (ya implementado)
trigger: weather.windKmh > 40 AND project.workTypes contains 'tunel'|'mina'
auto-edges:
  - causes → fatigue-alert (si trabajadores con epp-respirator-* en zona)
  - regulated_by → norma-DS-594  (Art. 32-35 ventilación)
  - regulated_by → norma-DS-132  (Art. 75 minería subterránea)
  - precedes → iper-finding (si persiste >2h sin acción)
  - physical_proximity → all sensor-iot-* radius 200m

# B.7 Tuberías hazmat
node: hazmatpipe-dp-static
trigger: presión calculada Bernoulli en HazmatStorageDesigner
auto-edges:
  - regulated_by → norma-DS-43
  - regulated_by → norma-NFPA-30
  - precedes → environmental-spill (si ΔP indica fuga)

# B.8 Wind load ✅ (ya implementado windload-warning)
trigger: weather.windKmh > 60 AND project has grúa|andamio|modular
auto-edges:
  - causes → falling-objects
  - regulated_by → norma-NCh-432
  - precedes → stop-work-issued (si F > anchor-rating × FS)
  - mitigated_by → asset-grua-torre.bandera-position

# B.9 Respiradores NIOSH
node: respirator-alert
trigger: respiratorPressureDrop calculado en VisionAnalyzer > umbral N95/P100
auto-edges:
  - causes → fatigue-alert
  - mitigates → exposure-chronic-flag
  - regulated_by → norma-NIOSH-42-CFR-84
  - regulated_by → norma-DS-594  (Art. 53)
  - precedes → epp-replacement-due

# B.10 Ergonomía pulmonar altitud
node: altitude-resp-alert
trigger: site.altitude_m > 3000 AND worker has tarea > 4h
auto-edges:
  - causes → altitude-hypoxia-risk
  - regulated_by → norma-DS-594  (Art. 49)
  - regulated_by → norma-DS-28
  - requires → exam-altura-geografica
  - requires → worker-altitude-clearance

# C.11 Micro-eólica
node: microwind-q-flow
trigger: topografia con efecto embudo + viento promedio > 4 m/s sostenido
auto-edges:
  - regulated_by → norma-IEC-61400-2
  - regulated_by → norma-NCh-Elec-4
  - precedes → sensor-iot-* (alimentación autónoma)

# C.12 Suelos / hidrostática evacuación
node: soilflow-alert
trigger: pendiente > ángulo reposo del material AND ruta evacuación atraviesa
auto-edges:
  - causes → slope-instability
  - regulated_by → norma-DS-132  (Art. 32 estabilidad taludes)
  - regulated_by → norma-Eurocodigo-7
  - mitigated_by → site-via-evacuacion (alterna)

# C.13 SLAM digital twin
node: slamflow-q-flow
trigger: simulación derrame químico en gemelo digital
auto-edges:
  - precedes → environmental-spill
  - regulated_by → norma-DS-43
  - regulated_by → norma-NFPA-30

# C.14 Diques piezómetros
node: damflow-alert
trigger: piezómetro con caída > 20% vs vecinos en ventana 24h
auto-edges:
  - causes → seepage-zone
  - regulated_by → norma-DS-248
  - regulated_by → norma-resolucion-1500-SERNAGEOMIN
  - precedes → audit-trail-decision (audit_log inmutable)

# C.15 Dispersión gas Pasquill
node: plumeflow-alert
trigger: gas-release-event AND viento > 2 m/s
auto-edges:
  - precedes → evacuation-triggered
  - precedes → shelter-in-place-triggered (zona orange)
  - regulated_by → norma-DS-144
  - regulated_by → norma-Pasquill-Gifford
  - physical_proximity → all worker-profile dentro de plume-zone-red
```

(Las 60 reglas siguen el patrón anterior — 4 nodos por use case × 15 use cases. El servicio `bernoulliCoupling.ts` (a crear, Sprint 9) implementa todas siguiendo el shape de `[climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts:270)`.)

### 4.2 Ejemplos otras familias

**CLIMATE**
```yaml
node: seismic-event
trigger: USGS adapter detecta M ≥ 4.0 dentro de 100km de cualquier site
auto-edges:
  - precedes → seismic-aftershock-window (72h)
  - precedes → ai-recommendation-stop-work (si M ≥ 5.5)
  - physical_proximity → all site-faena radius 100km

node: gas-dispersion-plume
trigger: orchestrator detecta liberación + viento ≥ 2 m/s
auto-edges:
  - has_instance → plume-zone-red, plume-zone-orange, plume-zone-yellow
  - causes → exposure-acute (radio rojo)
```

**OHS & NORMATIVA**
```yaml
node: norma-DS-594
trigger: bootstrap (semilla del registro)
auto-edges:
  - has_instance → norma-DS-594-Art-32, ...-Art-49, ...-Art-53, ...-Art-61, ...-Art-65, ...-Art-78
  - regulates → epp-respirator-half, epp-respirator-full
```

**PERSONAL & EPP**
```yaml
node: worker-altitude-clearance
trigger: HR system marca trabajador con tarea altitud > 3000m
auto-edges:
  - required_by → tarea (instance permit-trabajo-altura)
  - requires → exam-altura-geografica
```

**EVENTS & INCIDENTS**
```yaml
node: man-down-event
trigger: beacon-ble-mandown reporta inactividad + pulso anómalo
auto-edges:
  - precedes → medevac-dispatched
  - precedes → diat (si confirmado)
  - regulated_by → norma-Ley-16744
```

**ASSETS & FAENA**
```yaml
node: asset-grua-torre
trigger: registro inicial en módulo Equipos
auto-edges:
  - regulated_by → norma-NCh-432
  - regulated_by → norma-DS-594
  - requires → cert-rigger, cert-grua
  - has_instance → inspection-equipment (mensual)
```

**WORKFLOW & COMPLIANCE**
```yaml
node: permit-trabajo-altura
trigger: solicitud en módulo Permisos
auto-edges:
  - requires → epp-harness, epp-helmet, cert-altura, exam-vista
  - regulated_by → norma-DS-594  (Art. 53), norma-OSHA-1926-451
  - precedes → fall-from-height (si NO emitido y se trabaja igual)
```

**AI & ANALYTICS**
```yaml
node: gran-maestro-output-json
trigger: /api/ask-guardian con env-context-snapshot adjunto (Sprint 10)
auto-edges:
  - references → env-context-snapshot
  - references → rag-chunk-retrieved (cada cita)
  - precedes → ai-recommendation-* (uno por riesgo del JSON)
```

---

## 5. QUERY INTERFACE

```ts
// src/services/zettelkasten/query.ts (a crear)
export interface NodeQuery {
  type?: NodeType | NodeType[];
  tenantId: string;                       // SIEMPRE obligatorio
  property?: Record<string, unknown>;     // matching parcial sobre metadata
  near?: { lat: number; lng: number; radiusM: number };
  withEdges?: EdgeType[];
  depth?: number;                          // BFS depth, default 1, max 5
  active?: boolean;                        // metadata.state ∈ {issued, active}
  timeWindow?: { fromISO: string; toISO: string };
  limit?: number;                          // default 100, max 1000
}

export interface QueryResult {
  nodes: ZettelkastenNode[];
  edges: Edge[];
  truncated: boolean;
}

export interface ZettelkastenAPI {
  query(q: NodeQuery): Promise<QueryResult>;
  traverseBFS(rootId: string, edgeFilter: EdgeType[], maxDepth: number): Promise<QueryResult>;
  traverseDFS(rootId: string, edgeFilter: EdgeType[], maxDepth: number): Promise<QueryResult>;
  shortestPath(fromId: string, toId: string, edgeFilter?: EdgeType[]): Promise<Edge[] | null>;
  byProperty<K extends keyof Metadata>(key: K, value: Metadata[K]): Promise<ZettelkastenNode[]>;
  geoSpatial(box: { swLat: number; swLng: number; neLat: number; neLng: number }): Promise<ZettelkastenNode[]>;
}
```

Operaciones soportadas:

- **by-type**: `query({ type: 'venturi-warning' })` — equality.
- **by-property**: `byProperty('severity', 5)` — match exacto sobre metadata.
- **by-edge**: `query({ withEdges: ['causes'], depth: 2 })` — expansión.
- **traversal BFS/DFS**: para causality chains.
- **time-window**: `timeWindow: { from, to }` — sobre `metadata.occurredAt | forecastDateISO | createdAt`.
- **geo-spatial**: bbox o radio; usa Geohash en metadata para evitar full-scan.
- **shortest path**: para "¿qué cadena de causas conecta A con B?".

Los recorridos respetan `depth ≤ 5`. Más profundo requiere job batch (no online).

---

## 6. VISUALIZACIÓN — RiskNetwork.tsx

Consumidor canónico: `[src/pages/RiskNetwork.tsx](src/pages/RiskNetwork.tsx:46)` y su hijo `KnowledgeGraph`. Reglas de layout:

1. **Force-directed** (default) para clusters por familia. Nodos pintados según familia (8 colores).
2. **Tree layout** para causality chains: cuando el usuario selecciona un nodo y pide "explicar causa raíz", el grafo se reordena con dicho nodo como raíz y `caused_by` como aristas descendentes.
3. **Mapa 2D geo-spatial** para nodos con `metadata.lat/lng` — usa el mismo motor de mapas que `DynamicEvacuationMap`.
4. **Niveles de detalle (LOD)**:
   - Zoom out (≥ 1:50): clusters por familia (1 nodo virtual por familia con badge de count).
   - Zoom medio: nodos por tipo (1 nodo virtual por tipo con count).
   - Zoom in: nodos individuales con título y severidad.
5. **Deep-link**: `/risk-network?node=<id>` ya soportado por `resolveSelectedNodeIdFromSearch` en `[RiskNetwork.tsx](src/pages/RiskNetwork.tsx:32)`. V2 añade `&edge=<edgeType>&depth=N` para presets de exploración.
6. **Filtros**: por familia, por severidad ≥ N, por timeWindow, por siteId. Persistidos en query string para shareability.
7. **Agrupación Bernoulli**: los 4 nodos hijos de un mismo `parentBernoulliRunId` se renderizan como un super-nodo plegable.

---

## 7. PERSISTENCIA (Firestore)

### 7.1 Colecciones

```
tenants/{tenantId}/zettelkasten_nodes/{nodeId}
tenants/{tenantId}/zettelkasten_edges/{edgeId}
tenants/{tenantId}/zettelkasten_index_geo/{geohash6}/nodes/{nodeId}   # denormalizado
tenants/{tenantId}/zettelkasten_index_type/{type}/nodes/{nodeId}      # denormalizado
tenants/{tenantId}/audit_log/{auditId}                                # inmutable, ya existe
```

### 7.2 Índices compuestos (firestore.indexes.json)

```json
[
  { "collectionGroup": "zettelkasten_nodes",
    "fields": [{"fieldPath":"type","order":"ASCENDING"},
               {"fieldPath":"metadata.severity","order":"DESCENDING"},
               {"fieldPath":"createdAt","order":"DESCENDING"}] },
  { "collectionGroup": "zettelkasten_nodes",
    "fields": [{"fieldPath":"metadata.geohash6","order":"ASCENDING"},
               {"fieldPath":"type","order":"ASCENDING"}] },
  { "collectionGroup": "zettelkasten_edges",
    "fields": [{"fieldPath":"fromId","order":"ASCENDING"},
               {"fieldPath":"type","order":"ASCENDING"}] },
  { "collectionGroup": "zettelkasten_edges",
    "fields": [{"fieldPath":"toId","order":"ASCENDING"},
               {"fieldPath":"type","order":"ASCENDING"}] }
]
```

### 7.3 Reglas de seguridad (extracto)

```javascript
match /tenants/{tenantId}/zettelkasten_nodes/{nodeId} {
  allow read: if isProjectMemberOfAny(tenantId)
              && resource.data.tenantId == tenantId;
  allow create, update: if false;       // solo via /api/zettelkasten/* con HMAC
  allow delete: if false;
}
match /tenants/{tenantId}/zettelkasten_edges/{edgeId} {
  allow read: if isProjectMemberOfAny(tenantId);
  allow create, update, delete: if false; // misma regla que nodes
}
```

Las escrituras pasan por `/api/zettelkasten/upsert` autenticado con HMAC server-side; el cliente nunca escribe directo. Este patrón es consistente con las rules ya adoptadas (ver `[PLAN_PARTE3_PROTOTIPO2.md](PLAN_PARTE3_PROTOTIPO2.md:117)`).

---

## 8. ROADMAP DE IMPLEMENTACIÓN

| Sprint | Familia | Entregables | Esfuerzo |
|--------|---------|-------------|----------|
| **Sprint 9** | PHYSICS & FLUIDS (60 nodos) | `bernoulliCoupling.ts` + 60 reglas auto-coupling §4.1; cierra los 10 use cases pendientes de `[BERNOULLI_EXTENSIONS.md](BERNOULLI_EXTENSIONS.md:267)` | 30h |
| **Sprint 10** | CLIMATE & ENVIRONMENT (47 restantes) + AI env-context | env-context-snapshot inyectado en `/api/ask-guardian` (fix §3 de `[PLAN_PARTE3_PROTOTIPO2.md](PLAN_PARTE3_PROTOTIPO2.md:78)`); seismic-aftershock-window; plume-zone-{red,orange,yellow} | 24h |
| **Sprint 11** | OHS & NORMATIVA (80) | normaRegistry.ts con jurisprudencia chilena; auto-edges `regulates` desde EPP/asset/permit | 28h |
| **Sprint 12** | ASSETS & FAENA (80) con sensores IoT | sensorIngest.ts; auto-coupling sensor → physics; geohash index | 32h |
| **Sprint 13** | PERSONAL & EPP (50) | worker-profile completo; epp-fit-test; certificaciones; vínculo HR | 26h |
| **Sprint 14** | EVENTS & INCIDENTS (60) + WORKFLOW partial | iper-finding pipeline; diat auto-trigger; permit lifecycle | 28h |
| **Sprint 15** | WORKFLOW (resto 80) + AI & ANALYTICS (52) | gran-maestro-output-json end-to-end; audit_log binding; cluster-similar-incidents; model-drift-warning | 30h |

Total: ~198h (≈ 5 sprints de 2 ingenieros). Las 320 nodos existentes se rebrand al schema canónico en una migración de 1 sprint inicial (no contado arriba).

### 8.1 Dependencias críticas

- Sprint 10 desbloquea Sprint 11 (las normas viven referenciadas por env-context).
- Sprint 12 desbloquea 4.1 — sin sensores IoT en grafo, las reglas auto-coupling son parciales.
- Sprint 15 cierra el loop "Gran Maestro" con env-context inyectado en Sprint 10.

---

## 9. ARCHIVOS REFERENCIADOS / ESPERADOS

Existentes:
- `[src/services/zettelkasten/climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts)`
- `[src/services/zettelkasten/climateRiskCoupling.test.ts](src/services/zettelkasten/climateRiskCoupling.test.ts)`
- `[src/services/physics/bernoulliEngine.ts](src/services/physics/bernoulliEngine.ts)`
- `[src/services/orchestratorService.ts](src/services/orchestratorService.ts)`
- `[src/server/routes/gemini.ts](src/server/routes/gemini.ts)`
- `[src/pages/RiskNetwork.tsx](src/pages/RiskNetwork.tsx)`
- `[BERNOULLI_EXTENSIONS.md](BERNOULLI_EXTENSIONS.md)`
- `[PLAN_PARTE3_PROTOTIPO2.md](PLAN_PARTE3_PROTOTIPO2.md)`

A crear (consumidos por este spec):
- `src/services/zettelkasten/nodeTypes.ts` — discriminated union completa.
- `src/services/zettelkasten/normaRegistry.ts` — registro plano 80 entradas.
- `src/services/zettelkasten/edges.ts` — tipo Edge + helpers reciprocidad.
- `src/services/zettelkasten/query.ts` — ZettelkastenAPI.
- `src/services/zettelkasten/bernoulliCoupling.ts` — Sprint 9.
- `src/services/zettelkasten/sensorIngest.ts` — Sprint 12.
- `src/server/routes/zettelkasten.ts` — `/api/zettelkasten/upsert` HMAC.
- `firestore.indexes.json` (extender con bloques §7.2).

---

> Próxima revisión: tras Sprint 9 (cierre PHYSICS & FLUIDS) — 2026-06-30.
