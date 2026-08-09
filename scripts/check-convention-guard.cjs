#!/usr/bin/env node
// scripts/check-convention-guard.cjs
//
// Enforces two CLAUDE.md hard conventions across `src/server/routes/*`:
//   • Rule #3  — every state-changing op MUST write to `audit_logs`
//                (via `auditServerEvent` or a direct `audit_logs` write).
//   • Rule #19 — a read-modify-write on the same doc MUST use `runTransaction`.
//
// Ratchet philosophy (mirrors `check-coverage-ratchet.cjs`): the set of KNOWN
// endpoint-level violations lives in `scripts/convention-guard-baseline.json`
// and can only SHRINK. A NEW mutating handler without its own awaited audit
// after the write fails the gate — an audit in a sibling endpoint cannot mask it.
//
// Scope of confidence:
//   • Rule #3 is a HARD HANDLER-LEVEL GATE. TypeScript AST parsing identifies
//     Express route callbacks, including local named/wrapped/factory handlers,
//     then checks direct mutation signatures independently per endpoint.
//   • The mutation method set is intentionally coarse. Confirmed non-persistent
//     calls and derived/infra writes stay explicit in `rule3_exempt`; genuine
//     legacy gaps stay in `rule3_pending`, so both sets are visible and ratchet.
//   • Rule #19 is a TRACKED CHECKLIST, not an auto-detector — proving a
//     same-doc read-modify-write needs dataflow/AST analysis. The baseline
//     carries the human-verified pending list; the guard confirms each one once
//     it gains `runTransaction` and nudges you to clear it.
//
// Report-only when the baseline file is absent (so it can be seeded first),
// exactly like the coverage ratchet.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..");
const ROUTES_DIR = path.join(REPO_ROOT, "src", "server", "routes");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "convention-guard-baseline.json",
);

const TXN_RE = /runTransaction/;
const HTTP_METHODS = new Set(["delete", "get", "patch", "post", "put"]);
const MUTATION_METHODS = new Set([
  "add",
  "commit",
  "create",
  "createUser",
  "delete",
  "deleteUser",
  "revokeRefreshTokens",
  "save",
  "set",
  "setCustomUserClaims",
  "update",
  "updateUser",
]);

function listRouteFiles(dir = ROUTES_DIR) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listRouteFiles(full));
      continue;
    }
    if (!ent.name.endsWith(".ts")) continue;
    if (ent.name.endsWith(".test.ts") || ent.name.endsWith(".spec.ts"))
      continue;
    out.push(full);
  }
  return out;
}

/** repo-relative route id without extension, e.g. `b2d/suite`, `visitors`. */
function routeName(file) {
  return path
    .relative(ROUTES_DIR, file)
    .replace(/\\/g, "/")
    .replace(/\.ts$/, "");
}

function propertyName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function literalRoutePath(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return "<dynamic>";
}

function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

function buildLocalHandlerMap(sourceFile) {
  const handlers = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      handlers.set(node.name.text, node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer && isFunctionLike(node.initializer)) {
        handlers.set(node.name.text, node.initializer);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return handlers;
}

function returnedHandler(factory) {
  if (ts.isArrowFunction(factory) && isFunctionLike(factory.body)) {
    return factory.body;
  }
  if (!factory.body || !ts.isBlock(factory.body)) return null;
  for (const statement of factory.body.statements) {
    if (
      ts.isReturnStatement(statement) &&
      statement.expression &&
      isFunctionLike(statement.expression)
    ) {
      return statement.expression;
    }
  }
  return null;
}

function resolveHandler(node, handlers) {
  if (isFunctionLike(node)) return node;
  if (ts.isIdentifier(node)) return handlers.get(node.text) ?? null;
  if (ts.isCallExpression(node)) {
    // Local handler factory: manageStatus('suspended') -> async (req, res) => …
    if (ts.isIdentifier(node.expression)) {
      const factory = handlers.get(node.expression.text);
      if (factory) {
        const returned = returnedHandler(factory);
        if (returned) return returned;
      }
    }
    // Common local wrapper: asyncHandler(async (req, res) => { ... }).
    for (let i = node.arguments.length - 1; i >= 0; i -= 1) {
      const candidate = resolveHandler(node.arguments[i], handlers);
      if (candidate) return candidate;
    }
  }
  return null;
}

function routeRegistration(call, handlers) {
  const method = propertyName(call.expression);
  if (!method || !HTTP_METHODS.has(method.toLowerCase())) return null;

  let pathNode;
  let handlerArgs;
  const receiver = call.expression.expression;
  if (
    ts.isCallExpression(receiver) &&
    propertyName(receiver.expression) === "route"
  ) {
    pathNode = receiver.arguments[0];
    handlerArgs = [...call.arguments];
  } else {
    pathNode = call.arguments[0];
    handlerArgs = [...call.arguments].slice(1);
  }
  if (!pathNode || handlerArgs.length === 0) return null;

  for (let i = handlerArgs.length - 1; i >= 0; i -= 1) {
    const handler = resolveHandler(handlerArgs[i], handlers);
    if (handler) {
      return {
        method: method.toUpperCase(),
        path: literalRoutePath(pathNode),
        handler,
      };
    }
  }
  return null;
}

function isInsideAwait(node, handler) {
  for (let cur = node.parent; cur && cur !== handler; cur = cur.parent) {
    if (ts.isAwaitExpression(cur)) return true;
  }
  return false;
}

function isDirectAuditLogMutation(call) {
  if (!MUTATION_METHODS.has(propertyName(call.expression) ?? "")) return false;
  let found = false;
  function visit(node) {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      propertyName(node.expression) === "collection" &&
      node.arguments[0] &&
      literalRoutePath(node.arguments[0]) === "audit_logs"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  // Inspect the receiver and the first argument. Transactional writes commonly
  // use `tx.set(db.collection('audit_logs').doc(), row)`, where the canonical
  // collection is the target argument rather than the mutation receiver. Do
  // not inspect payload arguments: merely storing an audit-log ref elsewhere
  // must not make a business mutation look audited.
  visit(call.expression);
  if (
    !found &&
    call.arguments[0] &&
    ts.isPropertyAccessExpression(call.expression)
  ) {
    const receiver = call.expression.expression.getText();
    if (/(?:^|\.)(?:tx|txn|transaction|batch)$/.test(receiver)) {
      visit(call.arguments[0]);
    }
  }
  return found;
}

function isKnownNonPersistentMutation(call, sourceFile) {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const receiver = call.expression.expression.getText(sourceFile);
  // Express response headers and Node crypto hash builders use `.set`/`.update`
  // but do not mutate application persistence.
  return (
    /^(?:res|response)(?:$|\.|\[)/.test(receiver) ||
    /\bcreate(?:Hash|Hmac)\s*\(/.test(receiver)
  );
}

function controlContexts(node, handler) {
  const contexts = new Set();
  let child = node;
  for (
    let parent = node.parent;
    parent && parent !== handler;
    parent = parent.parent
  ) {
    if (ts.isIfStatement(parent)) {
      if (child === parent.thenStatement) contexts.add(`if:${parent.pos}:then`);
      if (child === parent.elseStatement) contexts.add(`if:${parent.pos}:else`);
    } else if (ts.isConditionalExpression(parent)) {
      if (child === parent.whenTrue) contexts.add(`cond:${parent.pos}:true`);
      if (child === parent.whenFalse) contexts.add(`cond:${parent.pos}:false`);
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      contexts.add(`switch:${parent.parent.parent.pos}:clause:${parent.pos}`);
    }
    child = parent;
  }
  return contexts;
}

function auditCanCoverMutation(audit, mutation) {
  if (audit.position <= mutation.position) return false;
  // An audit may be less conditional than the mutation (e.g. after an entire
  // if/else), but never more conditional. This prevents an audit in one sibling
  // branch from masking an unaudited mutation in the other branch.
  return [...audit.contexts].every((context) => mutation.contexts.has(context));
}

function buildAuditHelperNames(handlers) {
  const auditHelpers = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, fn] of handlers) {
      if (auditHelpers.has(name) || !fn.body) continue;
      let ownsAwaitedAudit = false;
      function visit(node) {
        if (ownsAwaitedAudit) return;
        if (ts.isCallExpression(node)) {
          const callName = propertyName(node.expression);
          if (
            isInsideAwait(node, fn) &&
            (callName === "auditServerEvent" ||
              auditHelpers.has(callName) ||
              isDirectAuditLogMutation(node))
          ) {
            ownsAwaitedAudit = true;
            return;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(fn.body);
      if (ownsAwaitedAudit) {
        auditHelpers.add(name);
        changed = true;
      }
    }
  }
  return auditHelpers;
}

function inspectHandler(handler, sourceFile, auditHelpers) {
  const mutations = [];
  const awaitedAudits = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = propertyName(node.expression);
      const directAudit = isDirectAuditLogMutation(node);
      if (directAudit && isInsideAwait(node, handler)) {
        awaitedAudits.push({
          position: node.getStart(sourceFile),
          contexts: controlContexts(node, handler),
        });
      } else if (
        (name === "auditServerEvent" || auditHelpers.has(name)) &&
        isInsideAwait(node, handler)
      ) {
        awaitedAudits.push({
          position: node.getStart(sourceFile),
          contexts: controlContexts(node, handler),
        });
      } else if (
        name &&
        MUTATION_METHODS.has(name) &&
        !isKnownNonPersistentMutation(node, sourceFile)
      ) {
        mutations.push({
          position: node.getStart(sourceFile),
          contexts: controlContexts(node, handler),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  if (handler.body) visit(handler.body);
  if (mutations.length === 0)
    return { mutates: false, auditedAfterWrite: false };
  return {
    mutates: true,
    auditedAfterWrite: mutations.every((mutation) =>
      awaitedAudits.some((audit) => auditCanCoverMutation(audit, mutation)),
    ),
  };
}

/**
 * Scan one route module at endpoint/handler level.
 *
 * A sibling handler's audit cannot mask an unaudited writer. Every direct
 * mutation must be followed by an awaited audit in a compatible control-flow
 * context; an audit in one if/else branch cannot cover its sibling branch.
 */
function scanSource(source, routeId = "<source>") {
  const sourceFile = ts.createSourceFile(
    `${routeId}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const handlers = buildLocalHandlerMap(sourceFile);
  const auditHelpers = buildAuditHelperNames(handlers);
  const violations = [];
  const occurrences = new Map();

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const registration = routeRegistration(node, handlers);
      if (registration) {
        const result = inspectHandler(
          registration.handler,
          sourceFile,
          auditHelpers,
        );
        if (result.mutates && !result.auditedAfterWrite) {
          const base = `${routeId} ${registration.method} ${registration.path}`;
          const occurrence = (occurrences.get(base) ?? 0) + 1;
          occurrences.set(base, occurrence);
          violations.push(occurrence === 1 ? base : `${base} #${occurrence}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations.sort();
}

/** Scan all route files; return the live violation sets. */
function scan(files = listRouteFiles()) {
  const rule3 = [];
  const rule19Tracked = []; // routes that still have NO runTransaction at all
  for (const f of files) {
    const c = fs.readFileSync(f, "utf8");
    const name = routeName(f);
    rule3.push(...scanSource(c, name));
    if (!TXN_RE.test(c)) rule19Tracked.push(name);
  }
  return { rule3: rule3.sort(), rule19Tracked };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch (err) {
    console.error(
      `[convention-guard] Could not parse baseline: ${err.message}`,
    );
    process.exit(2);
  }
  return null;
}

function main() {
  const { rule3, rule19Tracked } = scan();
  const rule19Set = new Set(rule19Tracked);
  const baseline = loadBaseline();

  if (!baseline) {
    console.log("[convention-guard] REPORT-ONLY (no baseline yet)\n");
    console.log(
      `rule #3 — mutating endpoint handlers WITHOUT awaited audit-after-write (${rule3.length}):`,
    );
    rule3.forEach((r) => console.log("  " + r));
    console.log(
      "\nSeed scripts/convention-guard-baseline.json (rule3_pending / rule3_exempt /" +
        " rule19_pending) to activate the gate.",
    );
    process.exit(0);
  }

  const exempt3 = new Set(Object.keys(baseline.rule3_exempt || {}));
  const pending3 = new Set(Object.keys(baseline.rule3_pending || {}));
  const allowed3 = new Set([...exempt3, ...pending3]);
  const pending19 = Object.keys(baseline.rule19_pending || {});

  let failures = 0;

  // ── HARD GATE: rule #3 new violations ──────────────────────────────────
  const new3 = rule3.filter((r) => !allowed3.has(r));
  if (new3.length) {
    failures += new3.length;
    console.error(
      "\n[convention-guard] FAIL rule #3 — new mutating endpoint handler(s)" +
        " without an awaited audit-after-write:",
    );
    new3.forEach((r) =>
      console.error(
        `  ${r}  → await auditServerEvent(...) in this handler after the write` +
          " (CLAUDE.md #3)," +
          " or classify it in baseline.rule3_pending/rule3_exempt with a reason",
      ),
    );
  }

  // ── Ratchet cleanup notices (non-fatal) ────────────────────────────────
  const fixed3 = [...pending3].filter((r) => !rule3.includes(r));
  if (fixed3.length) {
    console.log(
      "\n[convention-guard] ✅ rule #3 handler now audited — remove from" +
        " baseline.rule3_pending:",
    );
    fixed3.forEach((r) => console.log("  " + r));
  }
  const staleExempt3 = [...exempt3].filter((r) => !rule3.includes(r));
  if (staleExempt3.length) {
    console.log(
      "\n[convention-guard] ✅ rule #3 exemption no longer matches — remove" +
        " from baseline.rule3_exempt:",
    );
    staleExempt3.forEach((r) => console.log("  " + r));
  }

  // ── Rule #19 tracker: confirm each pending route gained a transaction ──
  const fixed19 = pending19.filter((r) => !rule19Set.has(r));
  if (fixed19.length) {
    console.log(
      "\n[convention-guard] ✅ rule #19 now uses runTransaction — verify the" +
        " read-modify-write is wrapped, then remove from baseline.rule19_pending:",
    );
    fixed19.forEach((r) => console.log("  " + r));
  }

  console.log("");
  if (failures) {
    console.error(`[convention-guard] FAIL: ${failures} new violation(s).`);
    process.exit(1);
  }
  console.log(
    `[convention-guard] PASS — rule #3 gate held (${pending3.size} pending, ` +
      `${exempt3.size} exempt); rule #19 pending: ${pending19.length}.`,
  );
  process.exit(0);
}

module.exports = {
  listRouteFiles,
  routeName,
  scan,
  scanSource,
  TXN_RE,
};

if (require.main === module) main();
