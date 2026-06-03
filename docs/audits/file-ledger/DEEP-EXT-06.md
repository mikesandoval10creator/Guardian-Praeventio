# DEEP-EXT-06 — Auditoría exhaustiva de tests (Lote #6)

**Deriva:** `ledger.json` → `category === "I-TEST"`, orden por `path`, slice `[275:330]`.
**Total I-TEST en ledger:** 1247. **Slice leído:** 55 archivos (índices 275–329).
**Modo:** lectura línea por línea, caza de falsos-verdes / tests débiles.

## Atestación 55/55

Los 55 archivos del slice fueron leídos completos. Todos son **tests de
componentes React** (`@vitest-environment jsdom`, `@testing-library/react`).
Patrón dominante y sano: el componente recibe el output del **motor/servicio
real** (o un factory tipado) por props y el test verifica render + interacción +
callbacks vía `data-testid`. Varios consumen el servicio de dominio real sin
mockearlo (`validateLineOfFire`, `computeMaturityLevel`, `buildOnboardingPlan`,
`buildChallenge`/`buildSignedAcknowledgement`, `CANONICAL_TEMPLATES`,
`MICROTRAINING_CATALOG`, `buildDefaultPolicy`, `severityForCell`,
`computeAutoCompliance`), lo que **eleva la calidad** (no son test-del-mock).

No se hallaron: rules-tests con Admin SDK, "ID crypto contract" tautológico,
reimplementación-disfrazada de handlers, `validate` mockeado a `next()`,
snapshot-only, `it()` vacío, skip/todo/fixme. El único mock recurrente es
`react-i18next` (devuelve fallback) y, en los 3 modales pesados, mocks de
`framer-motion`/`firebase`/`canvas-confetti`/`analytics` — todos legítimos
(dependencias de entorno, no la lógica bajo prueba).

## Hallazgos (débiles / falsos-verdes parciales)

| Test:línea | Módulo-sujeto | Tipo | Por qué |
|---|---|---|---|
| 🟡 `IperMatrixCard.test.tsx:44-48` (`dispara onChange`) | IperMatrixCard | Assert trivial | Solo `expect(onChange).toHaveBeenCalled()`; se dispara en mount, no verifica payload (score/level/residual). Pasaría con un `onChange()` vacío e incorrecto. |
| 🟡 `ResidualRiskCard.test.tsx:32-36` (`renderiza score inicial y residual`) | ResidualRiskCard | Assert débil | `residual-level-r1` solo `toBeInTheDocument()`, no verifica el valor calculado. El umbral sí se cubre en tests 2/3, pero este caso no pinea el cómputo. |
| 🟡 `ROICalculatorWidget.test.tsx:14-32` (`renderiza level y ratio`) | ROICalculatorWidget | Assert laxo | `roi-ratio` con `.toMatch(/x|∞/)` — la "x" matchea casi cualquier render; un ratio numérico erróneo pasaría. `roi-message` solo `toBeInTheDocument`. (Tests 2/3 UNDERWATER/∞ sí son firmes.) |
| 🟡 `PymeOnboardingPlanPanel.test.tsx:40-50,84-95,138-141,147-151,154-162` | PymeOnboardingPlanPanel | Assert condicional | Cinco tests envueltos en `if (plan.x.length>0)` / `if (...<=30)`. Si el motor produce la rama vacía, el test no asserta nada relevante (vacuo). Dependen del shape del engine real; frágiles ante cambios de datos. |
| 🟡 `OperationalPressureGauge.test.tsx:34-43` (`sube level...`) | OperationalPressureGauge | Assert laxo | `expect(['high','critical']).toContain(level)` — acepta 2 de 4 niveles; no pinea el umbral exacto. Defendible pero no preciso. |
| 🔵 `LegalCalendarView.test.tsx:14-27` (factory) | LegalCalendarView | Dato sintético deriva flag | El factory computa `isOverdue = (daysUntilDue<0)`; el agrupado del componente debe leer `daysUntilDue` (no `isOverdue`), así que es aceptable, pero el dato pre-deriva el gate de overdue. Vigilar si el componente algún día se basa en `isOverdue`. |
| 🔵 `LightningTrainingPlayer.test.tsx:37,51,53,65` | LightningTrainingPlayer | Acoplamiento a catálogo | Asume que `lightning-option-N-1` es siempre la correcta del catálogo real; si el catálogo reordena opciones, "score 100" se rompe sin que cambie la lógica. Acoplamiento de datos, no falso-verde. |
| 🔵 `MentalLoadSurveyForm.test.tsx:24-32` | MentalLoadSurveyForm | Dependencia de default | `score.overallLoad === 50` depende de que todos los sliders arranquen en 50; sano (verifica cómputo real) pero acoplado al valor por defecto. |

## Notas que NO son hallazgos (aclaraciones)

- `PredictedActivityModal.test.tsx` — NO es reimplementación-disfrazada: testea
  el helper **exportado real** `attachEscapeHandler` que el `useEffect` del
  componente invoca; cubre el path de producción. Workaround documentado por
  ausencia histórica de jsdom; legítimo.
- `sidebarMenuGroups.test.ts` — robusto: testea el builder puro extraído del
  Sidebar (gating de feature/admin, paths normativos DS54/DS594/Ley Karin/LPD,
  unicidad, idempotencia). Modelo a seguir.
- `OnboardingWizard.test.tsx` — excelente: reducer puro + helpers + e2e de
  submit con payload completo. Sin debilidades.
- `CloseProcessModal` / `StartProcessModal` — fuertes: happy-path + error 409/500
  + `not.toHaveBeenCalled` en validación + assert sobre URL/body del `fetch`.

## Conteo

- **Sólidos:** 47 / 55
- **Débiles (🟡, assert trivial/laxo/condicional-vacuo):** 5
- **Observaciones menores (🔵, acoplamiento de datos, no falso-verde):** 3
- **Falsos-verdes graves (🔴):** 0
- **Skip/todo/empty/snapshot-only/reimplementación/Admin-SDK-bypass:** 0

## Severidad global: 🔵 (bajo riesgo)

Lote de alta calidad. Sin falsos-verdes graves ni anti-patrones estructurales.
Las debilidades son asserts triviales/laxos puntuales (`onChange` sin payload,
`residual-level` sin valor, `roi-ratio` con regex permisivo) y tests con ramas
condicionales que pueden volverse vacuas. Recomendación: endurecer los 5 asserts
🟡 para pinear valores calculados en vez de mera presencia/regex amplio.
