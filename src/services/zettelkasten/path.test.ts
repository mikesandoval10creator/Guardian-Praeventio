import { describe, expect, it } from "vitest";
import {
  neighbors,
  findShortestPath,
  findPathToAny,
  reachableWithin,
} from "./path.js";
import type { ZkEdge } from "./edges.js";

interface TestNode {
  id: string;
  label?: string;
}

const A: TestNode = { id: "A" };
const B: TestNode = { id: "B" };
const C: TestNode = { id: "C" };
const D: TestNode = { id: "D" };
const E: TestNode = { id: "E" };
const F: TestNode = { id: "F" };

const e = (from: string, to: string, type: ZkEdge["type"] = "regulates"): ZkEdge => ({
  id: `${from}->${to}`,
  fromNodeId: from,
  toNodeId: to,
  type,
  inverseType: "regulated_by",
  createdAt: "2026-01-01T00:00:00Z",
  createdBy: "test",
  tenantId: "t1",
});

describe("neighbors", () => {
  it("retorna solo aristas salientes cuyo target existe en el set de nodos", () => {
    const edges = [e("A", "B"), e("A", "C"), e("B", "D"), e("A", "ghost")];
    const n = neighbors([A, B, C, D], edges, "A");
    expect(n).toEqual(new Set(["B", "C"]));
  });

  it("ignora aristas que NO son outgoing de nodeId", () => {
    const edges = [e("B", "A"), e("A", "B")];
    const n = neighbors([A, B], edges, "A");
    expect(n).toEqual(new Set(["B"]));
  });
});

describe("findShortestPath", () => {
  it("retorna null si fromId y toId no están en el set de nodos", () => {
    const edges = [e("A", "B")];
    const result = findShortestPath([A, B], edges, "ghost", "A");
    expect(result).toBeNull();
  });

  it("retorna [fromId] cuando fromId === toId", () => {
    expect(findShortestPath([A], [], "A", "A")).toEqual(["A"]);
  });

  it("retorna null cuando no hay conexión", () => {
    const result = findShortestPath([A, B, C], [e("A", "B"), e("C", "D")], "A", "D");
    expect(result).toBeNull();
  });

  it("encuentra el camino corto A->B->C->D (3 hops) vs A->E->D (2 hops)", () => {
    // Aquí el camino corto es A->E->D (2 hops) por construcción: el test
    // verifica que BFS respeta la distancia de hops, no el orden del array.
    const edges = [e("A", "B"), e("B", "C"), e("C", "D"), e("A", "E"), e("E", "D")];
    expect(findShortestPath([A, B, C, D, E], edges, "A", "D")).toEqual(["A", "E", "D"]);
  });

  it("prefiere el camino más corto aunque exista otro más largo", () => {
    // A->B->C->D son 3 hops; A->X->Y->Z->D son 4 hops. BFS elige el corto.
    const X: TestNode = { id: "X" };
    const Y: TestNode = { id: "Y" };
    const Z: TestNode = { id: "Z" };
    const edges = [
      e("A", "B"),
      e("B", "C"),
      e("C", "D"),
      e("A", "X"),
      e("X", "Y"),
      e("Y", "Z"),
      e("Z", "D"),
    ];
    expect(findShortestPath([A, B, C, D, X, Y, Z], edges, "A", "D")).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("ignora aristas cuyo target NO está en el set de nodos", () => {
    const edges = [e("A", "B"), e("B", "ghost"), e("ghost", "C")];
    // B sólo conecta a ghost; no hay forma de llegar a C dentro del set.
    expect(findShortestPath([A, B, C], edges, "A", "C")).toBeNull();
  });
});

describe("findPathToAny", () => {
  it("retorna null si targetIds está vacío", () => {
    expect(findPathToAny([A], [], "A", new Set())).toBeNull();
  });

  it("retorna el target mismo si fromId está en targetIds", () => {
    const result = findPathToAny([A, B], [], "A", new Set(["A", "B"]));
    expect(result).toEqual({ target: "A", path: ["A"] });
  });

  it("encuentra el primer target alcanzable en orden BFS", () => {
    const edges = [e("A", "B"), e("B", "C"), e("C", "D"), e("D", "E")];
    const result = findPathToAny([A, B, C, D, E], edges, "A", new Set(["C", "E"]));
    expect(result?.target).toBe("C");
    expect(result?.path).toEqual(["A", "B", "C"]);
  });

  it("retorna null si ningún target es alcanzable", () => {
    const edges = [e("A", "B")];
    const result = findPathToAny([A, B], edges, "A", new Set(["Z", "W"]));
    expect(result).toBeNull();
  });
});

describe("reachableWithin", () => {
  it("devuelve solo el nodo inicial cuando maxDepth = 0", () => {
    const edges = [e("A", "B"), e("B", "C")];
    expect(reachableWithin([A, B, C], edges, "A", 0)).toEqual(new Set(["A"]));
  });

  it("expande hasta la profundidad solicitada", () => {
    const edges = [e("A", "B"), e("B", "C"), e("C", "D")];
    expect(reachableWithin([A, B, C, D], edges, "A", 1)).toEqual(new Set(["A", "B"]));
    expect(reachableWithin([A, B, C, D], edges, "A", 2)).toEqual(new Set(["A", "B", "C"]));
    expect(reachableWithin([A, B, C, D], edges, "A", 5)).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("termina antes si el frontier se agota", () => {
    const edges = [e("A", "B")];
    expect(reachableWithin([A, B], edges, "A", 10)).toEqual(new Set(["A", "B"]));
  });
});
