# DEEP-EX #6 — B7-Salud [110:125] · 2026-06-02

**Atestación:** leídos 15/15 línea por línea.

Lote derivado de `ledger.json` (`category^="FEAT" && block==="B7-Salud"`, orden por
`path`, slice [110:125]):

1. `src/services/medical/aptitudeCertGenerator.ts`
2. `src/services/medical/aptitudeCertSigner.ts`
3. `src/services/medical/bodyRoutineGenerator.ts`
4. `src/services/medical/iconLibrary.ts`
5. `src/services/medicalAnalysisBackend.ts`
6. `src/services/medicineBackend.ts`
7. `src/services/mentalLoad/mentalLoadTracker.ts`
8. `src/services/observability/resilienceHealthMonitor.ts`
9. `src/services/psychosocialBackend.ts`
10. `src/services/returnToWork/returnToWorkPlanner.ts`
11. `src/services/systemEngine/zettelkasten/healthEvent.ts`
12. `src/services/telemetry/aggregator.ts`
13. `src/services/telemetry/eventCollector.ts`
14. `src/services/workerReadiness/readinessScore.ts`
15. `src/services/zettelkasten/bernoulli/respiratorFatigue.ts`

> **NO se repite** lo ya cubierto por `DEEP-B7-Salud.md` / `DEEP-EX-04.md` /
> `DEEP-EX-05.md`: la dead-UI diagnóstica 403 (`differentialDiagnosis` /
> `analyzeMedicalInjury` / `checkDrugInteractions` / `generateMedicalIllustration`
> NO en `ALLOWED_GEMINI_ACTIONS`), los prompts diagnósticos ADR-0012 en
> `medicalAnalysisBackend.ts`, el blind-spot del guard sobre `occupational-health/`,
> los disclaimers faltantes, el whitelist-status de `medicineBackend.ts`, y el
> misfiling de telemetry/resilience. Abajo SOLO hallazgos nuevos.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/services/psychosocialBackend.ts:68` | 🟡 | **`JSON.parse(response.text)` sin try/catch ni fallback tipado (viola directiva #5).** `analyzePsychosocialRisks` parsea la respuesta Gemini con `JSON.parse` desnudo; si el modelo devuelve JSON inválido, lanza y el dispatcher cae al 500 genérico (`gemini.ts:454`) en vez del 502/fallback tipado que exige #5. El archivo hermano `medicalAnalysisBackend.ts` SÍ usa el parser seguro `parseGeminiJson()`. Mismo file: directo bajo `src/services/` → fuera del scope del guard ADR-0012. | `return JSON.parse(response.text);` sin envoltura |
| `src/services/medicineBackend.ts:81,139,202` | 🟡 | **3× `JSON.parse(response.text)` sin try/catch (viola #5).** `mapRisksToSurveillance`, `analyzeHealthPatterns`, `generateCompensatoryExercises` parsean con `JSON.parse` crudo + luego mutan `parsed.citations`/`Object.defineProperty` sobre un valor sin validar shape. Las 3 acciones SÍ están whitelisted (a diferencia de medicalAnalysis), así que son alcanzables en prod → un JSON malformado las tumba con 500 genérico en lugar de fallback. No usan el `parseGeminiJson` compartido. | `const parsed = JSON.parse(response.text);` ×3 |
| `src/services/psychosocialBackend.ts:18-21` | 🔵 | **Prompt psicosocial pide correlación predictiva accidente/ausentismo (`predictedImpact`) — roza ADR-0012 y vive fuera del scope del guard.** "Correlacionar estos riesgos con posibles ausentismos o accidentes" + campo `predictedImpact`. No es diagnóstico clínico individual (es organizacional/ISTAS-21) por lo que es defendible, pero combina (a) salida predictiva sobre personas con (b) ubicación `src/services/*.ts` que `precommit-medical-guard.cjs` NO escanea (sólo `src/services/health/` y `src/services/medicine/`). Documentar la justificación inline para que no derive a diagnóstico. | `prompt` líneas 18-21; `predictedImpact` schema `:59` |
| `src/services/medicineBackend.ts:84-90` | 🔵 | **`Object.defineProperty(parsed,'citations',{enumerable:false})` sobre array sin validar tipo.** Si Gemini devuelve un objeto (no array) cuando el caller espera array, el `if (Array.isArray(parsed))` lo salta silenciosamente y las citations RAG recuperadas se pierden sin señal — el feature "trazabilidad normativa" degrada en silencio. Menor, pero es un fallo silencioso de cumplimiento (las citas normativas son el respaldo legal del output médico). | `if (Array.isArray(parsed)) { Object.defineProperty(...) }` |

## Archivos limpios: 11

- `medical/aptitudeCertGenerator.ts` — PDF+JSON+SHA-256 determinista, hash canónico
  estable, `pushedToMutual:false` explícito, clock inyectable. Sin egress externo.
- `medical/aptitudeCertSigner.ts` — puro (sin firebase-admin), WebAuthn challenge
  server-bound al hash, three-way hash match, role-gate + doctor-uid binding, errores
  tipados sin leak. Modelo de seguridad sólido.
- `medical/bodyRoutineGenerator.ts` — biblioteca curada determinista (no LLM), sin PII.
- `medical/iconLibrary.ts` — constante pura, sin red, sin PII.
- `mentalLoad/mentalLoadTracker.ts` — NASA-TLX determinista, sin LLM, sin egress.
- `observability/resilienceHealthMonitor.ts` — agregador puro, checkers inyectables,
  timeout con `clearTimeout` correcto, sin PII.
- `returnToWork/returnToWorkPlanner.ts` — motor determinista; ADR-0012-consciente por
  diseño (vocabulario `RestrictionTag` CERRADO, `evidenceDocId` "NUNCA descripción
  médica"). Ejemplo de cómo debería verse el resto del módulo salud.
- `systemEngine/zettelkasten/healthEvent.ts` — glue topología→score→emit;
  `emitZettelkastenHealth` envuelve en try/catch + `logger.warn` (no leak); usa `await`.
- `telemetry/aggregator.ts` — privacy-preserving, `assertNoPII` con blocklist explícita
  (workerUid/rut/email/…), determinista.
- `telemetry/eventCollector.ts` — read-only, proyección que dropea PII, scope
  tenant/proyecto en la query, cap por colección (defense-in-depth).
- `workerReadiness/readinessScore.ts` — determinista "solo asiste, no bloquea";
  penalización incident-recency bien documentada; sin PII médica cruda.

---

### Resumen (6-10 líneas)

Lote 15/15 leído línea por línea. **11 archivos limpios** — el grueso del lote son
motores puros, deterministas y bien diseñados (`returnToWorkPlanner` y `aptitudeCertSigner`
son ejemplares en cumplimiento ADR-0012/seguridad). Los grandes hallazgos del módulo
(dead-UI diagnóstica 403, prompts ADR-0012 en `medicalAnalysisBackend`, blind-spot del
guard sobre `occupational-health/`) **ya fueron documentados** por DEEP-B7/EX-04/EX-05 y
NO se repiten aquí. **Nuevos:** dos 🟡 de directiva #5 —`psychosocialBackend.ts:68` y
`medicineBackend.ts:81/139/202` usan `JSON.parse(response.text)` desnudo (sin try/catch
ni fallback tipado), mientras el hermano refactorizado `medicalAnalysisBackend.ts` ya usa
el `parseGeminiJson()` seguro; las de `medicineBackend` SÍ están whitelisted →
alcanzables en prod. Dos 🔵 menores: prompt psicosocial predictivo fuera de scope del
guard, y pérdida silenciosa de citations RAG si Gemini no devuelve array. El error-leak
(#8) está cubierto por el try/catch del dispatcher (`gemini.ts:454`), así que ninguna
de estas fuga internos en prod — el defecto es de robustez/cumplimiento #5, no de leak.
Doc-only; sin git commit.
