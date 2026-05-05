# Privacy compliance matrix (Sprint 31 Bucket MM)

Mapeo honesto de qué regímenes de privacidad cubrimos por país y qué
nivel de implementación tienen.

## Convención de estados

- IMPLEMENTADO E2E — endpoints + persistencia + UI cableados.
- DECLARADO — registry conoce el régimen y su deadline; el matrix UI lo
  muestra; falta wiring específico (DSAR per-regime, breach reporter,
  etc.).
- STUB — sólo entrada en `ALL_REGIMES` para tipado; deadline y rights
  basados en lectura textual de la ley sin validación legal local.

## Por país

| País | Código | Régimen primario | Estado | Deadline | Notas |
|------|--------|------------------|--------|----------|-------|
| Chile | CL | LEY-19628-CL (mod. Ley 21.719) | IMPLEMENTADO E2E | 30d | Endpoints `compliance/*` + RAT + erasure + Suseso retention. |
| Brasil | BR | LGPD-BR | IMPLEMENTADO E2E | 15d | Mismos endpoints; deadline más estricto se aplica vía registry. |
| EU | EU + 27 alpha-2 | GDPR-EU | DECLARADO | 30d | Registry + matrix UI. Falta DSAR portability machine-readable bundle. |
| US (California) | US-CA / US | CPRA-US-CA + CCPA-US-CA | DECLARADO | 45d | Falta opt_out_sale specific endpoint + "Do Not Sell" banner. |
| Canadá | CA | PIPEDA-CA | DECLARADO | 30d | OPC complaint workflow no implementado. |
| Japón | JP | APPI-JP | DECLARADO | 14d | Más estricto deadline; PPC breach reporter no cableado. |
| Singapur | SG | PDPA-SG | DECLARADO | 30d | Portability gated por commencement order. |
| Sudáfrica | ZA | POPIA-ZA | STUB | 30d | Information Regulator notification no implementada. |
| India | IN | PDP-IN-DPDP (DPDP 2023) | STUB | 30d | DPB workflow no implementado. |

## Rights soportados E2E hoy

| Right | Endpoint cableado | Notas |
|-------|------------------|-------|
| access | `GET /api/compliance/data-export/:requestId` | JSON inline |
| portability | mismo endpoint con `type='portability'` | machine_readable JSON |
| rectification | `POST /api/compliance/data-request type=rectification` | rectificationPayload |
| erasure | `POST /api/compliance/data-request type=erasure` | preserva audit_logs/incidents 7 años (DS 594) |
| consent_withdrawal | `DELETE /api/compliance/consent/:purpose` | bloquea revocación de `core_service` |

## Rights declarados sin endpoint específico

- `objection`, `restriction`, `no_automated_decision` — el matrix UI los
  muestra como soportados por GDPR/LGPD/CPRA pero no hay endpoint
  dedicado. La operación se enruta hoy a través de `consent_withdrawal`
  + `erasure`.
- `opt_out_sale` (CCPA/CPRA) — no aplica a Praeventio porque no
  vendemos PII. Se declara como soportado por convención (la app no
  realiza la actividad).

## Aplicación del deadline más estricto

`POST /api/compliance/data-request` ahora acepta `subjectCountry` +
`dataResidency`. El handler:

1. Llama `getActiveRegimes({ country, dataResidency })`.
2. Calcula `strictestDeadlineDays` (mínimo entre regímenes).
3. Loggea `compliance_data_request_deadline_applied` con el deadline y
   el régimen ganador.
4. Devuelve `{ deadlineDays, regimes }` en la respuesta para que el
   cliente renderice "responderemos en N días".

Ejemplo: subject en BR, processing en EU → regimes = `[LGPD-BR,
GDPR-EU]`, deadline = `min(15, 30) = 15`.

## DPIA

`generateDpiaPdf` produce el documento exigido por GDPR art.35 / LGPD
art.38 / Ley 21.719 EIPD. Sólo se ofrece a tier Titanio cuando hay
algún regime activo con `dpiaRequired: true` (GDPR, LGPD, Ley 19.628,
CPRA, PDP-IN-DPDP).

## Brechas conocidas (no cerradas en este sprint)

- DSAR worker que produzca bundles GDPR-portability con esquema
  estándar (CSV + JSON + manifest).
- Breach notification routes hacia EDPB / ANPD / CPPA / PPC.
- Cookie banner per-jurisdiction con consent strings.
- Sub-procesador list publicada como endpoint público para GDPR art.28.
- Auditoría legal por jurisdicción (hoy todo es lectura textual de la
  ley; cada país requiere validación local antes de marketing claims).
