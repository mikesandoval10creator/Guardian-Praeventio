# Baseline de conectividad "todo real y conectado" (2026-06-17)

Medición de cuánto trabajo CONSTRUIDO está sin conectar (huérfano), para volver medible "hacer real toda la app". Método: scan determinista de símbolos no-referenciados (excluye tests) → triage multi-agente (14 agentes, lectura del código real) clasificando cada huérfano.

## El número, corregido y honesto

Candidatos huérfanos detectados: **129**. Corregido restando falsos positivos:

| Categoría | N | Qué es |
|---|---|---|
| **mountable_now** | 66 (−9 ya-montados = **~57 reales**) | Feature construida + backend/dato real existe → **montar = hacerlo real hoy** |
| **needs_design** | 35 | Construida + servicio real existe, pero falta una página/fetch o un endpoint que la alimente |
| duplicate_already_inline | 10 | Ya renderizada inline en otra pantalla (montar duplicaría) |
| false_orphan / util / dead | 18 | Falsos positivos de la heurística (no son deuda) |
| + ya-montados dentro de mountable | 9 | DrillResult, DriverScore, EmergencyBrigade, EngineeringInventory, Equipment, mapConfig, RoleViews, syncConflictRoutes, useEquipment |
| **blocked_external** | 0 | (nada bloqueado por credencial/modelo/hardware) |

**Deuda real de conexión ≈ 92 features** construidas y sin montar — **~57 conectables YA**, **~35 necesitan una página/fetch/endpoint pequeño**. Cero perdidas: todas existen en el código.

## La respuesta a "¿perdimos ideas/propuestas?"

**No.** Hay ~90 features construidas (con motores y backends reales) esperando ser conectadas. "Hacer real la app" es, en gran parte, **un trabajo finito de cableado**, no construir de cero ni recuperar nada borrado.

## Roadmap connect-real — VIDA/LEGAL montables YA (30, prioridad 1)

Cada una: la feature existe, su backend/motor es real, solo falta montarla.

- **CPHS** `CphsCommitteeStatusCard` → CphsModule (quórum/elección reales)
- **Roles críticos** `CriticalRoleCoverageCard` → cobertura + plan de capacitación (POST /critical-roles)
- **Gestión del Cambio (MOC)** `ChangeDeclarationForm` + `MOCStatusPanel` + `AcknowledgmentBanner` → página MOC (useOperationalChange real)
- **Acciones correctivas** `ActionBalanceCard` → CorrectiveActions (weakActionDetector real)
- **Semáforo de cumplimiento** `ComplianceTrafficLight` → header Dashboard (trafficLightEngine real)
- **Línea de fuego** `LineOfFireValidationCard` → planificación de tarea (lineOfFireChecker real)
- **Hazmat DS 43/2016** `HazmatStorageManager` → inventario hazmat (hazmatInventory real)
- **Vencimientos** `ExpirationsListPanel` → dashboard prevencionista (expirations.ts real)
- **Obligaciones legales** `useLegalObligations` → calendario legal (5 endpoints reales)
- **Régimen de privacidad** `PrivacyRegimeCard` → cumplimiento (registry real)
- **Cierre de proyecto** `ProjectClosureCard` → ProjectClosure (6 endpoints reales)
- **Cadena de custodia** `CustodyChainTimelineCard` → investigación de incidente (custodyChain.ts real)
- **ISO 45001** `Iso45001Catalog` → cumplimiento (ISO_45001_CONTROLS real)
- **Cálculo de pandeo (Euler)** `BucklingCalculatorCard` → auditoría estructural (criticalLoad real)
- **Pre-uso de vehículo** `VehiclePreOpChecklistCard` · **SLA/escalación** `SlaWatchPanel` · **firma PIN** `PinSignModal` · **historial portable** `PortableHistoryPreview` · **versionado de documentos** `useDocumentVersioning` · **microcapacitación** `useMicrotraining` · **vulnerabilidad** `useVulnerability` · **residuos** `useWaste`

## needs_design (35) — construidas, falta una pieza de cableado

La mayoría son presentadores puros cuyo servicio YA es real (SPOF, ContractorRanking, WasteInventory, HeatStress/WBGT, AirQuality/CO2, Glossary, DeviationRadar, NonConformity, MeetingPack, MonthlyClientReport, LegalDocGenerator, etc.). Falta: una página que haga el fetch + pase props, o un endpoint que falta exponer. No son ideas perdidas — son cableado de 1 paso más.

## Propuesta: ratchet de conectividad

Igual que el ratchet de `as any` (155) e i18n-parity: fijar la baseline de huérfanos como número que **solo puede bajar**, con un gate en CI. Convierte "todo conectado y real" en algo medible que no puede retroceder.
