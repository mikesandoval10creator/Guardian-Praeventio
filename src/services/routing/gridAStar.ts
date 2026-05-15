// Praeventio Guard — Codex fake fix §2.3 (2026-05-15).
//
// Algoritmo A* REAL sobre grilla discretizada (NxM). Reemplaza el
// `simulatedPath` hardcoded que tenía `EvacuationRoutes.tsx` y que el
// TODO.md vendía como "A* sobre Grillas Dinámicas".
//
// Heurística: distancia Manhattan (admisible para grilla 4-conexa) o
// Octile (admisible para 8-conexa). Default 4-conexa (sin diagonales)
// porque es más conservador en evacuación — no permite "atajar esquinas"
// donde podría haber un obstáculo.
//
// Garantías:
//   - Determinístico (mismos inputs → mismo path)
//   - Devuelve null si destino inalcanzable (NO un fake path)
//   - O(N×M log(N×M)) con priority queue
//   - Heurística admisible → garantiza shortest path

export interface GridCell {
  x: number;
  y: number;
}

export interface AStarOptions {
  /** Si `true`, permite movimientos diagonales (8-conexa). Default false. */
  allowDiagonals?: boolean;
  /** Función custom de costo por celda (default 1 para todas). */
  cellCost?: (x: number, y: number) => number;
}

interface PqNode {
  x: number;
  y: number;
  fScore: number;
}

/**
 * Min-heap simple (priority queue) ordenado por fScore.
 * Operaciones O(log n).
 */
class MinHeap<T extends { fScore: number }> {
  private items: T[] = [];

  size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.items[idx].fScore < this.items[parent].fScore) {
        [this.items[idx], this.items[parent]] = [this.items[parent], this.items[idx]];
        idx = parent;
      } else break;
    }
  }

  private bubbleDown(idx: number): void {
    const n = this.items.length;
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;
      if (left < n && this.items[left].fScore < this.items[smallest].fScore) smallest = left;
      if (right < n && this.items[right].fScore < this.items[smallest].fScore) smallest = right;
      if (smallest !== idx) {
        [this.items[idx], this.items[smallest]] = [this.items[smallest], this.items[idx]];
        idx = smallest;
      } else break;
    }
  }
}

/**
 * Heurística Manhattan: |Δx| + |Δy|. Admisible para grilla 4-conexa.
 */
function heuristicManhattan(a: GridCell, b: GridCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Heurística Octile: max(|Δx|, |Δy|) + (√2 - 1) × min(|Δx|, |Δy|).
 * Admisible para grilla 8-conexa.
 */
function heuristicOctile(a: GridCell, b: GridCell): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

const DIRECTIONS_4 = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

const DIRECTIONS_8 = [
  ...DIRECTIONS_4,
  { dx: 1, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

/**
 * Algoritmo A* sobre grilla NxM. Encuentra el shortest path desde `start`
 * hasta `goal` evitando celdas con valor === 1 (obstáculos).
 *
 * @param grid Matriz NxM donde grid[y][x] = 0 (libre) ó 1 (obstáculo)
 * @param start Celda de origen
 * @param goal  Celda de destino
 * @param opts  Opciones (diagonales, costos por celda)
 * @returns Array de celdas desde start hasta goal, o null si inalcanzable
 */
export function findPathAStar(
  grid: number[][],
  start: GridCell,
  goal: GridCell,
  opts: AStarOptions = {},
): GridCell[] | null {
  if (!grid || grid.length === 0) return null;
  const rows = grid.length;
  const cols = grid[0].length;

  // Bounds + walkability check
  const inBounds = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows;
  const walkable = (x: number, y: number) =>
    inBounds(x, y) && grid[y][x] !== 1;

  if (!walkable(start.x, start.y) || !walkable(goal.x, goal.y)) {
    return null;
  }
  if (start.x === goal.x && start.y === goal.y) {
    return [{ x: start.x, y: start.y }];
  }

  const directions = opts.allowDiagonals ? DIRECTIONS_8 : DIRECTIONS_4;
  const heuristic = opts.allowDiagonals ? heuristicOctile : heuristicManhattan;
  const cellCost = opts.cellCost ?? (() => 1);

  const key = (x: number, y: number) => `${x},${y}`;

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const startKey = key(start.x, start.y);
  gScore.set(startKey, 0);

  const openSet = new MinHeap<PqNode>();
  openSet.push({ x: start.x, y: start.y, fScore: heuristic(start, goal) });
  const inOpenSet = new Set<string>();
  inOpenSet.add(startKey);

  while (openSet.size() > 0) {
    const current = openSet.pop()!;
    const currentKey = key(current.x, current.y);
    inOpenSet.delete(currentKey);

    if (current.x === goal.x && current.y === goal.y) {
      // Reconstrucción del path
      const path: GridCell[] = [{ x: current.x, y: current.y }];
      let k = currentKey;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k)!;
        const [xs, ys] = k.split(',').map(Number);
        path.unshift({ x: xs, y: ys });
      }
      return path;
    }

    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (!walkable(nx, ny)) continue;

      // Movimiento diagonal: requiere que ambas celdas ortogonales sean
      // también walkable (sin "corner-cutting" — más seguro para evacuación)
      if (opts.allowDiagonals && dir.dx !== 0 && dir.dy !== 0) {
        if (!walkable(current.x + dir.dx, current.y) || !walkable(current.x, current.y + dir.dy)) {
          continue;
        }
      }

      const stepCost =
        opts.allowDiagonals && dir.dx !== 0 && dir.dy !== 0
          ? Math.SQRT2 * cellCost(nx, ny)
          : 1 * cellCost(nx, ny);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + stepCost;
      const neighborKey = key(nx, ny);

      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeG);
        const f = tentativeG + heuristic({ x: nx, y: ny }, goal);
        if (!inOpenSet.has(neighborKey)) {
          openSet.push({ x: nx, y: ny, fScore: f });
          inOpenSet.add(neighborKey);
        }
      }
    }
  }

  // Destino inalcanzable — devolvemos null HONESTAMENTE en lugar de un fake path.
  return null;
}
