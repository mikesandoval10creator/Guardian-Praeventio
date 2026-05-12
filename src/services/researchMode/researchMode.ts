// Praeventio Guard — Sprint K: Modo Investigación Causa Raíz + Árbol Visual + Comparador.
//
// Cierra: Documento usuario "§191-194"
//
// Modo investigación que organiza el análisis de causa raíz como un
// árbol visual (5 porqués + Ishikawa):
//   - Detector de control fallido
//   - Comparador con incidentes similares
//   - Árbol visual de causas (drill-down)
//
// Determinístico, sin LLM. Acompaña a `rootCauseClassifier` (existente).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type CauseCategory =
  | 'people'         // habilidad/training/decisión
  | 'process'        // procedimientos/método
  | 'environment'    // clima/iluminación/temperatura
  | 'equipment'      // máquinas/herramientas/EPP
  | 'materials'      // sustancias/insumos
  | 'measurement'    // medición/calibración
  | 'management';    // supervisión/comunicación/cultura

export interface CauseNode {
  id: string;
  /** Texto del "por qué" o causa identificada. */
  text: string;
  category: CauseCategory;
  /** Si esta causa es la raíz última. */
  isRoot: boolean;
  /** ID del nodo padre (la pregunta "por qué" que llevó aquí). */
  parentId?: string;
  /** Si esta causa apunta a un control fallido conocido. */
  failedControlId?: string;
  /** UID que la propuso. */
  proposedByUid: string;
  /** Evidencia que la respalda. */
  evidenceRefs?: string[];
}

export interface RootCauseTree {
  incidentId: string;
  nodes: CauseNode[];
}

// ────────────────────────────────────────────────────────────────────────
// Tree construction / traversal
// ────────────────────────────────────────────────────────────────────────

export interface BranchPath {
  /** Camino desde la raíz hasta el nodo isRoot=true. */
  path: CauseNode[];
  depth: number;
  hasFailedControl: boolean;
}

export function findRootBranches(tree: RootCauseTree): BranchPath[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const roots = tree.nodes.filter((n) => n.isRoot);
  return roots.map((root) => {
    const path: CauseNode[] = [root];
    let current = root;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      path.unshift(parent);
      current = parent;
    }
    return {
      path,
      depth: path.length,
      hasFailedControl: path.some((n) => Boolean(n.failedControlId)),
    };
  });
}

export interface TreeSummary {
  totalNodes: number;
  rootCount: number;
  maxDepth: number;
  byCategory: Record<CauseCategory, number>;
  failedControlsIdentified: string[];
}

export function summarizeTree(tree: RootCauseTree): TreeSummary {
  const byCategory: Record<CauseCategory, number> = {
    people: 0,
    process: 0,
    environment: 0,
    equipment: 0,
    materials: 0,
    measurement: 0,
    management: 0,
  };
  for (const n of tree.nodes) byCategory[n.category] += 1;

  const branches = findRootBranches(tree);
  const maxDepth = branches.reduce((max, b) => Math.max(max, b.depth), 0);
  const failedControlsIdentified = [
    ...new Set(
      tree.nodes.filter((n) => n.failedControlId).map((n) => n.failedControlId as string),
    ),
  ];

  return {
    totalNodes: tree.nodes.length,
    rootCount: branches.length,
    maxDepth,
    byCategory,
    failedControlsIdentified,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Similarity comparator (§192)
// ────────────────────────────────────────────────────────────────────────

export interface SimilarityScore {
  otherIncidentId: string;
  /** Score 0-100. */
  score: number;
  matchingCategories: CauseCategory[];
  matchingFailedControls: string[];
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return inter.size / union.size;
}

export function compareTrees(
  primary: RootCauseTree,
  others: RootCauseTree[],
): SimilarityScore[] {
  const primarySummary = summarizeTree(primary);
  const primaryCats = new Set<CauseCategory>(
    (Object.entries(primarySummary.byCategory).filter(([, n]) => n > 0).map(([k]) => k as CauseCategory)),
  );
  const primaryControls = new Set(primarySummary.failedControlsIdentified);

  return others
    .map((other) => {
      const otherSummary = summarizeTree(other);
      const otherCats = new Set<CauseCategory>(
        Object.entries(otherSummary.byCategory).filter(([, n]) => n > 0).map(([k]) => k as CauseCategory),
      );
      const otherControls = new Set(otherSummary.failedControlsIdentified);

      const catSimilarity = jaccard(primaryCats, otherCats);
      const controlSimilarity = jaccard(primaryControls, otherControls);
      const score = Math.round((catSimilarity * 0.4 + controlSimilarity * 0.6) * 100);

      return {
        otherIncidentId: other.incidentId,
        score,
        matchingCategories: [...primaryCats].filter((c) => otherCats.has(c)),
        matchingFailedControls: [...primaryControls].filter((c) => otherControls.has(c)),
      };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ────────────────────────────────────────────────────────────────────────
// Failed control detector (§194)
// ────────────────────────────────────────────────────────────────────────

export interface FailedControlSignal {
  controlId: string;
  /** Cuántos incidentes lo apuntan como falla. */
  failureCount: number;
  /** % de incidentes recientes con falla de este control. */
  frequencyPercent: number;
  /** Severidad: si %>30 → critical, %>10 → warning, else low. */
  severity: 'low' | 'warning' | 'critical';
}

export function detectFailedControlPatterns(trees: RootCauseTree[]): FailedControlSignal[] {
  const failureCount = new Map<string, number>();
  for (const tree of trees) {
    const controls = new Set(
      tree.nodes.filter((n) => n.failedControlId).map((n) => n.failedControlId as string),
    );
    for (const c of controls) {
      failureCount.set(c, (failureCount.get(c) ?? 0) + 1);
    }
  }
  return [...failureCount.entries()]
    .map(([controlId, count]) => {
      const frequencyPercent = trees.length > 0 ? Math.round((count / trees.length) * 100) : 0;
      let severity: 'low' | 'warning' | 'critical';
      if (frequencyPercent > 30) severity = 'critical';
      else if (frequencyPercent > 10) severity = 'warning';
      else severity = 'low';
      return { controlId, failureCount: count, frequencyPercent, severity };
    })
    .sort((a, b) => b.frequencyPercent - a.frequencyPercent);
}
