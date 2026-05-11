// Praeventio Guard — Sprint K: Higiene Documental.
//
// Cierra: Documento usuario "§287-290"
//
// Detecta:
//   - Procedimientos no usados (existen pero nadie los abre/firma/aplica) §287
//   - Documentos fantasma (sin relación con tareas/riesgos/trabajadores) §288
//   - Depuración inteligente: archivar/revisar obsoletos o duplicados §289
//   - Mapa de confianza documental: score 0-100 por documento §290
//
// Determinístico. Recibe estado consolidado, devuelve listas accionables.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  id: string;
  title: string;
  /** Categoría (procedimiento/política/manual/registro/...). */
  kind: string;
  /** Versión actual. */
  version: string;
  /** UID del último aprobador. */
  approvedByUid?: string;
  /** ISO-8601 de la última aprobación. */
  approvedAt?: string;
  /** ISO-8601 de la última actualización. */
  updatedAt: string;
  /** True si tiene firma digital válida. */
  hasValidSignature: boolean;
  /** Cuántas veces fue accedido en los últimos 90d. */
  accessCount90d: number;
  /** Cuántas firmas de lectura ha recibido. */
  readReceiptCount: number;
  /** True si su contenido referencia una norma específica. */
  referencesNorm: boolean;
  /** True si está vinculado a tareas, riesgos, trabajadores o equipos. */
  isLinkedToOperations: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// 1. Unused procedures (§287)
// ────────────────────────────────────────────────────────────────────────

export interface UnusedDocumentReport {
  documentId: string;
  title: string;
  /** Días desde la última actividad. */
  daysSinceLastActivity: number;
  /** Razón: 'no_access' | 'no_signatures' | 'no_links'. */
  reasons: Array<'no_access' | 'no_signatures' | 'no_links'>;
  suggestedAction: 'archive' | 'revisit' | 'merge_or_replace';
}

const UNUSED_DAYS_THRESHOLD = 180;

export function detectUnusedDocuments(
  docs: DocumentRecord[],
  nowIso: string = new Date().toISOString(),
): UnusedDocumentReport[] {
  const nowMs = Date.parse(nowIso);
  return docs
    .map((d) => {
      const reasons: UnusedDocumentReport['reasons'] = [];
      if (d.accessCount90d === 0) reasons.push('no_access');
      if (d.readReceiptCount === 0) reasons.push('no_signatures');
      if (!d.isLinkedToOperations) reasons.push('no_links');
      const daysSinceLastActivity = Math.floor(
        (nowMs - Date.parse(d.updatedAt)) / 86_400_000,
      );
      let suggestedAction: UnusedDocumentReport['suggestedAction'] = 'revisit';
      if (reasons.length === 3 && daysSinceLastActivity > UNUSED_DAYS_THRESHOLD) {
        suggestedAction = 'archive';
      } else if (reasons.length === 3) {
        suggestedAction = 'merge_or_replace';
      }
      return {
        documentId: d.id,
        title: d.title,
        daysSinceLastActivity,
        reasons,
        suggestedAction,
      };
    })
    .filter((r) => r.reasons.length >= 2);
}

// ────────────────────────────────────────────────────────────────────────
// 2. Ghost documents (§288)
// ────────────────────────────────────────────────────────────────────────

export interface GhostDocumentReport {
  documentId: string;
  title: string;
  /** Por qué se considera "fantasma". */
  reason: string;
}

export function detectGhostDocuments(docs: DocumentRecord[]): GhostDocumentReport[] {
  return docs
    .filter(
      (d) =>
        !d.isLinkedToOperations &&
        d.readReceiptCount === 0 &&
        d.accessCount90d <= 1,
    )
    .map((d) => ({
      documentId: d.id,
      title: d.title,
      reason:
        'No está vinculado a tareas/riesgos/trabajadores, no tiene firmas, casi sin accesos. Indica documentación fuera del flujo real.',
    }));
}

// ────────────────────────────────────────────────────────────────────────
// 3. Duplicate / library purge (§289)
// ────────────────────────────────────────────────────────────────────────

export interface PurgeSuggestion {
  documentId: string;
  title: string;
  reason: 'duplicate' | 'obsolete' | 'orphaned';
  /** UIDs de documentos que lo superan / lo dejan obsoleto. */
  supersededBy?: string[];
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function suggestPurges(
  docs: DocumentRecord[],
  nowIso: string = new Date().toISOString(),
): PurgeSuggestion[] {
  const suggestions: PurgeSuggestion[] = [];

  // Duplicates by normalized title
  const byTitle = new Map<string, DocumentRecord[]>();
  for (const d of docs) {
    const t = normalizeTitle(d.title);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t)!.push(d);
  }
  for (const [, group] of byTitle) {
    if (group.length > 1) {
      // El más reciente es el "ganador"
      const sorted = [...group].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const winner = sorted[0];
      for (const loser of sorted.slice(1)) {
        suggestions.push({
          documentId: loser.id,
          title: loser.title,
          reason: 'duplicate',
          supersededBy: [winner.id],
        });
      }
    }
  }

  // Obsolete (>2 años sin actualizar Y referencia norma)
  const nowMs = Date.parse(nowIso);
  const TWO_YEARS = 730 * 86_400_000;
  for (const d of docs) {
    if (d.referencesNorm && nowMs - Date.parse(d.updatedAt) > TWO_YEARS) {
      suggestions.push({
        documentId: d.id,
        title: d.title,
        reason: 'obsolete',
      });
    }
  }

  // Orphaned: sin links a operación, sin lectores
  for (const d of docs) {
    if (!d.isLinkedToOperations && d.readReceiptCount === 0) {
      suggestions.push({
        documentId: d.id,
        title: d.title,
        reason: 'orphaned',
      });
    }
  }

  // Deduplicate (mismo doc puede caer en varias razones — quedarse con la más severa)
  const PRIORITY: Record<PurgeSuggestion['reason'], number> = { duplicate: 3, obsolete: 2, orphaned: 1 };
  const byDoc = new Map<string, PurgeSuggestion>();
  for (const s of suggestions) {
    const prev = byDoc.get(s.documentId);
    if (!prev || PRIORITY[s.reason] > PRIORITY[prev.reason]) {
      byDoc.set(s.documentId, s);
    }
  }
  return [...byDoc.values()];
}

// ────────────────────────────────────────────────────────────────────────
// 4. Confidence map (§290)
// ────────────────────────────────────────────────────────────────────────

export interface DocumentConfidence {
  documentId: string;
  title: string;
  /** 0-100. */
  score: number;
  level: 'low' | 'medium' | 'high';
  /** Razones del score. */
  factors: Array<{ factor: string; delta: number }>;
}

export function computeDocumentConfidence(d: DocumentRecord, nowIso: string = new Date().toISOString()): DocumentConfidence {
  const nowMs = Date.parse(nowIso);
  const factors: Array<{ factor: string; delta: number }> = [];

  let score = 0;
  if (d.approvedByUid) {
    score += 15;
    factors.push({ factor: 'Aprobador identificado', delta: 15 });
  }
  if (d.hasValidSignature) {
    score += 20;
    factors.push({ factor: 'Firma digital válida', delta: 20 });
  }
  if (d.referencesNorm) {
    score += 15;
    factors.push({ factor: 'Referencia normativa', delta: 15 });
  }
  if (d.isLinkedToOperations) {
    score += 15;
    factors.push({ factor: 'Vinculado a operación real', delta: 15 });
  }
  if (d.readReceiptCount > 0) {
    score += Math.min(10, Math.floor(d.readReceiptCount / 5));
    factors.push({
      factor: `${d.readReceiptCount} firmas de lectura`,
      delta: Math.min(10, Math.floor(d.readReceiptCount / 5)),
    });
  }
  if (d.accessCount90d > 0) {
    const cap = Math.min(15, Math.floor(d.accessCount90d / 4));
    score += cap;
    factors.push({ factor: `${d.accessCount90d} accesos últimos 90d`, delta: cap });
  }
  // Penalización por antigüedad sin actualizar
  const ageDays = Math.floor((nowMs - Date.parse(d.updatedAt)) / 86_400_000);
  if (ageDays > 730) {
    score -= 20;
    factors.push({ factor: `Sin actualizar hace ${ageDays}d (>2 años)`, delta: -20 });
  } else if (ageDays > 365) {
    score -= 10;
    factors.push({ factor: `Sin actualizar hace ${ageDays}d (>1 año)`, delta: -10 });
  }

  score = Math.max(0, Math.min(100, score));
  const level: DocumentConfidence['level'] = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return { documentId: d.id, title: d.title, score, level, factors };
}
