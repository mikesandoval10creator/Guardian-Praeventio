/**
 * Risk-node ranking — rank Zettelkasten RISK nodes (`NodeType.RISK = 'Riesgo'`)
 * by their DS44 IPER score (probabilidad × severidad → `calculateIper`).
 *
 * WHY (B2 🔵, Fase 5): the `useTopRisks` dashboard hook was an idle stub feeding
 * an orphan card; the existing pull endpoint read flat `risks`/`controls`
 * collections that NO writer populates (empty dashboards = disguised-fake). The
 * real risk data lives in `zettelkasten_nodes` (NodeType.RISK), written by the
 * Matrix IPER page with `metadata.{probabilidad,severidad}`. This pure engine
 * ranks those nodes using the canonical DS44 engine (the same one consolidated
 * in ADR 0020 / PR #687), so the dashboard shows REAL, correctly-classified
 * top risks. Decision: ADR 0020 (Zettelkasten-canonical source).
 */

import { calculateIper, type IperLevel } from '../protocols/iper';
import { criticidadFromIper, type IperCriticidad } from '../protocols/iperCriticidad';

/** A RISK node projected from `zettelkasten_nodes` + its `metadata`. */
export interface RiskNodeInput {
  id: string;
  title: string;
  category?: string;
  probabilidad?: number;
  severidad?: number;
}

export interface RankedRiskNode {
  id: string;
  title: string;
  category: string;
  probabilidad: 1 | 2 | 3 | 4 | 5;
  severidad: 1 | 2 | 3 | 4 | 5;
  /** Raw IPER score = probabilidad × severidad (1..25). */
  iperScore: number;
  /** DS44 5-level classification. */
  iperLevel: IperLevel;
  /** 4-band criticidad contract (Crítica/Alta/Media/Baja). */
  criticidad: IperCriticidad;
}

/** Clamp arbitrary node metadata to the valid IPER integer domain [1,5]. */
function clampScale(value: number | undefined): 1 | 2 | 3 | 4 | 5 {
  const n = Number.isFinite(value) ? Math.round(value as number) : 1;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n as 1 | 2 | 3 | 4 | 5;
}

/**
 * Rank RISK nodes by descending IPER score. Pure and deterministic; defensive
 * against missing/out-of-range metadata (clamps to [1,5] so a malformed node
 * never throws). Ties keep input order (stable sort). `topN <= 0` returns all.
 */
export function rankRiskNodesByIper(
  nodes: RiskNodeInput[],
  topN = 10,
): RankedRiskNode[] {
  const ranked: RankedRiskNode[] = nodes.map((node) => {
    const probabilidad = clampScale(node.probabilidad);
    const severidad = clampScale(node.severidad);
    const iper = calculateIper({ probability: probabilidad, severity: severidad });
    return {
      id: node.id,
      title: node.title,
      category: node.category && node.category.trim() ? node.category : 'sin categoría',
      probabilidad,
      severidad,
      iperScore: iper.rawScore,
      iperLevel: iper.level,
      criticidad: criticidadFromIper(probabilidad, severidad),
    };
  });
  ranked.sort((a, b) => b.iperScore - a.iperScore);
  return topN > 0 ? ranked.slice(0, topN) : ranked;
}
