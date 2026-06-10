// SystemEngine — Theme context adapter (placeholder).
//
// Theme transitions are pure UI; they do not produce semantic events for
// the bus today. Adapter exists for symmetry so SystemEngineProvider has
// a stable mount point.

export interface ThemeAdapterOptions { tenantId: string }


export function useThemeContextAdapter(_opts: ThemeAdapterOptions): void {
  // Intentionally empty.
}
