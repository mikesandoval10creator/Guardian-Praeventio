# Continuidad del trabajo conjunto de Guardian

## Propiedad y propósito

Los cambios recuperados del checkout `M:/Guardian Praeventio/repo-live` son trabajo conjunto deliberado de Daniel y Hermes. Que no tuvieran PR no los convierte en cambios ajenos ni descartables. No resetear, limpiar ni sincronizar este checkout de forma destructiva para recuperar contexto.

## Mapa de cambios auditados

Este mapa y sus pruebas son evidencia del slice de recuperación, no una lectura
actual de todo `main`. Ver el addendum de continuidad al final para el orden
vigente y las autorizaciones posteriores.

- **Arquitectura híbrida:** `PLAN-COOLIFY-HYBRID.md`, `COOLIFY-DEPLOYMENT-CONTRACT.md` y `RUST-GO-FEASIBILITY-GATE.md` conservan decisiones, límites y gates. Coolify complementa los adapters existentes; no autoriza borrar Firebase, desplegar, inventar secretos ni instalar toolchains. `praeventio.net` es público; `app.praeventio.net` sirve aplicación/API del mismo origen.
- **Gateway LLM:** `gemini.ts` usa tenant de claims verificados con compatibilidad UID. `providerRouter.ts` incorpora resolver backend y métricas con tenant sin prompts; `selfHostedProvider.ts` libera cuerpos HTTP descartados. El resolver por entorno sigue siendo compatibilidad: esto NO implementa todavía un almacén multi-tenant de claves ni aislamiento completo del circuito global.
- **Resiliencia:** orquestador y lector Firestore liquidan la rama timeout cuando gana la operación. Los fixtures deben liberar sus operaciones pendientes. Esto NO demuestra cancelación de adapters reales que ignoren el deadline.
- **Recursos HTTP:** cliente de firma de libro y limpieza del emulador consumen o cancelan respuestas antes de continuar/fallar; cada respuesta del mock de reintentos es independiente.
- **Tests UI/contextos:** aislamiento local de Firebase Auth/i18n/framer-motion donde no forman parte del contrato probado; espera de efectos de ProjectContext; cierre explícito de 404 Express en smoke B2D. No se eliminan las aserciones funcionales. Estos mocks no sustituyen integración real ni E2E.
- **Mesh:** hashing determinista con fixture del contrato `arrayBuffer`; no es evidencia de integración de Blob nativo.
- **Grafo:** simulación de ticks manuales detenida inmediatamente y limpieza de la wake-up frame de d3 entre pruebas. Benchmark TypeScript ya versionado; no existe aún comparativa Rust/WASM ni servicio Go verificado.
- **Tooling:** `test:ci` pasa a `vp test run`; `test:ci:vitest` conserva ejecución directa. Engine declarado `^24.22.1 || ^26.12.1`; runtime local observado `v24.15.0`, por lo que las pruebas locales no certifican compatibilidad del engine requerido.

## Correcciones al completar esta recuperación

Dos tests de regresión reprodujeron fallos del resolver: una configuración de tenant inyectada no se usaba sin configuración global y una excepción del almacén escapaba del contrato NEVER throws. Se permite resolver explícito sin configuración global y se captura su excepción con error tipado/redactado y sin HTTP. Se mantienen feature-off y fallback heredados.

Los dos fixtures lentos del orquestador ahora conservan una operación pendiente durante el deadline y la liquidan tras obtener el fallback, sin timers de 5/10 segundos abandonados. Esto corrige recursos propiedad del test, no afirma cancelar inferencia real.

## Evidencia y límites

- Antes de las correcciones: 22 archivos, 161 tests pasan, **5 leaks** en fixtures del orquestador. Exit 0 NO equivale a ausencia de leaks.
- Regresiones del resolver antes del fix: 2 fallan / 18 pasan.
- Después: **22 archivos / 163 tests pasan**, exit 0 y sin sección de leaks en la salida (`guardian-recovery-focused.log` en scratch de Hermes). Incluye USGS, HTTP self-hosted y los tests locales modificados.
- Router + orquestador + adapters: **3 archivos / 64 tests pasan**; sin sección de leaks en esa ejecución.
- Tests toolchain Vite+: **12 + 8 pasan**, exit 0.
- `npm run typecheck` fresco: exit 0.
- ESLint de todos los TS/TSX modificados: 0 errores, 8 advertencias en `gemini.ts`.
- `git diff --check`: exit 0.
- Suite completa vía Vite+ iniciada aparte: no declarar verde hasta leer su resultado final y comprobar SHA/estado de archivos. Si una ejecución coincide con una edición, repetir la prueba afectada y no presentarla como snapshot inmutable.

No se cierran tickets de Notion, no se declara producción ni se fusiona con checks pendientes. Esta nota preserva continuidad; no reemplaza código, pruebas, CI ni read-back.

## Addendum — continuidad reconciliada el 2026-10-27

- El plan canónico es [`PLAN-COOLIFY-HYBRID.md`](PLAN-COOLIFY-HYBRID.md), actualizado
  desde los acuerdos de Larry del 22–26 de octubre. No crear otro backlog ni
  volver a tratar nuestros cambios como material ajeno descartable.
- Snapshot documental: `fix/recover-technical-debt-20261027`,
  `5417fae4d6d61220dca75d6b3ad9d28d9f900ce3`; desarrollo en M, checkout de C preservado.
- Rust/Go sí fueron autorizados posteriormente y están instalados: rustc/cargo
  1.99.1 y Go 1.27.3. La frase inicial «no autoriza instalar toolchains» describe
  el alcance del documento, no revoca la autorización expresa de Daniel.
- #1866/#1867/#1868 y #1872/#1873 están fusionados según la revisión remota. La
  recuperación conjunta #1874 sigue draft/DIRTY/sin checks en ese corte y hay cinco
  conflictos en el worktree de integración. Reconciliarlos sin perder mejoras.
- Tras esa reconciliación, retomar la dinámica equivalente Rust del worker y su
  comparación con TypeScript; validar fixtures no implementa aún el algoritmo.
- La evidencia focalizada anterior se preserva. Esta actualización no ejecutó
  suite funcional ni recuperó/revalidó el resumen de la suite amplia; no cambia
  sus límites ni acredita cero leaks o gates de otro SHA.
- Gateway multi-tenant de claves, MCP HTTP autenticado y digital twin operacional
  no se consideran completos por existir adapters, UI, catálogos o propuestas.
- Notion, infraestructura y código funcional no se modificaron en este paso.
