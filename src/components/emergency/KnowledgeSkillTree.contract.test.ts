import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = () =>
  readFileSync(
    resolve(process.cwd(), "src/components/emergency/KnowledgeSkillTree.tsx"),
    "utf8",
  );

describe("KnowledgeSkillTree safety and scope contract", () => {
  it("uses the privacy-minimized server graph, owner-scoped learning cards and the authorized route", () => {
    const page = source();

    expect(page).toMatch(
      /where\(['"]workerUid['"],\s*['"]==['"],\s*user\?\.uid/,
    );
    expect(page).toMatch(
      /where\(['"]projectId['"],\s*['"]==['"],\s*projectId\s*\?\?\s*['"]__none__['"]\)/,
    );
    expect(page).toMatch(/fetch\(\s*['"]\/api\/zettelkasten\/edges['"]/);
    expect(page).toMatch(/body:\s*JSON\.stringify\(\{\s*projectId\s*\}\)/);
    expect(page).toMatch(/nodes\?:\s*KnowledgeSkillNodeInput\[\]/);
    expect(page).not.toMatch(
      /useFirestoreCollection<[^>]*>\(\s*projectId\s*\?\s*['"]nodes['"]/,
    );
  });

  it("is guidance only: no client writes, certification claims or safety gates", () => {
    const page = source();

    expect(page).toMatch(/No bloquea ninguna\s+acción de seguridad\./);
    expect(page).not.toMatch(
      /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/,
    );
    expect(page).not.toMatch(/if\s*\([^)]*(?:available|learningState)/);
  });
});
