# DTE / SII — Factura Electrónica Chile

Sprint 23 Bucket GG. This doc explains how Praeventio Guard emits
Documentos Tributarios Electrónicos (DTE) to the Servicio de Impuestos
Internos (SII) using **Bsale** as the proveedor de servicios electrónicos
(PSE).

## Why Bsale (and not Defontana)

| | Bsale | Defontana |
| --- | --- | --- |
| API style | REST + JSON | SOAP + XML |
| Documentation | https://docs.bsale.dev | Spanish-only PDF + portal |
| Sandbox | Yes (free) | Limited |
| Pricing | Per-document | Per-document + monthly |
| Best fit | SaaS / startups | Large enterprises |

Bsale wins for our use case (low monthly volume, REST-friendly stack). The
adapter is implemented behind the project-wide `SiiAdapter` interface, so
swapping in Defontana later means writing a sibling `defontanaAdapter.ts`
that implements `emitDte` / `getDteStatus`; no caller-side changes.

## Setup checklist

1. **Bsale account** — create at https://www.bsale.cl/. Pick the SaaS plan
   that includes DTE emission. Verify your email.
2. **Cargar certificado digital** (e-CertChile / E-Sign Chile / etc.) into
   the Bsale dashboard. The certificate is what signs the DTE XML before
   it reaches SII.
3. **Solicitar autorización SII** for the DTE document types Praeventio
   emits (33 factura electrónica, 39 boleta electrónica, optionally 41
   exenta + 56/61 NC/ND). SII grants this via the "Configurar Postulación"
   wizard at https://palena.sii.cl/.
4. **Subir CAF** (Código Autorización Folios) to Bsale. Each CAF is a
   range of folios; Bsale will allocate them sequentially per document type.
5. **Crear access token** in the Bsale dashboard (Configuración → API).
   Copy the token AND your `office_id` (Configuración → Sucursales).
6. **Set env vars** in `.env`:
   ```
   BSALE_ACCESS_TOKEN=<token-from-bsale>
   BSALE_OFFICE_ID=<numeric-office-id>
   DTE_AUTO_ISSUE=true
   SII_PSE=bsale
   ```
7. **Certificación SII** — for the first deployment to production, point
   `BSALE_API_BASE_URL` at the staging environment, run the SII
   certification set, then flip back to production.

## Tipos de DTE soportados

| Code | Type | Description |
| --- | --- | --- |
| 33 | `factura_electronica` | B2B con RUT receptor + giro. IVA afecto. |
| 39 | `boleta_electronica` | Consumidor final. IVA afecto. |
| 41 | `boleta_exenta` | Servicios exentos de IVA (capacitación SUSESO, etc). |
| 56 | `nota_debito` | Aumenta el monto de un DTE previo (requiere `references`). |
| 61 | `nota_credito` | Anula o disminuye un DTE previo. Requiere glosa. |

Otros códigos del catálogo SII (34, 43, 46, 52, 110…) están fuera de
alcance. Agrega el mapping en `src/services/sii/types.ts` cuando los
necesites.

## Flujo de emisión automática

```
invoice.paid (Webpay / MercadoPago / mark-paid manual)
   ↓
tryAutoIssueDte(invoice)         (src/services/billing/invoice.ts)
   ↓
BsaleAdapter.createDte(input)    (src/services/sii/bsaleAdapter.ts)
   ↓
POST https://api.bsale.io/v1/documents.json
   ↓
Bsale firma XML + envía a SII
   ↓
DteResult { folio, pdfUrl, xmlUrl, totalClp, ivaClp }
   ↓
Persist en invoices/{id}.dte
   ↓
dteIssuedTemplate(payload)       (src/services/email/templates.ts)
   ↓
Resend → cliente.email
```

`DTE_AUTO_ISSUE=false` desactiva la rama automática; los admins emiten
manualmente por `POST /api/dte/create`.

## Endpoints admin

Todos requieren `verifyAuth` + role admin (excepto `GET /api/dte/:folio`
que es lectura abierta a usuarios autenticados).

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/dte/create` | Emisión manual. Body = `DteCreateInput`. |
| GET  | `/api/dte/:folio` | Estado y URLs del DTE en Bsale. |
| POST | `/api/dte/:folio/cancel` | Anular vía Nota de Crédito. Body = `{ reason }`. |

## Compliance SII

- **Timbres electrónicos** — Bsale los gestiona desde el CAF cargado. Los
  monitoreas en la consola; cuando un rango se agota, sube un nuevo CAF
  (no requiere re-deploy).
- **Anulación** — SII no permite "borrar" un DTE. Para cancelar emites
  una Nota de Crédito que referencia el DTE original. La adapter
  `cancelDte(folio, reason)` automatiza esto.
- **Retención XML** — el XML firmado debe conservarse por 6 años. Bsale
  los guarda en su almacenamiento; nosotros guardamos también el `pdfUrl`
  + `xmlUrl` en `invoices/{id}.dte` para acceso rápido.
- **Certificación** — la primera vez que apuntas a producción Bsale
  exige un set de pruebas SII (≈ 30 documentos representativos). Hazlo
  con `BSALE_API_BASE_URL` apuntando al sandbox.

## Tests

```
npx vitest run src/services/sii/
```

Cobertura:
- `siiAdapter.test.ts` — totales, IVA, facade `getSiiAdapter()`, noop.
- `bsaleAdapter.test.ts` — fetch mocks: createDte, cancelDte, getDte,
  emitDte, payload mapping.

## Troubleshooting

| Síntoma | Causa probable | Fix |
| --- | --- | --- |
| `dte_not_configured` | `BSALE_ACCESS_TOKEN` o `BSALE_OFFICE_ID` faltan | Setea ambos en `.env` |
| `Bsale POST documents.json → HTTP 401` | Token caducado / mal copiado | Regenera en consola Bsale |
| `Bsale rejected the DTE` con `CAF agotado` | Sin folios disponibles | Sube nuevo CAF al portal Bsale |
| `Bsale rejected the DTE` con `RUT inválido` | Receptor sin RUT válido | Validar formato `NN.NNN.NNN-X` |
| `SiiAdapterError: globalThis.fetch is unavailable` | Node < 18 | Upgrade Node o pasa `fetchImpl` |
