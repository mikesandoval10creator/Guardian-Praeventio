# DEEP-EX-13 — Pasada exhaustiva línea-por-línea (Lote #13)

**Bloque:** B5-Cumplimiento · category `FEAT*` · slice `[110:154]` ordenado por `path`
**Atestación:** 44/44 archivos leídos completos, línea por línea.
**Fecha:** 2026-06-03
**Alcance nuevo:** hallazgos NO cubiertos por `DEEP-B5-Cumplimiento.md`, `DEEP-EX-11.md`,
`DEEP-EX-12.md`. Foco: firmas sin verificación cripto, folios no atómicos, DTE/PDF con
datos erróneos, colecciones client-side sin regla, montos/cálculos legales mal, auth/audit
faltante, stubs disfrazados (#13), Math.random (#15), filtrado de internals (#8),
`JSON.parse` sin try/catch (#5), promesas sin await, doc-drift.

Severidades: 🔴 alto · 🟡 medio · 🔵 bajo/nota.

---

## Tabla de hallazgos nuevos

| # | Sev | Archivo (lote) | Línea(s) | Hallazgo |
|---|-----|----------------|----------|----------|
| 13.1 | 🔴 | `sii/dteSigner.ts` (+ evidencia `server/routes/dte.ts`) | 168-176, 177-186 | **Firma WebAuthn nunca verificada criptográficamente.** El header de `verifyAndSignDte` delega EXPLÍCITAMENTE la verificación de la assertion (clientDataJSON↔authenticatorData↔signature↔COSE pubkey) al route handler, que "MUST call verifyAuthenticationResponse FIRST". El propio firmante sólo hace un *presence check* (strings no vacíos). El consumidor real `POST /api/dte/generate` (dte.ts:349) **no llama `verifyAuthenticationResponse` en ningún punto** (grep = 0 hits). Resultado: un DTE puede embeber un `<SignatureValue>` con `signature`/`authenticatorData`/`clientDataJSON` arbitrarios no vacíos y quedar "firmado biométricamente" sin que ninguna firma se valide contra la passkey registrada. Firma legalmente sin valor / suplantable. |
| 13.2 | 🟡 | `susesoBackend.ts` | 46, 86 | **`JSON.parse(response.text)` sin try/catch (viola convención #5).** `calculatePreventionROI` y `generateSusesoFormMetadata` parsean la salida Gemini cruda sin fallback tipado ni 502. Ambas están en `ALLOWED_GEMINI_ACTIONS` (gemini.ts:191-192) y exportadas vía `geminiBackend.ts:1450`, así que un parse roto cae al try/catch genérico del dispatcher → **HTTP 500 opaco** en vez del 502 tipado que exige la regla. No filtra internals en prod (el dispatcher enmascara), pero incumple el patrón. |
| 13.3 | 🟡 | `susesoBackend.ts` | 65-87 | **Códigos regulatorios SUSESO generados por LLM sin validación.** `generateSusesoFormMetadata` produce `codigoCausa` ("según codificación SUSESO"), `agenteAccidente` y `gravedadEstimada` (enum `Leve|Grave|Fatal`) directamente desde Gemini, sin validar contra catálogo oficial. Si la UI los inyecta en un DIAT/DIEP, se alimenta un formulario legal con códigos posiblemente inventados. Además `gravedadEstimada:"Fatal"` roza territorio de calificación (ADR 0012); conviene marcar como referencial + validar contra tabla cerrada. |
| 13.4 | 🟡 | `sii/siiPreflightCheck.ts` | 175, 187-189 | **Drift de nombre de variable de entorno Bsale.** El preflight verifica `BSALE_API_TOKEN`, pero el var canónico en `.env.example:244`, `bsaleAdapter.ts:153` y `dte.ts:109` es `BSALE_ACCESS_TOKEN`. Un deploy con sólo `BSALE_ACCESS_TOKEN` configurado **falla el preflight con `PSE_TOKEN_MISSING`** (salvo que también tenga `PSE_API_TOKEN`), bloqueando emisión a pesar de credencial válida. Mismo patrón con LibreDTE: preflight chequea `LIBREDTE_API_TOKEN`, adapter usa `LIBREDTE_TOKEN`/`LIBREDTE_BASE_URL` (libredteAdapter.ts:17). |
| 13.5 | 🟡 | `regulatory/profiles.ts` | 517, 574, 561 | **Régimen de privacidad mal mapeado para CL/US/MX.** `PROFILE_CL.privacyRegime='LGPD'` (régimen brasileño → regulator ANPD, multa 2%), `PROFILE_US='PIPEDA'` (régimen canadiense), `PROFILE_MX='LGPD'`. El propio archivo ya tiene fix 🔴 documentado (2026-05-15) por CN/TW/RU que apuntaban a `PIPA-JP`; la misma clase de error persiste para CL/US/MX. `compareRegimes()` y `getRegime()` devolverán regulator/deadline/multa de la jurisdicción equivocada para un tenant chileno. Falta `PrivacyRegimeCode` propio de Chile (Ley 19.628 / 21.719). |
| 13.6 | 🟡 | `suseso/cumplimientoCalculator.ts` | 17-18 vs 145-147 | **TF se desvía de la fórmula documentada.** El header define Tasa de Frecuencia = `(Nº accidentes × 1.000.000) / horas-hombre`, pero la implementación suma `fatalAccidents` al numerador (`accidentsWithTimeLoss + fatalAccidents`). Si el caller ya incluye fatales en `accidentsWithTimeLoss` (convención plausible), hay doble conteo en TF; si no, la TF documentada no coincide con la calculada. Cálculo legal referencial — ambiguo y sin test que fije la convención de entrada. |
| 13.7 | 🟡 | `sii/siiAdapter.ts` / `sii/index.ts` | 155-198 / 9, 51-68 | **`noopSiiAdapter` puede emitir DTE "accepted" falsos en prod sin guarda.** `getSiiAdapter()` cae a noop cuando `SII_PSE` no está seteado; el noop devuelve `status:'accepted'` con folios fake deterministas. index.ts dice "Production deploys MUST set SII_PSE" pero **no hay guarda `NODE_ENV==='production'`** que impida noop en producción (a diferencia de otras rutas que sí abortan en boot). Un deploy mal configurado emitiría comprobantes tributarios fantasma marcados como aceptados. |
| 13.8 | 🔵 | `regulatory/privacyRegimes.ts` | 377-384 | **`requiredConsentFor` con default poco conservador.** Para un `dataKind` no contemplado retorna `false` ("el caller decide"). En contexto de privacidad, devolver "no requiere consentimiento explícito" ante un tipo de dato sensible desconocido es el lado menos protector; fail-open silencioso. Preferible `true`/`unknown` para datos no clasificados. |
| 13.9 | 🔵 | `suseso/susesoService.ts` | 273-293 | **`submitToMutualidad` re-guarda el form completo para añadir `submittedAt`.** Lee `loadForm` y vuelve a `saveForm(... {...existing, submittedAt})`, lo que sobrescribe un registro declarado IMMUTABLE (líneas 24-28). El comentario reconoce que "en producción esto pasa a ser un único Admin-SDK update", pero hoy el patrón read→full-rewrite puede pisar firmas/campos si el store no es transaccional (cf. convención #19). No es atómico ni usa `attachSignature`. |
| 13.10 | 🔵 | `sii/susesoApiClient.ts` | 188, 207 | **`res.json()` del happy-path sin try/catch.** En `post()`/`get()` el error-path captura JSON inválido, pero el éxito (`return await res.json() as T`) lanza crudo si SUSESO responde 200 con cuerpo no-JSON. Cliente server-only y stubbed hoy (Directiva 2.6: no push), bajo impacto, pero defensivamente conviene envolver. |
| 13.11 | 🔵 | `sii/dtePdfRenderer.ts` | 96-111 | **"QR canónico SII" es texto plano, no un QR ni un TED real.** Se imprime `QR-payload: ...` con `TED=${dte.hash.slice(0,32)}` — el TED real SII es un bloque firmado con la llave CAF, no un slice del SHA-256 del XML. El comentario lo admite ("NO es un PNG real"). Riesgo: el documento aparenta verificabilidad SII que no posee; un lector podría confundirlo con un comprobante timbrado. Mantener disclaimer explícito y no rotular "canónico SII". |
| 13.12 | 🔵 | `zettelkasten/families/workflowComplianceNodeRegistry.ts` | 88-90 | **Nodos `historial-medico-*` en familia compliance.** Son sólo metadata de registro (id + descripción + source), sin lógica diagnóstica, por lo que NO violan ADR 0012; se anota únicamente como recordatorio de que cualquier productor/consumidor de estos nodos debe respetar el doble-lock médico (`piiBucketFor('medical')`). Conteo de nodos = 80, coincide con el header. Sin duplicados. |

---

## Verificaciones negativas (limpio en el lote)

- **#15 `Math.random` en server/ID-gen:** 0 ocurrencias en sii/, suseso/, regulatory/,
  privacyRetention/, susesoBackend.ts. (El FNV-1a + counter del noop adapter es
  determinístico, no `Math.random`.)
- **#14 audit `void`/sin await:** 0 ocurrencias en el lote. (El `.then(ok)` en dte.ts está
  fuera del lote y ya documentado allí.)
- **Folio atómico:** `suseso/folioGenerator.ts:nextFolio` usa `runTransaction` con
  get→set monotónico per `(tenant,year,kind)` — correcto, sin gaps ni colisiones (#19 ok).
- **#8 fuga de internals:** el dispatcher `/api/gemini` enmascara con
  `NODE_ENV==='production' ? 'Internal server error' : err.message` (gemini.ts:457-463);
  los `SiiAdapterError`/`SusesoApiError` no exponen stack. No se hallaron 5xx que filtren.
- **Cálculo IVA:** `calculateDteTotals` aplica `Math.ceil(net*0.19)` consistente con
  `pricing/tiers.ts:withIVA` y `siiPreflightCheck.computeIvaClp`. Validación de qty/precio
  entero positivo correcta. RUT regex y `validateChileanRut` (mod-11) bien usados.
- **Retención/consent (`privacyRetention/dataRetentionPolicy.ts`):** motor determinista,
  legal hold bloquea purga, fallback conservador `keep_active`, doble-lock médico
  (`piiBucketFor`). Sólido.
- **Adaptadores de jurisdicción** (au/br/ca/cl/cn/eu/in/jp/kr/mx/ru/tw/uk/us-osha):
  data estática de referencias normativas, sin lógica de control; limpios. `iso45001.ts`,
  `registry.ts`, `jurisdictionRegistry.ts`, `types.ts`, `privacyRegimeRegistry.ts` ok.
- **Tier-gating regulatorio:** `registry.ts` (`assertTenantHasJurisdiction`,
  `getActiveJurisdictions`) aplica límites server-side vía `getMaxJurisdictionsForTier`
  (#11 ok).

---

## Resumen ejecutivo (6-10 líneas)

Pasada 44/44 completa. El hallazgo crítico es **13.1**: la firma "biométrica" de DTE nunca
se verifica criptográficamente — `dteSigner.verifyAndSignDte` sólo chequea presencia de
strings y delega la verificación WebAuthn real al route, que no la ejecuta (`verifyAuthenticationResponse`
no existe en `dte.ts`), dejando firmas suplantables sin valor legal. Sigue un cluster de
riesgo regulatorio medio: `susesoBackend` parsea salida Gemini sin try/catch (#5) y genera
**códigos SUSESO + gravedad por LLM sin validar** (13.2/13.3); el preflight SII chequea
nombres de env equivocados (`BSALE_API_TOKEN`/`LIBREDTE_API_TOKEN`) que **bloquean emisión
con credenciales válidas** (13.4); y `profiles.ts` mapea **Chile/US/MX al régimen de privacidad
equivocado** (LGPD/PIPEDA), misma clase del fix 🔴 ya aplicado a CN/TW/RU (13.5). El noop SII
adapter puede emitir comprobantes "accepted" fantasma en prod sin guarda `NODE_ENV` (13.7),
y la TF de cumplimiento se desvía de su fórmula documentada (13.6). El folio SUSESO sí es
atómico, el cálculo de IVA es correcto, y los 14 adaptadores de jurisdicción + el motor de
retención/consentimiento están limpios. Sin `Math.random`, sin `void audit`, sin fuga de
internals en el lote.
