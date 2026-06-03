# DEEP-EXT-05 — Auditoría exhaustiva de tests (Lote #5)

**Atestación:** 55 / 55 archivos I-TEST leídos línea por línea.
**Deriva:** `ledger.json` filtrado `category==="I-TEST"`, ordenado por `path`, slice `[220:275]`.
**Rango:** `ComplianceTrafficLight.test.tsx` … `MorningRoutine.test.tsx`.
**Fecha:** 2026-06-03. Doc-only (sin commit).

## Veredicto general

Lote de altísima calidad media. Son casi todos tests de componentes React de
presentación (cards/panels) que reciben datos por props y verifican `data-testid`
concretos, ordenamiento, conteos y callbacks con argumentos verificados — no
snapshot-only, no asserts vacíos en general. Varios consumen el **engine puro real**
(`explainRecommendation`, `buildOccupationalContextBundle`, `createCorrectiveAction`,
`computeProjectCompliance`) en lugar de mockearlo, lo cual es lo correcto. El único
mock omnipresente es `react-i18next` (cosmético, aceptable).

No hay rules-tests en este lote (todos son component/unit), por lo que no aplica el
patrón "Admin SDK bypassa reglas". No hay `.skip/.todo/.fixme` activos.

## Hallazgos (Test:línea | Módulo | Tipo | Por qué)

| Test:línea | Módulo-sujeto | Tipo | Por qué | Sev |
|---|---|---|---|---|
| `MorningRoutine.test.tsx:143-158` | `components/hygiene/MorningRoutine` (XP wiring) | False-green / test-del-mock / tautología | El test "awards XP … success path (integration)" admite en su propio comentario que `persistMorningCheckIn` NO llama `awardPoints`; luego el cuerpo del test **llama `awardPoints('morning_checkin')` a mano** (l.156) y asserta que el mock recibió ese valor. No ejercita el código de producción que decide otorgar XP; pasaría aunque el componente jamás cablee el award. El nombre promete cobertura que no entrega. | 🔴 |
| `digital-twin/HazmatWindOverlay.test.tsx:9-43,57-76` | `components/digital-twin/HazmatWindOverlay` | Over-mocking / test-del-mock | Mockea `projectWindSuction`, `ringCentroid`, `generateGasLeakNode`, `writeNodesDebounced` y `@react-google-maps/api`. La toda la geometría de viento/succión está stubbeada con valores canned; el test solo verifica que se renderiza ≥1 `<Circle>` div. El segundo caso asserta `length > 0` en vez de conteo por feature → no detecta regresión de "1 círculo por N hazards". | 🟡 |
| `emergency/DynamicEvacuationMap.test.tsx:47-65` | `components/emergency/DynamicEvacuationMap` | Smoke débil | `VectorialEvacuationMap` (el mapa real) y `calculateDynamicEvacuationRoute` están mockeados a stub/`null`. Los 3 casos son "renderiza el stub", "no crashea" (`container.children.length>0`) y "hay un input o button". No verifican ninguna lógica de rutas/bloqueos del componente. | 🟡 |
| `health/OccupationalContextBundleCard.test.tsx:16-20` | `components/health/OccupationalContextBundleCard` (MedicalDisclaimer) | Assert trivial/vacío | "disclaimer médico renderizado standalone" solo asserta `document.body.textContent).toBeTruthy()` — vacuo, pasa con cualquier render no vacío; no verifica el texto del disclaimer ni ADR 0012. (Los otros casos sí verifican el texto vía testid, así que la cobertura real existe en otro it.) | 🔵 |
| `dashboard/RoleAwareDashboard.test.tsx:77-91` | `components/dashboard/RoleAwareDashboard` | Nombre vs assert desalineado | `it('empty state si no hay cards')` nunca asserta un empty state; el comentario admite "management siempre incluye estado faena → no empty" y solo verifica que `role-card-mg-faena` existe. El caso de empty real queda sin cubrir. | 🔵 |
| `euler/BucklingCalculatorCard.test.tsx:37-41` | `components/euler/BucklingCalculatorCard` | Assert trivial | "dispara onResult" solo verifica `toHaveBeenCalled()` al montar, sin inspeccionar el payload (P_cr / SF). Débil pero no falso-verde. | 🔵 |
| `fiveS/FiveSAuditForm.test.tsx:23-31` | `components/fiveS/FiveSAuditForm` | Assert sobre estado por defecto | "submit envía report con score" submitea con defaults y asserta `overallScore===0` (estado inicial). El caso fuerte (rating 2 → 100) sí existe a continuación, así que el par cubre, pero este it por sí solo no distingue una impl rota que devuelva siempre 0. | 🔵 |
| `digital-twin/Site25DPanel.test.tsx:182-189` | `components/digital-twin/Site25DPanel` | Comentario stale (no es bug de test) | Bloque `TODO(sprint-19)` describe un `.skip` que ya no existe; los tests corren con `act()` y verifican radio de halo escalando con v² (l.248-267, sólido). Solo deuda de comentario. | 🔵 |
| `emergency/SOSButton.test.tsx` (todo) | `components/emergency/SOSButton` | Cobertura estrecha (por diseño) | Solo prueba el predicado puro `isLongPress` (boundary 3s correcto). El cableado real del botón → dispatch SOS no se cubre aquí; documentado como restricción de deps (no jsdom). Aceptable pero deja el wiring SOS sin test de integración en este archivo. | 🔵 |

## Conteo de tests sólidos

- **Archivos sólidos (sin reservas materiales): 47 / 55.**
  Incluye joyas: `FallDetectionMonitor.test.tsx` (verifica wiring H6 SOS dispatcher,
  3 ramas con args exactos), `SlaWatchPanel.test.tsx` (orden por urgencia, barra
  capada a 100%, SIF tag, 13 casos), `FirstResponderDispatchPanel.test.tsx` (ETA
  formato, fallback uid, no-eligible), `challengeUtils.test.ts` y `gameScore.test.ts`
  (helpers puros con boundaries y blends numéricos exactos), `ExplainedRecommendationCard`
  (usa engine real, share IA = 50%), `ExpirationsListPanel`, `GlossarySearchPanel`,
  `ConsistencyAuditCard`, `CphsCommitteeStatusCard`.
- **Archivos con reservas: 8 / 55** — 1 🔴, 2 🟡, 5 🔵 (ver tabla).
- **`.skip/.todo/.fixme` activos: 0.** Snapshot-only: 0. Rules-tests con Admin SDK: N/A (no hay rules-tests en el slice).

## Resumen ejecutivo (6-10 líneas)

Lote #5 (component cards/panels, índices 220-274) es de calidad alta y consistente:
asserts concretos sobre testids, conteos, ordenamientos y callbacks con argumentos
verificados, varios apoyándose en el engine puro real en vez de mockearlo. **Un único
falso-verde claro**: `MorningRoutine.test.tsx:143-158` etiquetado "integration" llama
`awardPoints()` a mano dentro del test y asserta el mock — tautología que no toca el
código de producción del wiring XP (🔴, recomendado: ejercitar el handler del componente
o renombrar a unit del helper). Dos tests son smoke/over-mock débiles donde la lógica
de dominio queda stubbeada (`HazmatWindOverlay`, `DynamicEvacuationMap` — 🟡). Cinco
🔵 menores: un assert vacuo (`document.body.textContent` en OccupationalContextBundleCard),
un it cuyo nombre ("empty state") no coincide con su assert (RoleAwareDashboard), y
asserts triviales/de-default (BucklingCalculatorCard onResult, FiveSAuditForm score 0,
SOSButton scope estrecho) que están redimidos por casos hermanos más fuertes. Sin
skips, sin snapshot-only, sin rules-tests con bypass. Prioridad de remediación: el 🔴.
