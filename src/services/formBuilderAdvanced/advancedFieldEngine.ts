// Praeventio Guard — Sprint 53 §263-268: Form Builder ADVANCED fields.
//
// Extiende `checklistBuilder` (Sprint 49 §261-270) con:
//   • computed fields con fórmula declarativa
//   • aggregate_section / sum / avg / countTrue sobre múltiples fields
//   • cross-field validation (predicados entre fields)
//   • topological sort + ciclo-detection sobre dependencias
//   • date helpers: now(), today(), yearsBetween(), monthsBetween(), date_diff
//
// 100% determinístico — sin `eval`, sin `new Function`, sin I/O, sin red.
// El evaluator es un parser recursive-descent sobre un sub-lenguaje cerrado.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type AdvancedFieldKind =
  | 'computed'
  | 'aggregate_section'
  | 'matrix_grid'
  | 'lookup_table'
  | 'cross_field_validation'
  | 'conditional_required'
  | 'auto_calculated_age'
  | 'date_diff';

export type ComputedResultKind = 'number' | 'string' | 'boolean' | 'date';

export interface ComputedFieldFormula {
  /** ID del field destino que recibe el resultado. */
  fieldId: string;
  /** Expresión declarativa — ver soporte abajo. */
  expression: string;
  /** Field IDs referenciados — usado por el sorter para resolver orden. */
  dependencies: string[];
  /** Tipo del resultado esperado. Si no coincide → null. */
  resultKind: ComputedResultKind;
}

export interface CrossFieldValidationRule {
  ruleId: string;
  /** Field IDs que se validan juntos. */
  fields: string[];
  /** Predicado declarativo. Debe evaluar a boolean. */
  predicate: string;
  errorMessage: string;
}

export interface AdvancedFormResponse {
  fieldId: string;
  value: unknown;
}

export interface CrossFieldValidationFinding {
  ruleId: string;
  passed: boolean;
  errorMessage?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────

export class AdvancedFieldError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'AdvancedFieldError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Lexer / Parser / Evaluator — sub-lenguaje cerrado
//
// Gramática (informal):
//   Expr      = Or
//   Or        = And ( '||' And )*
//   And       = Not ( '&&' Not )*
//   Not       = '!' Not | Compare
//   Compare   = Sum ( ('=='|'!='|'<'|'>'|'<='|'>=') Sum )*
//   Sum       = Mul ( ('+'|'-') Mul )*
//   Mul       = Unary ( ('*'|'/'|'%') Unary )*
//   Unary     = '-' Unary | Primary
//   Primary   = Number | String | Bool | Null
//             | Ident '(' ArgList? ')'        // function call
//             | 'field' '(' String ')'        // explicit field ref
//             | '${' Ident '}'                // template-style field ref
//             | '[' ArgList? ']'              // array literal
//             | '(' Expr ')'
//   ArgList   = Expr ( ',' Expr )*
// ────────────────────────────────────────────────────────────────────────

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'fieldref'; value: string } // ${fieldId}
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'lbracket' }
  | { kind: 'rbracket' }
  | { kind: 'comma' };

const SINGLE_OPS = new Set(['+', '-', '*', '/', '%']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // Number
    if ((ch >= '0' && ch <= '9') || (ch === '.' && input[i + 1] >= '0' && input[i + 1] <= '9')) {
      let j = i;
      let dot = false;
      while (j < n) {
        const c = input[j];
        if (c >= '0' && c <= '9') {
          j++;
        } else if (c === '.' && !dot) {
          dot = true;
          j++;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'num', value: parseFloat(input.slice(i, j)) });
      i = j;
      continue;
    }
    // String literal — single or double quote
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < n && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < n) {
          const next = input[j + 1];
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else value += next;
          j += 2;
        } else {
          value += input[j];
          j++;
        }
      }
      if (j >= n) {
        throw new AdvancedFieldError('parse_unterminated_string', `String sin cerrar en pos ${i}`);
      }
      tokens.push({ kind: 'str', value });
      i = j + 1;
      continue;
    }
    // ${fieldId}
    if (ch === '$' && input[i + 1] === '{') {
      let j = i + 2;
      while (j < n && input[j] !== '}') j++;
      if (j >= n) {
        throw new AdvancedFieldError('parse_unterminated_fieldref', `\${...} sin cerrar en pos ${i}`);
      }
      const id = input.slice(i + 2, j).trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
        throw new AdvancedFieldError('parse_invalid_fieldref', `Field ref inválido: '${id}'`);
      }
      tokens.push({ kind: 'fieldref', value: id });
      i = j + 1;
      continue;
    }
    // Identifier
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let j = i;
      while (j < n && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ kind: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    // Two-char operators
    const two = input.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    // Single-char operators
    if (ch === '<' || ch === '>' || ch === '!') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (SINGLE_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ kind: 'lbracket' });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ kind: 'rbracket' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' });
      i++;
      continue;
    }
    throw new AdvancedFieldError('parse_unexpected_char', `Carácter inesperado '${ch}' en pos ${i}`);
  }
  return tokens;
}

// AST
type Node =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'null' }
  | { type: 'fieldref'; id: string }
  | { type: 'array'; items: Node[] }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'unary'; op: '-' | '!'; arg: Node }
  | { type: 'bin'; op: string; left: Node; right: Node };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parse(): Node {
    const node = this.expr();
    if (this.pos < this.tokens.length) {
      throw new AdvancedFieldError('parse_trailing_tokens', `Tokens sobrantes después de la expresión.`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private consume(): Token | undefined {
    return this.tokens[this.pos++];
  }
  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && t.kind === 'op' && ops.includes(t.value)) {
      this.pos++;
      return t.value;
    }
    return null;
  }

  private expr(): Node {
    return this.or();
  }
  private or(): Node {
    let node = this.and();
    while (this.matchOp('||')) {
      const right = this.and();
      node = { type: 'bin', op: '||', left: node, right };
    }
    return node;
  }
  private and(): Node {
    let node = this.not();
    while (this.matchOp('&&')) {
      const right = this.not();
      node = { type: 'bin', op: '&&', left: node, right };
    }
    return node;
  }
  private not(): Node {
    if (this.matchOp('!')) {
      return { type: 'unary', op: '!', arg: this.not() };
    }
    return this.compare();
  }
  private compare(): Node {
    let node = this.sum();
    const op = this.matchOp('==', '!=', '<', '>', '<=', '>=');
    if (op) {
      const right = this.sum();
      node = { type: 'bin', op, left: node, right };
    }
    return node;
  }
  private sum(): Node {
    let node = this.mul();
    while (true) {
      const op = this.matchOp('+', '-');
      if (!op) break;
      const right = this.mul();
      node = { type: 'bin', op, left: node, right };
    }
    return node;
  }
  private mul(): Node {
    let node = this.unary();
    while (true) {
      const op = this.matchOp('*', '/', '%');
      if (!op) break;
      const right = this.unary();
      node = { type: 'bin', op, left: node, right };
    }
    return node;
  }
  private unary(): Node {
    if (this.matchOp('-')) {
      return { type: 'unary', op: '-', arg: this.unary() };
    }
    return this.primary();
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) {
      throw new AdvancedFieldError('parse_unexpected_eof', 'Fin de expresión inesperado.');
    }
    if (t.kind === 'num') {
      this.consume();
      return { type: 'num', value: t.value };
    }
    if (t.kind === 'str') {
      this.consume();
      return { type: 'str', value: t.value };
    }
    if (t.kind === 'fieldref') {
      this.consume();
      return { type: 'fieldref', id: t.value };
    }
    if (t.kind === 'lbracket') {
      this.consume();
      const items: Node[] = [];
      if (this.peek()?.kind !== 'rbracket') {
        items.push(this.expr());
        while (this.peek()?.kind === 'comma') {
          this.consume();
          items.push(this.expr());
        }
      }
      if (this.peek()?.kind !== 'rbracket') {
        throw new AdvancedFieldError('parse_missing_rbracket', 'Falta ] en array literal.');
      }
      this.consume();
      return { type: 'array', items };
    }
    if (t.kind === 'lparen') {
      this.consume();
      const inner = this.expr();
      if (this.peek()?.kind !== 'rparen') {
        throw new AdvancedFieldError('parse_missing_rparen', 'Falta ).');
      }
      this.consume();
      return inner;
    }
    if (t.kind === 'ident') {
      this.consume();
      const name = t.value;
      // Literals
      if (name === 'true') return { type: 'bool', value: true };
      if (name === 'false') return { type: 'bool', value: false };
      if (name === 'null') return { type: 'null' };
      // Function call
      if (this.peek()?.kind === 'lparen') {
        this.consume();
        const args: Node[] = [];
        if (this.peek()?.kind !== 'rparen') {
          args.push(this.expr());
          while (this.peek()?.kind === 'comma') {
            this.consume();
            args.push(this.expr());
          }
        }
        if (this.peek()?.kind !== 'rparen') {
          throw new AdvancedFieldError('parse_missing_rparen_fn', `Falta ) en llamada a ${name}.`);
        }
        this.consume();
        return { type: 'call', name, args };
      }
      // Bare identifier no permitido — usar ${id} o field('id')
      throw new AdvancedFieldError(
        'parse_bare_identifier',
        `Identificador suelto '${name}' no permitido. Use \${${name}} o field('${name}').`,
      );
    }
    throw new AdvancedFieldError('parse_unexpected_token', `Token inesperado: ${JSON.stringify(t)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Built-in safe functions
// ────────────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    if (typeof item === 'number' && !isNaN(item)) out.push(item);
  }
  return out;
}

function toBoolArray(v: unknown): boolean[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Boolean(x));
}

export interface EvalContext {
  responses: Map<string, unknown>;
  /** Fuente de "ahora" — inyectable para tests deterministas. */
  now: Date;
}

const ALLOWED_FUNCTIONS = new Set([
  'now',
  'today',
  'yearsBetween',
  'monthsBetween',
  'daysBetween',
  'sum',
  'avg',
  'countTrue',
  'min',
  'max',
  'len',
  'field',
  'date',
  'abs',
  'round',
  'floor',
  'ceil',
  'concat',
  'if',
]);

function evalNode(node: Node, ctx: EvalContext): unknown {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'bool':
      return node.value;
    case 'null':
      return null;
    case 'fieldref':
      return ctx.responses.has(node.id) ? ctx.responses.get(node.id) : null;
    case 'array':
      return node.items.map((it) => evalNode(it, ctx));
    case 'unary': {
      const v = evalNode(node.arg, ctx);
      if (node.op === '-') {
        if (typeof v !== 'number') return null;
        return -v;
      }
      // '!'
      return !v;
    }
    case 'bin':
      return evalBin(node, ctx);
    case 'call':
      return evalCall(node, ctx);
  }
}

function evalBin(node: Extract<Node, { type: 'bin' }>, ctx: EvalContext): unknown {
  // Short-circuit for boolean ops
  if (node.op === '&&') {
    const l = evalNode(node.left, ctx);
    if (!l) return l;
    return evalNode(node.right, ctx);
  }
  if (node.op === '||') {
    const l = evalNode(node.left, ctx);
    if (l) return l;
    return evalNode(node.right, ctx);
  }
  const l = evalNode(node.left, ctx);
  const r = evalNode(node.right, ctx);
  switch (node.op) {
    case '+':
      if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      return null;
    case '-':
      if (typeof l === 'number' && typeof r === 'number') return l - r;
      return null;
    case '*':
      if (typeof l === 'number' && typeof r === 'number') return l * r;
      return null;
    case '/':
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) return null;
        return l / r;
      }
      return null;
    case '%':
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) return null;
        return l % r;
      }
      return null;
    case '==':
      return l === r;
    case '!=':
      return l !== r;
    case '<':
      if (typeof l === 'number' && typeof r === 'number') return l < r;
      if (typeof l === 'string' && typeof r === 'string') return l < r;
      return false;
    case '>':
      if (typeof l === 'number' && typeof r === 'number') return l > r;
      if (typeof l === 'string' && typeof r === 'string') return l > r;
      return false;
    case '<=':
      if (typeof l === 'number' && typeof r === 'number') return l <= r;
      if (typeof l === 'string' && typeof r === 'string') return l <= r;
      return false;
    case '>=':
      if (typeof l === 'number' && typeof r === 'number') return l >= r;
      if (typeof l === 'string' && typeof r === 'string') return l >= r;
      return false;
  }
  throw new AdvancedFieldError('eval_unknown_op', `Operador desconocido: ${node.op}`);
}

function evalCall(node: Extract<Node, { type: 'call' }>, ctx: EvalContext): unknown {
  const name = node.name;
  if (!ALLOWED_FUNCTIONS.has(name)) {
    throw new AdvancedFieldError('eval_forbidden_function', `Función no permitida: ${name}`);
  }
  const args = node.args.map((a) => evalNode(a, ctx));

  switch (name) {
    case 'now':
      return ctx.now.toISOString();
    case 'today': {
      const y = ctx.now.getUTCFullYear();
      const m = String(ctx.now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(ctx.now.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    case 'date': {
      if (args.length !== 1) return null;
      const d = toDate(args[0]);
      return d ? d.toISOString() : null;
    }
    case 'yearsBetween': {
      const a = toDate(args[0]);
      const b = toDate(args[1]);
      if (!a || !b) return null;
      // years differential calendar-aware
      let years = b.getUTCFullYear() - a.getUTCFullYear();
      const monthDelta = b.getUTCMonth() - a.getUTCMonth();
      const dayDelta = b.getUTCDate() - a.getUTCDate();
      if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) years--;
      return years;
    }
    case 'monthsBetween': {
      const a = toDate(args[0]);
      const b = toDate(args[1]);
      if (!a || !b) return null;
      let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
      if (b.getUTCDate() < a.getUTCDate()) months--;
      return months;
    }
    case 'daysBetween': {
      const a = toDate(args[0]);
      const b = toDate(args[1]);
      if (!a || !b) return null;
      const ms = b.getTime() - a.getTime();
      return Math.floor(ms / (1000 * 60 * 60 * 24));
    }
    case 'sum': {
      const arr = toNumberArray(args[0]);
      return arr.reduce((acc, v) => acc + v, 0);
    }
    case 'avg': {
      const arr = toNumberArray(args[0]);
      if (arr.length === 0) return null;
      return arr.reduce((acc, v) => acc + v, 0) / arr.length;
    }
    case 'countTrue': {
      const arr = toBoolArray(args[0]);
      return arr.filter((b) => b).length;
    }
    case 'min': {
      const arr = toNumberArray(args[0]);
      if (arr.length === 0) return null;
      return Math.min(...arr);
    }
    case 'max': {
      const arr = toNumberArray(args[0]);
      if (arr.length === 0) return null;
      return Math.max(...arr);
    }
    case 'len': {
      const v = args[0];
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'string') return v.length;
      return 0;
    }
    case 'field': {
      const id = args[0];
      if (typeof id !== 'string') {
        throw new AdvancedFieldError('eval_field_arg', "field() requiere string literal");
      }
      return ctx.responses.has(id) ? ctx.responses.get(id) : null;
    }
    case 'abs':
      return typeof args[0] === 'number' ? Math.abs(args[0]) : null;
    case 'round':
      return typeof args[0] === 'number' ? Math.round(args[0]) : null;
    case 'floor':
      return typeof args[0] === 'number' ? Math.floor(args[0]) : null;
    case 'ceil':
      return typeof args[0] === 'number' ? Math.ceil(args[0]) : null;
    case 'concat':
      return args.map((a) => (a === null || a === undefined ? '' : String(a))).join('');
    case 'if': {
      if (args.length !== 3) {
        throw new AdvancedFieldError('eval_if_arity', 'if(cond, a, b) requiere 3 argumentos');
      }
      return args[0] ? args[1] : args[2];
    }
  }
  throw new AdvancedFieldError('eval_unreachable', `Función no manejada: ${name}`);
}

function coerceResult(value: unknown, kind: ComputedResultKind): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'number':
      if (typeof value === 'number' && !isNaN(value)) return value;
      if (typeof value === 'string') {
        const n = parseFloat(value);
        return isNaN(n) ? null : n;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      return null;
    case 'string':
      if (typeof value === 'string') return value;
      return String(value);
    case 'boolean':
      return Boolean(value);
    case 'date': {
      const d = toDate(value);
      return d ? d.toISOString() : null;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public API — parse cache to avoid re-parsing on every eval
// ────────────────────────────────────────────────────────────────────────

const PARSE_CACHE = new Map<string, Node>();

function parseExpression(expression: string): Node {
  const cached = PARSE_CACHE.get(expression);
  if (cached) return cached;
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new AdvancedFieldError('parse_empty', 'Expresión vacía.');
  }
  const node = new Parser(tokens).parse();
  // Limit cache to avoid unbounded growth in long-lived processes.
  if (PARSE_CACHE.size > 256) PARSE_CACHE.clear();
  PARSE_CACHE.set(expression, node);
  return node;
}

function buildResponseMap(responses: AdvancedFormResponse[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const r of responses) m.set(r.fieldId, r.value);
  return m;
}

export function evaluateComputedField(
  formula: ComputedFieldFormula,
  responses: AdvancedFormResponse[],
  opts: { now?: Date } = {},
): unknown {
  const node = parseExpression(formula.expression);
  const ctx: EvalContext = {
    responses: buildResponseMap(responses),
    now: opts.now ?? new Date(),
  };
  const raw = evalNode(node, ctx);
  return coerceResult(raw, formula.resultKind);
}

export function validateCrossFieldRules(
  rules: CrossFieldValidationRule[],
  responses: AdvancedFormResponse[],
  opts: { now?: Date } = {},
): CrossFieldValidationFinding[] {
  const ctx: EvalContext = {
    responses: buildResponseMap(responses),
    now: opts.now ?? new Date(),
  };
  const findings: CrossFieldValidationFinding[] = [];
  for (const rule of rules) {
    let passed = false;
    try {
      const node = parseExpression(rule.predicate);
      const v = evalNode(node, ctx);
      passed = Boolean(v);
    } catch (err) {
      findings.push({
        ruleId: rule.ruleId,
        passed: false,
        errorMessage: `[parse_error] ${(err as Error).message}`,
      });
      continue;
    }
    findings.push({
      ruleId: rule.ruleId,
      passed,
      errorMessage: passed ? undefined : rule.errorMessage,
    });
  }
  return findings;
}

/**
 * Detecta ciclos en el grafo de dependencias. Retorna los field IDs
 * involucrados en algún ciclo (sin duplicados, en orden de descubrimiento).
 */
export function detectCircularDependencies(formulas: ComputedFieldFormula[]): string[] {
  const graph = new Map<string, string[]>();
  for (const f of formulas) {
    graph.set(f.fieldId, f.dependencies.filter((d) => formulas.some((x) => x.fieldId === d)));
  }
  const cyclic = new Set<string>();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);

  const stack: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    stack.push(node);
    const deps = graph.get(node) ?? [];
    for (const dep of deps) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        // Found cycle — record all nodes from dep onwards in the stack
        const idx = stack.indexOf(dep);
        if (idx >= 0) {
          for (let i = idx; i < stack.length; i++) cyclic.add(stack[i]);
        }
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    color.set(node, BLACK);
    stack.pop();
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }
  return Array.from(cyclic);
}

/**
 * Topological sort: orden de evaluación de fields computados.
 * `otherFieldIds` son fields no computados (inputs del usuario) — se
 * asume que ya tienen valor y no requieren ordenamiento. Cualquier
 * dependencia a un otherFieldId se ignora (se considera satisfecha).
 *
 * Si hay ciclos lanza AdvancedFieldError('topo_cycle', ...).
 */
export function topologicalSortFields(
  formulas: ComputedFieldFormula[],
  otherFieldIds: string[] = [],
): string[] {
  const cyclic = detectCircularDependencies(formulas);
  if (cyclic.length > 0) {
    throw new AdvancedFieldError(
      'topo_cycle',
      `Ciclo detectado en fields: ${cyclic.join(', ')}`,
    );
  }
  const computedIds = new Set(formulas.map((f) => f.fieldId));
  const others = new Set(otherFieldIds);
  const result: string[] = [];
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const formula = formulas.find((f) => f.fieldId === id);
    if (!formula) return;
    for (const dep of formula.dependencies) {
      if (computedIds.has(dep)) visit(dep);
      else if (!others.has(dep)) {
        // Dependencia desconocida — la tratamos como "asumida disponible"
        // pero podríamos warn. Mantenemos silencio aquí por simplicidad;
        // el evaluador retornará null si el field no existe.
      }
    }
    result.push(id);
  }

  for (const f of formulas) visit(f.fieldId);
  return result;
}

/**
 * Convenience: evalúa TODOS los computed fields en orden topológico,
 * propagando resultados intermedios al mapa de respuestas para que
 * fórmulas downstream puedan referenciar fields computados upstream.
 */
export function evaluateAllComputed(
  formulas: ComputedFieldFormula[],
  responses: AdvancedFormResponse[],
  opts: { now?: Date; otherFieldIds?: string[] } = {},
): Record<string, unknown> {
  const order = topologicalSortFields(formulas, opts.otherFieldIds);
  const enriched: AdvancedFormResponse[] = [...responses];
  const out: Record<string, unknown> = {};
  for (const fieldId of order) {
    const formula = formulas.find((f) => f.fieldId === fieldId);
    if (!formula) continue;
    const value = evaluateComputedField(formula, enriched, { now: opts.now });
    out[fieldId] = value;
    enriched.push({ fieldId, value });
  }
  return out;
}

// Export internals for tests
export const __internals = {
  tokenize,
  parseExpression,
  PARSE_CACHE,
};
