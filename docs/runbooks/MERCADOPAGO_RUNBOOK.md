# MercadoPago Runbook — Sandbox → Production

**Status**: Production-ready secret contract validated by `scripts/validate-env.cjs`.
**Owner**: Billing team.
**Last reviewed**: 2026-05-12 (Fase D.5).

This runbook describes how to provision and rotate MercadoPago
credentials, validate IPN webhook signatures, and migrate the
checkout from sandbox to production.

---

## 1. Why MercadoPago

MercadoPago is the **primary local payment rail** for Chile, Argentina,
México, Colombia, Brasil and Perú users — covering Webpay's gaps
(international cards, recurring subscriptions via wallet). Stripe was
discarded for LatAm per business decision 2026-05-03.

## 2. Required environment variables

The production secret contract is enforced by `scripts/validate-env.cjs`
(refusing to boot when any are missing in `NODE_ENV=production`):

| Variable | Purpose | Min length |
|---|---|---|
| `MP_ACCESS_TOKEN` | Access Token MP — used to create preferences via `/checkout/preferences` | 32 |
| `MP_IPN_SECRET` | HMAC-SHA-256 key for x-signature webhook verification | 16 |
| `MP_ENV` | One of `prod` or `sandbox` — gates the API base URL | n/a |

> **Aliases legacy**: `MP_PUBLIC_KEY` y `MP_CLIENT_ID` no se usan en el
> backend — solo en SDK frontend. NO los pongas en `.env` de server.

## 3. Sandbox → Production migration

### 3.1 Get production credentials

1. Login a https://www.mercadopago.cl/developers/panel/credentials.
2. Cambia el toggle a **Credenciales de producción** (esquina superior).
3. Copia **Access Token** (empieza con `APP_USR-…`) y guárdalo en el
   secret manager (Google Secret Manager / Cloud Run env secret).
4. Crea **IPN HMAC secret** en `Notificaciones webhooks` → `Configurar
   firma` → genera secret aleatorio ≥32 chars y guárdalo idéntico
   en `MP_IPN_SECRET`.

### 3.2 Set production env

```bash
gcloud run services update praeventio-api \
  --set-env-vars=MP_ENV=prod \
  --update-secrets=MP_ACCESS_TOKEN=mp-access-token:latest,MP_IPN_SECRET=mp-ipn-secret:latest
```

### 3.3 Validate boot

```bash
NODE_ENV=production node scripts/validate-env.cjs
# Esperado: exit 0 con resumen "all required env vars present".
```

Si falla:
- `MP_ACCESS_TOKEN missing` → repetir paso 3.1.1.
- `MP_IPN_SECRET too short` → ≥16 chars random.
- `MP_ENV invalid` → debe ser exactamente `prod` o `sandbox`.

## 4. Webhook signature verification

MercadoPago envía notificaciones IPN con header `x-signature` en formato
`ts=<timestamp>,v1=<hmac>` donde:

- `ts` = unix-seconds del envío
- `v1` = HMAC-SHA-256 de `id:<payment_id>;request-id:<x-request-id>;ts:<ts>;`
  firmado con `MP_IPN_SECRET`

El handler `src/services/billing/mercadoPagoIpn.ts` valida:
1. Header presente.
2. Timestamp dentro de ±5min del servidor.
3. HMAC computado coincide con `v1`.

Si alguno falla → **401 + log estructurado `billing.webhook.reject`**.
Nunca activamos compras sin verificación pasada.

### 4.1 Test webhook delivery

```bash
# Mientras la app está activa con MP_ENV=sandbox:
curl -X POST https://staging.praeventio.app/api/billing/mp/ipn \
  -H "x-signature: ts=$(date +%s),v1=$(echo -n 'id:123;ts:$(date +%s);' | openssl dgst -sha256 -hmac "$MP_IPN_SECRET" | awk '{print $2}')" \
  -H "x-request-id: test-$(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"id":123,"action":"payment.updated","type":"payment"}'
```

Debe responder **200** y agregar entry en Firestore `audit_logs`
con `billing.webhook.replay` o `billing.webhook.success`.

## 5. Credential rotation (90 días)

MP no fuerza rotación pero por política Praeventio:

1. Mensual: revisa logs `billing.webhook.*` por anomalías.
2. Cada 90 días o ante sospecha de fuga:
   - Genera nuevo Access Token + IPN secret en panel MP.
   - Actualiza Secret Manager: `gcloud secrets versions add …`.
   - Deploy gradual con `--no-traffic` luego shift 100%.
   - Espera 30min para confirmar webhooks llegando OK.
   - Revoca Access Token viejo en panel MP (botón "Revocar").
3. Documenta el cambio en `audit_logs` con tag `mp.rotation`.

## 6. Plan IDs (tier mapping)

Los tier IDs canónicos están en
`src/services/pricing/subscriptionPlan.ts`. MP no requiere productos
pre-registrados — pasamos el `price` y `description` dinámicamente al
crear la preferencia. La normalización de aliases legacy
(`comite_paritario_mensual` → `comite_paritario`) ocurre en
`normalizeSubscriptionPlanId()`.

## 7. Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `503` en `/api/billing/mp/preference` | `MP_ACCESS_TOKEN` no cargado | Verificar Cloud Run env vars |
| `401` en webhook callback | HMAC mismatch — secret rotado en MP pero no en app | Re-deploy con secret actualizado |
| `Webpay returnUrl 404` | typo en `WEBPAY_RETURN_URL` (Webpay, no MP) | Ver TRANSBANK_RUNBOOK.md |
| Cobros duplicados | Idempotency key faltante en cliente | Implementar `idempotency_key` per cart |

## 8. Related docs

- `docs/billing-iap.md` — IAP Google Play + Apple
- `docs/runbooks/TRANSBANK_RUNBOOK.md` — Webpay
- `docs/runbooks/SECRETS_RUNBOOK.md` — patrón general rotación
- `src/services/billing/mercadoPagoIpn.ts` — implementación verify

---

**Política directiva 3 del usuario**: NUNCA hacer push automático a APIs
de organismos (SUSESO/SII/MINSAL). MP es un payment rail comercial, no
un organismo regulatorio — la directiva no aplica acá.
