# ADR 0023 — Xiaomi MiMo como segundo cerebro cloud (independencia de cuotas Gemini)

Status: **proposed** (propuesta del fundador, sesión cowork local 2026-06-11)
Date: 2026-06-11
Aplica a: ADR 0019 (capas 1-2), `src/services/ai/selfHostedProvider.ts`,
`src/services/ai/providerRouter.ts`, `src/services/ai/selfHostedActions.ts`,
`src/server/routes/gemini.ts:512-550`, `docs/runbooks/SELFHOSTED_AI.md`.

> **Motivación del fundador (verbatim, 2026-06-11):** "Gemini ahora tiene cuotas y
> son bastante restrictivos con sus modelos, no quiero que mi aplicación se rompa
> porque no pagué la cuenta." Este ADR convierte esa preocupación en una decisión
> de arquitectura concreta, **sin contradecir** la restricción registrada en ADR
> 0019 ("no cambiar de proveedor — Gemini es la base"): Gemini sigue siendo el
> cerebro principal; MiMo entra como **segundo cerebro cloud** en la escalera de
> degradación, entre Gemini y el SLM on-device.

## Contexto

1. **La infraestructura ya existe y es agnóstica del modelo.** El PR #857 construyó
   la capa de proveedor auto-hosteado OpenAI-compatible por acción
   (`selfHostedProvider.ts` — env `AI_SELFHOSTED_BASE_URL/_MODEL/_API_KEY`;
   `providerRouter.ts:164-183` rutea por acción con fallback a Gemini;
   `selfHostedActions.ts` lleva 6 acciones con prompt-builder espejo). El runbook
   `docs/runbooks/SELFHOSTED_AI.md:6` ya nombra a MiMo-7B como primer candidato.
   **Integrar MiMo es configuración, no código nuevo.**

2. **La escalera de resiliencia ya está encendida.** PR #861 activó el
   `resilientAiOrchestrator` por defecto con Qwen on-device embebido. ADR 0019
   define 5 capas; la capa "cloud alternativo" hoy está vacía — este ADR la llena.

3. **Estado del ecosistema MiMo (verificado 2026-06-11):**
   - **MiMo-V2-Flash** (github.com/XiaomiMiMo/MiMo-V2-Flash): MoE 309B totales /
     15B activos, **Apache-2.0**, contexto 256k, FP8, MTP (~3× velocidad de
     generación), tool-calling (`--tool-call-parser mimo`), servible con SGLang
     exponiendo `/v1/chat/completions` (dialecto OpenAI). SWE-Bench Verified 73.4,
     τ²-Bench 80.3 — clase frontier-eficiente. Knowledge cutoff: **dic 2024**.
   - **MiMo-V2.5-Pro** (abr 2026): 1.02T MoE, licencia **MIT**, 1M contexto.
     Demasiado grande para self-host propio; relevante solo vía API.
   - **Xiaomi MiMo API Platform** (platform.xiaomimimo.com, lanzamiento global):
     "Token Plan" de compra única que desbloquea los modelos flagship V2.5 + TTS
     gratis por tiempo limitado. Posicionamiento de precio agresivo (~órdenes de
     magnitud bajo Gemini Pro).
   - **MiMo-7B-RL**: self-hosteable en una GPU única vía Ollama/vLLM (ya
     documentado en el runbook, Opciones A/B).

## Decisión (propuesta)

**MiMo se integra como proveedor secundario cloud detrás de la capa
`AI_SELFHOSTED_*` existente, en tres fases de adopción creciente:**

### Fase 1 — API MiMo como respaldo barato (config-only, ~1 hora)

```bash
# .env.local / Secret Manager (NUNCA commitear el valor real)
AI_SELFHOSTED_BASE_URL=<base URL de platform.xiaomimimo.com>   # confirmar dialecto /v1
AI_SELFHOSTED_MODEL=<p.ej. mimo-v2-flash>                      # confirmar string exacto
AI_SELFHOSTED_API_KEY=<token del Token Plan>
AI_PROVIDER_ACTIONS_SELFHOSTED=getSafetyAdvice                 # canary: 1 acción
```

Canary con `getSafetyAdvice` (la acción advisory de mayor volumen y menor
riesgo), validación con `npm run validate:env` + smoke test, luego expandir a
las 6 acciones con spec (`getChatResponse`, `queryBCN`, `calculateStructuralLoad`,
`designHazmatStorage`, `evaluateMinsalCompliance`).

### Fase 2 — Expandir specs por ola (sigue el patrón del split #863)

Cada dominio extraído de `geminiBackend.ts` a `src/services/gemini/*` gana su
espejo en `selfHostedActions.ts`. Prioridad: acciones Markdown/free-text de alto
volumen. Las acciones **estructuradas-JSON y legal-críticas permanecen en Gemini**
hasta evaluación individual (regla ya escrita en `selfHostedActions.ts:28-30`).

### Fase 3 — Self-host si el volumen lo justifica

Cuando el gasto mensual en API supere el costo de una GPU dedicada:
MiMo-7B-RL en Ollama/vLLM (runbook §1) para acciones advisory, manteniendo la
API para picos. La misma env var apunta al endpoint propio — cero cambio de código.

### Escalera resultante (extiende ADR 0019 capa 2)

```
Gemini (pagado, ruteo por complejidad)        ← cerebro principal
  └─ 429/503/cuota → MiMo cloud/self-host     ← ESTE ADR (segundo cerebro)
       └─ falla → SLM on-device (Qwen, #861)  ← offline/emergencia
            └─ falla → RAG canónico (safeNormativeQuery ≥0.75)
                 └─ respuesta canned con disclaimer (nunca caída dura)
```

## Salvaguardas obligatorias (no negociables)

1. **PII / Ley 21.719:** la API de MiMo es infraestructura de un tercero
   (posible residencia de datos fuera de Chile/UE). El seam de redacción ya
   aplica a este camino (`selfHostedActions.ts:31-35` → `redactPromptForVertex`
   de `src/services/gemini/_shared.ts`); se mantiene **obligatorio** para todo
   texto de usuario. Datos médicos/Health Vault **jamás** salen por este camino.
2. **Cutoff dic 2024 → RAG-grounding obligatorio:** MiMo no conoce el DS 44/2024
   en profundidad ni cambios normativos 2025-2026. Toda respuesta normativa va
   con contexto RAG inyectado (patrón existente `fetchLegalContext`,
   `selfHostedActions.ts:52-60`) y la instrucción de no inventar ley sin contexto.
3. **ADR 0022 intacto:** MiMo nunca recibe flujos de emisión regulatoria.
4. **Anti-lock-in simétrico:** nada en la integración debe ser MiMo-específico;
   si mañana conviene Qwen-Max, DeepSeek o GLM, es un cambio de env vars.

## Preguntas abiertas (verificar antes de Accepted)

- [x] **Base URL confirmada** (docs oficiales, 2026-06-11):
      `https://api.xiaomimimo.com/v1` dialecto OpenAI; bonus: endpoint
      Anthropic-compatible en `https://api.xiaomimimo.com/anthropic`.
- [x] **Modelo confirmado:** `mimo-v2.5-pro` (la plataforma sirve la serie
      V2.5; V2-Pro/Omni legacy se deprecan el 30 de junio 2026). Cutoff dic
      2024 confirmado en el system prompt recomendado por la plataforma.
- [x] **Auth compatible:** la plataforma acepta `Authorization: Bearer` (es lo
      que usa su ejemplo oficial con SDK OpenAI) — coincide con
      `selfHostedProvider.ts:196`. (Su curl usa header `api-key:` alternativo;
      si el smoke test diera 401, fallback trivial a ese header.)
- [x] **Login:** solo cuenta personal Xiaomi (id.mi.com) por ahora.
- [x] **Multi-turn `reasoning_content`:** confirmado en docs ("[Important
      Notice] Passing Back reasoning_content in Multi-Turn Conversations") —
      no aplica a las 6 acciones spec'd (single-turn), revisar al expandir.
- [x] **Smoke test PASADO (2026-06-11):** HTTP 200 contra
      `https://api.xiaomimimo.com/v1/chat/completions` con `Authorization:
      Bearer` (sin cambio de código), modelo `mimo-v2.5-pro`, respuesta
      correcta, **latencia 2.65s** round-trip (44 tokens, con thinking mode
      activo por defecto — `reasoning_content` presente en la respuesta).
      Cuenta del fundador activa con saldo inicial; key en `.env.local`
      (gitignored), canary `getSafetyAdvice` configurado.
- [x] **Precios pay-as-you-go confirmados** (docs oficiales, overseas USD/M
      tokens): `mimo-v2.5-pro` $0.435 in / $0.87 out (cache hit $0.0036);
      `mimo-v2.5` $0.14 in / $0.28 out. ~15× más barato que Gemini Pro en
      output. Decisión fundador: pay-as-you-go, sin Token Plan (uso de
      respaldo esporádico).
- [ ] Términos de servicio para uso comercial B2B + SLA (leer Service
      Agreement antes de pasar de canary a producción).
- [ ] Opcional al expandir: evaluar `chat_template_kwargs.enable_thinking:
      false` para acciones de alto volumen (baja latencia/costo del
      reasoning implícito).

## 🔄 Revisión 2026-06-11 (misma sesión) — Decisión del fundador: INVERSIÓN DE LA ESCALERA

> Verbatim del fundador tras ver precios y smoke test: "si MiMo sale mucho más
> barato y es compatible con la app, será MiMo, Qwen en dispositivo, RAG,
> Gemini — usaremos Gemini solo al final. No quiero depender de las
> restricciones de otros. La aplicación debe ser capaz de sostenerse
> económicamente. Los modelos más potentes solo cuando realmente sea necesario,
> como en una emergencia crítica de planta. La app debe funcionar en todo
> momento."

Ambas condiciones se cumplieron (≈15× más barato en output; smoke test 200 OK
sin cambio de código). **MiMo pasa de "segundo cerebro" a CEREBRO PRINCIPAL.**
El título de este ADR se conserva por trazabilidad; la decisión vigente es esta.

### Escalera definitiva (orden por solicitud, costo mínimo primero)

```
0. Caché semántica + RAG-deflect          ← gratis: si safeNormativeQuery ≥0.75,
   (safeNormativeQuery, Zettelkasten)        responde del corpus SIN llamar LLM
1. MiMo cloud                             ← PRINCIPAL (pay-as-you-go)
   · rutina/alto volumen → mimo-v2.5        ($0.14/$0.28 por M tokens)
   · razonamiento/agente → mimo-v2.5-pro    ($0.435/$0.87)
2. Qwen on-device (SLM, #861)             ← offline / sin red / móvil
3. Gemini                                 ← SOLO: (a) fallback si MiMo falla,
                                             (b) EMERGENCIA CRÍTICA DE PLANTA
4. RAG canónico → respuesta canned        ← garantía "nunca caída dura" (Regla #3)
```

**Excepción de emergencia (directiva del propio fundador):** en eventos de
vida (SOS, man-down, evacuación, gas), la síntesis IA usa el **mejor modelo
disponible** — hoy Gemini Pro lidera los benchmarks publicados por la propia
Xiaomi (MMLU-Pro 90.1 vs 84.9; GPQA-D 91.9 vs 83.7) — con failover inmediato a
mimo-v2.5-pro. El costo es irrelevante ahí (pocas llamadas, vidas en juego).
Nota crítica: las features de emergencia son **deterministas por diseño**
(sensores, umbrales, SOS); el LLM solo redacta/sintetiza — la app funciona
aunque TODA la IA cloud esté caída.

### Modelo de costos a 10.000 usuarios (estimación honesta, 2026-06-11)

Supuestos: 20% usuarios activos con IA/día, 4 consultas c/u, ~600 tokens in +
350 out por consulta → ~240k consultas/mes ≈ 144M tokens in / 84M out.

| Estrategia | Costo IA/mes estimado |
|---|---|
| Todo Gemini Pro (statu quo previo) | ~$1.000+ |
| Todo mimo-v2.5-pro | ~$135 |
| **Escalera completa** (60% deflect RAG/caché · 90% restante en mimo-v2.5 · 8% pro · 2% Gemini emergencia) | **~$25-50** |

Con prompt-cache de MiMo ($0.0036/M en hits — los system prompts de la app se
repiten) el costo real baja aún más. **La IA deja de ser el costo dominante**
(<$0.005/usuario/mes); el costo de infra pasa a ser Cloud Run/Firestore.

### Sobre la rotación por horas (idea del fundador, evaluada)

- Pay-as-you-go tiene **precio plano 24h** → rotar modelos por hora no ahorra
  por sí solo en PAYG.
- El **Token Plan sí tiene "night discount rates"** → si el volumen mensual
  supera ~$50-100, evaluar suscribir y rutear ahí el batch nocturno.
- Lo que SÍ se implementa ya (captura la misma intención): **rotación por
  criticidad** (rutina→v2.5, análisis→pro, emergencia→mejor disponible) +
  **batch jobs nocturnos** (reportes mensuales, ingesta RAG, re-embeddings)
  que de paso evitan competir por rate limits con el tráfico diurno.

### MiMo Claw — revisado, NO aplica al producto

Verificado en aistudio.xiaomimimo.com (2026-06-11): Claw es el **despliegue
hosted de OpenClaw** (asistente personal open-source) corriendo sobre
MiMo-V2.5, con skills integradas y preview de documentos (Kingsoft WebOffice).
El propio footer dice: *"Developer demo platform for model showcases. Not a
formal AI assistant."* → Es vitrina/playground, no bloque de producto. Útil
para que el fundador evalúe la calidad agéntica de MiMo gratis; **no se
integra a Guardian Praeventio** (nuestra integración es por API directa).

### Sobre añadir Claude como proveedor in-app (consulta del fundador)

Decisión: **no por ahora** — coincide con la intuición del fundador. Las IAs
del sistema NO dialogan entre sí (el router elige UN proveedor por solicitud;
no existe comunicación inter-modelo que pueda "confundirse"); el costo real de
cada proveedor extra es mantenimiento: specs espejo, evals por acción y
monitoreo. Dos nubes (MiMo+Gemini) + edge (Qwen) cubren disponibilidad,
costo y calidad. La puerta queda abierta sin deuda: la misma capa
OpenAI-compatible aceptaría un endpoint de Claude (o cualquier otro) con
solo env vars, si algún día una acción lo justifica con eval en mano.

### Plan de migración por fases (acciones → MiMo)

1. **Hoy:** las 6 acciones con spec (`getSafetyAdvice`, `getChatResponse`,
   `queryBCN`, `calculateStructuralLoad`, `designHazmatStorage`,
   `evaluateMinsalCompliance`) → `AI_PROVIDER_ACTIONS_SELFHOSTED` (hecho en
   `.env.local`; Gemini queda como fallback automático del router).
2. **Sesiones cloud:** escribir specs espejo para el resto de acciones
   advisory de alto volumen (patrón split #863), con eval de calidad por
   acción antes de migrar (Regla #1: evidencia, no fe).
3. **Acciones estructuradas-JSON y legal-críticas:** migran una a una SOLO
   con eval aprobado; mientras tanto siguen en Gemini.
4. **Matriz de criticidad** (rutina/análisis/emergencia → modelo): la define
   el fundador con las sesiones cloud; el router ya soporta la distinción
   por acción.
5. **Antes de escalar a producción masiva:** verificar rate limits de la
   plataforma MiMo (la página docs es SPA y no se pudo extraer en esta
   sesión — revisar en Console/FAQ) + Service Agreement para uso comercial.

## Consecuencias

- (+) La app deja de tener un único punto de falla cloud para IA advisory.
- (+) Costo por token advisory cae drásticamente (Token Plan / Apache-2.0 self-host).
- (+) Cero deuda: reutiliza capa #857, orquestador #861, redacción y RAG existentes.
- (−) Un proveedor más que monitorear (mitigado: providerRouter ya loguea por acción).
- (−) Calidad por acción debe validarse (mitigado: canary + expansión gradual).

## Evidencia

- Capa proveedor: `src/services/ai/selfHostedProvider.ts:17-21,82-104`
- Router por acción: `src/services/ai/providerRouter.ts:75,164-183`
- Specs espejo: `src/services/ai/selfHostedActions.ts:274-284`
- Chokepoint dispatcher: `src/server/routes/gemini.ts:512-550`
- Runbook: `docs/runbooks/SELFHOSTED_AI.md` (MiMo-7B citado en L6,19,29,40)
- MiMo-V2-Flash: github.com/XiaomiMiMo/MiMo-V2-Flash (Apache-2.0, README §6 SGLang)
- Plataforma API: platform.xiaomimimo.com (Token Plan global launch)
