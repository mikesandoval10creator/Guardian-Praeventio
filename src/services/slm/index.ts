/**
 * Public barrel for the SLM offline namespace.
 *
 * Re-exports the canonical types and the static model registry so the
 * rest of the app can `import { ... } from '@/services/slm'` without
 * reaching into individual modules.
 *
 * Fase 1 (Sprint 20, Bucket Gamma, T-1.1) — types + registry only.
 * The Web Worker (T-1.2) and reconciliation queue (T-1.3+) will add
 * their own exports here as they land.
 */

export type {
  ModelDescriptor,
  SLMQuery,
  SLMResponse,
  OfflineQueueEntry,
  SLMBackend,
  SLMQuantization,
  SLMFormat,
  SLMLicense,
} from './types';

export {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  getModelById,
  getDefaultModel,
} from './registry';
