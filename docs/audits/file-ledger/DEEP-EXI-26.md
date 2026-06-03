# DEEP-EXI-26 — Lote #26 (I-DATA): corpus normativo + catálogos médicos + datos demo

**Categoría:** `I-DATA` (filtro `ledger.json category==="I-DATA"`, orden por `path`, slice `[0:18]` — total de la categoría = 18, lote completo).
**Método:** lectura línea-por-línea de cada archivo. Foco: ¿corpus real vs placeholder/lorem? ¿citas legales correctas (DS 40 vs DS 44/2024, artículos)? ¿URLs verificables? ¿licencias de catálogos médicos declaradas? ¿datos inventados presentados como reales? ¿RUT/empresas filtrables a prod? ¿doc-drift de nomenclatura?
**Fecha:** 2026-06-03 · **Auditor:** Claude (deep exhaustivo)

## Atestación de cobertura: 18/18 archivos leídos íntegros

| # | Archivo | LOC | Veredicto | Hallazgo principal |
|---|---|---|---|---|
| 1 | `src/data/bcnKnowledgeBase.ts` | 89 | 🟡 | `id:"ds-40"` / `title:"Decreto Supremo 40"` pero `content` dice "El DS 44/2024 aprueba el reglamento…" — id/título quedaron en DS 40 (derogado) mientras el cuerpo se actualizó a DS 44. Doc-drift de nomenclatura normativa interno. |
| 2 | `src/data/demoProject.ts` | 441 | 🔵 | Sintético, ejemplar. RUTs documentados como rango reservado (17.000.00x), emails `.demo`, geo genérica Santiago, `readOnly`+`tenant_demo`. Modelo correcto. |
| 3 | `src/data/epp.ts` | 82 | 🟡 | `imageUrl: picsum.photos/seed/...` (placeholder) y `ispCertification: 'ISP-12345'…'ISP-99000'` (números ISP falsos secuenciales). Datos placeholder presentados sin marca de "ejemplo". `projectId:'default'`, `createdAt: new Date()` (no determinista). |
| 4 | `src/data/industryDemos.ts` | 261 | 🟡 | RUTs secuenciales plausibles SIN rango reservado documentado (16.789.012-3, 19.012.345-6, 24.567.890-1…). A diferencia de `demoProject.ts`, no hay nota de que sean sintéticos/reservados → riesgo de colisión con persona real. Nombres + "Dr. Felipe Aravena" estilo PII. Resto del contenido (riesgos/EPP/incidentes) es correcto y bien etiquetado como demo. |
| 5 | `src/data/medical/anatomy.json` | 463 | 🔵 | 50 estructuras reales, licencia declarada (CC BY-SA 4.0 Wikipedia + DS 594/109), URLs Wikipedia ES verificables, códigos CIE-10 asociados correctos, disclaimer en `_meta`. |
| 6 | `src/data/medical/diagnoses.json` | 598 | 🔵 | ~70 códigos CIE-10 reales y correctos, licencia CC0 declarada, `occupational` razonable, disclaimer + `todoExpand` (stub registrado legítimo). Nota menor: algunas `description` rozan tratamiento ("broncodilatador", "IBP") pero son texto estático educativo. |
| 7 | `src/data/medical/drugs.json` | 487 | 🔵 | ~70 fármacos, códigos ATC correctos, interacciones plausibles, licencia CC0 + fuentes (WHO ATC/DrugBank/BNF/Stockley) y disclaimer declarados. Orientación farmacológica, no diagnóstica. |
| 8 | `src/data/medical/index.ts` | 67 | 🔵 | Loader tipado limpio; expone `_meta` (licencia/fuente/disclaimer) de cada catálogo. Comentario de fuentes coincide con los `_meta`. |
| 9 | `src/data/milestones.ts` | 125 | 🟡 | Historia real y sólida, PERO: (a) typo `Ulrich Ellenbaf` (debería ser Ellenbog, 1473); (b) entradas especulativas 2025-2027 (exoesqueletos, nanomateriales) mezcladas con hechos históricos sin marca de "proyección"; (c) línea 122 "Praeventio Guard — Implementación a nivel nacional" (2026) = ficción de marketing presentada como hito histórico. |
| 10 | `src/data/normativa/ar.ts` | 100 | 🟡 | Cuerpo correcto y umbrales con notas `VERIFY` honestas. Doc-drift: header comenta "Res SRT 84/2012 — Programa de Seguridad para construcción" pero la entrada real es "Riesgo Eléctrico" (la de construcción es Res 51/97). URLs infoleg.gob.ar verificables. |
| 11 | `src/data/normativa/br.ts` | 119 | 🔵 | NRs correctas (NR-01 GRO/PGR, NR-05 CIPA con "A" de Assédio Portaria 4.219/2022), umbrales con `VERIFY`, AVISO legal, URLs gov.br. Real. |
| 12 | `src/data/normativa/cl.ts` | 135 | 🔵 | Excelente. DS 44/2024 correctamente identificado como reemplazo del DS 40/1969 derogado (vigente 2025-02-01), Ley Karin 21.643, idNorma BCN coherentes (28650, 1217760, 9924, 167766…). Maneja bien la transición DS 40→44 que falla en #1. |
| 13 | `src/data/normativa/co.ts` | 97 | 🔵 | SG-SST (Decreto 1072/2015, Res 0312/2019 escalonada), COPASST, umbrales con `VERIFY`, URLs mintrabajo/minsalud. Real. |
| 14 | `src/data/normativa/iso.ts` | 97 | 🔵 | ISO 45001:2018 cláusulas 4-10 (Annex SL HLS) correctas, jerarquía de controles, fallback universal, URL iso.org/standard/63787. Real, paráfrasis del ToC público (declarado). |
| 15 | `src/data/normativa/mx.ts` | 107 | 🔵 | LFT Título IX + RFSST 2014 + NOM-019/030/035/017/002/009-STPS correctas, umbrales con `VERIFY`, URLs dof.gob.mx/diputados. Real. |
| 16 | `src/data/normativa/pe.ts` | 92 | 🔵 | Ley 29783 + DS 005-2012-TR (Art. 43 comité ≥20), Ley 30222, RM 375-2008-TR, DS 024-2016-EM minera, URLs gob.pe. Real. |
| 17 | `src/data/risks.ts` | 77 | 🔵 | 8 riesgos genéricos por categoría, descripciones correctas (ruido 85 dB, caída >1.8m). Catálogo semilla mínimo pero legítimo. |
| 18 | `src/data/industryIPER.ts` | 937 | 🟡 | Corpus IPER extenso y técnicamente sólido (26 industrias; IEEE 1584, ATEX, IMDG, SOLAS, LOTO, DS 132/594/63, Ley 20.001). Header honesto admite gap audit ("real: 6 vs promesa 500+") y fuentes "referenciales". Doc-drift: nombres de programa SAG/MINSAL inconsistentes/dudosos — "REAS" (L118) vs "REPLA SAG" (L767) para el mismo registro de plaguicidas (real ≈ RNPLA/SAG), y "PREMAES" (L789) no es acrónimo MINSAL reconocido para estrés térmico. |

## Conteo

- 🔵 Limpios (corpus real, licencia/fuente correcta): **11** — #2, #5, #6, #7, #8, #11, #12, #13, #14, #15, #16, #17 (12 ítems; CL/ISO/normativa BR/CO/MX/PE + medical trío + loader + demoProject + risks).
- 🟡 Atención (doc-drift de nomenclatura / placeholder / datos sin marca de ejemplo): **6** — #1 (ds-40↔ds-44), #3 (picsum + ISP falsos), #4 (RUTs no reservados), #9 (typo + ficción "Praeventio Guard" como hito + proyecciones), #10 (header AR drift), #18 (REAS/REPLA/PREMAES).
- 🔴 Críticos (datos inventados presentados como hecho real con impacto legal, o PII real filtrada): **0**.

> Recuento exacto: 12 archivos 🔵 / 6 archivos 🟡 / 0 🔴 (total 18).

## Notas transversales

- **No hay lorem/ipsum/dummy/NotImplemented** en ningún archivo del lote. El único `todoExpand` (diagnoses.json) es un stub declarado y registrable conforme a la directiva anti-stub.
- **Licencias médicas:** los 3 catálogos médicos declaran licencia (CC0 / CC BY-SA 4.0) y fuente en `_meta` — cumplen el requisito de licencia declarada.
- **Riesgo downstream ADR 0012 (fuera de lote, a verificar):** los consumidores de `data/medical/*` incluyen `src/components/medicine/DifferentialDiagnosis.tsx`, `DrugInteractions.tsx`, `AnatomyLibrary.tsx` y `hygiene/VitalityMonitor.tsx`. En un grep directo NINGUNO importa `MedicalDisclaimer` y el nombre "DifferentialDiagnosis" es de forma diagnóstica. Los DATOS son catálogos estáticos educativos (OK), pero esos componentes deberían auditarse contra `scripts/precommit-medical-guard.cjs` (puede que el disclaimer lo aporte un wrapper padre — verificar). **Pertenece a un lote de componentes, no a I-DATA.**
- **RUT en prod:** #4 (`industryDemos.ts`) es el mayor riesgo de "ejemplo→prod": RUTs verosímiles sin rango reservado documentado. Recomendación: migrar al patrón de `demoProject.ts` (rango reservado + nota explícita) o usar RUTs claramente ficticios.
- **DS 40 vs DS 44/2024:** `cl.ts` (#12) es la fuente de verdad correcta; `bcnKnowledgeBase.ts` (#1) y `milestones.ts` (#9, hito 1969 "DS 40") quedaron con el id/título antiguo. Per regla "el código es la fuente de verdad", `cl.ts` está bien; los demás necesitan PR de sincronización de nomenclatura.

## Resumen (6-10 líneas)

Lote #26 (18/18 archivos I-DATA leídos íntegros): el corpus es **real, no placeholder** — sin lorem/ipsum. Los 7 paquetes normativos (CL/AR/BR/CO/MX/PE/ISO) citan leyes, artículos y URLs verificables y son técnicamente correctos; `cl.ts` maneja bien la transición DS 40/1969→DS 44/2024. Los 3 catálogos médicos (CIE-10, ATC, anatomía) son auténticos, con licencia (CC0 / CC BY-SA 4.0) y fuente declaradas. `industryIPER.ts` es un IPER extenso y honesto (admite su propio gap de cobertura). Hallazgos 🟡: (1) doc-drift DS 40↔DS 44 en `bcnKnowledgeBase.ts` y `milestones.ts`; (2) `epp.ts` con `picsum.photos` y certificaciones ISP falsas; (3) `industryDemos.ts` con RUTs verosímiles sin rango reservado (riesgo ejemplo→prod, a diferencia del ejemplar `demoProject.ts`); (4) `milestones.ts` mezcla proyecciones 2025-27 + marketing "Praeventio Guard" como hitos históricos + typo "Ellenbaf"; (5) acrónimos SAG/MINSAL dudosos en IPER (REAS/REPLA/PREMAES). **0 hallazgos 🔴** — ningún dato inventado con impacto legal ni PII real filtrada. Riesgo a seguir fuera de lote: los componentes `src/components/medicine/*` que consumen estos catálogos no parecen renderizar `<MedicalDisclaimer/>` (verificar contra ADR 0012).

*(Doc-only. Sin commit, sin cambios de código.)*
