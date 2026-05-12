// Praeventio Guard — Sprint K: 5S Audit + Housekeeping + Zone Scoring.
//
// Cierra: Documento usuario "§227"
//
// 5S = Seiri (clasificar), Seiton (organizar), Seiso (limpiar),
// Seiketsu (estandarizar), Shitsuke (disciplinar). Audit periódico
// de cada zona con score 0-100.
//
// Determinístico.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type FiveSDimension = 'seiri' | 'seiton' | 'seiso' | 'seiketsu' | 'shitsuke';

export interface FiveSAuditChecklistItem {
  dimension: FiveSDimension;
  id: string;
  label: string;
}

const CHECKLIST: FiveSAuditChecklistItem[] = [
  // Seiri (Clasificar)
  { dimension: 'seiri', id: 's1-1', label: 'Solo elementos necesarios en el área' },
  { dimension: 'seiri', id: 's1-2', label: 'Elementos obsoletos retirados' },
  { dimension: 'seiri', id: 's1-3', label: 'EPP no usado almacenado correctamente' },
  // Seiton (Organizar)
  { dimension: 'seiton', id: 's2-1', label: 'Cada herramienta tiene un lugar marcado' },
  { dimension: 'seiton', id: 's2-2', label: 'Inventario visual claro' },
  { dimension: 'seiton', id: 's2-3', label: 'Vías de circulación libres' },
  // Seiso (Limpiar)
  { dimension: 'seiso', id: 's3-1', label: 'Pisos sin residuos / derrames' },
  { dimension: 'seiso', id: 's3-2', label: 'Equipos limpios' },
  { dimension: 'seiso', id: 's3-3', label: 'Iluminación funcionando' },
  // Seiketsu (Estandarizar)
  { dimension: 'seiketsu', id: 's4-1', label: 'Estándares visuales aplicados (líneas, etiquetas)' },
  { dimension: 'seiketsu', id: 's4-2', label: 'Procedimientos visibles' },
  // Shitsuke (Disciplinar)
  { dimension: 'shitsuke', id: 's5-1', label: 'Reglas se cumplen sin supervisión' },
  { dimension: 'shitsuke', id: 's5-2', label: 'Auditoría 5S regular ejecutada' },
];

export function getFiveSChecklist(): FiveSAuditChecklistItem[] {
  return CHECKLIST;
}

// ────────────────────────────────────────────────────────────────────────
// Audit + scoring
// ────────────────────────────────────────────────────────────────────────

export interface FiveSAuditResponse {
  itemId: string;
  /** 0 = no cumple, 1 = parcial, 2 = cumple totalmente. */
  rating: 0 | 1 | 2;
}

export interface FiveSAuditReport {
  zoneId: string;
  /** Score 0-100. */
  overallScore: number;
  /** Score por dimensión 0-100. */
  byDimension: Record<FiveSDimension, number>;
  level: 'critical' | 'low' | 'fair' | 'good' | 'excellent';
  worstDimension: FiveSDimension;
  items: Array<{ item: FiveSAuditChecklistItem; rating: 0 | 1 | 2 }>;
}

export function buildFiveSAuditReport(
  zoneId: string,
  responses: FiveSAuditResponse[],
): FiveSAuditReport {
  const responseMap = new Map(responses.map((r) => [r.itemId, r.rating]));
  const items = CHECKLIST.map((item) => ({
    item,
    rating: (responseMap.get(item.id) ?? 0) as 0 | 1 | 2,
  }));

  const byDimensionSum: Record<FiveSDimension, { sum: number; count: number }> = {
    seiri: { sum: 0, count: 0 },
    seiton: { sum: 0, count: 0 },
    seiso: { sum: 0, count: 0 },
    seiketsu: { sum: 0, count: 0 },
    shitsuke: { sum: 0, count: 0 },
  };
  for (const { item, rating } of items) {
    byDimensionSum[item.dimension].sum += rating;
    byDimensionSum[item.dimension].count += 1;
  }
  const byDimension: Record<FiveSDimension, number> = {
    seiri: 0,
    seiton: 0,
    seiso: 0,
    seiketsu: 0,
    shitsuke: 0,
  };
  for (const dim of Object.keys(byDimension) as FiveSDimension[]) {
    const { sum, count } = byDimensionSum[dim];
    byDimension[dim] = count > 0 ? Math.round((sum / (count * 2)) * 100) : 0;
  }

  const overallScore = Math.round(
    Object.values(byDimension).reduce((s, v) => s + v, 0) / 5,
  );

  let level: FiveSAuditReport['level'];
  if (overallScore >= 90) level = 'excellent';
  else if (overallScore >= 75) level = 'good';
  else if (overallScore >= 60) level = 'fair';
  else if (overallScore >= 40) level = 'low';
  else level = 'critical';

  const worstDimension = (Object.entries(byDimension) as Array<[FiveSDimension, number]>)
    .sort((a, b) => a[1] - b[1])[0][0];

  return { zoneId, overallScore, byDimension, level, worstDimension, items };
}

// ────────────────────────────────────────────────────────────────────────
// Zone comparison
// ────────────────────────────────────────────────────────────────────────

export interface ZoneScoreEntry {
  zoneId: string;
  overallScore: number;
  level: FiveSAuditReport['level'];
  worstDimension: FiveSDimension;
}

export function rankZonesBy5S(reports: FiveSAuditReport[]): ZoneScoreEntry[] {
  return reports
    .map((r) => ({
      zoneId: r.zoneId,
      overallScore: r.overallScore,
      level: r.level,
      worstDimension: r.worstDimension,
    }))
    .sort((a, b) => a.overallScore - b.overallScore); // peor primero
}
