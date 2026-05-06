# ADR 0017 — Per-country emission adapters (no push, doc-only)

Status: **accepted** (target Sprint 38+ implementation, country-by-country)
Date: 2026-05-06
Aplica a: Global launch TODO (Play Store / iOS multi-país), DS-67/76 country
gate (Sprint 33 D2 — `JurisdictionNotSupportedError` + `suggestedAdapters`),
DTE generator (Sprint 34 E6), Aptitude certificate signer (Sprint 35 F1) y
todas las futuras emisiones regulatorias por jurisdicción.

> Comment header: este ADR consolida la línea Sprint 33 D2 (country gate
> con early-return + `suggestedAdapters: ['OSHA-301','EU-OSHA','RIDDOR',
> 'NOM-019/STPS','NR-5']`) + Sprint 34 E6 (DTE SII generator, sin push)
> + Sprint 35 F1 (Aptitude cert biométrico, sin push). Memoria
> persistente del usuario reafirma: **NO push a SUSESO/MUTUAL/SII/OSHA/
> RIDDOR/NOM/NR/MEM/Rostrud/etc.** Praeventio Guard genera el documento
> en formato exacto que el organismo pide; la empresa cliente firma en
> persona y entrega por su canal oficial.

## Contexto

Praeventio Guard apunta a lanzamiento mundial en Play Store / App Store.
Cada país tiene su propio formato regulatorio para reportar accidentes
laborales, certificar aptitud y emitir documentos tributarios:

| Jurisdicción | Documentos típicos |
|---|---|
| Chile | DS-67, DS-76, DIAT/DIEP SUSESO, DTE SII (Ley 19.799) |
| US | OSHA Form 301 (occupational injury), Form 300 (log) |
| UK | RIDDOR (Reporting of Injuries, Diseases, Dangerous Occurrences) |
| EU | EU-OSHA + variantes nacionales (España: Delt@; Italia: INAIL) |
| México | NOM-019/STPS + IMSS ST-5 |
| Brasil | NR-5 + CAT (Comunicação de Acidente de Trabalho) |
| Australia | WHS regulations + state-specific incident notifications |
| China | GB/T 33000 + MEM (Ministry of Emergency Management) reports |
| Russia | 152-FZ + Rostrud occupational injury forms |

Sprint 33 D2 implementó el **guard early-return** (`compliance/ds67ds76`):
si `country !== 'CL'`, se lanza `JurisdictionNotSupportedError` con
`suggestedAdapters: ['OSHA-301','EU-OSHA','RIDDOR','NOM-019/STPS','NR-5']`.
Esto evita que se emita un documento chileno en otro país, pero deja
explícito qué adapters faltan. Sprint 34 E6 (DTE) y 35 F1 (Aptitude
cert) siguieron el mismo patrón: generar documento + firma biométrica
WebAuthn, **sin push** a APIs externas. Falta cerrar la abstracción
formal antes de empezar a sumar países nuevos.

## Decisión

**Cada país regulado se modela como un adapter aislado bajo
`src/services/compliance/adapters/{country}/` con cuatro piezas
obligatorias y cero capacidad de push.**

1. **Schema** (Zod) del documento target — campos exactos que el
   organismo pide.
2. **Generator** — produce PDF (formato visual oficial) + JSON
   estructurado (para auditoría interna).
3. **Signer** biométrico — replica el patrón Sprint 34 E6 `dteSigner`:
   firma por WebAuthn passkey login Google (passkey = "firma biométrica"
   en términos de UX). El certificado del firmante (RUT / SSN / NIE /
   CPF / Aadhaar / etc.) queda anclado al PDF + JSON.
4. **NO API push.** El adapter NO conoce credenciales del organismo.
   La empresa cliente recibe el documento, lo firma físicamente si la
   ley local exige firma manuscrita además, y lo entrega por el canal
   oficial (web del organismo, courier, mesa de partes).

### Registry pattern

```ts
// src/services/compliance/registry.ts
type EmissionType = 'accident' | 'aptitude' | 'tributary' | ...;
type CountryCode = 'CL' | 'US' | 'UK' | 'EU' | 'MX' | 'BR' | 'AU' | 'CN' | 'RU';

const adapters: Partial<Record<CountryCode, Record<EmissionType, Adapter>>> = {
  CL: { accident: ds67ds76, tributary: dteSII, aptitude: aptitudeCL },
  // US, UK, EU, MX, BR, AU, CN, RU se llenan country-by-country.
};
```

### Endpoint genérico

```
POST /api/compliance/emit/:type
body: { country: CountryCode, payload: <schema-validated> }
→ 200: { pdfBase64, jsonDoc, signature, signerSubject }
→ 400: { error: 'JurisdictionNotSupportedError',
         suggestedAdapters: ['OSHA-301','EU-OSHA','RIDDOR','NOM-019/STPS','NR-5'],
         message: 'Country X has no adapter yet for type Y' }
```

Si el país solicitado no tiene adapter, retornamos 400 con el mismo
patrón que Sprint 33 D2 ya validó. **Nunca** se intenta "emitir igual"
con un formato genérico — eso sería emitir un documento legalmente
inválido en esa jurisdicción.

## Implementación incremental (no big-bang)

| Sprint | Alcance |
|---|---|
| 38 | **Chile**: consolidar DS-67, DS-76, DIAT/DIEP, DTE SII en el registry (refactor de los servicios ya existentes en Sprint 33-35). |
| 39 | **US**: OSHA Form 301 + Form 300 log. |
| 40 | **UK**: RIDDOR. |
| 41+ | **EU** (Delt@, INAIL), **MX** (NOM-019/STPS, IMSS ST-5), **BR** (NR-5, CAT), **AU** (WHS state-specific), **CN** (GB/T 33000, MEM), **RU** (152-FZ, Rostrud). Orden ajustable según mercados objetivo del usuario. |

Cada nuevo adapter requiere:

- Schema Zod + Generator + Signer + tests unitarios.
- **Localización del PDF** en idioma local (i18n del template oficial:
  inglés US, inglés UK, español MX, portugués BR, mandarín simplificado
  CN, ruso RU, etc.).
- **Validación legal por counsel local** antes de productivo. Sin
  approval del abogado de la jurisdicción, el adapter queda con flag
  `experimental: true` y no se expone en producción.

## Consecuencias

### Operacionales

- `TODO.md` y `HONEST_STATE` documentan **% cobertura por país**
  (Chile 100%, US 0%, UK 0%, ...) en cada sprint.
- El cliente final entrega el documento al organismo. Praeventio
  **nunca actúa como agente fiscal/regulatorio**. Esto reduce
  exposición legal: no somos un retenedor de información oficial ni
  un sustituto del representante legal de la empresa.
- Endpoint genérico `/api/compliance/emit/:type` simplifica futuras
  integraciones (un solo contrato HTTP, dispatch interno).

### Legales

- Praeventio nunca tiene credenciales SUSESO/SII/OSHA/etc. — reduce
  superficie de ataque y obligaciones de retención de claves estatales.
- La firma biométrica WebAuthn queda incrustada en el PDF + JSON
  → trazabilidad sin que Praeventio guarde la passkey privada.
- Si un país introduce push electrónico **obligatorio** (no opcional),
  ese país requiere **nuevo ADR** con autorización explícita del
  usuario antes de cualquier integración push. Este ADR no autoriza
  push de antemano para futuros países.

### Técnicas

- Tipo discriminado `CountryCode` permite `switch` exhaustivo en TS
  → si se agrega un país al type sin adapter, typecheck rompe.
- `JurisdictionNotSupportedError` ya existe (Sprint 33 D2): se reusa
  para todo tipo de emisión, no solo DS-67/76.
- Adapters son aislados → un bug en NR-5 brasileño no rompe DTE
  chileno.

## Comparación con ADRs adyacentes

- **ADR 0013 (mesh information relay):** drift documentado, software
  cerrado en Sprint 35 F3. ADR 0017 sigue la misma filosofía: cerrar
  el contrato antes de que la deuda técnica se acumule.
- **ADR 0014 (regulatory framework abstraction):** define el
  **catálogo** de controles HSE por jurisdicción (citas ISO 45001 + país).
  ADR 0017 es la **implementación operativa de emisión** sobre ese
  catálogo: 0014 es "qué citar", 0017 es "qué documento producir y
  firmar". Los `JurisdictionCode` de 0014 deben converger con los
  `CountryCode` de 0017 en Sprint 38.
- **ADR 0016 (CQRS deferred):** se decidió no construir aún. Contrasta
  con 0017, que **sí se construye** — pero también incrementalmente,
  country-by-country, no big-bang.
- **ADR 0011 (digital twin triple-gate auth):** la firma biométrica
  WebAuthn que usan los adapters reusa la misma passkey de login,
  consistente con la triple-gate.

## Re-evaluación

Cada nuevo adapter dispara revisión de este ADR. Disparadores
explícitos para abrir un nuevo ADR (no modificar este):

1. Un organismo (ej. SUSESO, SII) **obliga** push electrónico oficial
   y deja de aceptar entrega manual.
2. Aparece un país con regulación que exige retención de credenciales
   estatales por el proveedor de software (caso poco probable, pero
   plausible en CN o RU).
3. Cambio de modelo de negocio que justifique convertirnos en agente
   fiscal/regulatorio (requiere aprobación del usuario explícita).

Hasta entonces: **doc-only, no push, country-by-country, counsel local
firma cada release**.

## Decisión final

**Praeventio Guard genera documentos regulatorios firmados con
biometría WebAuthn, en el formato exacto que cada organismo pide, sin
nunca empujarlos a APIs externas. Cada país es un adapter aislado bajo
`src/services/compliance/adapters/{country}/`, registrado en
`registry.ts`, expuesto vía `POST /api/compliance/emit/:type`. Roll-out
country-by-country desde Sprint 38 (Chile consolidación) hacia US, UK,
EU, MX, BR, AU, CN, RU según mercados objetivo. Sin counsel local
aprobando, ningún adapter llega a producción.**
