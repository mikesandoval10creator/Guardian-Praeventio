# services/dte-worker — worker Go de cola de emisión DTE

Worker **opt-in** para la cola de emisión de documentos tributarios (DTE).
Cierra por construcción el riesgo de **doble emisión bajo stale-retry**
(taquilla Hy3-architect-oleada-2): un reintento con un `Idempotency-Key`
ya visto nunca crea una segunda emisión.

**La ruta Node existente sigue siendo la autoridad.** Este servicio entra a
staging solo después de cumplir el gate completo de
`docs/production/RUST-GO-FEASIBILITY-GATE.md` y con rollback probado.

## Scope honesto

- **Sí**: máquina de estados idempotente, contrato HTTP versionado,
  autenticación por secreto (deny-by-default), tenant explícito, límites por
  tenant, health/readiness/liveness, métricas, logs estructurados JSON,
  shutdown graceful, benchmarks.
- **No**: integración real SII/SAP ni firma tributaria (el emisor real es un
  adapter posterior con credenciales; no hay stub que se presente como real),
  persistencia Firestore (el `Store` de memoria es la referencia testeada;
  Firestore es un slice posterior revisado), despliegue.

## Gate Go — estado

| # | Item del gate | Estado |
|---|---|---|
| 1 | job/adapter concreto con necesidad medida | PRESENTE (riesgo medido: doble emisión + IPN sin cola; benchmark abajo) |
| 2 | contrato HTTP versionado | `/v1/emissions` + `GET /v1/emissions/{id}` |
| 3 | autenticación y tenant | Bearer (compare constante) + `X-Tenant-Id` obligatorio |
| 4 | idempotencia y límites | `Idempotency-Key` exactly-once + token bucket por tenant |
| 5 | health/readiness/liveness | `/healthz`, `/readyz`, `/livez` |
| 6 | métricas, logs, trazas | `/metrics` (contadores), logs JSON (`slog`) |
| 7 | benchmark contra TypeScript | medido (abajo) |
| 8 | despliegue paralelo en staging | PENDIENTE (infra, bloque F) |
| 9 | fallback/ruta anterior operativa | la ruta Node sigue autoridad (flag) |
| 10 | rollback probado | PENDIENTE junto al despliegue |

## Benchmark (2026-10-28, misma carga mixta, 50.000 ops)

| Motor | Resultado |
|---|---|
| Go (`BenchmarkHotPath`) | **1.258 ns/op** |
| Node (`bench/node/machine-bench.mjs`) | p50 100 ns · p95 200 ns · p99 800 ns |

**Lectura honesta:** el Node gana esta carga sintética. El adapter `Store`
de memoria copia por escaneo (`All()`), una ineficiencia conocida de esta
primera iteración; con ella presente, los números NO justifican promover al
worker por velocidad. La justificación medida es de corrección (idempotencia
exactly-once, aislamiento por tenant) y de operación (servicio aislado con
sus propios límites/health/rollback). Cualquier promoción futura requiere
re-medir con carga representativa real (concurrencia multi-tenant sostenida).

## Cómo se ejecuta

```sh
cd services/dte-worker
go test ./...                 # máquina + contrato HTTP
go vet ./...
go test -run=NONE -bench=BenchmarkHotPath ./internal/emission/
node internal/emission/bench/node/machine-bench.mjs 50000
DTE_WORKER_SECRET=... go run ./cmd/dte-worker   # DTE_WORKER_ADDR=:8787
```

## Operación

- Arranque sin `DTE_WORKER_SECRET` = rechazo (exit 2, deny-by-default).
- `POST /v1/emissions` (Bearer + `X-Tenant-Id` + `Idempotency-Key` +
  `{"document_type": "...", "payload": {...}}`) → `201` (creado) o `200`
  (`idempotent_replay: true`, mismo `emission.id`).
- Reintentos: `failed` vuelve a cola con backoff; a los `max_attempts` pasa
  a `dead` (dead-letter). `emitting` es exclusivo por claim.
