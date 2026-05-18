# Zettelkasten v2 — Catalogo Completo de los 512 Nodos

> Generado automaticamente desde `src/services/zettelkasten/families/*`.
> Cada fila = un tipo de nodo. Producer/Consumer = puntos de acoplamiento sugeridos.
> Total: 512 nodos en 8 familias.

## Familia: climate-environment (50 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `climate-risk` | Riesgo climatico agregado por sitio segun adaptador meteorologico. | `src/services/zettelkasten/climateRiskCoupling.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | internal |
| 2 | `venturi-warning` | Aceleracion topografica del viento en tunel/embudo (efecto Venturi). | `src/services/zettelkasten/climateRiskCoupling.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 3 | `windload-warning` | Carga de viento sobre estructura, andamio o lona. | `src/services/zettelkasten/climateRiskCoupling.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 4 | `seismic-event` | Sismo M>=4.0 detectado por adaptador USGS dentro de 100km. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | USGS |
| 5 | `seismic-aftershock-window` | Ventana de 72h post-sismo con probabilidad elevada de replicas. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | USGS |
| 6 | `lightning-strike-proximate` | Impacto de rayo dentro de radio 5km del sitio. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | NFPA-780 |
| 7 | `uv-extreme-window` | Ventana con indice UV >= 8 (radiacion solar extrema). | `src/services/orchestratorService.ts` | `src/services/zettelkasten/climateRiskCoupling.ts` | DS-594 |
| 8 | `cold-snap-window` | Ola de frio con temperatura sostenida bajo umbral exposicion. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 9 | `heat-wave-window` | Ola de calor con temperatura sostenida sobre umbral exposicion. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 10 | `air-quality-pm10` | Concentracion de material particulado PM10 sobre OEL. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 11 | `air-quality-pm25` | Concentracion de material particulado fino PM2.5. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 12 | `air-quality-co` | Concentracion de monoxido de carbono. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 13 | `air-quality-so2` | Concentracion de dioxido de azufre. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 14 | `air-quality-no2` | Concentracion de dioxido de nitrogeno. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 15 | `air-quality-o3` | Concentracion de ozono troposferico. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 16 | `volcanic-ash-fallout` | Caida de ceniza volcanica reportada en sitio. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | SERNAGEOMIN |
| 17 | `tsunami-warning` | Aviso de tsunami para faena costera. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | SHOA |
| 18 | `flood-watch` | Aviso de crecida fluvial o inundacion local. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DGA |
| 19 | `wildfire-proximity` | Incendio forestal dentro de radio 10km de la faena. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | CONAF |
| 20 | `snowfall-event` | Evento de nevada significativa sobre la faena. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DMC |
| 21 | `hail-event` | Evento de granizo sobre la faena. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DMC |
| 22 | `fog-low-visibility` | Niebla densa con visibilidad reducida. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DMC |
| 23 | `humidity-extreme` | Humedad relativa fuera de rango operativo. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 24 | `pressure-anomaly-baro` | Anomalia de presion barometrica indicativa de frente. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 25 | `altitude-hypoxia-risk` | Riesgo de hipoxia en faena sobre 3000m s.n.m. | `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` | `src/pages/BioAnalysis.tsx` | DS-594 |
| 26 | `wind-funnel-topographic` | Embudo topografico que amplifica viento local. | `src/services/zettelkasten/climateRiskCoupling.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 27 | `gas-dispersion-plume` | Pluma de dispersion de gas calculada (Pasquill-Gifford). | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 28 | `plume-zone-red` | Zona roja de pluma — exposicion aguda probable. | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 29 | `plume-zone-orange` | Zona naranja de pluma — refugio en lugar. | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 30 | `plume-zone-yellow` | Zona amarilla de pluma — vigilancia. | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 31 | `piezometer-anomaly` | Anomalia de piezometro en talud o dique. | `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | `src/pages/RiskNetwork.tsx` | DS-248 |
| 32 | `seepage-zone` | Zona de filtracion identificada en obra hidraulica. | `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | `src/pages/RiskNetwork.tsx` | DS-248 |
| 33 | `slope-instability` | Inestabilidad de talud detectada por monitoreo. | `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` | `src/pages/RiskNetwork.tsx` | Eurocodigo-7 |
| 34 | `soil-moisture-saturation` | Saturacion de humedad de suelo sobre umbral. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | Eurocodigo-7 |
| 35 | `frost-heave-zone` | Zona con riesgo de levantamiento por congelamiento. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 36 | `glacier-retreat-marker` | Marcador de retroceso glaciar relevante a faena. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DGA |
| 37 | `river-flood-stage` | Etapa de crecida en cauce monitoreado. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | DGA |
| 38 | `tide-extreme` | Marea extrema sobre referencia hidrografica. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | SHOA |
| 39 | `storm-surge` | Marejada por temporal en faena costera. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | SHOA |
| 40 | `dust-storm-event` | Tormenta de polvo afectando visibilidad y respiracion. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DMC |
| 41 | `sandstorm-event` | Tormenta de arena en faena desertica. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DMC |
| 42 | `icefall-zone` | Zona con riesgo de caida de hielo. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 43 | `rockfall-zone` | Zona con riesgo de desprendimiento de rocas. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 44 | `avalanche-corridor` | Corredor de avalancha cartografiado. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | internal |
| 45 | `lahar-corridor` | Corredor de lahar volcanico cartografiado. | `src/services/orchestratorService.ts` | `src/pages/EmergenciaAvanzada.tsx` | SERNAGEOMIN |
| 46 | `sinkhole-detected` | Socavon detectado en superficie de la faena. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 47 | `permafrost-thaw` | Deshielo de permafrost en faena de altura. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 48 | `ozone-depletion-local` | Depresion local de ozono que eleva radiacion UV. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DMC |
| 49 | `noise-environmental` | Ruido ambiental sostenido sobre limites OEL. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 50 | `vibration-environmental` | Vibracion ambiental sostenida sobre limites OEL. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |

## Familia: physics-fluids (60 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `hydrant-q-dynamic` | red de hidrantes — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 2 | `hydrant-dp-static` | red de hidrantes — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 3 | `hydrant-q-flow` | red de hidrantes — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 4 | `hydrant-alert` | red de hidrantes — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 5 | `misting-q-dynamic` | supresion de polvo por misting — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/mistingDustSuppression.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 6 | `misting-dp-static` | supresion de polvo por misting — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/mistingDustSuppression.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 7 | `misting-q-flow` | supresion de polvo por misting — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/mistingDustSuppression.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 8 | `misting-alert` | supresion de polvo por misting — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/mistingDustSuppression.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 9 | `uplift-q-dynamic` | succion en cubierta/lona — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 10 | `uplift-dp-static` | succion en cubierta/lona — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 11 | `uplift-q-flow` | succion en cubierta/lona — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 12 | `uplift-alert` | succion en cubierta/lona — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 13 | `hvac-q-dynamic` | ventilacion de espacio confinado — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 14 | `hvac-dp-static` | ventilacion de espacio confinado — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 15 | `hvac-q-flow` | ventilacion de espacio confinado — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 16 | `hvac-alert` | ventilacion de espacio confinado — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 17 | `gasleak-q-dynamic` | fuga de gas industrial — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/gasLeakDetection.ts` | `src/pages/EmergenciaAvanzada.tsx` | DS-66 |
| 18 | `gasleak-dp-static` | fuga de gas industrial — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/gasLeakDetection.ts` | `src/pages/EmergenciaAvanzada.tsx` | DS-66 |
| 19 | `gasleak-q-flow` | fuga de gas industrial — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/gasLeakDetection.ts` | `src/pages/EmergenciaAvanzada.tsx` | DS-66 |
| 20 | `gasleak-alert` | fuga de gas industrial — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/gasLeakDetection.ts` | `src/pages/EmergenciaAvanzada.tsx` | DS-66 |
| 21 | `mineventuri-q-dynamic` | venturi minero — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/miningVenturi.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 22 | `mineventuri-dp-static` | venturi minero — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/miningVenturi.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 23 | `mineventuri-q-flow` | venturi minero — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/miningVenturi.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 24 | `mineventuri-alert` | venturi minero — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/miningVenturi.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 25 | `hazmatpipe-q-dynamic` | tuberia hazmat — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/hazmatPipePressure.ts` | `src/pages/RiskNetwork.tsx` | NFPA-30 |
| 26 | `hazmatpipe-dp-static` | tuberia hazmat — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/hazmatPipePressure.ts` | `src/pages/RiskNetwork.tsx` | NFPA-30 |
| 27 | `hazmatpipe-q-flow` | tuberia hazmat — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/hazmatPipePressure.ts` | `src/pages/RiskNetwork.tsx` | NFPA-30 |
| 28 | `hazmatpipe-alert` | tuberia hazmat — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/hazmatPipePressure.ts` | `src/pages/RiskNetwork.tsx` | NFPA-30 |
| 29 | `windload-q-dynamic` | carga de viento sobre estructura — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/structuralWindLoad.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 30 | `windload-dp-static` | carga de viento sobre estructura — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/structuralWindLoad.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 31 | `windload-q-flow` | carga de viento sobre estructura — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/structuralWindLoad.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 32 | `windload-alert` | carga de viento sobre estructura — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/structuralWindLoad.ts` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 33 | `respirator-q-dynamic` | caida de presion en respirador — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/respiratorFatigue.ts` | `src/pages/BioAnalysis.tsx` | NIOSH-42-CFR-84 |
| 34 | `respirator-dp-static` | caida de presion en respirador — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/respiratorFatigue.ts` | `src/pages/BioAnalysis.tsx` | NIOSH-42-CFR-84 |
| 35 | `respirator-q-flow` | caida de presion en respirador — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/respiratorFatigue.ts` | `src/pages/BioAnalysis.tsx` | NIOSH-42-CFR-84 |
| 36 | `respirator-alert` | caida de presion en respirador — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/respiratorFatigue.ts` | `src/pages/BioAnalysis.tsx` | NIOSH-42-CFR-84 |
| 37 | `altitude-resp-q-dynamic` | respiracion en altura geografica — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` | `src/pages/BioAnalysis.tsx` | DS-594 |
| 38 | `altitude-resp-dp-static` | respiracion en altura geografica — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` | `src/pages/BioAnalysis.tsx` | DS-594 |
| 39 | `altitude-resp-q-flow` | respiracion en altura geografica — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` | `src/pages/BioAnalysis.tsx` | DS-594 |
| 40 | `altitude-resp-alert` | respiracion en altura geografica — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts` | `src/pages/BioAnalysis.tsx` | DS-594 |
| 41 | `microwind-q-dynamic` | micro-eolica — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/microWindEnergy.ts` | `src/pages/RiskNetwork.tsx` | IEC-61400-2 |
| 42 | `microwind-dp-static` | micro-eolica — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/microWindEnergy.ts` | `src/pages/RiskNetwork.tsx` | IEC-61400-2 |
| 43 | `microwind-q-flow` | micro-eolica — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/microWindEnergy.ts` | `src/pages/RiskNetwork.tsx` | IEC-61400-2 |
| 44 | `microwind-alert` | micro-eolica — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/microWindEnergy.ts` | `src/pages/RiskNetwork.tsx` | IEC-61400-2 |
| 45 | `soilflow-q-dynamic` | flujo hidrostatico de suelos — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` | `src/pages/RiskNetwork.tsx` | Eurocodigo-7 |
| 46 | `soilflow-dp-static` | flujo hidrostatico de suelos — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` | `src/pages/RiskNetwork.tsx` | Eurocodigo-7 |
| 47 | `soilflow-q-flow` | flujo hidrostatico de suelos — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` | `src/pages/RiskNetwork.tsx` | Eurocodigo-7 |
| 48 | `soilflow-alert` | flujo hidrostatico de suelos — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts` | `src/pages/RiskNetwork.tsx` | Eurocodigo-7 |
| 49 | `slamflow-q-dynamic` | simulacion de flujo en gemelo digital SLAM — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 50 | `slamflow-dp-static` | simulacion de flujo en gemelo digital SLAM — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 51 | `slamflow-q-flow` | simulacion de flujo en gemelo digital SLAM — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 52 | `slamflow-alert` | simulacion de flujo en gemelo digital SLAM — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 53 | `damflow-q-dynamic` | flujo en dique con piezometros — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | `src/pages/RiskNetwork.tsx` | DS-248 |
| 54 | `damflow-dp-static` | flujo en dique con piezometros — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | `src/pages/RiskNetwork.tsx` | DS-248 |
| 55 | `damflow-q-flow` | flujo en dique con piezometros — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | `src/pages/RiskNetwork.tsx` | DS-248 |
| 56 | `damflow-alert` | flujo en dique con piezometros — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts` | `src/pages/RiskNetwork.tsx` | DS-248 |
| 57 | `plumeflow-q-dynamic` | dispersion de pluma de gas — Presion dinamica q = 1/2 rho v^2 (Pa). | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 58 | `plumeflow-dp-static` | dispersion de pluma de gas — Delta P estatico entre dos puntos (Pa). | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 59 | `plumeflow-q-flow` | dispersion de pluma de gas — Caudal volumetrico Q (m3/s). | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |
| 60 | `plumeflow-alert` | dispersion de pluma de gas — Alerta booleana al cruzar umbral, con recomendacion. | `src/services/zettelkasten/bernoulli/gasDispersionCloud.ts` | `src/pages/EmergenciaAvanzada.tsx` | Pasquill-Gifford |

## Familia: ohs-normativa (80 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `norma-DS-54` | DS 54 — Comites paritarios de higiene y seguridad. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-54 |
| 2 | `norma-DS-40` | DS 44/2024 — Reglamento sobre prevencion de riesgos. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-40 |
| 3 | `norma-DS-76` | DS 76 — Subcontratacion y obligaciones del mandante. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-76 |
| 4 | `norma-DS-132` | DS 132 — Reglamento de seguridad minera. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-132 |
| 5 | `norma-DS-594` | DS 594 — Condiciones sanitarias y ambientales basicas en lugares de trabajo. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-594 |
| 6 | `norma-DS-66` | DS 66 — Reglamento de instalaciones interiores y medidores de gas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-66 |
| 7 | `norma-DS-43` | DS 43 — Reglamento de almacenamiento de sustancias peligrosas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-43 |
| 8 | `norma-DS-248` | DS 248 — Reglamento de tranques de relave. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-248 |
| 9 | `norma-DS-144` | DS 144 — Emisiones a la atmosfera de fuentes fijas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-144 |
| 10 | `norma-DS-28` | DS 28 — Trabajo en altura geografica extrema. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | DS-28 |
| 11 | `norma-Ley-16744` | Ley 16.744 — Seguro social contra accidentes y enfermedades profesionales. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | Ley-16744 |
| 12 | `norma-ISO-45001` | ISO 45001 — Sistema de gestion de SST. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | ISO-45001 |
| 13 | `norma-OHSAS-18001` | OHSAS 18001 — Sistema de gestion SST (legacy). | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | OHSAS-18001 |
| 14 | `norma-NCh-432` | NCh 432 — Diseno estructural: cargas de viento. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | NCh-432 |
| 15 | `norma-NCh-1646` | NCh 1646 — Hidrantes para servicio contra incendio. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | NCh-1646 |
| 16 | `norma-NCh-Elec-4` | NCh Elec 4 — Instalaciones electricas en baja tension. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | NCh-Elec-4 |
| 17 | `norma-NIOSH-42-CFR-84` | NIOSH 42 CFR 84 — Aprobacion de respiradores. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | NIOSH-42-CFR-84 |
| 18 | `norma-NFPA-14` | NFPA 14 — Sistemas de tuberias verticales y mangueras. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | NFPA-14 |
| 19 | `norma-NFPA-30` | NFPA 30 — Codigo de liquidos inflamables y combustibles. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | NFPA-30 |
| 20 | `norma-OSHA-1926-451` | OSHA 1926.451 — Andamios en construccion. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | OSHA-1926-451 |
| 21 | `norma-OSHA-1910-146` | OSHA 1910.146 — Espacios confinados que requieren permiso. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | OSHA-1910-146 |
| 22 | `norma-IEC-61400-2` | IEC 61400-2 — Pequenas turbinas eolicas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | IEC-61400-2 |
| 23 | `norma-Eurocodigo-7` | Eurocodigo 7 — Diseno geotecnico. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | Eurocodigo-7 |
| 24 | `norma-Pasquill-Gifford` | Pasquill-Gifford — Estabilidad atmosferica para dispersion. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | Pasquill-Gifford |
| 25 | `norma-art` | Articulo generico de norma (referencia variable). | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | internal |
| 26 | `norma-resolucion-1500-SERNAGEOMIN` | Resolucion 1500 SERNAGEOMIN — Depositos de relave. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/services/orchestratorService.ts` | SERNAGEOMIN |
| 27 | `norma-DS-594-Art-3` | DS 594 Art. 3 — Obligacion del empleador en condiciones sanitarias. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 28 | `norma-DS-594-Art-9` | DS 594 Art. 9 — Servicios higienicos. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 29 | `norma-DS-594-Art-21` | DS 594 Art. 21 — Iluminacion en lugares de trabajo. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 30 | `norma-DS-594-Art-23` | DS 594 Art. 23 — Riesgo electrico. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 31 | `norma-DS-594-Art-32` | DS 594 Art. 32 — Ventilacion en espacios cerrados. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 32 | `norma-DS-594-Art-33` | DS 594 Art. 33 — Renovacion de aire en interiores. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 33 | `norma-DS-594-Art-35` | DS 594 Art. 35 — Extraccion localizada de contaminantes. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 34 | `norma-DS-594-Art-41` | DS 594 Art. 41 — Proteccion contra incendios y agua. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 35 | `norma-DS-594-Art-49` | DS 594 Art. 49 — Trabajo en altura geografica. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 36 | `norma-DS-594-Art-53` | DS 594 Art. 53 — Equipos de proteccion respiratoria. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 37 | `norma-DS-594-Art-57` | DS 594 Art. 57 — Proteccion auditiva. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 38 | `norma-DS-594-Art-61` | DS 594 Art. 61 — Espacios confinados. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 39 | `norma-DS-594-Art-65` | DS 594 Art. 65 — Limites permisibles de silice. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 40 | `norma-DS-594-Art-72` | DS 594 Art. 72 — Calor y exposicion termica. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 41 | `norma-DS-594-Art-78` | DS 594 Art. 78 — Trabajo en alturas y andamios. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 42 | `norma-DS-594-Art-103` | DS 594 Art. 103 — Limite ruido continuo. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 43 | `norma-DS-594-Art-110` | DS 594 Art. 110 — Vibraciones mano-brazo. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-594 |
| 44 | `norma-DS-132-Art-32` | DS 132 Art. 32 — Estabilidad de taludes mineros. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-132 |
| 45 | `norma-DS-132-Art-74` | DS 132 Art. 74 — Ventilacion en mineria subterranea. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-132 |
| 46 | `norma-DS-132-Art-75` | DS 132 Art. 75 — Caudal minimo de aire por trabajador en mina. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-132 |
| 47 | `norma-DS-132-Art-201` | DS 132 Art. 201 — Voladuras controladas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-132 |
| 48 | `norma-DS-132-Art-220` | DS 132 Art. 220 — Manejo de explosivos. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-132 |
| 49 | `norma-DS-40-Art-14` | DS 44/2024 Art. 14 — Departamento de prevencion de riesgos. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-40 |
| 50 | `norma-DS-40-Art-21` | DS 44/2024 Art. 21 — Obligacion de informar (ODI/Derecho a saber). | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-40 |
| 51 | `norma-DS-54-Art-1` | DS 54 Art. 1 — Constitucion de comite paritario. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-54 |
| 52 | `norma-DS-54-Art-24` | DS 54 Art. 24 — Funciones del comite paritario. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-54 |
| 53 | `norma-DS-76-Art-3` | DS 76 Art. 3 — Reglamento especial de subcontratistas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-76 |
| 54 | `norma-DS-76-Art-7` | DS 76 Art. 7 — Sistema de gestion en regimen de subcontratacion. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-76 |
| 55 | `norma-DS-43-Art-22` | DS 43 Art. 22 — Almacenamiento de inflamables. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-43 |
| 56 | `norma-DS-43-Art-46` | DS 43 Art. 46 — Distancias de seguridad y compatibilidad. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-43 |
| 57 | `norma-DS-66-Art-43` | DS 66 Art. 43 — Pruebas de hermeticidad de gas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-66 |
| 58 | `norma-DS-248-Art-12` | DS 248 Art. 12 — Diseno y construccion de tranques. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-248 |
| 59 | `norma-DS-248-Art-31` | DS 248 Art. 31 — Monitoreo geotecnico de relaves. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-248 |
| 60 | `norma-DS-28-Art-4` | DS 28 Art. 4 — Examen pre-ocupacional de altura. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | DS-28 |
| 61 | `norma-Ley-16744-Art-66` | Ley 16.744 Art. 66 — Comite paritario y reglamento interno. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | Ley-16744 |
| 62 | `norma-Ley-16744-Art-68` | Ley 16.744 Art. 68 — Obligaciones de la empresa. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | Ley-16744 |
| 63 | `norma-ISO-45001-Cap-6` | ISO 45001 Cap. 6 — Planificacion y evaluacion de riesgos. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | ISO-45001 |
| 64 | `norma-ISO-45001-Cap-8` | ISO 45001 Cap. 8 — Operacion y control operacional. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | ISO-45001 |
| 65 | `norma-ISO-45001-Cap-10` | ISO 45001 Cap. 10 — Mejora y accion correctiva. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | ISO-45001 |
| 66 | `norma-NCh-432-Cap-5` | NCh 432 Cap. 5 — Coeficientes de presion en estructuras. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NCh-432 |
| 67 | `norma-NCh-1646-Cap-3` | NCh 1646 Cap. 3 — Capacidad y caudal de hidrantes. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NCh-1646 |
| 68 | `norma-NCh-Elec-4-Sec-9` | NCh Elec 4 Sec. 9 — Tableros y proteccion diferencial. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NCh-Elec-4 |
| 69 | `norma-NCh-Elec-4-Sec-13` | NCh Elec 4 Sec. 13 — Faenas temporales y obras. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NCh-Elec-4 |
| 70 | `norma-NFPA-14-Cap-7` | NFPA 14 Cap. 7 — Diseno hidraulico de redes humedas. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NFPA-14 |
| 71 | `norma-NFPA-30-Cap-9` | NFPA 30 Cap. 9 — Tanques de almacenamiento aereo. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NFPA-30 |
| 72 | `norma-OSHA-1926-451-b` | OSHA 1926.451(b) — Plataformas y barandas en andamios. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | OSHA-1926-451 |
| 73 | `norma-OSHA-1910-146-c` | OSHA 1910.146(c) — Programa escrito de espacios confinados. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | OSHA-1910-146 |
| 74 | `norma-NIOSH-42-CFR-84-N95` | NIOSH 42 CFR 84 — Filtros N95 y P100. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | NIOSH-42-CFR-84 |
| 75 | `norma-Eurocodigo-7-Sec-2` | Eurocodigo 7 Sec. 2 — Diseno geotecnico de estabilidad. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | Eurocodigo-7 |
| 76 | `norma-IEC-61400-2-Cap-7` | IEC 61400-2 Cap. 7 — Cargas de diseno en micro-eolica. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | IEC-61400-2 |
| 77 | `norma-resolucion-1500-Art-5` | Resolucion 1500 Art. 5 — Plan de cierre de relaves. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | SERNAGEOMIN |
| 78 | `norma-SUSESO-Circular-3241` | SUSESO Circular 3241 — Protocolo PREXOR (ruido). | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | SUSESO |
| 79 | `norma-SUSESO-Circular-3596` | SUSESO Circular 3596 — Protocolo TMERT-EESS. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | SUSESO |
| 80 | `norma-SUSESO-Protocolo-PLANESI` | SUSESO Protocolo PLANESI — Vigilancia silice. | `src/services/zettelkasten/normaRegistry.ts` | `src/pages/RiskNetwork.tsx`, `src/pages/Audits.tsx` | SUSESO |

## Familia: personal-epp (50 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `worker-profile` | Perfil de trabajador con rol y faenas activas. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 2 | `worker-medical-clearance` | Aptitud medica vigente del trabajador. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 3 | `worker-altitude-clearance` | Aptitud medica para faena sobre 3000m. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | DS-28 |
| 4 | `worker-confined-space-clearance` | Aptitud para entrada a espacio confinado. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 5 | `worker-hot-work-permit` | Permiso vigente para trabajos en caliente. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-51B |
| 6 | `worker-hv-electrical-permit` | Permiso para trabajos electricos en alta tension. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 7 | `epp-helmet` | Casco de seguridad asignado. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NCh-461 |
| 8 | `epp-harness` | Arnes de cuerpo entero para trabajo en altura. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |
| 9 | `epp-respirator-half` | Respirador media cara. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NIOSH-42-CFR-84 |
| 10 | `epp-respirator-full` | Respirador cara completa. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NIOSH-42-CFR-84 |
| 11 | `epp-respirator-papr` | Respirador motorizado purificador de aire. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NIOSH-42-CFR-84 |
| 12 | `epp-eye-protection` | Proteccion ocular (lentes/goggles/face shield). | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | ANSI-Z87.1 |
| 13 | `epp-hearing-double` | Doble proteccion auditiva (tapon + orejera). | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 14 | `epp-hearing-single` | Proteccion auditiva simple. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 15 | `epp-gloves-cut-A` | Guantes anticorte nivel A (EN-388). | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | EN-388 |
| 16 | `epp-gloves-chemical` | Guantes para riesgo quimico (EN-374). | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | EN-374 |
| 17 | `epp-boots-dielectric` | Calzado de seguridad dielectrico. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 18 | `epp-boots-steel` | Calzado de seguridad con punta de acero. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | EN-12568 |
| 19 | `epp-flame-retardant` | Vestuario ignifugo (FR). | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-2112 |
| 20 | `epp-arc-flash` | Traje contra arco electrico. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-70E |
| 21 | `epp-hi-vis` | Vestuario de alta visibilidad. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | EN-ISO-20471 |
| 22 | `epp-fall-arrest` | Sistema de detencion de caidas (linea de vida + arnes). | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |
| 23 | `cert-iperc` | Certificacion IPERC del trabajador. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 24 | `cert-altura` | Certificacion de trabajo en altura. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 25 | `cert-confinado` | Certificacion de trabajo en espacio confinado. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 26 | `cert-rigger` | Certificacion de rigger/aparejador. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 27 | `cert-grua` | Certificacion de operador de grua. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 28 | `cert-soldador` | Certificacion AWS/IIW de soldador. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | AWS-D1.1 |
| 29 | `exam-audiometria` | Examen de audiometria ocupacional. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 30 | `exam-espirometria` | Examen de espirometria ocupacional. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 31 | `exam-vista` | Examen de visiometria. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 32 | `exam-altura-geografica` | Examen pre-ocupacional para altura geografica. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | DS-28 |
| 33 | `exam-musculo-esqueletico` | Examen musculoesqueletico (TMERT). | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 34 | `exam-psicosensometrico` | Examen psicosensometrico. | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 35 | `training-induccion` | Capacitacion de induccion hombre nuevo. | `src/pages/Training.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 36 | `training-charla-5min` | Charla diaria de seguridad de 5 minutos. | `src/pages/Training.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 37 | `training-evacuacion` | Capacitacion en plan de evacuacion. | `src/pages/Training.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 38 | `fatigue-alert` | Alerta de fatiga del trabajador. | `src/services/zettelkasten/bernoulli/respiratorFatigue.ts` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 39 | `biometric-anomaly` | Anomalia biometrica (HR, SpO2, HRV). | `src/pages/BioAnalysis.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 40 | `manual-handling-load` | Carga de manipulacion manual sobre limite. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | Ley-20949 |
| 41 | `epp-exposure-pairing` | Pareo entre EPP asignado y exposicion del trabajador. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 42 | `epp-fit-test` | Resultado de fit-test cualitativo/cuantitativo. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NIOSH-42-CFR-84 |
| 43 | `epp-replacement-due` | EPP cuya vida util ha vencido. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | NIOSH-42-CFR-84 |
| 44 | `epp-stockout-warning` | Advertencia de quiebre de stock de EPP. | `src/pages/Inventory.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 45 | `epp-non-compliance-detected` | No conformidad detectada en uso de EPP (vision). | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 46 | `worker-vacation-window` | Ventana de vacaciones del trabajador. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 47 | `worker-shift-pattern` | Patron de turnos del trabajador. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | Ley-20949 |
| 48 | `worker-overtime-alert` | Alerta de sobretiempo sostenido. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | Ley-20949 |
| 49 | `subcontractor-credential` | Credencial vigente de subcontratista. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | DS-76 |
| 50 | `visitor-induction` | Induccion entregada a visitante en faena. | `src/pages/Workers.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |

## Familia: events-incidents (60 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `man-down-event` | Evento man-down detectado por beacon BLE. | `src/services/manDownDetector.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 2 | `man-down-cancelled-by-user` | Man-down cancelado manualmente por el usuario. | `src/services/manDownDetector.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 3 | `man-down-confirmed` | Man-down confirmado tras ventana de gracia. | `src/services/manDownDetector.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 4 | `geofence-breach-entry` | Entrada a geofence restringida. | `src/services/geofenceService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 5 | `geofence-breach-exit` | Salida no autorizada de geofence. | `src/services/geofenceService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 6 | `geofence-restricted-zone-violation` | Violacion a zona restringida (ATEX, voladura). | `src/services/geofenceService.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 7 | `near-miss` | Cuasi-accidente reportado. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 8 | `first-aid-event` | Atencion de primeros auxilios. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 9 | `lost-time-injury` | Lesion con tiempo perdido (LTI). | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 10 | `restricted-work-injury` | Lesion con trabajo restringido. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 11 | `medical-treatment-injury` | Lesion con tratamiento medico. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 12 | `fatality` | Accidente con resultado fatal. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 13 | `property-damage` | Dano material sin lesion. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 14 | `environmental-spill` | Derrame ambiental reportable. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-43 |
| 15 | `fire-event` | Evento de incendio. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 16 | `explosion-event` | Evento de explosion. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-30 |
| 17 | `electric-arc-event` | Evento de arco electrico. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-70E |
| 18 | `fall-from-height` | Caida de altura. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |
| 19 | `struck-by` | Golpe por objeto en movimiento. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 20 | `caught-in-between` | Atrapamiento entre objetos. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 21 | `overexertion-event` | Sobreesfuerzo musculo-esqueletico. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 22 | `exposure-acute` | Exposicion aguda a agente. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 23 | `exposure-chronic-flag` | Marcador de exposicion cronica acumulada. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 24 | `asphyxiation-risk-event` | Riesgo de asfixia en espacio confinado. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 25 | `crush-event` | Aplastamiento. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 26 | `cut-laceration` | Corte o laceracion. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | EN-388 |
| 27 | `burn-thermal` | Quemadura termica. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-2112 |
| 28 | `burn-chemical` | Quemadura quimica. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | EN-374 |
| 29 | `burn-electrical` | Quemadura electrica. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-70E |
| 30 | `gas-release-event` | Liberacion no controlada de gas. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-66 |
| 31 | `lel-proximity-warning` | Cercania a LEL detectada por sensor. | `src/services/sensorIngest.ts` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 32 | `odor-anomaly-report` | Reporte ciudadano de olor anomalo. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 33 | `noise-overexposure-event` | Sobreexposicion a ruido (PREXOR). | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 34 | `vibration-overexposure-event` | Sobreexposicion a vibracion mano-brazo o cuerpo entero. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 35 | `evacuation-triggered` | Evacuacion iniciada. | `src/pages/EmergenciaAvanzada.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 36 | `evacuation-completed` | Evacuacion completada con conteo final. | `src/pages/EmergenciaAvanzada.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 37 | `shelter-in-place-triggered` | Refugio en lugar activado. | `src/pages/EmergenciaAvanzada.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 38 | `lockdown-triggered` | Bloqueo de instalacion activado. | `src/pages/EmergenciaAvanzada.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 39 | `rescue-team-dispatched` | Equipo de rescate despachado. | `src/pages/EmergenciaAvanzada.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 40 | `medevac-dispatched` | Evacuacion medica despachada. | `src/pages/EmergenciaAvanzada.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 41 | `iper-finding` | Hallazgo IPER en matriz de riesgos. | `src/pages/IperMatrix.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 42 | `iper-finding-closed` | Hallazgo IPER cerrado con verificacion. | `src/pages/IperMatrix.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 43 | `iper-corrective-action-overdue` | Accion correctiva IPER vencida. | `src/pages/IperMatrix.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 44 | `audit-finding` | Hallazgo de auditoria. | `src/pages/Audits.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 45 | `audit-non-conformity` | No conformidad de auditoria. | `src/pages/Audits.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 46 | `audit-observation` | Observacion de auditoria. | `src/pages/Audits.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 47 | `inspection-pre-task` | Inspeccion pre-tarea (5 pasos). | `src/pages/Inspections.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 48 | `inspection-equipment` | Inspeccion de equipo critico. | `src/pages/Inspections.tsx` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 49 | `inspection-area` | Inspeccion de area de trabajo. | `src/pages/Inspections.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 50 | `permit-issued` | Permiso emitido. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 51 | `permit-revoked` | Permiso revocado. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 52 | `permit-expired` | Permiso expirado. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 53 | `stop-work-issued` | Detencion de trabajo (Stop Work) emitida. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 54 | `stop-work-lifted` | Detencion de trabajo levantada. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 55 | `sif-precursor` | Precursor de lesion grave/fatalidad (SIF). | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 56 | `lessons-learned-published` | Leccion aprendida publicada. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 57 | `safety-alert-broadcast` | Alerta de seguridad difundida masivamente. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 58 | `incident-investigation-opened` | Investigacion de incidente abierta. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 59 | `incident-investigation-closed` | Investigacion de incidente cerrada. | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 60 | `falling-objects` | Objetos en caida desde altura (riesgo derivado). | `src/pages/Incidents.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |

## Familia: assets-faena (80 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `asset-grua-torre` | Grua torre de obra. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 2 | `asset-grua-movil` | Grua movil sobre camion. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 3 | `asset-grua-pluma` | Grua pluma articulada. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 4 | `asset-grua-puente` | Grua puente en nave industrial. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 5 | `asset-andamio-tubular` | Andamio tubular de fachada. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |
| 6 | `asset-andamio-colgante` | Andamio colgante motorizado. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |
| 7 | `asset-andamio-multidireccional` | Andamio multidireccional sistema. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-451 |
| 8 | `asset-plataforma-elevadora` | Plataforma elevadora movil. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | EN-280 |
| 9 | `asset-tijera` | Plataforma de tijera. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | EN-280 |
| 10 | `asset-brazo-articulado` | Brazo articulado tipo boom-lift. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | EN-280 |
| 11 | `asset-hidrante` | Hidrante de red contra incendio. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-1646 |
| 12 | `asset-bie` | BIE — Boca de incendio equipada. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-1646 |
| 13 | `asset-rociador` | Rociador automatico (sprinkler). | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-13 |
| 14 | `asset-extintor` | Extintor portatil. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-1430 |
| 15 | `asset-tanque-hazmat` | Tanque de almacenamiento hazmat. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-43 |
| 16 | `asset-tanque-combustible` | Tanque de combustible. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-30 |
| 17 | `asset-tanque-glp` | Tanque de GLP. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-58 |
| 18 | `asset-cilindro-gas` | Cilindro de gas industrial. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-1377 |
| 19 | `asset-bombona-soldadura` | Bombona de gas para soldadura. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | AWS-D1.1 |
| 20 | `asset-tuberia-proceso` | Tuberia de proceso industrial. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B31.3 |
| 21 | `asset-tuberia-incendio` | Tuberia de red contra incendio. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 22 | `asset-ducto-ventilacion` | Ducto de ventilacion mecanica. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 23 | `asset-bomba-centrifuga` | Bomba centrifuga de proceso. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | API-610 |
| 24 | `asset-compresor-aire` | Compresor de aire industrial. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | ASME-PTC-10 |
| 25 | `asset-generador` | Generador electrico de respaldo. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-110 |
| 26 | `asset-tablero-electrico-bt` | Tablero electrico baja tension. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 27 | `asset-tablero-electrico-mt` | Tablero electrico media tension. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 28 | `asset-tablero-electrico-at` | Tablero electrico alta tension. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 29 | `asset-transformador` | Transformador de potencia. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | IEC-60076 |
| 30 | `asset-ups` | UPS — Sistema de alimentacion ininterrumpida. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | IEC-62040 |
| 31 | `asset-banco-baterias` | Banco de baterias estacionario. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | IEC-62619 |
| 32 | `asset-camion-tolva` | Camion tolva. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 33 | `asset-camion-cisterna` | Camion cisterna. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-43 |
| 34 | `asset-camion-pluma` | Camion pluma. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 35 | `asset-cargador-frontal` | Cargador frontal. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 36 | `asset-bulldozer` | Bulldozer. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 37 | `asset-excavadora` | Excavadora hidraulica. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 38 | `asset-perforadora` | Perforadora. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 39 | `asset-jumbo` | Jumbo de perforacion subterranea. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 40 | `asset-lhd` | LHD — Cargador subterraneo. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 41 | `asset-soldadora-arc` | Maquina de soldar al arco. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | AWS-D1.1 |
| 42 | `asset-soldadora-mig` | Maquina de soldar MIG/MAG. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | AWS-D1.1 |
| 43 | `asset-soldadora-tig` | Maquina de soldar TIG. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | AWS-D1.1 |
| 44 | `asset-radial` | Esmeril angular (radial). | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | EN-60745 |
| 45 | `asset-taladro-percutor` | Taladro percutor. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | EN-60745 |
| 46 | `asset-sierra-circular` | Sierra circular. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | EN-60745 |
| 47 | `sensor-iot-co` | Sensor IoT de monoxido de carbono. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 48 | `sensor-iot-co2` | Sensor IoT de dioxido de carbono. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 49 | `sensor-iot-h2s` | Sensor IoT de acido sulfhidrico. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 50 | `sensor-iot-o2` | Sensor IoT de oxigeno. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 51 | `sensor-iot-lel` | Sensor IoT de LEL (limite explosivo inferior). | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 52 | `sensor-iot-pm25` | Sensor IoT de PM2.5. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 53 | `sensor-iot-pm10` | Sensor IoT de PM10. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 54 | `sensor-iot-noise` | Sensor IoT de ruido. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 55 | `sensor-iot-vibration` | Sensor IoT de vibracion. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 56 | `sensor-iot-temperatura` | Sensor IoT de temperatura ambiente. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 57 | `sensor-iot-humedad` | Sensor IoT de humedad relativa. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 58 | `sensor-iot-presion` | Sensor IoT de presion (proceso o linea). | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | ASME-B31.3 |
| 59 | `sensor-iot-flujo` | Sensor IoT de flujo (caudal). | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 60 | `sensor-iot-piezometro` | Sensor IoT piezometro en talud o dique. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-248 |
| 61 | `sensor-iot-uv` | Sensor IoT de radiacion UV. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 62 | `sensor-iot-radiacion` | Sensor IoT de radiacion ionizante. | `src/services/sensorIngest.ts` | `src/services/zettelkasten/climateRiskCoupling.ts`, `src/pages/RiskNetwork.tsx` | DS-3 |
| 63 | `beacon-ble-mandown` | Beacon BLE para deteccion man-down. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 64 | `beacon-ble-geofence` | Beacon BLE para geofencing. | `src/pages/Equipment.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 65 | `site-faena` | Faena: contenedor topologico raiz. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-76 |
| 66 | `site-zona` | Zona dentro de una faena. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-76 |
| 67 | `site-frente-trabajo` | Frente de trabajo activo. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 68 | `site-acceso` | Punto de acceso o portal de la faena. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 69 | `site-bodega` | Bodega de almacenamiento. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-43 |
| 70 | `site-comedor` | Comedor del personal. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 71 | `site-banos` | Servicios higienicos. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 72 | `site-enfermeria` | Enfermeria o policlinico de faena. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 73 | `site-sala-mando` | Sala de mando o control. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 74 | `site-helipuerto` | Helipuerto para evacuacion aeromedica. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | internal |
| 75 | `site-punto-encuentro` | Punto de encuentro de evacuacion. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 76 | `site-via-evacuacion` | Via de evacuacion senalizada. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 77 | `site-zona-segura` | Zona segura de evacuacion. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-594 |
| 78 | `site-zona-restringida` | Zona restringida (acceso controlado). | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | DS-132 |
| 79 | `site-zona-explosion-atex` | Zona ATEX (atmosferas explosivas). | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | IEC-60079 |
| 80 | `site-zona-confinada-declarada` | Zona declarada como espacio confinado. | `src/pages/Sites.tsx` | `src/pages/EmergenciaAvanzada.tsx`, `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |

## Familia: workflow-compliance (80 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `diat` | Declaracion individual de accidente del trabajo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 2 | `diep` | Declaracion individual de enfermedad profesional. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 3 | `libro-obras-entry` | Asiento del libro de obras. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 4 | `acta-cphs` | Acta de comite paritario de higiene y seguridad. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-54 |
| 5 | `plan-evacuacion` | Plan de evacuacion. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 6 | `plan-emergencia` | Plan de emergencia. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 7 | `plan-prevencion` | Plan de prevencion de riesgos. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 8 | `simulacro-evacuacion` | Simulacro de evacuacion. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 9 | `simulacro-incendio` | Simulacro de incendio. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-14 |
| 10 | `simulacro-rescate-confinado` | Simulacro de rescate en espacio confinado. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 11 | `simulacro-derrame-quimico` | Simulacro de derrame quimico. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-43 |
| 12 | `simulacro-medevac` | Simulacro de evacuacion medica. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 13 | `permit-trabajo-altura` | Permiso de trabajo en altura. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 14 | `permit-trabajo-caliente` | Permiso de trabajo en caliente. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | NFPA-51B |
| 15 | `permit-espacio-confinado` | Permiso de trabajo en espacio confinado. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-146 |
| 16 | `permit-electrico-bt` | Permiso de trabajo electrico baja tension. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 17 | `permit-electrico-mt-at` | Permiso de trabajo electrico media/alta tension. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | NCh-Elec-4 |
| 18 | `permit-izaje-critico` | Permiso de izaje critico. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | ASME-B30 |
| 19 | `permit-excavacion` | Permiso de excavacion. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1926-651 |
| 20 | `permit-buceo` | Permiso de buceo industrial. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | DS-752 |
| 21 | `permit-radiografia` | Permiso de radiografia industrial. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | DS-3 |
| 22 | `permit-trabajo-nocturno` | Permiso de trabajo nocturno. | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | Ley-20949 |
| 23 | `permit-aislamiento-loto` | Permiso de aislamiento de energias (LOTO). | `src/pages/Permits.tsx` | `src/pages/RiskNetwork.tsx` | OSHA-1910-147 |
| 24 | `matriz-iper` | Matriz IPER de riesgos. | `src/pages/IperMatrix.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 25 | `matriz-aspectos-ambientales` | Matriz de aspectos e impactos ambientales. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-14001 |
| 26 | `matriz-legal-aplicable` | Matriz de legislacion aplicable. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 27 | `procedimiento-trabajo-seguro` | Procedimiento de trabajo seguro (PTS). | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 28 | `instructivo-tarea` | Instructivo de tarea especifica. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 29 | `estandar-operacional` | Estandar operacional. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 30 | `check-list-pre-uso` | Check list pre-uso de equipo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | NCh-432 |
| 31 | `check-list-cinco-pasos` | Check list de 5 pasos pre-tarea. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 32 | `ats-analisis-trabajo-seguro` | ATS — Analisis de Trabajo Seguro. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 33 | `auditoria-interna` | Auditoria interna SGI. | `src/pages/Audits.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 34 | `auditoria-externa` | Auditoria externa de tercera parte. | `src/pages/Audits.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 35 | `certificacion-iso-45001` | Certificacion ISO 45001 vigente. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 36 | `certificacion-ohsas-18001` | Certificacion OHSAS 18001 (legacy). | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | OHSAS-18001 |
| 37 | `mutual-rate-cotizacion` | Tasa de cotizacion adicional Mutual (DS-110). | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-110 |
| 38 | `denuncia-mutual` | Denuncia de accidente a Mutual. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 39 | `investigacion-causa-raiz` | Investigacion de causa raiz (RCA). | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 40 | `plan-accion-correctivo` | Plan de accion correctivo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 41 | `plan-accion-preventivo` | Plan de accion preventivo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 42 | `verificacion-eficacia-accion` | Verificacion de eficacia de accion. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 43 | `comunicado-cphs` | Comunicado oficial del CPHS. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-54 |
| 44 | `reglamento-interno` | Reglamento interno de orden, higiene y seguridad (RIOHS). | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 45 | `mof-manual-organizacion-funciones` | Manual de organizacion y funciones. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 46 | `organigrama-prevencion` | Organigrama del area de prevencion. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 47 | `comite-paritario-acta` | Acta de sesion del comite paritario. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-54 |
| 48 | `comite-paritario-eleccion` | Eleccion de comite paritario. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-54 |
| 49 | `comite-paritario-capacitacion` | Capacitacion al comite paritario. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-54 |
| 50 | `derecho-saber` | Derecho a saber entregado al trabajador. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 51 | `derecho-saber-recibido` | Constancia de recepcion de derecho a saber. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 52 | `odi-obligacion-informar` | Obligacion de informar (ODI) registrada. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 53 | `capacitacion-anual-plan` | Plan anual de capacitacion. | `src/pages/Training.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 54 | `capacitacion-evidencia` | Evidencia de capacitacion realizada. | `src/pages/Training.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 55 | `capacitacion-evaluacion` | Evaluacion post-capacitacion. | `src/pages/Training.tsx` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 56 | `kpi-tasa-frecuencia` | KPI tasa de frecuencia de accidentes. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 57 | `kpi-tasa-gravedad` | KPI tasa de gravedad de accidentes. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 58 | `kpi-tasa-accidentabilidad` | KPI tasa de accidentabilidad. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 59 | `kpi-cumplimiento-ipercs` | KPI cumplimiento IPERCs. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 60 | `kpi-cumplimiento-charlas` | KPI cumplimiento charlas diarias. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 61 | `kpi-cumplimiento-inspecciones` | KPI cumplimiento de inspecciones planificadas. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 62 | `reporte-mensual-cphs` | Reporte mensual del CPHS. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-54 |
| 63 | `reporte-mensual-mutual` | Reporte mensual a Mutual. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 64 | `reporte-anual-superintendencia` | Reporte anual a la Superintendencia. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 65 | `multa-recibida` | Multa recibida por fiscalizacion. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | internal |
| 66 | `fiscalizacion-dt` | Fiscalizacion de la Direccion del Trabajo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Ley-16744 |
| 67 | `fiscalizacion-seremi` | Fiscalizacion de la SEREMI de Salud. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 68 | `fiscalizacion-sernageomin` | Fiscalizacion de SERNAGEOMIN. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 69 | `observacion-seremi` | Observacion emitida por la SEREMI. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 70 | `orden-paralizacion` | Orden de paralizacion de faena. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 71 | `levantamiento-paralizacion` | Levantamiento de paralizacion de faena. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 72 | `cierre-faena` | Cierre formal de faena. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-76 |
| 73 | `apertura-faena` | Apertura formal de faena. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-76 |
| 74 | `aviso-faena-dt` | Aviso de faena a la Direccion del Trabajo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-76 |
| 75 | `aviso-faena-seremi` | Aviso de faena a la SEREMI de Salud. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 76 | `contrato-trabajador` | Contrato individual de trabajo. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Codigo-Trabajo |
| 77 | `finiquito-trabajador` | Finiquito del trabajador. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | Codigo-Trabajo |
| 78 | `historial-medico-pre-ocupacional` | Historial medico pre-ocupacional. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 79 | `historial-medico-ocupacional` | Historial medico ocupacional. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 80 | `historial-medico-egreso` | Historial medico de egreso. | `src/pages/Compliance.tsx` | `src/pages/RiskNetwork.tsx` | DS-594 |

## Familia: ai-analytics (52 nodos)

| # | ID | Descripcion | Producer | Consumers | Source |
|---|----|-------------|----------|-----------|--------|
| 1 | `ai-prediction-accident` | Prediccion AI de probabilidad de accidente. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 2 | `ai-prediction-equipment-failure` | Prediccion AI de falla de equipo. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 3 | `ai-prediction-weather` | Prediccion AI acoplada al clima. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 4 | `ai-prediction-fatigue` | Prediccion AI de fatiga del trabajador. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 5 | `ai-prediction-non-compliance` | Prediccion AI de no conformidad. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 6 | `ai-recommendation-epp` | Recomendacion AI de EPP. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 7 | `ai-recommendation-stop-work` | Recomendacion AI de stop-work. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 8 | `ai-recommendation-training` | Recomendacion AI de capacitacion. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | DS-40 |
| 9 | `ai-recommendation-route` | Recomendacion AI de ruta segura. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 10 | `ai-recommendation-control` | Recomendacion AI de control operacional. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | ISO-45001 |
| 11 | `ai-alert-triggered` | Alerta AI disparada. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 12 | `ai-alert-acknowledged` | Alerta AI reconocida por humano. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 13 | `ai-alert-dismissed` | Alerta AI descartada por humano. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 14 | `ai-alert-escalated` | Alerta AI escalada. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 15 | `ai-alert-false-positive-flag` | Alerta marcada como falso positivo. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 16 | `audit-trail-prompt` | Registro inmutable del prompt enviado al LLM. | `src/services/auditLog.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 17 | `audit-trail-response` | Registro inmutable de la respuesta del LLM. | `src/services/auditLog.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 18 | `audit-trail-tool-call` | Registro inmutable de cada tool-call. | `src/services/auditLog.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 19 | `audit-trail-decision` | Registro inmutable de decision tomada por el sistema. | `src/services/auditLog.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 20 | `audit-trail-override-by-human` | Registro inmutable de override humano. | `src/services/auditLog.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 21 | `rag-citation` | Cita RAG referenciando un nodo del grafo. | `src/services/rag.ts` | `src/pages/RiskNetwork.tsx` | RFC-9457 |
| 22 | `rag-chunk-retrieved` | Chunk recuperado por RAG. | `src/services/rag.ts` | `src/pages/RiskNetwork.tsx` | RFC-9457 |
| 23 | `rag-context-augmented` | Contexto aumentado con RAG previo a inferencia. | `src/services/rag.ts` | `src/pages/RiskNetwork.tsx` | RFC-9457 |
| 24 | `env-context-snapshot` | Snapshot del contexto ambiental para ask-guardian. | `src/server/routes/gemini.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 25 | `orchestrator-call-weather` | Llamada del orchestrator a adaptador weather. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 26 | `orchestrator-call-seismic` | Llamada del orchestrator a adaptador seismic. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | USGS |
| 27 | `orchestrator-call-aqi` | Llamada del orchestrator a adaptador AQI. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | EPA |
| 28 | `gran-maestro-output-json` | Salida JSON estricta del Gran Maestro. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 29 | `vision-detection-epp-present` | Vision detecto EPP correcto. | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 30 | `vision-detection-epp-missing` | Vision detecto ausencia de EPP. | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | DS-594 |
| 31 | `vision-detection-posture-bad` | Vision detecto postura ergonomica deficiente. | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 32 | `vision-detection-zone-intrusion` | Vision detecto intrusion a zona restringida. | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | DS-132 |
| 33 | `vision-detection-fire` | Vision detecto fuego. | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | NFPA-72 |
| 34 | `vision-detection-smoke` | Vision detecto humo. | `src/services/visionAnalyzer.ts` | `src/pages/RiskNetwork.tsx` | NFPA-72 |
| 35 | `embedding-document` | Embedding vectorial de un documento. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 36 | `embedding-incident-narrative` | Embedding vectorial de narrativa de incidente. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 37 | `embedding-image` | Embedding vectorial de una imagen. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 38 | `cluster-similar-incidents` | Cluster de incidentes similares. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 39 | `cluster-similar-near-misses` | Cluster de cuasi-accidentes similares. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 40 | `anomaly-detection-sensor` | Anomalia detectada en sensor IoT. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 41 | `anomaly-detection-behavior` | Anomalia detectada en comportamiento. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 42 | `anomaly-detection-shift` | Anomalia detectada en patron de turno. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 43 | `forecast-accident-risk-7d` | Forecast de riesgo de accidente a 7 dias. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 44 | `forecast-fatigue-rolling-72h` | Forecast de fatiga rolling 72h. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | SUSESO |
| 45 | `forecast-weather-coupled-risk` | Forecast de riesgo acoplado al clima. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 46 | `forecast-seismic-aftershock` | Forecast de replicas sismicas. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | USGS |
| 47 | `model-drift-warning` | Advertencia de drift en modelo desplegado. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 48 | `model-retrain-event` | Evento de reentrenamiento de modelo. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 49 | `model-version-deployed` | Despliegue de nueva version de modelo. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 50 | `feature-flag-experiment` | Experimento via feature flag. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 51 | `a-b-test-cohort` | Cohorte de A/B test. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |
| 52 | `a-b-test-result` | Resultado de A/B test. | `src/services/orchestratorService.ts` | `src/pages/RiskNetwork.tsx` | internal |

---

## Reglas de Auto-Coupling (resumen)

Las reglas detalladas viven en `ZETTELKASTEN_V2_SPEC.md` seccion 4. Este catalogo provee las IDs canonicas que dichas reglas referencian.

Resumen por familia:
- **PHYSICS & FLUIDS**: cada use case Bernoulli emite 4 nodos hijos compartiendo `parentBernoulliRunId`. Ver §4.1 spec.
- **CLIMATE**: `seismic-event` precede `seismic-aftershock-window` (72h). `gas-dispersion-plume` tiene instancia → plume-zone-{red,orange,yellow}.
- **OHS & NORMATIVA**: cada cuerpo legal tronco `has_instance` → articulos especificos (e.g. `norma-DS-594` → `norma-DS-594-Art-32`).
- **PERSONAL & EPP**: `worker-altitude-clearance` requires `exam-altura-geografica`; `epp-respirator-*` regulated_by `norma-NIOSH-42-CFR-84`.
- **EVENTS**: `man-down-confirmed` precedes `medevac-dispatched` y `diat`.
- **ASSETS**: `asset-grua-torre` requires `cert-rigger` y `cert-grua`; sensores IoT alimentan reglas Bernoulli.
- **WORKFLOW**: `permit-trabajo-altura` requires `epp-harness`, `epp-helmet`, `cert-altura`, `exam-vista`.
- **AI**: `gran-maestro-output-json` references `env-context-snapshot` y `rag-chunk-retrieved` por cita.

## Citas de Fuentes (campo source)

- ANSI-Z87.1
- API-610
- ASME-B30
- ASME-B31.3
- ASME-PTC-10
- AWS-D1.1
- CONAF
- Codigo-Trabajo
- DGA
- DMC
- DS-110
- DS-132
- DS-144
- DS-248
- DS-28
- DS-3
- DS-40
- DS-43
- DS-54
- DS-594
- DS-66
- DS-752
- DS-76
- EN-12568
- EN-280
- EN-374
- EN-388
- EN-60745
- EN-ISO-20471
- EPA
- Eurocodigo-7
- IEC-60076
- IEC-60079
- IEC-61400-2
- IEC-62040
- IEC-62619
- ISO-14001
- ISO-45001
- Ley-16744
- Ley-20949
- NCh-1377
- NCh-1430
- NCh-1646
- NCh-432
- NCh-461
- NCh-Elec-4
- NFPA-110
- NFPA-13
- NFPA-14
- NFPA-2112
- NFPA-30
- NFPA-51B
- NFPA-58
- NFPA-70E
- NFPA-72
- NFPA-780
- NIOSH-42-CFR-84
- OHSAS-18001
- OSHA-1910-146
- OSHA-1910-147
- OSHA-1926-451
- OSHA-1926-651
- Pasquill-Gifford
- RFC-9457
- SERNAGEOMIN
- SHOA
- SUSESO
- USGS
- internal

---

Documento sincronizado con commit. Toda divergencia entre este archivo y los registries TS debe resolverse re-generando este markdown via `npx tsx scripts/generateZettelkastenMarkdown.ts`.
