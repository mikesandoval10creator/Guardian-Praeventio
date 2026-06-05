# ADR 0020 — Risk banding: DS 44/2024 IPER + ISO 31000 coexisten; criticidad deriva del motor canónico

Status: **accepted**
Date: 2026-06-05
Aplica a: matriz de riesgos (`Matrix.tsx`), matriz ejecutiva 5×5
(`RiskMatrix5x5.tsx`), motor IPER (`services/protocols/iper.ts`), bloque B2 de
la remediación Fase 5. Extiende ADR 0014 (Regulatory Framework Abstraction).

## Contexto

La auditoría Fase 5 (B2, `DEEP-B2`) encontró **tres esquemas distintos** que
clasifican el **mismo** par `probabilidad × severidad` con resultados
diferentes según la pantalla:

1. **`calculateIper`** (`services/protocols/iper.ts`) — motor canónico DS 44/2024
   (SUSESO), 5 niveles `trivial · tolerable · moderado · importante · intolerable`
   por **lookup de matriz** (no por umbral de score). Usado por ~10 módulos.
2. **`Matrix.tsx`** — escalera ad-hoc de umbrales `P×S` (`>=16 'Crítica' :
   >=9 'Alta' : >=4 'Media' : 'Baja'`) duplicada en 3 sitios (seed / sugerencia
   IA / manual) + la calculadora "Riesgo Puro". No coincide con (1) ni con (3).
3. **`RiskMatrix5x5.tsx`** — `severityForCell` inline, 4 bandas ISO 31000:2018
   (`low ≤4 · medium ≤9 · high ≤15 · extreme 16+`).

Ejemplo del drift: `P=3, S=3` (score 9) → DS44 = `moderado`; Matrix.tsx = `Alta`;
ISO 31000 = `medium`. Un mismo riesgo se ve distinto en cada vista.

**Decisión de producto (usuario, 2026-06-05):** DS44 e ISO 31000 **deben
coexistir**. ISO 31000 es normativa internacional que permite que industrias que
requieren calidad ISO adopten la herramienta; la selección de estándar es parte
de la "geolocalización de normativa" ya soportada por el registry regulatorio
(ADR 0014, baseline ISO 45001 + 14 jurisdicciones). NO se debe colapsar ISO
dentro de DS44. El plan original del roadmap ("unificar todo a `calculateIper`")
se **refina**: se unifica la *fuente de cálculo*, no el *número de estándares*.

Restricción dura: `criticidad` (Crítica/Alta/Media/Baja) está **persistida** en
`node.metadata.criticidad` y leída por ~10 módulos (filtros, tarjetas de stats,
triggers, cphsMinute, useRiskEngine…). Cambiar su vocabulario rompería ese
contrato cross-cutting.

## Decisión

1. **`calculateIper` (DS44) es la única fuente de cálculo de la clasificación
   legal chilena.** Se elimina la escalera de umbrales ad-hoc de `Matrix.tsx`.
2. **Se preserva el contrato `criticidad` de 4 bandas** mediante un adapter
   canónico `services/protocols/iperCriticidad.ts` que deriva la banda desde el
   resultado DS44 con un mapa anclado a las *recomendaciones del propio DS44*:
   `trivial`/`tolerable` → **Baja** (ambos "no requieren control adicional"),
   `moderado` → **Media** ("controles en 30 días"), `importante` → **Alta**
   ("suspender"), `intolerable` → **Crítica** ("detener de inmediato").
3. **ISO 31000 se promueve a motor puro de primera clase**
   (`services/protocols/iso31000Band.ts`), dejando de ser un esquema inline
   anónimo. `RiskMatrix5x5.severityForCell` se conserva como re-export delgado
   (back-compat) que delega en `iso31000Band`.
4. **Los dos estándares coexisten, conmutables por régimen.** Cablear el toggle
   DS44↔ISO en vivo al `TenantRegulatoryContext` (ADR 0014) queda como
   follow-up acotado; este ADR elimina la divergencia, que es lo urgente.

## Consecuencias

- Una sola fuente de verdad para la criticidad chilena: ya no hay drift entre
  pantallas. La banda en `Matrix.tsx` puede cambiar para algunos `P×S` respecto
  al comportamiento previo (p. ej. score 9 ahora es `Media`, no `Alta`) —
  **esto es la corrección**, no una regresión: ahora respeta la matriz DS44.
- El contrato persistido `criticidad` (4 bandas) NO cambia → cero migración de
  datos ni de los ~10 consumidores downstream.
- ISO 31000 sigue intacto en comportamiento; solo se de-duplica.
- `iperCriticidad.ts` e `iso31000Band.ts` son funciones puras testeadas (vitest).
  Añadirlas al scope de mutation testing (stryker) queda como follow-up.

## Alternativas consideradas

- **Colapsar todo a DS44 5-niveles (incl. RiskMatrix5x5).** Rechazada: elimina
  el estándar internacional ISO, contradice la estrategia multi-norma (ADR 0014)
  y reduce la adoptabilidad de la herramienta.
- **`Matrix.tsx` muestra los 5 niveles DS44 directamente.** Rechazada para este
  PR: rompe el contrato persistido `criticidad` de 4 bandas y obligaría a migrar
  ~10 consumidores. Es la opción "más fiel a DS44" pero de alto riesgo; se puede
  retomar como migración deliberada futura.

## Principio rector (Fase 5)

Resolver deuda técnica = **crear la solución real de lo ya propuesto en el
código**, no eliminar. Aquí: el comentario en `Matrix.tsx` ya declaraba que "la
clasificación legal vive en el motor IPER, no en la UI" — esta ADR lo hace
realidad cableando el motor, en lugar de borrar la intención. Este enfoque se
mantiene para los bloques siguientes.
