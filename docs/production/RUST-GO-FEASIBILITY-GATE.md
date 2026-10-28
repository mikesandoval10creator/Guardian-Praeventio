# Gate de factibilidad Rust/WASM y Go

Estado: **evaluación previa al despliegue; no autoriza migración ni despliegue**.

## Actualización vigente — 2026-10-27

Este gate se subordina al orden de
[`PLAN-COOLIFY-HYBRID.md`](PLAN-COOLIFY-HYBRID.md). Snapshot documental:
`5417fae4d6d61220dca75d6b3ad9d28d9f900ce3`, rama
`fix/recover-technical-debt-20261027`; la base `c11b4308` que aparece abajo es histórica.

- Daniel autorizó instalar Rust y Go en Larry, mensaje 761601 del 26 de octubre.
  La restricción inicial de instalación quedó superada por ese permiso, no por
  una inferencia de este documento. No hace falta reinstalar lo disponible.
- Comprobación física: `rustc 1.99.1`, `cargo 1.99.1` y
  `go version go1.27.3 windows/amd64`, mediante rutas absolutas de toolchain.
- Se conservaron fixtures compartidos 100/1.000/10.000 y mediciones TypeScript.
  El prototipo Rust inspeccionado carga y valida JSON, enlaces y posiciones;
  todavía no contiene la dinámica equivalente del worker.
- El probe WASM histórico acredita toolchain, no equivalencia del motor. La
  tolerancia numérica y el beneficio mínimo de adopción siguen por fijar.
- Próximo slice técnico: tras reconciliar la base compartida, implementar la
  dinámica equivalente de `forceGraphWorker.ts` en Rust, respetar contrato 2D/3D,
  comparar invariantes y tolerancia y medir el algoritmo real por Worker/WASM.
  TypeScript sigue como referencia/fallback; Go instalado no implica servicio Go.

Esta actualización es documental: no inicia la implementación ni cambia el
algoritmo productivo. El histórico y sus mediciones se conservan a continuación,
con su alcance original; no son una nueva ejecución contra el snapshot actual.

## Objetivo

Determinar si Rust/WASM o Go deben entrar antes del despliegue híbrido sin reemplazar TypeScript por preferencia tecnológica. Toda adopción debe ser aislada, medible, reversible y mantener un fallback TypeScript.

## Evidencia histórica — auditoría inicial, anterior a la instalación

- Repositorio: `M:/Guardian Praeventio/repo-live`.
- Rama: `main`.
- HEAD verificado durante la auditoría: `c11b430889a3dc103a96b4c6ef4a846c1d753b5f`.
- Vite+: `1.4.0`.
- `graphify update . --no-cluster`: `34.392` nodos y `80.710` aristas.
- Graphify identifica `src/workers/forceGraphWorker.ts` como dependiente de `KnowledgeGraph.tsx` y `forceGraphWorker.test.ts`.
- El worker usa simulación síncrona con ticks manuales y detiene el timer de d3; su contrato ya es message-based y puede aislarse.
- En aquella consulta inicial no se encontraron `rustc` ni `cargo`; ese resultado
  no describe la disponibilidad actual comprobada en el addendum.
- En aquella consulta inicial no se encontró `go`; actualmente está instalado.

## Línea base TypeScript

Comando ejecutado contra `runSimulation()` con 3 calentamientos y 7 muestras, reteniendo mediana; 60 ticks, cadena de enlaces, salida validada por cantidad de nodos:

| Fixture | Mediana | Mínimo | Máximo |
|---:|---:|---:|---:|
| 100 nodos | 10,60 ms | 10,15 ms | 11,48 ms |
| 1.000 nodos | 168,17 ms | 166,41 ms | 177,02 ms |
| 10.000 nodos | 2.651,81 ms | 2.590,25 ms | 2.737,15 ms |

Estos números son una línea base local, no una promesa de rendimiento universal. El benchmark Rust/WASM debe repetir exactamente los mismos fixtures, iteraciones, validación y medición de transferencia JS/WASM.

## Candidato Rust/WASM adelantable

### `src/workers/forceGraphWorker.ts`

Es el primer candidato técnico porque:

- es cálculo CPU-bound;
- tiene contrato de entrada/salida explícito;
- es stateless por request;
- ya vive fuera del hilo principal;
- no contiene lógica de vida-safety, identidad ni persistencia;
- permite mantener fallback TypeScript;
- los datos son transferibles y acotables.

### Contrato mínimo

Entrada:

```ts
{
  type: "simulate",
  payload: {
    nodes: Array<{ id: string; x?: number; y?: number; z?: number }>;
    links: Array<{ source: string; target: string }>;
    iterations?: number;
    dim?: 2 | 3;
  }
}
```

Salida:

```ts
{
  type: "simulate.done",
  payload: { positions: Array<{ id: string; x: number; y: number; z?: number }> }
}
```

Errores:

```ts
{
  type: "simulate.error",
  payload: { message: string }
}
```

### Gate para adelantar Rust/WASM

Antes de adoptar Rust en la ruta productiva se requiere lo siguiente. La
implementación aislada equivalente sí forma parte de la evaluación acordada:

1. fixture compartido para 100, 1.000 y 10.000 nodos;
2. implementación Rust equivalente, sin cambiar el algoritmo de referencia;
3. build WASM reproducible;
4. comparación bitwise o tolerancia numérica explícita;
5. medición separada de:
   - cálculo puro;
   - serialización/deserialización;
   - transferencia JS/WASM;
   - inicialización del módulo;
   - memoria;
   - p50, p95 y p99;
6. fallback automático a TypeScript si falla carga, validación o presupuesto de latencia;
7. tests contractuales compartidos;
8. health/telemetría de versión del motor;
9. rollback por feature flag;
10. beneficio mínimo previamente acordado, no solo benchmark sintético.

La medición histórica justificó preparar el contrato y el benchmark. Esa
preparación ya avanzó: el siguiente paso es la dinámica equivalente y su
comparación, no afirmar todavía que Rust mejora el producto.

## Candidatos Go

No hay evidencia suficiente para adelantar Go como reemplazo de `server.ts`:

- Express ya concentra una superficie API grande y heterogénea.
- El cambio requeriría contratos estables, autenticación, rate limiting, observabilidad, sesiones, adapters, health checks y despliegue paralelo.
- `conflictQueue` y sincronización tienen requisitos de autoridad, persistencia y auditoría; no son un buen primer port sin contrato de servicio separado.
- Los jobs scheduler/worker son candidatos futuros solo si aparece un límite medido de concurrencia, aislamiento o throughput.

### Gate para Go

Go puede entrar después como servicio independiente cuando exista:

1. un job o adapter concreto con cuello de botella medido;
2. contrato HTTP/gRPC versionado;
3. autenticación y tenant context;
4. idempotencia y límites;
5. health/readiness/liveness;
6. métricas, logs estructurados y trazas;
7. benchmark contra TypeScript con carga representativa;
8. despliegue paralelo en staging;
9. fallback o ruta anterior operativa;
10. rollback probado.

## Decisión provisional

- **Rust/WASM:** continuar la evaluación aislada sobre `forceGraphWorker` desde
  los fixtures existentes hacia la implementación equivalente y benchmark;
  no adelantar aún la migración productiva.
- **Go:** no adelantar implementación todavía; mantenerlo como candidato para un worker/adapter operacional después de estabilizar el contrato y medir la necesidad.
- **TypeScript:** sigue siendo la fuente de verdad y fallback para el vertical slice.
- **Coolify:** no se bloquea por la evaluación, pero ningún servicio Rust/Go entra a staging hasta pasar sus gates.

## Próxima acción autorizada

La instrucción inicial condicionaba el prototipo a habilitar toolchains y
prohibía instalarlos sin permiso. El permiso posterior de Daniel y la instalación
comprobada resuelven esa condición; no autorizan por extensión más instalaciones,
producción ni sustitución de rutas existentes.

La continuación técnica acordada es implementar el algoritmo equivalente aislado,
no otra prueba de carga de fixtures. Reutilizar la misma carga y registrar
versión/hash de TypeScript, fixtures y Rust; validar 2D/3D, errores, determinismo,
invariantes y tolerancia explícita. Medir carga WASM, cálculo, transferencias,
serialización, memoria y p50/p95/p99 antes de decidir adopción. El punto de
entrada operativo y la reconciliación previa están en los bloques A/B del plan.
