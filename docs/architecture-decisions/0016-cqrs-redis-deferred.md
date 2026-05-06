# ADR 0016 — CQRS / Redis: deferred until P95 latency demands it

Status: **accepted (deferred — no build until trigger condition met)**
Date: 2026-05-05
Aplica a: TODO.md Prioridad 5 ítem "Arquitectura CQRS / Redis", `pages/CQRSArchitecture.tsx` (shell educativo), HONEST_STATE 2026-05-05.

## Contexto

`TODO.md` (línea 57 hasta 2026-05-05) marcaba **CQRS / Redis como `[x]`** mientras `HONEST_STATE` y `DOCS_RECONCILIATION` lo clasificaban explícitamente como SHELL. El audit profundo del 2026-05-05 (`docs/audits/AUDIT_2026-05-05_FULL.md`) confirmó la contradicción: `pages/CQRSArchitecture.tsx` es **solo presentational** (un panel educativo que explica el patrón), sin ningún command/query split en routes ni Redis productivo.

El plan original (Fase 10x) asumía que la app llegaría a "cientos de miles de operarios concurrentes" y que necesitaríamos cache distribuido para separar lecturas/escrituras. El audit muestra que estamos lejos de esa carga — el cuello de botella real al 2026-05-05 es:

1. **Cobertura E2E ~62%** (no 99% como decía el badge), todavía hay deuda de feature.
2. **Lanzamiento mundial Play Store/iOS** bloqueado por i18n hardcoded en 107/110 páginas + dark mode + WCAG.
3. **Ingesta IoT real** (Sprint 32 TT) recién en flight.
4. **Concurrencia actual**: tenants reales tienen O(10²-10³) workers, no O(10⁵). Firestore + caching local en server.ts son suficientes.

Construir CQRS+Redis ahora sería **arquitectura antes de carga**, lo opuesto al principio "no abstraer prematuramente". Cada capa nueva añade superficie de bugs, complejidad operativa, y costo de mantenimiento sin beneficio observable hoy.

## Decisión

**Deferred**. No se construye CQRS productivo ni se aprovisiona Redis hasta que se cumpla **al menos uno** de estos triggers:

1. **P95 latency degradación**: el endpoint más caliente (probablemente `/api/zettelkasten/nodes` o `/api/billing/invoice/:id`) supera 800ms P95 sostenido durante una semana, con fan-out a Firestore como causa raíz verificada (no por código aplicación).
2. **Carga real >50k workers concurrentes**: un único tenant alcanza 50.000 workers activos en una semana laboral. Es ~100x el supuesto de carga 2026.
3. **Costo Firestore >$1.5k USD/mes**: el costo de reads pasa el umbral donde Redis cache pagaría su propia operación + dev time amortizado en 3 meses.
4. **Restricción regulatoria**: alguna jurisdicción nueva (China, Russia, UE post-DPA) exige caching local con cache invalidation auditable que Firestore no satisface.

Si **ninguno** de los triggers se cumple, **no se construye** CQRS. El `pages/CQRSArchitecture.tsx` queda como **doc educativa** del patrón (con banner inline "**Diagrama de arquitectura objetivo si se cumplen triggers — no implementado al 2026-05-05**" — TODO incluir banner en su próximo touch del file).

## Consecuencias

- **TODO.md desmarcado**: `[x]` → `[ ]` en Prioridad 5 ítem CQRS, con nota "deferred (ADR 0016)".
- **HONEST_STATE no cambia su tabla**: CQRS no era un dominio listado, así que no hay % a recalibrar.
- **`pages/CQRSArchitecture.tsx` queda**: sigue siendo útil pedagógicamente (explica a stakeholders qué patrón está disponible si la app escala). Pero se marca claramente como "objetivo, no construido".
- **No se aprovisiona Redis**: ni en `docker-compose.dev.yml` (si existe) ni en infra prod. Si llega un dev nuevo y ve `pages/CQRSArchitecture.tsx`, lee este ADR primero antes de empezar a construir.
- **Métrica a rastrear**: agregar a `docs/observability/INDEX.md` un dashboard que muestre P95 latency de los 5 endpoints más calientes. Cuando uno cruce 800ms P95, este ADR debe revisitarse.
- **No precluye micro-cache local**: si un endpoint específico necesita un `Map` con TTL en memoria del proceso (como ya hace `routes/emergency.ts:79 USER_TOKEN_CACHE_TTL_MS`), eso NO requiere CQRS — es optimización local. El gating es solo para Redis productivo + read/write split arquitectónico.

## Comparación con ADR 0013 (Mesh)

ADR 0013 también describe un sistema sub-utilizado al 2026-05-05 (mesh BLE/WiFi Direct con engine + Capacitor plugin pero CERO consumer en `src/`). La diferencia: ADR 0013 está **accepted con drift** — el código sí se construyó pero no se cableó; el siguiente sprint debe cerrar el wire. Para CQRS la decisión es opuesta: **NO construir** hasta trigger. Esto evita el patrón "construido sin consumir" que el audit identificó como deuda silenciosa.

## Re-evaluación

Este ADR debe revisitarse en **Sprint 38** (≈2026-06-30) o cuando se cumpla un trigger, lo que ocurra primero.
