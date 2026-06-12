# SPEC — Tier-gating server-side (`requireTier`)

**Origen:** P0 #1 del informe externo `docs/audits/INFORME-EXTERNO-2026-06-12.md`
(elevado por el fundador en sesión cowork local 2026-06-11/12).
**Problema:** la verificación de tier/paywall vive solo en el cliente
(`src/contexts/SubscriptionContext.tsx`). Un `curl` directo a las rutas premium
las consume gratis. Riesgo directo de ingresos.

## Diseño propuesto (para implementación por sesiones cloud, ~0.5 sprint)

### 1. Middleware `requireTier(minTier: TierId)`

- Ubicación: `src/server/middleware/requireTier.ts`.
- Fuente de verdad: el doc de suscripción del tenant en Firestore (el mismo que
  activa `mark-paid`/webhooks de billing — PR #862). NUNCA el header/cliente.
- Cache por request en `res.locals.subscription` (visitas múltiples del mismo
  request no re-leen Firestore); TTL corto opcional en memoria por tenant
  (≤60 s) si el QPS lo justifica.
- Respuesta al bloquear: `402 Payment Required` con
  `{ error: 'tier_required', minTier, currentTier }` — el cliente ya sabe
  renderizar upsell desde SubscriptionContext.
- Telemetría: `logger.warn('tier_gate_blocked', …)` + contador (detección de
  intentos de bypass = señal de demanda del feature).

### 2. Tabla central ruta→tier (no dispersar la política)

- `src/server/middleware/tierRouteTable.ts`: lista explícita
  `{ mount: '/api/predictions', minTier: 'pro' }` etc.
- Aplicación en `server.ts` al montar: `app.use('/api/predictions',
  requireTier('pro'), predictionsRouter)` — o un wrapper que recorra la tabla.
- **Regla ADR 0021:** las features de VIDA (SOS, man-down, evacuación,
  emergencias) son FREE para todos los tiers — la tabla NO debe incluirlas
  jamás (test de invariante que lo verifique).

### 3. Tests (patrón existente `billing.routeTable.test.ts`)

- Contract test que recorre la tabla: sin suscripción → 402; con tier
  insuficiente → 402; con tier correcto → next() (200/route-specific).
- Test de invariante: ninguna ruta de vida/emergencia en la tabla.
- Test anti-regresión: rutas premium NUEVAS sin entrada en la tabla → el
  convention-guard debe avisar (extender `scripts/check-convention-guard.cjs`
  con `tier_gate_pending` si se quiere ratchet).

### 4. Rollout seguro

1. Fase report-only: el middleware solo loguea `tier_gate_would_block` (1-2
   días en prod) — valida la tabla sin romper clientes pagados mal indexados.
2. Fase enforce: activar bloqueo con env `TIER_GATE_ENFORCE=true`.
3. Monitorear `tier_gate_blocked` en logs/Sentry la primera semana.

## Nota local 2026-06-12

El P0 #2 del mismo informe (`.catch(() => {})` en billing) ya quedó RESUELTO
en la sesión local: 9/9 call-sites en
`src/server/routes/billing/{webpay,mercadopago,khipu,googleplay,appstore}.ts`
migrados al patrón de `dte.ts` (`.then(ok => !ok && logger.error(...))`,
auditServerEvent nunca lanza). Pendiente: commit + PR (working tree local del
fundador) + correr suite billing en CI.
