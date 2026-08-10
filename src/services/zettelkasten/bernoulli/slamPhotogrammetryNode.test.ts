import { describe, it, expect } from "vitest";
import { generateSlamMeshNode } from "./slamPhotogrammetryNode";

// Ticket 39aaa66d-73fe-8119-9c76-e26f55db154c [P2]:
// "Nodo SLAM declara una malla inexistente (placeholder:true)".
// Un nodo slam-mesh SOLO se emite con malla real validada (hash/URI/formato/
// métricas); sin placeholder:true. Sin malla real -> null (nunca inventar).

const REAL_MESH = {
  meshUri:
    "https://firebasestorage.googleapis.com/v0/b/praeventio.appspot.com/o/meshes%2Fcam-A.glb",
  meshFormat: "glb",
  meshSizeBytes: 4_194_304,
  sha256: "a".repeat(64),
} as const;

describe("generateSlamMeshNode (photogrammetry bridge) — malla real obligatoria", () => {
  it("emite nodo cuando hay malla REAL validada y cobertura suficiente", () => {
    const node = generateSlamMeshNode(
      { id: "cam-A", keyframeCount: 120, coveragePercent: 85 },
      { id: "proj-Z" },
      REAL_MESH,
    );
    expect(node).not.toBeNull();
    // NUNCA placeholder: la malla existe de verdad.
    expect(node?.metadata.placeholder).toBeUndefined();
    // metadata expone la malla real verificable.
    expect(node?.metadata.meshUri).toBe(REAL_MESH.meshUri);
    expect(node?.metadata.meshFormat).toBe("glb");
    expect(node?.metadata.meshSizeBytes).toBe(REAL_MESH.meshSizeBytes);
    expect(node?.metadata.sha256).toBe(REAL_MESH.sha256);
    expect(node?.metadata.keyframeCount).toBe(120);
    expect(node?.metadata.coveragePercent).toBe(85);
  });

  it("NO emite nodo sin malla real (null, sin placeholder) incluso con keyframes/coverage altos", () => {
    const node = generateSlamMeshNode(
      { id: "cam-B", keyframeCount: 500, coveragePercent: 99 },
      { id: "proj-Y" },
      // @ts-expect-error — mesh es obligatorio; sin malla no hay nodo.
      undefined,
    );
    expect(node).toBeNull();
  });

  it("NO emite nodo con meshUri vacío o ausente (no afirmar malla inexistente)", () => {
    const node = generateSlamMeshNode(
      { id: "cam-C", keyframeCount: 120, coveragePercent: 85 },
      { id: "proj-X" },
      { meshUri: "", meshFormat: "glb", meshSizeBytes: 100 },
    );
    expect(node).toBeNull();
  });

  it("emite nodo sin coveragePercent cuando el pipeline no lo reporta (no fabrica valores)", () => {
    const node = generateSlamMeshNode(
      { id: "cam-E", keyframeCount: 120 },
      { id: "proj-V" },
      REAL_MESH,
    );
    expect(node).not.toBeNull();
    expect(node?.metadata.coveragePercent).toBeUndefined();
    expect(node?.metadata.meshUri).toBe(REAL_MESH.meshUri);
  });

  it("returns null when capture is too sparse for usable mesh", () => {
    const node = generateSlamMeshNode(
      { id: "cam-D", keyframeCount: 5, coveragePercent: 90 },
      { id: "proj-W" },
      REAL_MESH,
    );
    expect(node).toBeNull();
  });
});
