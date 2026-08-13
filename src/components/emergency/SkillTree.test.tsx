import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = () =>
  readFileSync(
    resolve(process.cwd(), "src/components/emergency/SkillTree.tsx"),
    "utf8",
  );

describe("SkillTree knowledge graph wiring", () => {
  it("renders the read-only project knowledge route without replacing the existing tree", () => {
    const page = source();

    expect(page).toMatch(
      /import\s+\{\s*KnowledgeSkillTree\s*\}\s+from\s+['"]\.\/KnowledgeSkillTree['"]/,
    );
    expect(page).toContain("<KnowledgeSkillTree />");
    expect(page).toContain("const DEFAULT_SKILLS");
  });
});
