// Praeventio Guard — Sprint K §155-160: barrel del módulo aiGuardrails.
//
// Re-exporta la API pública de los 3 sub-services + el wrapper. Los
// archivos legacy `aiGuardrails.ts` y `aiGuardrails.test.ts` siguen
// existiendo en este directorio para no romper imports históricos
// (`./aiGuardrails.js`). El nuevo módulo se importa así:
//
//   import { runWithGuardrails, getPrompt, validateResponse }
//     from 'src/services/aiGuardrails';
//
// Compatibilidad: el adapter de Gemini NO se modificó. Callers existentes
// que llaman a `geminiAdapter.generate(...)` directamente siguen
// funcionando sin guardrails (default = sin guardrails). Migrar
// gradualmente al wrapper `runWithGuardrails` por call site.

export {
  getPrompt,
  getLatestVersion,
  getCatalog,
  listVersions,
  listPromptIds,
  UnknownPromptError,
  type VersionedPrompt,
  type CitationPolicy,
} from './versionedPrompts.ts';

export {
  validateResponse,
  extractCitations,
  describeValidationFailure,
  type CitationSource,
  type CitationValidationResult,
  type MissingCitation,
  type InvalidCitation,
} from './citationValidator.ts';

export {
  guardAgainstHallucination,
  splitSentences,
  type HallucinationGuardResult,
  type SuspiciousSentence,
  type SuspicionTrigger,
} from './hallucinationGuard.ts';

export {
  runWithGuardrails,
  renderPromptBody,
  findUnresolvedPlaceholders,
  GUARDRAIL_FALLBACK_TEXT,
  type RunWithGuardrailsInput,
  type RunWithGuardrailsResult,
} from './runWithGuardrails.ts';
