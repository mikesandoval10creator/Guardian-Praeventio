# ADR 0019 — Estrategia de resiliencia y cuota de IA (Gemini)

Status: **proposed** (decisión pendiente de implementación)
Date: 2026-06-02
Aplica a: B14 (IA/Gemini/SLM), `src/server/routes/gemini.ts`, `src/services/gemini/*`,
`src/services/slm/*`, `resilientAiOrchestrator.ts`, `safeNormativeQuery.ts`,
tier-gating (B15), TODO.md §2.32.

> **Estado real al 2026-06-02** (barrido archivo-por-archivo): la inferencia de
> producción usa **claves de Google AI Studio** (`gemini.ts:271` →
> `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })`), NO Vertex. Ya
> existen: rate-limit por-usuario (`geminiLimiter`, 30 req/15 min) + tope global
> diario (`geminiGlobalDailyLimiter`), circuit-breaker (`geminiCircuit.ts`),
> estimación de costo (`estimateGeminiCostUsd`), orquestador resiliente de 5 tiers
> **construido pero detrás de flag OFF**, SLM offline `SLM_OFFLINE_ENABLED=false`,
> y RAG normativo (`safeNormativeQuery`, umbral 0.75). Este ADR es la decisión de
> cómo consumir Gemini de forma sostenible, no el reporte de estado.

## Contexto

Google estrechó las cuotas de **AI Studio** (límites diarios de solicitudes y de
nivel de "thinking"). La aplicación de prevención apoya decisiones donde la vida y
el cumplimiento legal dependen del uptime; depender de cuotas de **clave gratuita**
(propia o del cliente) no es viable en producción: a escala, el tráfico de clientes
agotaría la cuota y degradaría o caería el servicio de IA.

Restricción del dueño del producto: **no cambiar de proveedor** — Gemini es la base
de la aplicación y de muchas de las 84 acciones whitelisted. La arquitectura
Zettelkasten (RAG sobre corpus normativo canónico) es el corazón del sistema y debe
preservarse y, de hecho, explotarse.

Diagnóstico clave: el problema no es Gemini, es **cómo se consume** (clave gratuita
como único camino, modelo/`thinking` sin ruteo por complejidad, y dependencia de
Gemini para respuestas que el RAG ya podría cubrir).

## Decisión

**Defensa en profundidad de IA: Gemini como sintetizador, no como único motor.**
Cinco capas, en orden de prioridad:

1. **Producción sobre cuota pagada y controlable.** Migrar la credencial del
   servidor de AI Studio gratuito a **Vertex AI (pay-as-you-go)** —o, como mínimo,
   AI Studio de pago con aumento de cuota solicitado. Es un cambio de
   credencial/endpoint detrás de la misma interfaz `@google/genai`; **no** altera la
   lógica de negocio ni las 84 acciones. Elimina el techo de la cuota gratuita.

2. **Degradación elegante (nunca caída dura).** Encender el
   `resilientAiOrchestrator` (hoy flag OFF) tras corregir el bundle SLM (Phi-3/Gemma
   caen a CDN — ver §2.32): ante 429/503 de Gemini, responder con SLM on-device →
   RAG canónico → respuesta "canned" con disclaimer, en vez de fallar. Esta es la
   garantía operacional de "no se cae el sitio".

3. **Ruteo de modelo por complejidad.** Acciones rutinarias → modelos **Flash /
   Flash-Lite** con `thinkingBudget` bajo; reservar Pro + thinking alto solo para
   síntesis genuinamente compleja. Recorta consumo/costo ~10× sin perder calidad
   donde no se necesita.

4. **RAG-first + caché semántica.** Responder desde el corpus
   Zettelkasten/`safeNormativeQuery` cuando la confianza supere el umbral; Gemini
   solo para lo que el RAG no cubre. Cada respuesta servida desde RAG es una llamada
   a Gemini que no se hace. Cachear respuestas por query normalizada.

5. **Aislamiento y presupuesto por tenant/tier.** Añadir rate-limit **por-tenant**
   (hoy es por-usuario + global) y atar un **budget de IA al `subscription.planId`**
   (cierra también el tier-gating por-feature de §2.32 B13). Un tenant no consume la
   cuota de otro; el gasto de IA es predecible y facturable.

**BYOK (clave del cliente)** queda como opción **enterprise** únicamente, con clave
**de pago** del cliente cifrada vía KMS (no como base): una clave gratuita del
cliente sufre el mismo throttling, así que BYOK resuelve costo, no cuota.

## Consecuencias

**Positivas:** uptime de IA desacoplado de cuotas gratuitas; reducción de costo por
ruteo + RAG; resiliencia offline reforzada (alinea con la tesis offline-first);
gasto de IA atado a tiers (ingreso). Reduce la dependencia de Gemini **sin**
abandonarlo: Gemini pasa de "motor de cada respuesta" a "sintetizador de lo no
cubierto por RAG/SLM".

**Negativas / costos:** Vertex introduce facturación pay-as-you-go (requiere control
de costo — ya hay `estimateGeminiCostUsd`); encender el orquestador exige cerrar el
bundle SLM primero; el ruteo de modelo y la caché semántica son trabajo nuevo. Hay
que medir calidad de Flash vs Pro por acción.

## Alternativas consideradas

- **Solo BYOK gratuito (status quo intencional):** rechazada — no resuelve cuota; a
  escala cae el servicio.
- **Cambiar de proveedor (OpenAI/Anthropic/local):** rechazada por directiva del
  dueño (Gemini es la base) y por costo de re-cableado de 84 acciones.
- **Solo subir el tope del rate-limit:** rechazada — traslada el problema, no lo
  resuelve; a más tráfico, antes se agota la cuota.

## Plan de implementación (incremental, TDD)

1. **F1 (prod-critical):** credencial Vertex en `gemini.ts` detrás de
   `GEMINI_BACKEND=vertex|aistudio` (default vertex en prod, aistudio en dev). Test:
   selección de backend + fallback de credencial.
2. **F2:** corregir bundle SLM (Phi-3/Gemma local) → encender
   `resilientAiOrchestrator` por flag. Test: 429 de Gemini degrada a SLM/RAG/canned.
3. **F3:** ruteo de modelo por acción (mapa acción→modelo/thinking). Test: acción
   rutinaria usa Flash; compleja usa Pro.
4. **F4:** caché semántica + RAG-first en el chokepoint. Test: hit de caché/RAG no
   llama a Gemini.
5. **F5:** rate-limit por-tenant + budget IA por tier. Test: tenant A no agota cuota
   de tenant B; tier gratis topa antes que enterprise.

Cada fase es independiente y aporta resiliencia incremental; F1 y F2 son las que
eliminan el riesgo de "se cae el sitio al escalar".

## Pendiente de investigación (antes de F1)

Números exactos de cuota actual (AI Studio free vs paid vs Vertex), límites de
`thinking` por modelo, y costo estimado para el volumen objetivo. Registrar en este
ADR cuando se obtengan (búsqueda web pendiente — ver TODO.md §2.32).
