import { describe, expect, it } from "vitest";
import { buildKnowledgeSkillTree } from "./skillTreeProjection.js";

const NOW = "2026-08-13T12:00:00.000Z";

const nodes = [
  {
    id: "altura",
    title: "Trabajo en altura",
    description: "Prevención de caídas.",
    connections: ["arnes", "rescate"],
  },
  {
    id: "arnes",
    title: "Arnés de seguridad",
    description: "Uso correcto del arnés.",
    connections: ["altura"],
  },
  {
    id: "rescate",
    title: "Rescate en altura",
    description: "Plan de rescate.",
    connections: ["altura"],
  },
  {
    id: "quimicos",
    title: "Sustancias químicas",
    description: "Control de exposición.",
    connections: [],
  },
] as const;

const edges = [
  { source: "altura", target: "arnes", type: "requires" },
  { source: "altura", target: "rescate", type: "mitigates" },
] as const;

describe("buildKnowledgeSkillTree", () => {
  it("projects typed graph hubs and a completed learning card without gating any safety knowledge", () => {
    const tree = buildKnowledgeSkillTree({
      nodes,
      edges,
      learningCards: [
        {
          id: "card-1",
          topic: "Trabajo-en-altura",
          reviewCount: 2,
          intervalDays: 6,
          nextReviewAt: "2026-08-12T12:00:00.000Z",
        },
      ],
      nowIso: NOW,
    });

    const altura = tree.skills.find((skill) => skill.nodeId === "altura");
    const arnes = tree.skills.find((skill) => skill.nodeId === "arnes");
    const quimicos = tree.skills.find((skill) => skill.nodeId === "quimicos");

    expect(altura).toMatchObject({
      learningState: "review_due",
      available: true,
      isHub: true,
      connectionCount: 2,
      relationTypes: ["mitigates", "requires"],
    });
    expect(arnes).toMatchObject({ available: true, recommended: true });
    expect(quimicos).toMatchObject({
      available: true,
      learningState: "not_started",
    });
    expect(tree.availableCount).toBe(tree.skills.length);
  });

  it("does not infer learning evidence from partial or merely similar topic text", () => {
    const tree = buildKnowledgeSkillTree({
      nodes,
      edges,
      learningCards: [
        {
          id: "card-1",
          topic: "altura",
          reviewCount: 1,
          intervalDays: 1,
          nextReviewAt: "2026-08-14T12:00:00.000Z",
        },
      ],
      nowIso: NOW,
    });

    expect(
      tree.skills.find((skill) => skill.nodeId === "altura"),
    ).toMatchObject({
      learningState: "not_started",
      available: true,
    });
  });

  it("falls back to canonical node connections when typed edges are not available", () => {
    const tree = buildKnowledgeSkillTree({
      nodes,
      edges: [],
      learningCards: [],
      nowIso: NOW,
    });

    expect(
      tree.skills.find((skill) => skill.nodeId === "altura"),
    ).toMatchObject({
      connectionCount: 2,
      relationTypes: [],
      isHub: true,
    });
  });

  it("fails closed on dangling edges and keeps the projection deterministic", () => {
    const input = {
      nodes,
      edges: [
        ...edges,
        { source: "altura", target: "foreign-project-node", type: "requires" },
      ],
      learningCards: [],
      nowIso: NOW,
    };

    expect(buildKnowledgeSkillTree(input)).toEqual(
      buildKnowledgeSkillTree(input),
    );
    expect(
      buildKnowledgeSkillTree(input).skills.some(
        (skill) => skill.nodeId === "foreign-project-node",
      ),
    ).toBe(false);
  });
});
