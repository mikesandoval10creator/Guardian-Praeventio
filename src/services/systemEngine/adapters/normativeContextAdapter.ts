// SystemEngine — Normative context adapter (placeholder).
//
// Future hook: emit `normative_updated` when the cached normative dataset
// receives a new revision (e.g. post-deploy of a refreshed legalBackend).
// Lets RAG pipelines re-index dependent documents.

export interface NormativeAdapterOptions { tenantId: string }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useNormativeContextAdapter(_opts: NormativeAdapterOptions): void {
  // Intentionally empty.
}
