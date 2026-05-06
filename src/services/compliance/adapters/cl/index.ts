// Praeventio Guard — Sprint 38 (CL adapter consolidation).
//
// Per ADR-0017 (Per-country emission adapters, doc-only, no push), this
// module is the **CL namespace** that re-exports the existing Sprint
// 28-35 emission services without moving or refactoring them. It is
// purely additive: every original call site (`/api/dte/generate`,
// `/api/compliance/ds67`, `/api/compliance/ds76`, the SUSESO folio
// generator, the medical aptitude certificate utility) keeps working.
//
// Sprint 38 is the **incremental rollout step #1** of ADR-0017:
// Chile-only consolidation. Sprint 39 will add US (OSHA Form 301),
// Sprint 40 UK (RIDDOR), etc., each as its own adapter directory next
// to this one.
//
// Reglas durables del usuario incrustadas en este adapter:
//   1. NO push a SUSESO / MUTUAL / SII — todos los generators producen
//      PDF + JSON localmente; la empresa cliente entrega por su canal
//      oficial.
//   2. Firma biométrica WebAuthn (passkey login Google) — los signers
//      reusan el patrón Sprint 34 E6 dteSigner.
//   3. NO bloquear maquinaria — este adapter solo emite documentos,
//      no toca directiveOrders ni equipment locks.

// ─── DS 67 (Reglamento Interno, Ley 16.744) ─────────────────────────────────
//
// Sprint 31 PP. Generator + signer + folio formatter + country gate
// (Sprint 33 D2 — JurisdictionNotSupportedError).
export {
  createDs67Form,
  signForm as signDs67Form,
  formatDs67Folio,
  parseDs67Folio,
  nextDs67Folio,
  ds67FolioToDocId,
  listVersions as listDs67Versions,
  JurisdictionNotSupportedError,
} from '../../ds67/ds67Service.js';
export type {
  CreateDs67Input,
  CreateDs67Result,
  MinimalDs67FormStore,
  ResolveCountryFn,
} from '../../ds67/ds67Service.js';

// ─── DS 76 (Reglamento Subcontratación Minera) ──────────────────────────────
export {
  createDs76Form,
  signForm as signDs76Form,
  formatDs76Folio,
  parseDs76Folio,
  nextDs76Folio,
  ds76FolioToDocId,
  listVersions as listDs76Versions,
} from '../../ds76/ds76Service.js';
export type {
  CreateDs76Input,
  CreateDs76Result,
  MinimalDs76FormStore,
} from '../../ds76/ds76Service.js';

// ─── DIAT/DIEP (SUSESO accident notification) ───────────────────────────────
//
// Sprint 28 B6. createSusesoForm cubre DIAT (Declaración Individual
// de Accidente de Trabajo) y DIEP (Declaración Individual de
// Enfermedad Profesional) según `formType` en el input.
export {
  createSusesoForm,
  signForm as signSusesoForm,
  verifyFolio as verifySusesoFolio,
  folioToDocId as susesoFolioToDocId,
  buildVerificationUrl as buildSusesoVerificationUrl,
} from '../../../suseso/susesoService.js';
export type {
  CreateSusesoFormInput,
  CreateSusesoFormResult,
  MinimalFormStore as MinimalSusesoFormStore,
} from '../../../suseso/susesoService.js';
export {
  formatFolio as formatSusesoFolio,
  parseFolio as parseSusesoFolio,
  nextFolio as nextSusesoFolio,
  tenantSlug,
} from '../../../suseso/folioGenerator.js';
export type { MinimalFolioStore } from '../../../suseso/folioGenerator.js';

// ─── DTE SII (Ley 19.799 — Boleta/Factura Electrónica) ──────────────────────
//
// Sprint 34 E6. generateDte produce JSON canonical + XML SII; signer
// usa WebAuthn passkey; renderDtePdf produce PDF para entrega manual.
// NO push al SII (regla del usuario reafirmada en ADR-0017).
export {
  generateDte,
  type GenerateDteType,
  type GenerateDteOptions,
  type GeneratedDte,
} from '../../../sii/dteGenerator.js';
export {
  verifyAndSignDte,
  buildSignChallenge as buildDteSignChallenge,
  type SignDteRequest,
  type SignDteResult,
  type DteSignChallenge,
} from '../../../sii/dteSigner.js';
export { renderDtePdf } from '../../../sii/dtePdfRenderer.js';

// ─── Aptitude Certificate (DS 109 / Examen Ocupacional) ─────────────────────
//
// Sprint 35 F1. Médico ocupacional emite el certificado; el utility
// produce PDF jsPDF visualmente fiel al formato MINSAL. Firma
// biométrica WebAuthn se aplica por el frontend usando el mismo
// challenge model que DTE (no signer dedicado en backend hoy — los
// metadatos firmados se persisten en `medicalCertificates` collection
// vía route `/api/medical/aptitude-cert/sign`).
export {
  generateAptitudeCertificate,
  type AptitudeData,
} from '../../../../utils/aptitudeCertificate.js';
