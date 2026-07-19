#!/usr/bin/env node
// Prevent machine-facing failures from crossing into visible React UI.
//
// Technical errors remain legal in hooks, services, logs, outboxes and thrown
// exceptions. This guard targets only presentation sinks: JSX children and
// state/toast calls that receive a caught `.message`, `String(error)`, or a
// visible HTTP-status template without passing through src/lib/humanError.ts.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..');
const UI_ROOTS = ['src/pages', 'src/components', 'src/contexts', 'src/hooks'];
const HUMANIZERS = new Set([
  'humanErrorMessage',
  'humanErrorFromBody',
  'humanErrorFromResponse',
]);

function fileKey(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

function listUiFiles() {
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') visit(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec|stories)\.(ts|tsx)$/.test(entry.name)) continue;
      files.push(full);
    }
  };
  for (const root of UI_ROOTS) visit(path.join(REPO_ROOT, root));
  return files.sort();
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

function isHumanizerCall(node) {
  return ts.isCallExpression(node) && HUMANIZERS.has(calleeName(node.expression));
}

function isErrorLikeName(name) {
  return /(?:^|[A-Z_])(?:error|err)(?:Message|Msg)?$/i.test(name) ||
    /^(?:load|submit|server|feed|parse|accept|claims?|resend)?Error(?:Message|Msg)?$/i.test(name);
}

function expressionContainsRawError(node) {
  if (!node) return false;
  if (isHumanizerCall(node)) return false;
  if (ts.isParenthesizedExpression(node)) {
    return expressionContainsRawError(node.expression);
  }
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return expressionContainsRawError(node.expression);
  }
  if (ts.isIdentifier(node)) return isErrorLikeName(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === 'message' && expressionContainsRawError(node.expression);
  }
  if (ts.isElementAccessExpression(node)) {
    return expressionContainsRawError(node.expression);
  }
  if (ts.isConditionalExpression(node)) {
    return expressionContainsRawError(node.whenTrue) ||
      expressionContainsRawError(node.whenFalse);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionContainsRawError(node.right);
    }
    return expressionContainsRawError(node.left) ||
      expressionContainsRawError(node.right);
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.some((span) => expressionContainsRawError(span.expression));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) =>
      ts.isPropertyAssignment(property) &&
      expressionContainsRawError(property.initializer),
    );
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    if (name === 'String') return node.arguments.some(expressionContainsRawError);
    if (/^(?:t|tr)$/.test(name)) {
      return node.arguments.some(expressionContainsRawError);
    }
  }
  return false;
}

function containsRawCaughtMessage(node) {
  let unsafe = false;
  const visit = (child) => {
    if (unsafe || isHumanizerCall(child)) return;
    if (
      ts.isPropertyAccessExpression(child) &&
      child.name.text === 'message' &&
      expressionContainsRawError(child.expression)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isCallExpression(child) &&
      calleeName(child.expression) === 'String' &&
      child.arguments.some(expressionContainsRawError)
    ) {
      unsafe = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return unsafe;
}

function containsVisibleMachineStatus(node, sourceFile) {
  const text = node.getText(sourceFile);
  return /(?:Error|HTTP|http_|error_)[^\n]{0,50}(?:response|res)\.status/i.test(text) ||
    /(?:http_|error_)\$?\{?[^\n]{0,20}status/i.test(text);
}

function isVisibleStateCall(node) {
  if (!ts.isCallExpression(node)) return false;

  if (ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    return (
      /^set[A-Z]/.test(name) ||
      /^(?:showToast|enqueueSnackbar|notify)$/.test(name)
    );
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    const owner = node.expression.expression.getText();
    const method = node.expression.name.text;
    return (
      /^(?:toast|notify|notifications)$/i.test(owner) &&
      /^(?:error|warning|warn)$/.test(method)
    );
  }

  return false;
}

function isDirectNotificationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) {
    return /^(?:showToast|enqueueSnackbar|notify)$/.test(node.expression.text);
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = node.expression.expression.getText();
  return /^(?:toast|notify|notifications)$/i.test(owner);
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return '';
}

function isBareErrorObject(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) && /^(?:err|error)$/i.test(current.text);
}

function visibleStateContainsRaw(node, sourceFile) {
  if (!node || isHumanizerCall(node)) return false;
  if (ts.isParenthesizedExpression(node)) {
    return visibleStateContainsRaw(node.expression, sourceFile);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return !ts.isBlock(node.body) && visibleStateContainsRaw(node.body, sourceFile);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (!ts.isPropertyAssignment(property)) return false;
      const name = propertyName(property.name);
      if (ts.isComputedPropertyName(property.name)) {
        return expressionContainsRawError(property.initializer);
      }
      if (/(?:error|err|message|msg|title)$/i.test(name)) {
        if (/^(?:error|err)$/i.test(name) && isBareErrorObject(property.initializer)) {
          return false;
        }
        return (
          expressionContainsRawError(property.initializer) ||
          containsVisibleMachineStatus(property.initializer, sourceFile)
        );
      }
      return visibleStateContainsRaw(property.initializer, sourceFile);
    });
  }
  // Keep a bare Error object typed in state. The JSX rule guards the point
  // where it could become text. Derived strings still need humanization here.
  if (isBareErrorObject(node)) return false;
  return expressionContainsRawError(node);
}

function scanSource(source, key = 'inline.tsx') {
  const sourceFile = ts.createSourceFile(
    key,
    source,
    ts.ScriptTarget.Latest,
    true,
    key.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const seen = new Set();

  const add = (node, kind) => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const line = position.line + 1;
    const id = `${line}:${kind}:${node.getStart(sourceFile)}`;
    if (seen.has(id)) return;
    seen.add(id);
    violations.push({
      file: key,
      line,
      kind,
      excerpt: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 180),
    });
  };

  const visit = (node) => {
    if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      node.expression
    ) {
      if (expressionContainsRawError(node.expression)) {
        add(node, 'raw-jsx-error');
      } else if (containsVisibleMachineStatus(node.expression, sourceFile)) {
        add(node, 'visible-machine-status');
      }
    }

    if (isVisibleStateCall(node)) {
      for (const argument of node.arguments) {
        if (isHumanizerCall(argument)) continue;
        if (containsVisibleMachineStatus(argument, sourceFile)) {
          add(argument, 'visible-machine-status');
        } else if (
          isDirectNotificationCall(node)
            ? expressionContainsRawError(argument)
            : visibleStateContainsRaw(argument, sourceFile)
        ) {
          add(argument, 'raw-error-state');
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function scan(files = listUiFiles()) {
  return files.flatMap((file) =>
    scanSource(fs.readFileSync(file, 'utf8'), fileKey(file)),
  );
}

function main() {
  const violations = scan();
  if (violations.length > 0) {
    console.error(
      `[user-facing-errors] FAIL — ${violations.length} raw user-visible error sink(s):`,
    );
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line} ${violation.kind} ${violation.excerpt}`,
      );
    }
    process.exit(1);
  }
  console.log('[user-facing-errors] PASS — 0 raw user-visible error sink(s).');
}

module.exports = { scanSource, scan, listUiFiles, fileKey };

if (require.main === module) main();
