# ADR 0022 — Nunca push a APIs externas (SUSESO/SISESAT/MINSAL/OSHA)

Status: **Accepted** (2026-06-10)
Aplica a: todo flujo que produce documentos o datos regulatorios — DIAT/DIEP
SUSESO, DTE SII, certificados de aptitud, DS-67/76, actas CPHS, inventario
hazmat, EPP, cadena de custodia — y a cualquier adapter futuro por país
(ADR 0017).

> Este ADR **eleva a decisión de arquitectura formal** una directiva del
> fundador que hasta hoy vivía únicamente en comentarios de código y en
> tests de invariante. No cambia comportamiento: documenta y hace citable
> lo que el código ya cumple.

## Contexto

Praeventio Guard genera documentos exigidos por organismos estatales y
mutualidades chilenas (SUSESO, SII, MINSAL, mutualidades Ley 16.744) y, en el
roadmap multi-país, por sus equivalentes extranjeros (OSHA, RIDDOR, NR-5,
etc. — ver ADR 0017). La tentación obvia es "integrarse": empujar el DIAT
directo a SUSESO, el DTE directo al SII, el certificado de aptitud directo a
la mutual.

La directiva del fundador es explícita y repetida: **nunca**. Hoy esa
directiva existe solo dispersa en comentarios de código. Evidencia en el
repositorio (verificada, no exhaustiva):

- `src/server/routes/incidentFlow.ts:24-25` — *"Founder directive: nunca
  push a APIs externas. Everything writes to our own Firestore tree. No
  SUSESO / MINSAL / OSHA outbound calls anywhere."*
- `src/services/zettelkasten/flows/incidentLessonTrainingFlow.ts:31-33` —
  *"Founder directive (`product_signing_no_blocking_directives_2026-05-06`):
  nunca push a APIs externas (SUSESO / MINSAL / OSHA / etc)."*
- `src/server/routes/dte.ts:4` — *"Praeventio NO push a SII. La empresa
  cliente imprime/firma/envía."* (mismo header en
  `src/services/sii/dteGenerator.ts:4`, `dteSigner.ts:4`,
  `dtePdfRenderer.ts:4`).
- `src/server/routes/medicalAptitude.ts:4` y
  `src/services/medical/aptitudeCertGenerator.ts:4` — *"Praeventio NO push a
  MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal."*
- `src/server/routes/complianceEmit.ts:14` — *"NO push a SUSESO/MUTUAL/SII —
  el handler retorna documento al [cliente]"*.
- `src/server/routes/hazmatInventory.ts:15` — la API genera el documento
  (directiva "no push a APIs estatales").
- `src/server/routes/eppFlow.ts:13` — *"Directiva no-push: NUNCA empujamos
  al proveedor. El PDF se descarga…"*
- `src/services/compliance/registry.ts:12` y
  `src/services/compliance/adapters/cl/index.ts:16` — registry multi-país con
  *"NO push a SUSESO / MUTUAL / SII — todos los generators producen
  [documento]"*; el patrón se replica en los adapters `us/uk/ca/au/jp/kr/in`.
- `src/services/suseso/susesoServerOnlyHelpers.ts:24` — *"Plan maestro
  directive 3: NO push automático a SUSESO API."* y
  `src/services/suseso/cumplimientoCalculator.ts:4` (*"no push, no
  scraping"*).
- Frontend: `src/App.tsx:166` (*"Praeventio NO push-a a organismos
  externos"*), `src/pages/QrSignature.tsx:21`,
  `src/pages/CphsDraftMinute.tsx:19`, `src/pages/SupplierQuality.tsx:13`,
  `src/pages/DrivingSafety.tsx:24`, `src/pages/CustodyChain.tsx:14`,
  `src/pages/WorkerPortableHistory.tsx:23`, `src/pages/EmergencyBrigade.tsx:20`,
  `src/pages/SusesoReports.tsx:30-37` (el path "Enviar a SUSESO" fue
  desmontado en Fase C.1, 2026-05-21).
- Tests que fijan el invariante:
  `src/__tests__/server/suseso.router.test.ts:327` (*"createSusesoForm does
  NOT make any external HTTP call to SUSESO"*), `:528` (*"sign does NOT call
  submitToMutualidad"*), `:707`; `src/__tests__/server/dte.test.ts:3,335`;
  `src/server/routes/legalObligations.test.ts:97-98`;
  `src/__tests__/contracts/noBrowserSusesoApiClient.test.ts` (ningún archivo
  de browser importa el cliente SUSESO).

Una directiva que vive solo en comentarios es frágil: un contribuidor nuevo
(o un agente de código) que no lea el archivo correcto puede "mejorar" la app
agregando la integración. Necesita un ADR citable, con razones y condiciones
de revisión.

## Decisión

**Praeventio Guard NUNCA empuja datos a APIs externas de organismos
estatales, mutualidades ni terceros regulatorios — ni SUSESO, ni SISESAT, ni
MINSAL, ni SII, ni OSHA, ni sus equivalentes en ninguna jurisdicción.**

Todo flujo regulatorio termina en uno de estos dos destinos, y solo en ellos:

1. **Nuestro propio árbol Firestore** (con `audit_logs` y reglas
   default-deny), o
2. **Un documento entregado al cliente** (PDF/JSON/XML descargable, firmado
   biométricamente vía WebAuthn cuando aplica — p. ej.
   `src/utils/susesoCertificate.ts:3`, generador DIAT DS 101 / DIEP DS 110),
   que **la empresa cliente presenta por su canal oficial** (portal del
   organismo, mesa de partes, courier).

Praeventio no almacena credenciales de organismos estatales, no actúa como
agente fiscal/regulatorio y no asume la responsabilidad legal de la
presentación.

## Razones

1. **Privacidad y minimización de egress.** Los datos de prevención son PII
   ocupacional y, en parte, datos de salud (la categoría más protegida bajo
   Ley 19.628/21.719). Cada integración saliente es un canal nuevo por el que
   datos sensibles pueden salir del perímetro que controlamos (Firestore
   default-deny + KMS + audit trail). Cero push = superficie de egress
   mínima y auditable: el único camino de salida es un documento que el
   propio cliente decide entregar.
2. **Superficie de ataque y de credenciales.** Integrarse exige custodiar
   credenciales/certificados estatales (API keys SUSESO, certificado digital
   SII, tokens SISESAT). Eso convierte a Praeventio en objetivo de alto valor
   y agrega obligaciones de rotación, revocación y respuesta a incidentes
   por cada organismo (ver ADR 0017, "Consecuencias legales": *"Praeventio
   nunca tiene credenciales SUSESO/SII/OSHA"*).
3. **Responsabilidad legal de la presentación.** La declaración (DIAT/DIEP,
   DTE, certificado) es un acto jurídico **del empleador**, con plazos y
   sanciones propias. Si Praeventio empuja y el push falla, llega tarde o
   lleva un dato erróneo, la responsabilidad se vuelve difusa y el riesgo
   migra hacia nosotros. Con entrega manual, el representante legal de la
   empresa firma y presenta: la cadena de responsabilidad queda intacta y
   Praeventio es solo el instrumento de generación con trazabilidad
   (firma WebAuthn embebida en PDF + JSON).
4. **Disponibilidad y acoplamiento.** Los portales estatales tienen ventanas
   de mantención, cambios de contrato sin aviso y ambientes de certificación
   lentos. No depender de ellos mantiene la app funcional offline-first
   (mina/faena sin señal) y sin SLAs ajenos.

## Consecuencias

- **DIAT/DIEP se generan como PDF para presentación manual.**
  `src/utils/susesoCertificate.ts` (DS 101 / DS 110) +
  `src/server/routes/` (suseso router) producen el documento; la empresa lo
  presenta en el portal SUSESO/mutualidad. Los tests de directiva
  (`suseso.router.test.ts:327,528,707`) deben mantenerse verdes.
- **La integración SISESAT (XML firmado + CUN) queda explícitamente FUERA
  de alcance.** Hoy no existe ningún código SISESAT en el repo (verificado
  por grep 2026-06-10) y este ADR establece que NO debe agregarse: ni envío
  de documentos electrónicos XML al SISESAT, ni obtención/gestión de CUN
  (Código Único Nacional) en nombre del empleador. Si un cliente lo pide,
  la respuesta canónica es: Praeventio genera el documento; el empleador o
  su mutualidad lo ingresa a SISESAT por su canal.
- **Todo adapter nuevo por país nace sin capacidad de push** (ADR 0017,
  pieza obligatoria #4: *"NO API push. El adapter NO conoce credenciales del
  organismo."*).
- **El RAT (Ley 19.628/21.719) puede listar a SUSESO/mutualidades como
  destinatarios** (`src/services/compliance/ley19628.ts:131-133`) — eso es
  correcto en términos de protección de datos: el dato llega al organismo,
  pero **por entrega manual del empleador**, nunca por API de Praeventio.
- **Revisores deben rechazar** cualquier PR que agregue un cliente HTTP
  hacia SUSESO/SISESAT/MINSAL/SII/OSHA o que reintroduzca un botón "Enviar a
  <organismo>" que haga push real. El contract-test
  `src/__tests__/contracts/noBrowserSusesoApiClient.test.ts` y los tests
  DIRECTIVE citados arriba son la red de seguridad; ampliarlos al agregar
  superficies nuevas.
- Los comentarios inline existentes siguen siendo válidos; los nuevos deben
  citar **este ADR** (`ADR 0022`) en lugar de re-narrar la directiva.

## Condiciones de revisión

Este ADR solo se revisa si se cumplen **ambas** condiciones:

1. **Demanda enterprise real y concreta** — p. ej. un organismo que deja de
   aceptar entrega manual y OBLIGA push electrónico (gatillo #1 de
   re-evaluación del ADR 0017), o un contrato enterprise cuyo cierre depende
   de la integración, con el análisis legal de responsabilidad de
   presentación resuelto por counsel.
2. **Decisión consciente y explícita del fundador**, registrada en un
   **nuevo ADR** que supersede parcialmente a este (scope por organismo y
   por país, nunca un permiso genérico de push). Este ADR no autoriza push
   de antemano para ningún caso futuro.

Hasta entonces: **generar, firmar, entregar al cliente — nunca empujar.**

## Referencias

- ADR 0017 — Per-country emission adapters (no push, doc-only).
- ADR 0012 — Health data sovereignty (no diagnosis): misma filosofía de
  soberanía del dato.
- `docs/api-routes.md` — catálogo de endpoints (ninguno con push estatal).
- CLAUDE.md directiva #12 (biometría 100% on-device) — el mismo principio de
  "el dato no sale" aplicado a frames de cámara y frecuencia cardíaca.
