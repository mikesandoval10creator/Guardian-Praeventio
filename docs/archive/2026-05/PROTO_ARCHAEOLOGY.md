# Arqueología de prototipos — Guardian Praeventio
> Auditoría exhaustiva de los repos hermanos del codebase actual
> Fecha: 2026-05-03
> Responsable: Daho Sandoval (`mikesandoval10creator`)

## 1. Inventario de repos

| Repo | Última actualización | Visibilidad | Estado | Relevancia |
|------|---------------------|-------------|--------|------------|
| `Guardian-Praeventio` | 2026-05-03 | PUBLIC | Activo (este repo) | Codebase actual; contiene `BERNOULLI_EXTENSIONS.md`, `PLAN_PARTE2_PROTOTIPO1.md`, `src/pages/DigitalTwinFaena.tsx` (ya integra `LingBot-Map`). |
| `Guardian-Praeventio-f-irebaseversion` | 2026-04-30 | PUBLIC | Prototipo congelado | **Contiene los tres docs maestros faltantes**: `PLAN_MAESTRO.md` (512 nodos), `analisis_funcional.md`, `auditoria01.md`, `ROADMAP_RESCATE.md`. |
| `praevium-guard` | 2025-09-06 | PUBLIC | Prototipo Lovable | **Implementación completa del Zettelkasten original** (`UniversalKnowledgeContext.tsx`, `useZettelkastenIntegration.ts`, 4 componentes en `src/components/knowledge/`). |

## 2. Material recuperado por archivo

### analisis_funcional.md
- **Encontrado en:** `Guardian-Praeventio-f-irebaseversion/analisis_funcional.md` (81 líneas).
- **Contenido relevante:**
  - Mapa vivo de la arquitectura post-rescate (Fase 1 de auditoría).
  - Identifica **tres pilares del sistema antiguo** (clave para PARTE3 — gap de contexto en `/api/ask-guardian`):
    1. **El Portal** (`praeventio.ts`): punto de entrada unificado / capa anticorrupción.
    2. **Los Sentidos** (`praeventio-orchestrator.ts`): orquestador que **enriquece el contexto** antes de invocar a la IA. Adaptadores aislados:
       - Meteorológico (OpenWeatherMap) con fallback a datos simulados.
       - Sísmico (USGS) sin fallback (devuelve `null`).
    3. **La Mente** (`praeventio-main.ts`): "Gran Maestro" — Gemini con prompt rol-playing experto 30 años + JSON estricto (causa raíz, riesgos con severidad/probabilidad, plan correctivo/preventivo).
  - Hallazgo crítico: regresión de `security-manager.ts` (capacidad biométrica/cifrado infrautilizada).
- **Decisión sugerida:** **Recuperar** como `docs/legacy/analisis_funcional.md`. La arquitectura "Portal → Sentidos → Mente" es exactamente el patrón que falta inyectar en `/api/ask-guardian`.

### auditoria01.md
- **Encontrado en:** `Guardian-Praeventio-f-irebaseversion/auditoria01.md` (75 líneas).
- **Contenido relevante:**
  - Informe de Estado Absoluto v3.1 (sesión 7-DIC-2025).
  - Resoluciones documentadas:
    - Arquitectura de datos dual → unificada en `src/lib/firestore-utils.ts`.
    - Singleton de Auth → falso positivo, ya correcto.
  - RBAC vía **Custom Claims de Firebase Auth** (no perfiles Firestore). Cloud Function `setUserRole` + UI en `UserManagement.tsx`.
  - Innovación: `generateDynamicRoute` (Vertex AI) reemplaza rutas estáticas de evacuación.
- **Decisión sugerida:** **Recuperar** como `docs/legacy/auditoria01.md`. Documenta decisiones arquitectónicas que aún rigen.

### PLAN_MAESTRO.md (512 nodos)
- **Encontrado en:** `Guardian-Praeventio-f-irebaseversion/PLAN_MAESTRO.md` (59 líneas — **resumen, no las 512 filas**).
- **Estructura recuperada:**
  - **Bloque I — Identidad y Perfil** (Nodos 1-75): tabla colapsada con `...` (filas no enumeradas individualmente).
  - **Bloque II — Sensores y Datos en Tiempo Real** (Nodos 76-135): idem.
  - **Bloque III — Gestión y Procesos** (Nodos 136-311): idem.
  - **Bloque IV — Bio-Ingeniería y Fisiología** (Nodos 312-362): **9 nodos enumerados explícitamente (312-320)**, resto colapsado en `321-512 🔴 Inexistente`.
- **Nodos detallados encontrados (los únicos con ID concreto):**
  | ID | Nodo | Tipo | Fundamento | Sinapsis |
  |----|------|------|-----------|----------|
  | 312 | Asistente Ritmo Circadiano | [AI] | DS 44 | Higiene Sueño + Horario Real |
  | 313 | Hidratación Inteligente | [D] | Admin | → Test Fatiga + Temp. Actual |
  | 314 | Test Fatiga y Alerta | [AI] | DS 44 | Combina [312]+[313] |
  | 315 | Detector Postura Ergonómica | [AI] | DS 44 (TME) | → [070] Antropometría, [209] Tareas Correctivas |
  | 316 | Box Breathing | [K] | Admin | Auto-trigger tras [082] Pánico |
  | 317 | Nutrición Anti-Inflamatoria | [K] | Cultura | Cruza [010] Alergias + [011] Medicación |
  | 318 | Visión Periférica | [AI] | Admin | → Reduce [043] Accidentes |
  | 319 | Carga Física (pasos) | [D] | DS 44 | → [063] Horario Real |
  | 320 | Pausa Activa Guiada | [K] | Cultura/Ley | Trigger por [124] Contexto |
- **Veredicto del documento:** "Próxima Acción Inmediata: Definir y abordar el **Nodo 321**".
- **Taxonomía de tipos detectada:** `[AI]` (IA), `[D]` (Dato/sensor), `[K]` (Conocimiento/contenido). Faltarían tipos para los 503 nodos restantes.
- **Decisión sugerida:** **Sintetizar de cero** los 503 nodos faltantes. El PLAN_MAESTRO recuperado es **un esqueleto, no un censo**. Lo que sí se rescata es la **estructura de 4 Bloques** y la **convención `[AI]/[D]/[K]`**.

## 3. Lógica del Zettelkasten original

Recuperado **íntegramente** desde `praevium-guard` (artefactos verificados):

- `src/contexts/UniversalKnowledgeContext.tsx` (401 líneas) — **estado global unificado**.
- `src/hooks/useZettelkastenIntegration.ts` (203 líneas) — auto-detección de contexto por ruta.
- `src/components/knowledge/ZettelkastenEnhancement.tsx` (123 líneas) — wrapper.
- `src/components/knowledge/SmartConnectionsPanel.tsx` (271 líneas) — panel flotante.
- `src/components/knowledge/KnowledgeNodeBadge.tsx` (162 líneas) — badge de conexiones.
- `src/components/knowledge/KnowledgeGraphVisualizer.tsx` (409 líneas) — visualizador.
- `src/components/knowledge/AcademicContentProcessor.tsx` (695 líneas) — ingesta académica.
- `src/components/knowledge/README.md` (107 líneas) — documentación de fases 1-4 ya completadas.

### Modelo de datos canónico (interfaz `KnowledgeNode`)
```ts
type NodeType = 'project'|'worker'|'epp'|'normative'|'risk'|'document'|'training'|'industry';
interface KnowledgeNode {
  id: string;
  type: NodeType;
  title: string;
  content: any;
  connections: string[];           // bidireccional implícito
  metadata: { category?, priority?, lastUpdate, tags[], industryCode?, sector?, riskLevel? };
}
interface SmartConnection {
  sourceId; targetId;
  type: 'automatic'|'manual'|'suggested';
  strength: number;                // 0-1
  reason: string; createdAt: string;
}
```

### Reglas de auto-acoplamiento (smart actions tipados)
Cinco patrones canónicos descubiertos en `useZettelkastenIntegration.ts`:
1. `create-worker-epp-connection` — vincula `worker-{id}` ↔ `epp-{id}` con razón "EPP asignado automáticamente".
2. `suggest-normatives-for-project` — dispara `generateSuggestions(project-{id})`.
3. `link-industry-to-project` — vincula `project-{id}` ↔ `industry-{sector}`.
4. `suggest-epp-for-worker` — usa `jobPosition` como filtro semántico.
5. `auto-link-training-to-worker` — razón "Capacitación recomendada por IA".

### Detección automática de contexto por URL
```
/proyectos/:id/trabajadores/* → project-{id}
/trabajadores                 → workers-module
/epp                          → epp-module
/normativas                   → normatives-module
/riesgos                      → risks-module
/pizarra                      → pizarra-interactive
/admin/industries-import      → industries-import
```

### Conexión semántica explícita
- **Proyecto ↔ Normativa** por `industry === applicableSectors`.
- **Trabajador → EPP** por `jobPosition`.
- **EPP → Capacitaciones** por tipo.

### Estado actual en este repo (gap)
`PLAN_PARTE2_PROTOTIPO1.md` ya señala: *"los 5 smart actions tipados de Proto 1 aún no están en `useZettelkastenIntelligence`"*. El acoplamiento `climateRiskCoupling.ts` ya existe (commit `0bf4620`) pero solo cubre el dominio meteorológico.

## 4. LingBot-Map y similares

**Estado: parcial — referenciado en docs y un componente, sin código propio del SLAM.**

- `BERNOULLI_EXTENSIONS.md` §C.13 "Fotogrametría SLAM (LingBot-Map open source)":
  - Categoría: wildcard.
  - Módulo target: `DigitalTwinFaena.tsx` (ya existe).
  - Fórmula: gemelo digital + simulación derrame químico por pendiente real (gradiente Bernoulli sobre superficies).
  - Normas: DS 43/2015, NFPA 30.
  - Esfuerzo: 8h.
  - Reemplaza la idea descartada de AutoCAD/Pizarra.
- `src/pages/DigitalTwinFaena.tsx` (499 líneas) — la UI existe y muestra etiqueta visible *"Reconstrucción Faena · lingBot-Map"*. Es **shell de UI; falta el pipeline de captura/mesh real**.
- `PLAN_PARTE2_PROTOTIPO1.md` confirma la cadena: "(a) PDF render via pdf.js, (b) zonas dibujadas sobre Google Maps, (c) SLAM open source (LingBot-Map)".
- `praevium-guard` **no contiene** referencias a LingBot ni SLAM (búsqueda confirmada).
- Pipeline auxiliar ya en repo actual: `scripts/ply_to_glb.py`, `scripts/reconstruct_faena.py`.

**No hay implementación del SLAM en sí**, ni en este repo ni en los hermanos. LingBot-Map es una **integración pendiente** (open source externo).

## 5. Otros hallazgos relevantes

- **ROADMAP_RESCATE.md** (firebaseversion, 71 líneas) — predecesor del PLAN_MAESTRO; cuenta la fusión "código rescatado + visión `caballodefuego.md`".
- **COMPASS_SETUP.md** existe en ambos prototipos (firebaseversion 171 líneas, praevium-guard) — sistema de brújula nativa.
- **Patrón "Bernoulli como traductor"** (BERNOULLI_EXTENSIONS.md): *"el motor genera el dato, el zettelkasten lo conecta, el Asesor lo interpreta"* — define el rol del Zettelkasten en la arquitectura tri-capa.
- **Gap PARTE3 confirmado**: el orquestador antiguo (`praeventio-orchestrator.ts`) inyectaba clima+sismo en cada llamada a la IA. El `/api/ask-guardian` actual carece de esa capa de sentidos. Recuperar ese patrón es alta prioridad.
- **Componente `AcademicContentProcessor.tsx`** (695 líneas en praevium-guard) — ingesta de papers/normativas a nodos del Zettelkasten. Pieza ausente en repo actual.

## 6. Recomendaciones

### Recuperar (copiar adaptado al repo actual)
1. ✅ recuperado — `analisis_funcional.md` → `docs/proto/analisis_funcional.md` (sanitizado al 2026-05-03, Sprint 10).
2. ✅ recuperado — `auditoria01.md` → `docs/proto/auditoria01.md` (sanitizado al 2026-05-03, Sprint 10).
3. `PLAN_MAESTRO.md` → `docs/legacy/PLAN_MAESTRO_skeleton.md` (marcar explícitamente que solo nodos 312-320 están enumerados).
4. **Modelo `KnowledgeNode` + `SmartConnection`** de `UniversalKnowledgeContext.tsx` → fusionar con `useZettelkastenIntelligence` actual.
5. **Los 5 smart actions tipados** → integrar en el hook actual (gap señalado en PARTE2).
6. **Arquitectura "Portal → Sentidos → Mente"** → reimplementar en `/api/ask-guardian` con orquestador que inyecte contexto meteorológico+sísmico antes de Gemini.
7. `AcademicContentProcessor.tsx` → adaptar a `src/components/knowledge/` actual.

### Sintetizar de cero
- **Los 503 nodos restantes del PLAN_MAESTRO** (321-512). El doc original es esqueleto; hay que generarlos.
- **Pipeline real LingBot-Map** (captura → mesh → simulación Bernoulli en superficies). Solo existe la UI shell.
- **Adaptador SLAM** y módulo de gemelo digital físico (más allá del shell `DigitalTwinFaena.tsx`).

### Abandonar formalmente
- **AutoCAD/Pizarra** (ya descartados explícitamente en PARTE2 §4 — sustituidos por LingBot-Map).
- **Idea de RBAC vía perfiles Firestore** — el sistema definitivo es Custom Claims (auditoria01 lo confirma).
- **Fallback con `null` del adaptador sísmico** — replicar en su lugar el patrón "datos simulados resilientes" del adaptador meteorológico.
