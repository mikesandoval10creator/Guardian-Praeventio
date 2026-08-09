// Vitest gate for scripts/check-convention-guard.cjs — the CLAUDE.md #3/#19
// convention ratchet.
//
// This test IS the CI gate (it runs in the default vitest suite, unlike the
// `.cjs` guard tests which vitest does not discover). If a new endpoint handler
// mutates persistent state without its own awaited audit after the write and
// isn't baselined, the live scan surfaces it here and the "Tests" check goes red.
//
// The guard is CommonJS (invoked from the husky hook), so we pull it in via
// createRequire. Requiring it does NOT run its `main()` — that's gated behind
// `require.main === module`.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const guard = require("../../../scripts/check-convention-guard.cjs") as {
  scan: () => { rule3: string[]; rule19Tracked: string[] };
  scanSource: (source: string, routeId: string) => string[];
  routeName: (f: string) => string;
  listRouteFiles: () => string[];
  TXN_RE: RegExp;
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const baseline = JSON.parse(
  readFileSync(
    path.join(repoRoot, "scripts", "convention-guard-baseline.json"),
    "utf8",
  ),
) as {
  rule3_pending: Record<string, string>;
  rule3_exempt: Record<string, string>;
  rule19_pending: Record<string, string>;
};

describe("convention-guard (CLAUDE.md #3/#19 ratchet)", () => {
  it("discovers the real route files", () => {
    const files = guard.listRouteFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(
      files.every((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
    ).toBe(true);
  });

  it("routeName strips the routes dir + extension", () => {
    const visitors = guard
      .listRouteFiles()
      .find((f) => f.endsWith("visitors.ts"));
    expect(visitors).toBeDefined();
    expect(guard.routeName(visitors!)).toBe("visitors");
  });

  it("detects an unaudited mutating endpoint even when its sibling is audited", () => {
    const source = `
      const router = Router();
      router.post('/audited', async (req, res) => {
        await ref.update({ ok: true });
        await auditServerEvent(req, 'thing.update', 'thing');
        res.json({ ok: true });
      });
      router.post('/missing', async (_req, res) => {
        await ref.set({ unsafe: true });
        res.json({ ok: true });
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([
      "synthetic POST /missing",
    ]);
  });

  it("detects compound Firebase Auth mutator methods", () => {
    const source = `
      router.post('/claims', async (_req, res) => {
        await admin.auth().setCustomUserClaims('uid-1', { role: 'admin' });
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([
      "synthetic POST /claims",
    ]);
  });

  it("requires the handler-owned audit to be awaited and after the mutation", () => {
    const source = `
      const router = Router();
      router.patch('/not-awaited', async (req, res) => {
        await ref.update({ x: 1 });
        auditServerEvent(req, 'thing.update', 'thing');
        res.sendStatus(204);
      });
      router.delete('/too-early', async (req, res) => {
        await auditServerEvent(req, 'thing.delete', 'thing');
        await ref.delete();
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([
      "synthetic DELETE /too-early",
      "synthetic PATCH /not-awaited",
    ]);
  });

  it("does not let an audited sibling branch mask an unaudited mutation", () => {
    const source = `
      router.patch('/branches', async (req, res) => {
        if (req.body.enabled) {
          await enabledRef.update({ enabled: true });
        } else {
          await disabledRef.update({ enabled: false });
          await auditServerEvent(req, 'thing.disable', 'thing');
        }
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([
      "synthetic PATCH /branches",
    ]);
  });

  it("allows one awaited audit after an entire conditional mutation block", () => {
    const source = `
      router.patch('/branches', async (req, res) => {
        if (req.body.enabled) {
          await enabledRef.update({ enabled: true });
        } else {
          await disabledRef.update({ enabled: false });
        }
        await auditServerEvent(req, 'thing.toggle', 'thing');
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([]);
  });

  it("accepts an awaited direct audit_logs write after the business mutation", () => {
    const source = `
      router.post('/direct-audit', async (_req, res) => {
        await ref.create({ x: 1 });
        await db.collection('audit_logs').add({ action: 'thing.create' });
        res.sendStatus(201);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([]);
  });

  it("recognizes an awaited local audit helper owned by the handler", () => {
    const source = `
      async function safeAudit(req) {
        await auditServerEvent(req, 'thing.update', 'thing');
      }
      router.patch('/wrapped-audit', async (req, res) => {
        await ref.update({ x: 1 });
        await safeAudit(req);
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([]);
  });

  it("rejects a fire-and-forget local audit helper call", () => {
    const source = `
      async function safeAudit(req) {
        await auditServerEvent(req, 'thing.update', 'thing');
      }
      router.patch('/wrapped-audit', async (req, res) => {
        await ref.update({ x: 1 });
        safeAudit(req);
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([
      "synthetic PATCH /wrapped-audit",
    ]);
  });

  it("accepts a transactional audit_logs write whose doc ref is an argument", () => {
    const source = `
      router.patch('/transactional-audit', async (_req, res) => {
        await tx.update(entityRef, { x: 1 });
        await tx.set(db.collection('audit_logs').doc(), { action: 'thing.update' });
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([]);
  });

  it("does not mistake an audit_logs ref inside a business payload for an audit write", () => {
    const source = `
      router.patch('/payload-ref', async (_req, res) => {
        await entityRef.set({ auditRef: db.collection('audit_logs').doc() });
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([
      "synthetic PATCH /payload-ref",
    ]);
  });

  it("ignores Express response headers and crypto hash-builder updates", () => {
    const source = `
      router.get('/non-persistent', async (_req, res) => {
        res.set('Cache-Control', 'no-store');
        createHash('sha256').update('payload').digest('hex');
        res.sendStatus(204);
      });
    `;

    expect(guard.scanSource(source, "synthetic")).toEqual([]);
  });

  it("resolves named and wrapped handlers on router.route registrations", () => {
    const namedHandler = `
      const mutate = async (req, res) => {
        await batch.commit();
        res.sendStatus(204);
      };
      router.route('/named').put(verifyAuth, asyncHandler(mutate));
    `;

    expect(guard.scanSource(namedHandler, "synthetic")).toEqual([
      "synthetic PUT /named",
    ]);
  });

  it("resolves local handler factories used by a route", () => {
    const factoryHandler = `
      const manage = (status) => async (_req, res) => {
        await repository.update({ status });
        res.sendStatus(204);
      };
      router.post('/factory', verifyAuth, manage('closed'));
    `;

    expect(guard.scanSource(factoryHandler, "synthetic")).toEqual([
      "synthetic POST /factory",
    ]);
  });

  it("scan() returns a non-empty handler-level audit-missing set, all baselined", () => {
    // Robust against campaign progress: as routes are fixed, scan() and the
    // baseline shrink in lockstep — so we assert the relationship, not names.
    const { rule3 } = guard.scan();
    expect(rule3.length).toBeGreaterThan(0);
    const tracked = new Set([
      ...Object.keys(baseline.rule3_pending),
      ...Object.keys(baseline.rule3_exempt),
    ]);
    expect(rule3.every((r) => tracked.has(r))).toBe(true);
  });

  // ── THE GATE ────────────────────────────────────────────────────────────
  it("every live rule#3 violation is baselined (no new un-tracked violations)", () => {
    const { rule3 } = guard.scan();
    const allowed = new Set([
      ...Object.keys(baseline.rule3_pending),
      ...Object.keys(baseline.rule3_exempt),
    ]);
    const unbaselined = rule3.filter((r) => !allowed.has(r));
    expect(
      unbaselined,
      `New mutating endpoint handler(s) without an awaited audit-after-write. ` +
        `Add await auditServerEvent(...) inside the handler after the write ` +
        `(CLAUDE.md #3), or baseline them with a reason: ${unbaselined.join(", ")}`,
    ).toEqual([]);
  });

  it("baseline.rule3_pending has no stale entries (fixed routes must be removed)", () => {
    const { rule3 } = guard.scan();
    const live = new Set(rule3);
    const stale = Object.keys(baseline.rule3_pending).filter(
      (r) => !live.has(r),
    );
    expect(
      stale,
      `These routes now audit — remove from baseline.rule3_pending: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("baseline.rule3_exempt has no stale entries", () => {
    const { rule3 } = guard.scan();
    const live = new Set(rule3);
    const stale = Object.keys(baseline.rule3_exempt).filter(
      (r) => !live.has(r),
    );
    expect(
      stale,
      `These handler exemptions no longer match — remove them: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
