// Praeventio Guard — Sprint 51 §260: Auto-admin (sugerir automatizaciones).
//
// Cierra §260 de la 2da tanda usuario: dado un reporte de carga
// administrativa, sugiere automatizaciones existentes en el producto
// Praeventio que reemplazan cada tipo de tarea manual, con estimación de
// minutos ahorrados/semana, esfuerzo de implementación y confianza.
//
// 100% determinístico. Engine puro sin I/O. Las recomendaciones apuntan a
// features REALES del producto (importador Excel, QR ack, Doc Versioning,
// Audit Express Bundle, Inbox Prevencionista, Monthly Client Report).

import type { AdminBurdenReport, AdminTaskKind } from './adminBurdenTracker.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ImplementationEffort = 'config' | 'training' | 'small_dev' | 'medium_dev';

export interface AutomationSuggestion {
  forKind: AdminTaskKind;
  savedMinutesPerWeek: number;
  /** Cuál feature existente del producto reemplaza esta tarea manual. */
  replacementFeature: string;
  /** Estimación esfuerzo implementación. */
  implementationEffort: ImplementationEffort;
  /** Confianza 0-1 de que efectivamente reemplaza. */
  confidence: number;
}

// ────────────────────────────────────────────────────────────────────────
// Mapping interno: kind → automatización candidata
// ────────────────────────────────────────────────────────────────────────

interface MappingEntry {
  replacementFeature: string;
  implementationEffort: ImplementationEffort;
  confidence: number;
  /**
   * Fracción del tiempo manual que la automatización efectivamente ahorra.
   * 1.0 = reemplaza 100%, 0.5 = ahorra la mitad.
   */
  savedRatio: number;
}

const MAPPING: Record<AdminTaskKind, MappingEntry> = {
  data_entry: {
    replacementFeature: 'Importador Excel + validador',
    implementationEffort: 'config',
    confidence: 0.9,
    savedRatio: 0.85,
  },
  signature_collection: {
    replacementFeature: 'QR Acknowledgement Sessions',
    implementationEffort: 'training',
    confidence: 0.95,
    savedRatio: 0.9,
  },
  manual_pdf_export: {
    replacementFeature: 'Auditoría Express Bundle',
    implementationEffort: 'config',
    confidence: 0.9,
    savedRatio: 0.9,
  },
  duplicate_filing: {
    replacementFeature: 'Document Versioning',
    implementationEffort: 'config',
    confidence: 0.85,
    savedRatio: 0.8,
  },
  phone_followup: {
    replacementFeature: 'Inbox Prevencionista + FCM notif',
    implementationEffort: 'training',
    confidence: 0.7,
    savedRatio: 0.6,
  },
  manual_report: {
    replacementFeature: 'Monthly Client Report auto',
    implementationEffort: 'config',
    confidence: 0.85,
    savedRatio: 0.85,
  },
  spreadsheet_update: {
    replacementFeature: 'Dashboards en vivo + KPI service',
    implementationEffort: 'small_dev',
    confidence: 0.75,
    savedRatio: 0.7,
  },
  inbox_triage: {
    replacementFeature: 'Smart Inbox routing + filtros',
    implementationEffort: 'small_dev',
    confidence: 0.65,
    savedRatio: 0.5,
  },
};

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Genera sugerencias de automatización para cada `kind` presente en el
 * reporte. Sólo emite sugerencias con `savedMinutesPerWeek > 0`.
 *
 * Resultado ordenado desc por minutos ahorrados y, ante empate, desc por
 * `confidence` (mayor confianza primero).
 */
export function suggestAutomations(
  report: AdminBurdenReport,
): AutomationSuggestion[] {
  const out: AutomationSuggestion[] = [];

  for (const row of report.byKind) {
    const mapping = MAPPING[row.kind];
    if (!mapping) continue;
    const saved = round1(row.minutes * mapping.savedRatio);
    if (saved <= 0) continue;
    out.push({
      forKind: row.kind,
      savedMinutesPerWeek: saved,
      replacementFeature: mapping.replacementFeature,
      implementationEffort: mapping.implementationEffort,
      confidence: mapping.confidence,
    });
  }

  return out.sort((a, b) => {
    if (b.savedMinutesPerWeek !== a.savedMinutesPerWeek) {
      return b.savedMinutesPerWeek - a.savedMinutesPerWeek;
    }
    return b.confidence - a.confidence;
  });
}

/**
 * Total estimado minutos/semana ahorrables al implementar TODAS las
 * automatizaciones sugeridas. Útil para construir caso de negocio.
 */
export function totalSavedMinutesPerWeek(
  suggestions: AutomationSuggestion[],
): number {
  return round1(
    suggestions.reduce((s, x) => s + x.savedMinutesPerWeek, 0),
  );
}
