# Flow de inspección conjunta de la aplicación

Este documento describe las herramientas que permiten revisar la aplicación
**juntos**: el visor embebido en el cliente de DeepSeek Harness (superficie de
trabajo), Lighthouse (calidad), Playwright (comportamiento) y graphify
(estructura y relaciones entre nodos).

La regla que ordena todo el flujo: **se mide la aplicación real en ejecución,
no una build de referencia**. El servidor de desarrollo de Express (que
hospeda Vite en `middlewareMode`) es la misma app que el visor abre en la
pestaña Navegador, así que las cifras describen lo que se está viendo.

---

## 1. Visor embebido (superficie de trabajo compartida)

El plugin `@local/guardian-praeventio-viewer` añade, junto al redactor del
chat, un acceso que abre la aplicación en la pestaña **Navegador** de la barra
lateral derecha, más un catálogo con las **201 rutas** de la aplicación
organizadas en 8 grupos (General, IA, Cumplimiento, Emergencias, Salud,
Operaciones, Riesgos, Capacitación).

Ventana de trabajo compartida:

1. `npm run dev` en el repositorio (puerto `57335` por defecto).
2. Abrir o refrescar el cliente de DeepSeek Harness.
3. Pulsar el acceso **Guardian** junto al redactor → elegir *Abrir en la
   pestaña Navegador* o *Buscar rutas…*.
4. En el catálogo, filtrar por nombre o ruta y pulsar Enter para saltar al
   módulo objetivo.

El catálogo es un **snapshot** extraído de las declaraciones de ruta reales
(`src/AppRoutes.tsx` y `src/routes/*.tsx`), no un router en vivo. Si una ruta
se renombra o se elimina aguas arriba, la pestaña Navegador sigue reportando
el resultado real de la carga.

### Honestidad del estado

El plugin informa sobre **la solicitud de apertura**, nunca sobre la carga:

- «Se solicitó abrir en la pestaña Navegador de la barra lateral derecha.»
- «No se pudo solicitar abrir esa ruta.»

El plugin **no** sondea el servidor antes de abrir: Guardian no envía
`Access-Control-Allow-Origin`, así que una comprobación de salud entre
orígenes fallaría por CORS aunque la app sirviera perfectamente. La pestaña
Navegador ya muestra su propio aviso localizado cuando el destino no
alcanza.

---

## 2. `npm run inspect:app` — Lighthouse + Playwright contra el dev server

```bash
npm run inspect:app                      # salud + Lighthouse + smoke Playwright
node scripts/inspect-app.mjs --only=lighthouse
node scripts/inspect-app.mjs --only=e2e
node scripts/inspect-app.mjs --url=http://localhost:3000
```

Qué hace:

| Paso | Herramienta | Objetivo |
|---|---|---|
| salud | `GET /api/health` | confirmar que el dev server responde |
| Lighthouse | `node_modules/lighthouse/cli/index.js` | performance, accessibility, best-practices, SEO, PWA |
| smoke | `node_modules/@playwright/test/cli.js` | `tests/e2e/landing-smoke.spec.ts` en chromium |

Decisiones de diseño:

- **Reutiliza el servidor** si ya está sano. Nunca levanta un segundo
  proceso: dos instancias de Express sobre el mismo proyecto de Firestore
  pelearían por los emuladores y los jobs en segundo plano.
- **Apunta al dev server**, no al preview de build que usa el job de perf de
  CI. El dev server es lo que el visor muestra.
- **Un fallo en un paso no aborta el resto**: cada paso reporta su resultado y
  el script continúa.
- Los artefactos se escriben en `reports/lighthouse/` (ya ignorado por git).

`E2E_NO_SERVER=1` y `E2E_BASE_URL` se inyectan para que Playwright no levante
su propio servidor de preview y apunte al dev server.

### Referencias

- `playwright.config.ts` — proyectos `chromium`, `mobile-android`, `firefox`,
  `webkit`; `baseURL` desde `E2E_BASE_URL`.
- `lighthouserc.json` — umbrales de CI (LCP ≤ 4000 ms, TBT ≤ 600 ms, CLS
  ≤ 0.1, accesibilidad ≥ 0.90). `PERFORMANCE.md` documenta umbrales más
  estrictos (LCP 2200, TBT 200) que aún no coinciden con el archivo de
  configuración: esa deriva sigue abierta.

---

## 3. graphify — estructura y relaciones entre nodos

`graphify-out/` es la representación del grafo de código (nodos = símbolos,
enlaces = llamadas, importaciones, pertenencia). Está en `.gitignore` porque
pesa ~52 MB; se regenera con:

```bash
graphify update .
```

Consultas útiles durante la revisión de deuda técnica:

```bash
graphify explain "securityHeaders"   # vecindad y-degree de un símbolo
graphify query "<patrón>"             # buscar en el grafo
graphify affected "<archivo>"         # qué se ve afectado si cambia
graphify god-nodes                    # hubs con demasiada responsabilidad
graphify diagnose multigraph          # colisiones de aristas
```

El grafo actual: **35 498 nodos / 73 590 enlaces / 1 650 comunidades**.
53 archivos fuente no producen ningún nodo (señal de código muerto o de
exports que nadie consume).

**Por qué importa para "un cambio puede afectar a otro apartado":** el
comando `affected` recorre el grafo desde un archivo y devuelve el conjunto
de símbolos que dependen de él. Antes de tocar un módulo compartido
(por ejemplo `src/services/firebase.ts` o `src/server/middleware/`), ese
recorrido es más fiable que leer los imports a mano en 219 páginas lazy.

---

## 4. Deuda técnica: dónde mirar primero

Los contadores vigentes están en `docs/ESTADO-MEDIDO.md` y se regeneran con
`node scripts/gen-measured-state.cjs`. El plan de trabajo vive fuera del
repositorio para no abrir listas paralelas en `.md`.

Los gates que impiden que la deuda crezca (y que deben seguir en verde):

| Gate | Comando |
|---|---|
| huérfanos de conectividad | `npm run lint:connectivity` |
| montajes fantasma | `node scripts/check-render-ratchet.cjs` |
| routers sin test real | `npm run lint:router-tests` |
| `as any` | `npm run lint:any` |
| honestidad de la UI | `npm run lint:honesty` |
| paridad i18n | `npm run lint:i18n` |

Principio rector: **hacer REAL la app, NO eliminar**. Un función honesta hace
lo que promete; nunca un cartel "no disponible" ni un stub.

---

## 5. Checklist de revisión conjunta

- [ ] `npm run dev` en ejecución; `GET /api/health` responde.
- [ ] El visor abre la app en la pestaña Navegador.
- [ ] `npm run inspect:app` — accessibility ≥ 90, sin regresiones nuevas.
- [ ] `graphify affected "<archivo>"` antes de cambiar un módulo compartido.
- [ ] El cambio tiene test (TDD estricto) y `npm run typecheck` en 0 errores.
- [ ] PR con reviewers; nunca push directo a `main`.
