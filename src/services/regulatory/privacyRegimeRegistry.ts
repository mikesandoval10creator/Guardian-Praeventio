// Sprint 48 E.4 — Façade pública del catálogo de regímenes de privacidad.
//
// Re-exporta los símbolos de `privacyRegimes.ts` con un nombre más legible
// desde fuera del módulo. El catálogo en sí vive en privacyRegimes.ts;
// este archivo es la API estable para callers.

export {
  getRegime,
  listRegimes,
  requiredConsentFor,
  type PrivacyRegime,
  type PrivacyRegimeCode,
  type DataSubjectRight,
  type ConsentLegalBasis,
  type DataKind,
} from './privacyRegimes.js';
