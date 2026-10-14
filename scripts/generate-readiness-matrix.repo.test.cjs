const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

for (const mode of ["absolute", "relative"]) {
  test(`CLI selects the requested ${mode} repository from another directory`, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-repo-"));
    try {
      const repo = path.join(scratch, "selected repo=fixture");
      const launchDirectory = path.join(scratch, "launch");
      fs.mkdirSync(path.join(repo, "src"), { recursive: true });
      fs.mkdirSync(path.join(launchDirectory, "src"), { recursive: true });
      fs.writeFileSync(path.join(repo, "src/AppRoutes.tsx"), '<Route path="/selected" />');
      fs.writeFileSync(path.join(launchDirectory, "src/AppRoutes.tsx"), '<Route path="/wrong" />');
      const jsonPath = path.join(scratch, "matrix.json");
      const selector = mode === "absolute" ? repo : path.relative(launchDirectory, repo);
      const result = spawnSync(process.execPath, [
        path.join(__dirname, "generate-readiness-matrix.cjs"),
        `--repo=${selector}`,
        `--output=${path.join(scratch, "matrix.md")}`,
        `--json=${jsonPath}`,
      ], { cwd: launchDirectory, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const records = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      assert.deepEqual(
        records.filter((record) => record.kind === "route").map((record) => record.surface),
        ["/selected"],
        "the selector must preserve spaces and equals signs and override the working directory",
      );
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}
