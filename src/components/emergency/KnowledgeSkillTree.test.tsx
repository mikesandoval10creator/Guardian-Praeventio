// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { KnowledgeSkillTree } from "./KnowledgeSkillTree.js";

vi.mock("../../contexts/FirebaseContext", () => ({
  useFirebase: () => ({ user: { uid: "worker-1" } }),
}));
vi.mock("../../contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProject: { id: "project-1" } }),
}));
vi.mock("../../lib/apiAuth", () => ({
  apiAuthHeaders: vi.fn(async () => ({})),
}));
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      nodes: [
        {
          id: "altura",
          title: "Trabajo en altura",
          description: "Prevención de caídas.",
          connections: ["arnes"],
        },
        {
          id: "arnes",
          title: "Arnés de seguridad",
          description: "Uso correcto del arnés.",
          connections: ["altura"],
        },
        {
          id: "incompleto",
          title: undefined,
          description: "No debe romper la ruta.",
          connections: [],
        },
      ],
      edges: [{ source: "altura", target: "arnes", type: "requires" }],
    }),
  })),
);

vi.mock("../../hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: () => ({
    data: [
      {
        id: "card-1",
        topic: "Trabajo-en-altura",
        reviewCount: 1,
        intervalDays: 1,
        nextReviewAt: "2000-01-01T00:00:00.000Z",
      },
    ],
  }),
}));

describe("<KnowledgeSkillTree />", () => {
  it("renders the active-project graph as available guidance and ignores incomplete rows", async () => {
    render(<KnowledgeSkillTree />);

    await waitFor(() =>
      expect(screen.getByText("Trabajo en altura")).toBeInTheDocument(),
    );
    expect(screen.getByText("Arnés de seguridad")).toBeInTheDocument();
    expect(screen.getByText("Repaso pendiente")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_content, element) =>
          element?.tagName === "SPAN" &&
          element.textContent?.includes("requires") === true,
      ),
    ).toHaveLength(2);
    expect(screen.getAllByText("Disponible")).toHaveLength(1);
    expect(
      screen.queryByText("No debe romper la ruta."),
    ).not.toBeInTheDocument();
  });
});
