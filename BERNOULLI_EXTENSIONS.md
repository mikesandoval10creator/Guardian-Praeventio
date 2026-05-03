# BERNOULLI EXTENSIONS — 15 Use Cases para el Motor de Dinámica de Fluidos

> Documento creado: 2026-05-03 | Sprint 5 cierre + planificación Sprint 9
> Motor base: [`src/services/physics/bernoulliEngine.ts`](src/services/physics/bernoulliEngine.ts) (6 funciones SI puras)

---

## RESUMEN EJECUTIVO

Bernoulli es estratégico para Guardian Praeventio porque **transforma sensores y normativa en alertas físicas accionables**. La ecuación de Bernoulli (`P + ½ρv² + ρgh = constante`) y sus derivados permiten al sistema:

- **Predecir fallas antes del accidente** — caída anómala de presión en redes de gas industrial alerta antes de superar el LEL.
- **Cuantificar fuerzas que normativa describe en prosa** — NCh 432 habla de "carga de viento"; Bernoulli da el número exacto en kN/m².
- **Cerrar el loop sensores → AI → operador** — el motor físico es el "experto" determinista que el Asesor (LLM, no determinista) consulta antes de recomendar EPP o detener una operación.

Cada use case se conecta al **Zettelkasten Neuronal**: cada cálculo Bernoulli no es solo un número, es un **nodo** que se enlaza a EPP, normativa, trabajador, sitio y tiempo. Eso es lo que diferencia a Guardian de un calculador de bolsillo.

---

## ESTADO ACTUAL DEL MOTOR

`bernoulliEngine.ts` — 54 líneas, 6 funciones puras SI:

| Función | Fórmula | Uso típico |
|---------|---------|------------|
| `dynamicPressure(rho, v)` | `q = ½ρv²` | Carga viento, succión cubiertas |
| `staticPressureDelta(rho, v1, v2)` | `ΔP = ½ρ(v₂² − v₁²)` | Venturi, fugas |
| `venturiFlowRate(A, deltaP, rho)` | `Q = A·√(2ΔP/ρ)` | Inyectores, extracción |
| `windLoadOnSurface(rho, v, area, Cp)` | `F = q·A·Cp` | Estructuras, andamios |
| `respiratorPressureDrop(...)` | `ΔP_filtro` | Fatiga respirador, NIOSH |
| `windSpeedKmhToMs(kmh)` | `v[m/s] = kmh/3.6` | Helper |

Tests unitarios: ✅ commit `e063c08`. Hardening post-review: negative deltaP guard + NaN input guard (commit `bad629f`).

---

## ROADMAP VISUAL

| Categoría | Use cases | ✅ implementado | 🔶 parcial | ⏳ pendiente |
|-----------|-----------|-----------------|------------|--------------|
| Operativos (industria/EPP) | 5 | 0 | 0 | 5 |
| Integrados Sprint 5 | 5 | 5 | 0 | 0 |
| Wildcards (ciencia/medio ambiente) | 5 | 0 | 0 | 5 |

**Total: 5 de 15 implementados (33%).** Plan: cerrar los 10 pendientes en Sprint 9 (~30h).

---

## CATEGORÍA A — APLICACIONES OPERATIVAS (5 nuevos)

### A.1 Cálculo de redes de incendio (hidrantes)

| Atributo | Valor |
|----------|-------|
| Categoría | operativo |
| Módulo target | nuevo `FireNetworkCalculator.tsx` (en módulo Emergencia) |
| Fórmula | `Q = A·√(2ΔP/ρ)` aplicada a boquillas; chorro a altura `h = v²·sin²(θ)/(2g)` |
| Norma chilena/internacional | NCh 1646 Of.98 (hidrantes), NFPA 14 (standpipe), DS 594 Art. 41 |
| Esfuerzo | 4h |
| Estado | ⏳ pendiente |

Output esperado: para una boquilla 38mm con presión de red de 4 bar, calcular chorro útil hasta `h ≈ 12m` y caudal `Q ≈ 380 L/min`. Alertar si presión <2 bar (incumplimiento NCh).

### A.2 Sistemas de supresión de polvo (misting, PM10/PM2.5 silica)

| Atributo | Valor |
|----------|-------|
| Categoría | operativo |
| Módulo target | nuevo `DustSuppressionDesigner.tsx` (HazmatDesigner adyacente) |
| Fórmula | `Q = A·√(2ΔP/ρ)` aplicada a inyectores Venturi; tamaño gota d ∝ 1/√v |
| Norma | DS 132/2004 (minería), DS 594 Art. 65 (sílice respirable, OEL 0.025 mg/m³) |
| Esfuerzo | 3h |
| Estado | ⏳ pendiente |

Calcular caudal de agua y aire necesario para cubrir un radio de 5m con gotas <50µm (efectivas contra PM2.5). Conectar a sensor PM2.5 para auto-modulación.

### A.3 Estabilidad de cubiertas y andamios — succión por viento

| Atributo | Valor |
|----------|-------|
| Categoría | operativo |
| Módulo target | extender `StructuralCalculator.tsx` (ya wired NCh 432) |
| Fórmula | `F_succión = q·A·Cp` con Cp negativo (succión) hasta -1.5 en cubiertas curvas |
| Norma | NCh 432 Of.71 (acción del viento), DS 594 Art. 78 (andamios), OSHA 29 CFR 1926.451 |
| Esfuerzo | 3h |
| Estado | ⏳ pendiente |

Alerta de anclaje insuficiente: si `F_succión > resistencia anclaje declarada` → bloquear faena en zona, FCM al supervisor. Cubre lonas, mallas perimetrales, cubiertas livianas.

### A.4 Monitoreo de espacios confinados (HVAC) — gradiente de presión

| Atributo | Valor |
|----------|-------|
| Categoría | operativo |
| Módulo target | extender `ConfinedSpaceMonitor.tsx` o crear si no existe |
| Fórmula | `ΔP = ½ρ(v_extracción² − v_aspiración²)` para garantizar flujo de aire fresco hacia el contaminante pesado |
| Norma | DS 594 Art. 61 (espacios confinados), DS 132 Art. 74, OSHA 29 CFR 1910.146 |
| Esfuerzo | 4h |
| Estado | ⏳ pendiente |

Para H2S (densidad 1.19, más pesado que aire), calcular caudal de extracción inferior necesario. Alertar si gradiente medido por sensor difiere >20% del calculado.

### A.5 Detección de fugas en redes de gas industrial

| Atributo | Valor |
|----------|-------|
| Categoría | operativo |
| Módulo target | nuevo `GasLeakSentinel.ts` + UI en `Telemetry.tsx` |
| Fórmula | desviación de constante de Bernoulli: `ΔE = (P₁/ρ + ½v₁² + gh₁) − (P₂/ρ + ½v₂² + gh₂)` |
| Norma | DS 66/2007 (Reglamento gases combustibles), NCh Elec.4/2003 |
| Esfuerzo | 5h |
| Estado | ⏳ pendiente |

Si dos sensores de presión consecutivos en una línea de GLP muestran ΔE anómalo (más allá de pérdida por fricción esperada según Darcy-Weisbach) → alerta **antes** de superar el LEL (límite explosivo inferior). Activar `appMode = 'emergency'` automáticamente.

---

## CATEGORÍA B — INTEGRADOS EN SPRINT 5 (5 referencias)

### B.6 Ventilación táctica en minería — efecto Venturi extracción gases ✅

| Atributo | Valor |
|----------|-------|
| Categoría | integrado |
| Módulo | `[HazmatStorageDesigner.tsx](src/components/HazmatStorageDesigner.tsx)` |
| Fórmula | `Q = A·√(2ΔP/ρ)` (`venturiFlowRate`) |
| Norma | DS 594 Art. 32 (ventilación), DS 132 Art. 75 (minería subterránea) |
| Esfuerzo | ✅ entregado (commit `9cbb4e8`) |
| Estado | ✅ implementado — UI alert pendiente (B-NEW-03 en PARTE1) |

### B.7 Cálculo de presiones en tuberías hazmat ✅

| Atributo | Valor |
|----------|-------|
| Categoría | integrado |
| Módulo | mismo `HazmatStorageDesigner.tsx` |
| Fórmula | `ΔP = ½ρ(v₂² − v₁²)` |
| Norma | DS 43/2015 (almacenamiento sustancias peligrosas), NFPA 30 |
| Esfuerzo | ✅ entregado |
| Estado | ✅ — extender a fugas predictivas en Sprint 9 (sub-tarea de A.5) |

### B.8 Cargas de viento en estructuras ✅

| Atributo | Valor |
|----------|-------|
| Categoría | integrado |
| Módulo | `StructuralCalculator.tsx` |
| Fórmula | `F = q·A·Cp` con Cp=0.8 (`windLoadOnSurface`) |
| Norma | NCh 432 Of.71 |
| Esfuerzo | ✅ entregado (commit `71a87a8`) |
| Estado | ✅ implementado |

### B.9 Análisis de respiradores (NIOSH) ✅

| Atributo | Valor |
|----------|-------|
| Categoría | integrado |
| Módulo | `[VisionAnalyzer.tsx](src/components/ai/VisionAnalyzer.tsx)` |
| Fórmula | `respiratorPressureDrop` |
| Norma | NIOSH 42 CFR Part 84 (clasificación respiradores), DS 594 Art. 53 |
| Esfuerzo | ✅ entregado (commit `afa8c08`) |
| Estado | ✅ implementado |

### B.10 Ergonomía pulmonar con altitud ✅

| Atributo | Valor |
|----------|-------|
| Categoría | integrado |
| Módulo | `BioAnalysis.tsx` |
| Fórmula | `respiratorPressureDrop` con corrección barométrica `P_atm(h)` |
| Norma | DS 594 Art. 49 (trabajos en altitud geográfica), DS 28/2012 |
| Esfuerzo | ✅ entregado (commit `5178149`) |
| Estado | ✅ implementado |

---

## CATEGORÍA C — WILDCARDS (5 nuevos, ciencia/medio ambiente)

### C.11 Micro-generación eólica para sensores autónomos

| Atributo | Valor |
|----------|-------|
| Categoría | wildcard |
| Módulo target | nuevo `EnergyHarvestPlanner.tsx` (en módulo Telemetry) |
| Fórmula | potencia disponible `P = ½ρv³A·Cp_betz` (límite Betz 0.593) |
| Norma | NCh Elec.4/2003 (instalaciones eléctricas), IEC 61400-2 (small wind) |
| Esfuerzo | 3h |
| Estado | ⏳ pendiente |

Identificar puntos topográficos en la faena con efecto embudo (relieve concentra viento) para alimentar sensores BLE de Man Down sin baterías. Output: mapa con pins de "buen sitio energético".

### C.12 Mecánica de suelos / hidrostática — escape ante derrumbes

| Atributo | Valor |
|----------|-------|
| Categoría | wildcard |
| Módulo target | nuevo `EvacuationPathOptimizer.ts` (extiende DynamicEvacuationMap) |
| Fórmula | ángulo de reposo material + ruta de menor energía potencial `min∫ρgh dl` |
| Norma | DS 132 Art. 32 (estabilidad taludes), Eurocódigo 7 |
| Esfuerzo | 4h |
| Estado | ⏳ pendiente |

Para evacuación en mina/cantera: calcular ruta que minimiza energía potencial perdida (descender) y evita zonas con pendiente > ángulo de reposo del material. Combinar con A* de evacuación existente.

### C.13 Fotogrametría SLAM (LingBot-Map open source)

| Atributo | Valor |
|----------|-------|
| Categoría | wildcard |
| Módulo target | nuevo `DigitalTwinFaena.tsx` |
| Fórmula | gemelo digital + simulación derrame químico por pendiente real (gradiente Bernoulli en superficies) |
| Norma | DS 43/2015 (sustancias peligrosas), NFPA 30 |
| Esfuerzo | 8h (incluye integración LingBot-Map) |
| Estado | ⏳ pendiente |

Reemplaza la idea descartada de AutoCAD (ver PARTE2 §4). Open source, captura con teléfono, malla 3D real. Simular dirección y velocidad de derrame de un químico aplicando Bernoulli sobre el campo de altura. Reemplaza Pizarra/AutoCAD descartados.

### C.14 Hidrostática avanzada — monitor de diques + napas

| Atributo | Valor |
|----------|-------|
| Categoría | wildcard |
| Módulo target | nuevo `DamMonitorService.ts` (en módulo Estructural) |
| Fórmula | presión hidrostática `P = ρgh` + caudal infiltración Darcy `q = -K·∇h` |
| Norma | DS 248/2007 (depósitos de relaves), Resolución 1500 SERNAGEOMIN |
| Esfuerzo | 5h |
| Estado | ⏳ pendiente |

Para mineras con tranques: monitorizar presión piezométrica (sensores enterrados). Caída anormal en presión de un piezómetro respecto a vecinos = posible infiltración. Conectar a `audit_log` para trazabilidad ante autoridad.

### C.15 Termodinámica/difusión — dispersión nubes de gas + zonas exclusión dinámicas

| Atributo | Valor |
|----------|-------|
| Categoría | wildcard |
| Módulo target | nuevo `GasDispersionModel.ts` + overlay en `EmergenciaAvanzada.tsx` |
| Fórmula | modelo Gaussiano de pluma con velocidad de viento Bernoulli + estabilidad atmosférica Pasquill-Gifford |
| Norma | DS 144/1961 (emisiones), guía MINSAL ATSDR |
| Esfuerzo | 6h |
| Estado | ⏳ pendiente |

En accidente con liberación gas tóxico (Cl₂, NH₃, H₂S): calcular zona de exclusión dinámica según viento actual + tasa de fuga + topografía. Mapa overlay rojo/naranja/amarillo por concentración prevista. Conectar a `triggerEmergency('gas_release')` con polígono FCM-broadcasted.

---

## SINERGIA CON ZETTELKASTEN NEURONAL

Cada use case Bernoulli **no es solo un cálculo** — genera nodos y aristas que enriquecen la red de conocimiento de Guardian:

| Use case | Nodos generados | Aristas (conexiones) |
|----------|-----------------|---------------------|
| A.1 Hidrantes | `fire-network`, `nozzle-pressure` | → NCh 1646, → DEAZones, → Plan Emergencia |
| A.3 Cubiertas | `wind-uplift`, `anchor-rating` | → trabajador en altura, → NCh 432, → permiso trabajo |
| A.5 Fugas gas | `pressure-anomaly`, `LEL-proximity` | → emergency_event, → Hazmat inventory, → CPHS reporte |
| B.6 Venturi mina | `venturi-warning` ✅ ya creado | → DS 594, → climateRiskCoupling, → ventilación |
| B.8 Wind load | `windload-warning` ✅ ya creado | → NCh 432, → climate, → estructura |
| C.11 Eólica | `energy-site` | → telemetría, → mantención sensor |
| C.12 Suelos | `slope-risk`, `evacuation-route` | → DS 132, → A* nav, → workforce |
| C.13 SLAM | `digital-twin-mesh`, `chemical-spill-sim` | → Hazmat, → DS 43, → emergencia |
| C.14 Diques | `piezometer-anomaly`, `seepage-zone` | → DS 248, → audit_log inmutable |
| C.15 Dispersión | `plume-zone`, `wind-vector` | → emergency_event, → población expuesta |

**Patrón:** cada uno cumple el principio "Bernoulli como traductor entre física → normativa → acción operativa". El motor genera el dato, el zettelkasten lo conecta, el Asesor (con env context post Sprint 10) lo interpreta y propone.

---

## PRIORIZACIÓN PROPUESTA PARA SPRINT 9

Si no hay 30h disponibles, ejecutar en este orden de valor:

1. **A.5 Fugas gas industrial** (5h) — alto valor seguridad letal.
2. **A.3 Cubiertas y andamios** (3h) — extiende módulo existente, mínimo riesgo integración.
3. **B-NEW-03 (UI alert Hazmat venturi)** (2h) — cierra el loop de B.6 ya integrado.
4. **C.15 Dispersión gas** (6h) — combina con A.5 para escenarios de fuga.
5. **A.1 Hidrantes** (4h).
6. **A.4 HVAC confinado** (4h).
7. **A.2 Misting** (3h).
8. **C.14 Diques** (5h) — específico minería con relaves.
9. **C.12 Suelos** (4h) — mejora evacuación.
10. **C.11 Eólica** (3h).
11. **C.13 SLAM** (8h) — solo si hay design partner pidiéndolo.

Total: 47h si se ejecuta todo. Cortar en `Sprint 9.1 = 1-3` (10h) + `9.2 = 4-7` (17h) + `9.3 = 8-11` (20h).

---

> Próxima revisión: 2026-05-31 tras Sprint 9.1 (3 use cases más críticos).
