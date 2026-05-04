# Euler Integration Spec — Plan de 10 Fases

**Sprint 20 · Euler-Matrix sweep · Fecha: 2026-05-04**

> Continuación natural del sweep Bernoulli (`src/services/zettelkasten/bernoulli/*`, ~14 modules atómicos). Bernoulli cuantifica las **magnitudes** de cada peligro físico (presión, velocidad, energía); Euler modela la **estructura** que conecta los peligros entre sí (grafos, ODE, optimización variacional, invariantes topológicos).

---

## Visión

Aplicar el trabajo matemático de Leonhard Euler (1707–1783) a la prevención de riesgos para llevar Guardian Praeventio de "modelo reactivo" a "modelo puramente matemático y predictivo". Cada fase aborda un problema real de seguridad industrial mediante un teorema o método demostrado por Euler hace siglos — código fundado en física, no heurísticas.

**Pareja físico-matemática**:
- **Bernoulli** (1700–1782, contemporáneo de Euler en San Petersburgo): dinámica de fluidos, presión vs. velocidad, principio de conservación de energía → magnitudes de peligros.
- **Euler** (1707–1783): teoría de grafos, cálculo diferencial e integral, mecánica del medio continuo, teoría de números → estructura, optimización, invariantes.

---

## Namespace

`src/services/euler/*` — módulos atómicos, pure-function-first, mirror del patrón Bernoulli. Tests unitarios que pinen valores numéricos exactos. Cada módulo lleva un block-comment al inicio con:
1. Aplicación a prevención (problema real que resuelve).
2. Fórmula(s).
3. Origen histórico breve (publicación Euler).
4. Trade-offs / limitaciones / cuándo NO usar.

---

## Mapa de fases (10 → 3 olas)

| Fase | Métodología | Implementación | Wave | Dependencias |
|------|-------------|---------------|------|--------------|
| **1** Cartografía Topológica de Riesgos | Teoría de grafos (Königsberg 1736) | `euler/graphConnectivity.ts` + `RiskNetworkExplorer.tsx` | **Euler-1** | — |
| **2** Optimización Flujos de Evacuación | Caminos eulerianos (paseo único) | `euler/eulerianPath.ts` + `VectorialEvacuationMap.tsx` | Euler-2 | Fase 1 (depende de connectivity) |
| **3** Carga Crítica Estructural | Pcr = π²EI/(KL)² (Euler 1744) | `euler/criticalLoad.ts` + `StructuralCalculator.tsx` | **Euler-1** | — |
| **4** Dinámica Fluidos (no viscosos) | Ecuaciones de Euler (1755) | `euler/fluidDynamics.ts` extends `bernoulliEngine.ts` | Euler-3 | Bernoulli existente |
| **5** Frecuencias Críticas IoT | FFT + identidad e^iπ + 1 = 0 | `euler/fftAnalyzer.ts` + `useAccelerometer.ts` | Euler-2 | — |
| **6** Simulación de Eventos | Método de Euler para ODE (1768) | `euler/odeIntegrator.ts` + `EmergencySimulator.tsx` | **Euler-1** | — |
| **7** Inteligencia Nodos Zettelkasten | Topología jerárquica de Euler | extends Zettelkasten v2 spec | Euler-3 | Zettelkasten existente |
| **8** Mantenimiento Predictivo Variacional | Euler-Lagrange (1755) | `euler/eulerLagrange.ts` + `VigilanciaScheduler.tsx` | Euler-2 | — |
| **9** Criptografía Phi de Euler | Función φ(n), aritmética modular | ADR documentando RSA en `kmsEnvelope.ts` | Euler-3 | NO refactor (RSA ya usa φ implícitamente) |
| **10** Gamificación Bio-Matemática | Característica V-E+F=2 (1758) | `euler/polyhedronAchievements.ts` + `Medal3DViewer.tsx` + `NormativeQuiz.tsx` | **Euler-1** | — |

---

## Wave 1 (esta) — Fases 1, 3, 6, 10

Razón del orden: las 4 fases tienen surfaces existentes y son independientes entre sí. Sienta los rails y prueba el patrón antes de las fases que requieren refactor más profundo.

### Criterios de aceptación Euler-1

- [ ] `src/services/euler/` namespace con barrel + 4 módulos atómicos
- [ ] Tests unitarios pinning fórmulas exactas (≥10 por módulo)
- [ ] 4 surfaces UI integradas sin disrupción visual del estado actual
- [ ] Locale entries × 3 idiomas para nuevos componentes UI
- [ ] Spec doc (este) committed
- [ ] Master plan actualizado con progreso Euler-1

### Constraints Euler-1

- **NO Anthropic SDK** (project memory).
- **NO new deps** — Three.js + i18next + framer-motion ya disponibles.
- **NO refactor de bernoulli/*** — Euler es paralelo, no reemplazo.
- Pure functions en `src/services/euler/*` — sin DOM, sin Web Worker, sin fetch. Esto las hace SLM-friendly (Brecha B).
- Backwards compat: cada surface UI integrada debe seguir renderizando sin errores si la nueva sección Euler está vacía/oculta.

---

## Wave 2 — Fases 2, 5, 8

### Fase 2 — Caminos Eulerianos en Evacuación
- Algoritmo de Hierholzer para encontrar circuito euleriano en grafo de rutas.
- Si grafo tiene >2 nodos de grado impar → no hay paseo continuo posible → alertar "trampa topológica" en UI.
- Output: ruta secuencial sin repetir aristas (cada pasillo cruzado una vez).

### Fase 5 — FFT + Identidad de Euler para IoT
- e^iπ + 1 = 0 es la base teórica del FFT (DFT con W_N = e^{2πi/N}).
- Implementación: usar `fft.js` o equivalente compatible con licencia MIT/Apache (verificar antes con context7).
- Aplicación: descomponer señal de acelerómetro de maquinaria → detectar armónicos que preceden fatiga del material.
- Surface: `useAccelerometer.ts` hook + `WearablesPanel`.

### Fase 8 — Euler-Lagrange para Vigilancia
- Functional `J[γ] = ∫ L(t, γ, γ') dt` minimizado por γ que satisface `∂L/∂γ - d/dt(∂L/∂γ') = 0`.
- Aplicación: optimizar rutas de inspección de prevencionistas — minimizar "energía" (= distancia + tiempo + cambios de elevación) cubriendo cada zona crítica.
- Surface: `VigilanciaScheduler.tsx`.

---

## Wave 3 — Fases 4, 7, 9

### Fase 4 — Ecuaciones de Euler de Fluidos (no viscosos)
- Generalización de Bernoulli para flujo compresible/no estacionario.
- Vinculado a `bernoulliEngine.ts` (extensión, no reemplazo).
- Aplicación: predicción de dispersión de gases tóxicos en `HazmatWindOverlay.tsx` con ventana temporal.

### Fase 7 — Topología Zettelkasten
- Auto-organización de nodos según conectividad euleriana.
- Refactor de `ZETTELKASTEN_V2_SPEC.md` para incluir invariante topológico per nodo.

### Fase 9 — Criptografía φ Euler (DOCUMENTACIÓN, no refactor)
- φ(n) = (p−1)(q−1) para n = pq es el corazón de RSA.
- `kmsEnvelope.ts` ya usa RSA via Cloud KMS — **no reescribir**.
- Crear ADR `docs/architecture-decisions/0007-euler-phi-in-kms.md` documentando el principio matemático.

---

## Reuse de utilidades existentes

- `src/services/zettelkasten/bernoulli/*` — patrón a mirror.
- `src/services/randomId.ts` (19va ola) — para IDs únicos en tests si se necesitan.
- `src/i18n/locales/{es,en,pt-BR}/common.json` — nuevas namespaces `euler.*`.
- Three.js geometrías para Fase 10 (Tetrahedron/Cube/Octahedron/Dodecahedron/Icosahedron built-ins).

---

## Verification end-to-end

Tras Euler-1 (en `D:/Guardian Praeventio/repo`):

```bash
npm run typecheck                              # 0 errores
npm test -- src/services/euler/                # tests Euler-1 verde (≥40 tests)
npm test                                       # full suite green
npm run build                                  # bundle within budget
```

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Bundle size sube por Euler primitives | Baja | Pure functions tree-shake bien; bundle limit 310 KB tiene headroom |
| Tests numéricos flaky por floating-point | Media | Tolerancias explícitas (±0.5%) en lugar de equality estricta |
| Integración UI rompe surfaces existentes | Baja | Cada wire-in es additivo + feature-flag-friendly |
| Three.js polyhedron geoms no disponibles en versión actual | Baja | Verificar `IcosahedronGeometry` etc. existen en R20 (default desde r60) |
| Fase 4 acopla con Bernoulli y rompe contracto | Media | Fase 4 es Euler-3 — última, después de validar el patrón |
| Fase 9 introduce vulnerabilidad cripto | Alta si refactor | NO refactorizar — solo documentar via ADR |

---

## Atribuciones culta

Cada módulo lleva citas Euler-style:
- Fase 1: "Solutio problematis ad geometriam situs pertinentis" (1736)
- Fase 3: "Methodus inveniendi lineas curvas maximi minimive proprietate gaudentes" (1744)
- Fase 4: "Principia motus fluidorum" (1755)
- Fase 6: "Institutiones calculi integralis" (1768)
- Fase 8: Mismo Methodus 1744 (cálculo variacional)
- Fase 10: "Elementa doctrinae solidorum" (1758)

El equipo educa al usuario final con tooltips ("Esta fórmula viene del trabajo de Euler en 1744...").
