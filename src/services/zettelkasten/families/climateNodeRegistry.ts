// SPDX-License-Identifier: MIT
// Static catalog for the CLIMATE & ENVIRONMENT family (50 nodes).
// Pure data — no logic. Future generators iterate over this list.

export interface FamilyNodeSpec {
  readonly id: string;
  readonly description: string;
  readonly producerHint: string;
  readonly consumerHints: readonly string[];
  readonly source: string;
}

export const CLIMATE_NODES: ReadonlyArray<FamilyNodeSpec> = [
  { id: 'climate-risk', description: 'Riesgo climatico agregado por sitio segun adaptador meteorologico.', producerHint: 'src/services/zettelkasten/climateRiskCoupling.ts', consumerHints: ['src/pages/RiskNetwork.tsx', 'src/services/orchestratorService.ts'], source: 'internal' },
  { id: 'venturi-warning', description: 'Aceleracion topografica del viento en tunel/embudo (efecto Venturi).', producerHint: 'src/services/zettelkasten/climateRiskCoupling.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'NCh-432' },
  { id: 'windload-warning', description: 'Carga de viento sobre estructura, andamio o lona.', producerHint: 'src/services/zettelkasten/climateRiskCoupling.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'NCh-432' },
  { id: 'seismic-event', description: 'Sismo M>=4.0 detectado por adaptador USGS dentro de 100km.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'USGS' },
  { id: 'seismic-aftershock-window', description: 'Ventana de 72h post-sismo con probabilidad elevada de replicas.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'USGS' },
  { id: 'lightning-strike-proximate', description: 'Impacto de rayo dentro de radio 5km del sitio.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'NFPA-780' },
  { id: 'uv-extreme-window', description: 'Ventana con indice UV >= 8 (radiacion solar extrema).', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/services/zettelkasten/climateRiskCoupling.ts'], source: 'DS-594' },
  { id: 'cold-snap-window', description: 'Ola de frio con temperatura sostenida bajo umbral exposicion.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'heat-wave-window', description: 'Ola de calor con temperatura sostenida sobre umbral exposicion.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'air-quality-pm10', description: 'Concentracion de material particulado PM10 sobre OEL.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'air-quality-pm25', description: 'Concentracion de material particulado fino PM2.5.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'air-quality-co', description: 'Concentracion de monoxido de carbono.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'air-quality-so2', description: 'Concentracion de dioxido de azufre.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'air-quality-no2', description: 'Concentracion de dioxido de nitrogeno.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'air-quality-o3', description: 'Concentracion de ozono troposferico.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'volcanic-ash-fallout', description: 'Caida de ceniza volcanica reportada en sitio.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'SERNAGEOMIN' },
  { id: 'tsunami-warning', description: 'Aviso de tsunami para faena costera.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'SHOA' },
  { id: 'flood-watch', description: 'Aviso de crecida fluvial o inundacion local.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DGA' },
  { id: 'wildfire-proximity', description: 'Incendio forestal dentro de radio 10km de la faena.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'CONAF' },
  { id: 'snowfall-event', description: 'Evento de nevada significativa sobre la faena.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DMC' },
  { id: 'hail-event', description: 'Evento de granizo sobre la faena.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DMC' },
  { id: 'fog-low-visibility', description: 'Niebla densa con visibilidad reducida.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DMC' },
  { id: 'humidity-extreme', description: 'Humedad relativa fuera de rango operativo.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'pressure-anomaly-baro', description: 'Anomalia de presion barometrica indicativa de frente.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'internal' },
  { id: 'altitude-hypoxia-risk', description: 'Riesgo de hipoxia en faena sobre 3000m s.n.m.', producerHint: 'src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts', consumerHints: ['src/pages/BioAnalysis.tsx'], source: 'DS-594' },
  { id: 'wind-funnel-topographic', description: 'Embudo topografico que amplifica viento local.', producerHint: 'src/services/zettelkasten/climateRiskCoupling.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'internal' },
  { id: 'gas-dispersion-plume', description: 'Pluma de dispersion de gas calculada (Pasquill-Gifford).', producerHint: 'src/services/zettelkasten/bernoulli/gasDispersionCloud.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'Pasquill-Gifford' },
  { id: 'plume-zone-red', description: 'Zona roja de pluma — exposicion aguda probable.', producerHint: 'src/services/zettelkasten/bernoulli/gasDispersionCloud.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'Pasquill-Gifford' },
  { id: 'plume-zone-orange', description: 'Zona naranja de pluma — refugio en lugar.', producerHint: 'src/services/zettelkasten/bernoulli/gasDispersionCloud.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'Pasquill-Gifford' },
  { id: 'plume-zone-yellow', description: 'Zona amarilla de pluma — vigilancia.', producerHint: 'src/services/zettelkasten/bernoulli/gasDispersionCloud.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'Pasquill-Gifford' },
  { id: 'piezometer-anomaly', description: 'Anomalia de piezometro en talud o dique.', producerHint: 'src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-248' },
  { id: 'seepage-zone', description: 'Zona de filtracion identificada en obra hidraulica.', producerHint: 'src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-248' },
  { id: 'slope-instability', description: 'Inestabilidad de talud detectada por monitoreo.', producerHint: 'src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'Eurocodigo-7' },
  { id: 'soil-moisture-saturation', description: 'Saturacion de humedad de suelo sobre umbral.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'Eurocodigo-7' },
  { id: 'frost-heave-zone', description: 'Zona con riesgo de levantamiento por congelamiento.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'internal' },
  { id: 'glacier-retreat-marker', description: 'Marcador de retroceso glaciar relevante a faena.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DGA' },
  { id: 'river-flood-stage', description: 'Etapa de crecida en cauce monitoreado.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'DGA' },
  { id: 'tide-extreme', description: 'Marea extrema sobre referencia hidrografica.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'SHOA' },
  { id: 'storm-surge', description: 'Marejada por temporal en faena costera.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'SHOA' },
  { id: 'dust-storm-event', description: 'Tormenta de polvo afectando visibilidad y respiracion.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DMC' },
  { id: 'sandstorm-event', description: 'Tormenta de arena en faena desertica.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DMC' },
  { id: 'icefall-zone', description: 'Zona con riesgo de caida de hielo.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'internal' },
  { id: 'rockfall-zone', description: 'Zona con riesgo de desprendimiento de rocas.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-132' },
  { id: 'avalanche-corridor', description: 'Corredor de avalancha cartografiado.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'internal' },
  { id: 'lahar-corridor', description: 'Corredor de lahar volcanico cartografiado.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/EmergenciaAvanzada.tsx'], source: 'SERNAGEOMIN' },
  { id: 'sinkhole-detected', description: 'Socavon detectado en superficie de la faena.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-132' },
  { id: 'permafrost-thaw', description: 'Deshielo de permafrost en faena de altura.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'internal' },
  { id: 'ozone-depletion-local', description: 'Depresion local de ozono que eleva radiacion UV.', producerHint: 'src/services/orchestratorService.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DMC' },
  { id: 'noise-environmental', description: 'Ruido ambiental sostenido sobre limites OEL.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
  { id: 'vibration-environmental', description: 'Vibracion ambiental sostenida sobre limites OEL.', producerHint: 'src/services/sensorIngest.ts', consumerHints: ['src/pages/RiskNetwork.tsx'], source: 'DS-594' },
];
