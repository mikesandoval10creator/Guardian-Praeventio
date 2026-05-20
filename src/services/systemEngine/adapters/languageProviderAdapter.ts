// SystemEngine — LanguageProvider adapter (placeholder).
//
// Locale changes are pure UI; no semantic event today. Adapter exists for
// symmetry so SystemEngineProvider has a stable mount point.

export interface LanguageAdapterOptions { tenantId: string }

 
export function useLanguageProviderAdapter(_opts: LanguageAdapterOptions): void {
  // Intentionally empty.
}
