# Transbank / Webpay — Runbook

> Operacional. Onboarding del comercio + tarjetas de prueba + switch a producción + troubleshooting.
> Sigue después de `BILLING.md` (que tiene la arquitectura).

**Doc oficial Transbank**: <https://transbankdevelopers.cl/documentacion/como_empezar>
**Tarjetas de prueba**: <https://transbankdevelopers.cl/documentacion/como_empezar#tarjetas-de-prueba>
**Producto que usamos**: Webpay Plus (REST) — con `transbank-sdk@^6.1.1` (Node).

---

## 1. Estado actual del código

| Pieza | Archivo | Estado |
|---|---|---|
| Adapter SDK | `src/services/billing/webpayAdapter.ts` | ✅ Real (no stub). Default sandbox; flip a prod via env. |
| Idempotencia | `processed_webpay/{token_ws}` Firestore doc | ✅ Lock-then-complete con stale-window 5min. |
| Return handler | `GET /billing/webpay/return` | ✅ Mapea `response_code` a 3 estados (AUTHORIZED/REJECTED/FAILED-transient). |
| Audit logs | `audit_logs/billing.webpay-return.{authorized,rejected,failed}` | ✅ Sprint 18 (TM-R02 closure). |
| PCI guards | `cardLast4` en lugar de PAN, raw nunca al cliente | ✅ Tests específicos. |
| Métricas | `webpayMetrics.ts` | ✅ Counters por outcome. |
| Tests | `webpayAdapter.test.ts` (43 cases) + `billing.test.ts` integration | ✅ 100% pasando. |

**No requieres tocar código** para empezar a integrar — solo poblar credenciales.

---

## 2. Onboarding (lado Transbank — manual del usuario)

### 2.1 Cuenta de comercio (KYC)

1. Ir a <https://www.transbank.cl/> → "Quiero contratar Webpay Plus".
2. Completar KYC (RUT empresa o persona, datos bancarios, giro, dirección).
3. Tiempo aproximado de aprobación: **3–10 días hábiles** dependiendo de validación.
4. Tras aprobación, Transbank envía por **correo encriptado** (passphrase aparte):
   - `commerceCode` (12 dígitos numéricos, ej. `597055555532`).
   - `apiKey` (token UUID + hash, no es JWT).
   - URL de portal de comercios.

### 2.2 Configuración portal Transbank

1. Loguearse en el portal con el `commerceCode` + clave inicial.
2. Configurar URL de retorno (debe matchear `${APP_BASE_URL}/billing/webpay/return` exactamente — Transbank rechaza redirects diferentes).
3. Habilitar producto "Webpay Plus REST" si no está por default.
4. (Opcional) Habilitar conciliación automática + webhook para reportería diaria.

### 2.3 Variables de entorno (lado nuestro)

```bash
WEBPAY_COMMERCE_CODE=597055555532          # numérico, 12 dígitos
WEBPAY_API_KEY=579B532A7440BB0C9079DED94...  # UUID-shaped, opaque
WEBPAY_ENV=production                       # default 'integration'
APP_BASE_URL=https://app.praeventio.net     # canonical URL para return
```

Vault: **GitHub Actions Secrets** + **GCP Secret Manager** para Cloud Run runtime. **NUNCA commitear**. El `audit_logs` system y `processed_webpay` Firestore collection ya tienen rules que los protegen — solo el SDK del server los usa.

---

## 3. Tarjetas de prueba (entorno integration)

> Fuente oficial: <https://transbankdevelopers.cl/documentacion/como_empezar#tarjetas-de-prueba>
>
> Estas tarjetas SOLO funcionan con `WEBPAY_ENV=integration` (o cuando las env vars no están seteadas — el default). En producción, devolverán "tarjeta no autorizada".

### 3.1 Webpay Plus (compras únicas — el flujo principal)

| Caso | Tarjeta | Marca | CVV | Expiración | Resultado esperado |
|---|---|---|---|---|---|
| **VISA aprobada** | `4051 8856 0044 6623` | VISA | `123` | cualquier futuro | `AUTHORIZED` |
| **MasterCard aprobada** | `5186 0595 5959 0568` | MC | `123` | cualquier futuro | `AUTHORIZED` |
| **AMEX aprobada** | `3700 0000 0002 032` | AMEX | `1234` | cualquier futuro | `AUTHORIZED` |
| **VISA rechazada** | `4051 8842 3993 7763` | VISA | `123` | cualquier futuro | `REJECTED` (response_code -1) |

Para todas: usar **RUT** `11.111.111-1` y **clave** `123` cuando el formulario lo pida (login del portal de prueba).

### 3.2 Tarjetas Redcompra (débito CL — tarjeta de débito)

| Caso | Tarjeta | RUT | Clave | Resultado |
|---|---|---|---|---|
| **Débito aprobado** | `4051 8842 3993 7763` | `11.111.111-1` | `123` | `AUTHORIZED` |
| **Débito rechazado** | `5186 0595 5959 0568` (mismo formato pero seleccionar débito) | `11.111.111-1` | `123` | `REJECTED` |

**OBSERVACIÓN**: el formato del flujo redcompra es distinto — el comprador ingresa RUT + clave de banco, no CVV. Este flujo se prueba seleccionando "Tarjeta de Débito" en el formulario de Webpay.

### 3.3 Prepago

| Caso | Tarjeta | Resultado |
|---|---|---|
| **Prepago aprobado** | `4051 8841 0035 9148` | `AUTHORIZED` |

### 3.4 Casos de error / borde

Para forzar `FAILED` (transient — código `-96/-97/-98`):
- Estos son errores de red / timeout entre Transbank y emisor; **no se pueden reproducir confiablemente con tarjetas**, sino apagando el internet o usando un proxy interceptor durante el commit.
- Para tests automatizados ver `webpayAdapter.test.ts` que mockea estos códigos directamente.

---

## 4. Smoke test manual end-to-end (integration)

Antes de cualquier deploy a producción, correr este flujo manual al menos una vez con cada navegador relevante (Chrome / Safari iOS / WebView Capacitor):

```bash
# 1. Levantar el server local con env de integration (NO setear WEBPAY_ENV=production):
cd "D:/Guardian Praeventio/repo"
npm run dev

# 2. En otra terminal, crear una invoice de prueba:
curl -X POST http://localhost:5173/api/billing/checkout \
  -H "Authorization: Bearer <Firebase-ID-token>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"hierro","gateway":"webpay","amount":15000,"currency":"CLP"}'

# Respuesta debe traer una URL de Webpay (token_ws) — el response.url.
# Ejemplo: https://webpay3gint.transbank.cl/webpayserver/initTransaction?token_ws=...

# 3. Abrir la URL en navegador. Aparece el formulario de Transbank.

# 4. Ingresar: VISA 4051 8856 0044 6623 / 123 / cualquier futuro
#    RUT 11.111.111-1 / clave 123 cuando lo pida el portal.

# 5. Tras confirmar, Transbank redirige a APP_BASE_URL/billing/webpay/return?token_ws=...

# 6. El handler del server:
#    - Adquiere lock en processed_webpay/{token_ws}
#    - Llama webpayAdapter.commit(token_ws)
#    - Si AUTHORIZED → invoice.status = 'paid', audit_logs entry, redirect /pricing/success
#    - Si REJECTED → invoice.status = 'rejected', redirect /pricing/failed
#    - Si FAILED transient → invoice queda 'pending-payment', redirect /pricing/retry

# 7. Verificar en Firestore (server-only):
#    - invoices/{buyOrder} → status === 'paid'
#    - audit_logs/{auto-id} → action === 'billing.webpay-return.authorized', invoiceId, amount
#    - processed_webpay/{token_ws} → status === 'done', outcome === 'authorized'

# 8. Verificar Sentry breadcrumb category 'analytics' (si analytics adapter está activo):
#    payment.checkout.started + payment.transaction.succeeded events
```

---

## 5. Switch integration → production checklist

**NO** hacer este switch hasta que:
- [ ] El smoke test §4 pasa 100% en `integration` con las 4 tarjetas (VISA aprobada / MC aprobada / VISA rechazada / débito aprobado).
- [ ] Tests automáticos verdes (`npm test -- webpay`).
- [ ] El portal Transbank muestra la URL de retorno correctamente configurada (= `${APP_BASE_URL}/billing/webpay/return` exacto).
- [ ] Tienes acceso al panel de transacciones de Transbank para reconciliación.
- [ ] Operaciones tiene runbook de chargebacks y refunds (Sprint 21+ si no existe).

**Switch**:

1. En GitHub Actions Secrets (o GCP Secret Manager):
   - Set `WEBPAY_COMMERCE_CODE` (12 dígitos production).
   - Set `WEBPAY_API_KEY` (production token).
   - Set `WEBPAY_ENV=production`.
   - Verify `APP_BASE_URL=https://app.praeventio.net` (o canonical URL).
2. Deploy nueva revisión Cloud Run (o tu plataforma).
3. **Smoke test PROD con monto mínimo** (ej. CLP 100):
   - Usar TU tarjeta personal (NO una de prueba — esas no funcionan en prod).
   - Confirmar que `webpay3.transbank.cl` (no el `webpay3gint`) aparece en URL de redirect.
   - Confirmar `invoices/{id}.status === 'paid'` post-flujo.
4. **Refundear el monto de prueba** vía Transbank portal (no por API hasta confirmar en prod):
   - Transbank refund tarda ~24h en cuenta del comprador.
5. Activar monitoring:
   - Sentry alert P0 sobre `webpay error spike >5/5min` (ya en `SENTRY_ALERTS.md`).
   - Métrica `webpay_authorize_total` en dashboard.

---

## 6. Troubleshooting

### "Transaction not found" / 422 al commit

- Causa típica: el `token_ws` ya fue commiteado o expiró (Transbank lo invalida después de ~7min).
- Fix: el handler del server ya tiene idempotency, devuelve el outcome cacheado en `processed_webpay/{token}`. Si igual falla, revisar logs Sentry filtrando `category:billing.webpay`.

### Redirect a `/pricing/retry` con tarjeta válida

- Causa: response_code `-96/-97/-98` (transient — Transbank ↔ emisor timeout).
- Acción del cliente: reintentar (la invoice queda `pending-payment`, no se pierde).
- Si pasa repetidamente: incidente, página status Transbank: <https://status.transbank.cl/>.

### Hash mismatch / firma inválida

- Causa típica: `WEBPAY_API_KEY` mal copiado (espacios al inicio/final, o vino con `\n` del email).
- Fix: re-pegar la key directamente del email original Transbank.

### "Configuración no autorizada"

- Causa: `WEBPAY_COMMERCE_CODE` apunta a integration sandbox PERO `WEBPAY_ENV=production`.
- Fix: Las dos vars deben pertenecer al mismo entorno. Si tienes el código de integración (598X...), `WEBPAY_ENV` debe ser `integration` (o no estar seteado).

### Return URL mismatch

- Causa: la URL configurada en el portal Transbank no coincide exactamente con `${APP_BASE_URL}/billing/webpay/return`.
- Síntoma: el botón de pago en Transbank funciona pero al volver dice "URL no autorizada".
- Fix: ir al portal Transbank → Configuración → URLs → editar para que matchee EXACTO (incluye trailing slash o ausencia, scheme http/https).

---

## 7. Reconciliación diaria (post-launch)

Al menos hasta tener confianza con el flujo:

1. Cada mañana exportar el reporte de Transbank del día anterior.
2. Comparar con `audit_logs` filtrando `action LIKE 'billing.webpay-return.%'`.
3. Cualquier discrepancia → investigar en `processed_webpay` collection.

Procedimiento automatizable en Sprint 22+ (cron job que escribe diff a Sentry como `billing.recon.discrepancy`).

---

## 8. Referencias

- BILLING.md (arquitectura general billing)
- `src/services/billing/webpayAdapter.ts` (implementación)
- `src/server/routes/billing.ts` (rutas + handler return)
- `webpayAdapter.test.ts` + `billing.test.ts` (tests)
- `docs/security/STRIDE_findings.md` TM-R02 + TM-T04 (audit log + idempotencia)
- `docs/observability/SENTRY_ALERTS.md` rule `P0-webpay-error-spike`
- Transbank docs: <https://transbankdevelopers.cl/documentacion/como_empezar>
- Transbank tarjetas: <https://transbankdevelopers.cl/documentacion/como_empezar#tarjetas-de-prueba>
- Transbank status: <https://status.transbank.cl/>
- Portal comercios: enviado por correo tras KYC.
