import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = () =>
  readFileSync(
    resolve(process.cwd(), "src/pages/DigitalTwinFaena.tsx"),
    "utf8",
  );

describe("Digital Twin Gaussian Splat wiring contract", () => {
  it("deriva tenant del claim firmado y entrega una captura reactiva al visor", () => {
    const source = page();

    expect(source).toMatch(
      /import\s+\{\s*useTenantId\s*\}\s+from\s+["']\.\.\/hooks\/useTenantId["']/,
    );
    expect(source).toMatch(
      /subscribePreferredSplatCapture\(\s*tenantId\s*\?\?\s*["']{2}\s*,\s*projectId\s*\?\?\s*["']{2}/,
    );
    expect(source).toMatch(
      /const projectId = selectedProject\?\.id;[\s\S]*?setPreferredSplatCapture\(null\);[\s\S]*?const unsub = subscribePreferredSplatCapture/,
    );
    const guardOffset = source.indexOf("<TwinAccessGuard");
    const viewerOffset = source.indexOf(
      "<GaussianSplatViewer capture={preferredSplatCapture}",
    );
    expect(guardOffset).toBeGreaterThanOrEqual(0);
    expect(viewerOffset).toBeGreaterThan(guardOffset);
    expect(source).not.toMatch(/<GaussianSplatViewer\s+capture=\{null\}/);
  });

  it("no introduce proveedores ArtCraft/remotos en la ruta de captura local", () => {
    const source = page();

    expect(source).not.toMatch(/ArtCraft|Hunyuan|WorldLabs|Meshy|Tripo/i);
  });
});
