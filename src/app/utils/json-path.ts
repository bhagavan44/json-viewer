import { LosslessNumber } from './json-parse';
import { childPath, jsonTypeOf } from './json-utils';

/**
 * A JSONPath evaluator covering the parts people actually use:
 *
 *   $  .name  ['name']  [0]  [-1]  [*]  .*  ..name  ..*  [0,2]  ['a','b']  [1:3]  [::2]
 *   [?(@.price > 10 && @.tags)]   comparisons: == != < <= > >=   =~ /regex/i
 *   functions in filters: length(@.x), count(@.x..y)
 *
 * Each match carries its path in the same format the tree view uses, so results
 * can be highlighted and revealed there.
 */

export class JsonPathError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

export interface PathMatch {
  path: string;
  value: unknown;
}

type Selector =
  | { t: 'name'; name: string }
  | { t: 'index'; index: number }
  | { t: 'wild' }
  | { t: 'slice'; start: number | null; end: number | null; step: number }
  | { t: 'filter'; expr: Expr };

interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

type Expr =
  | { k: 'lit'; value: unknown }
  | { k: 'query'; abs: boolean; segments: Segment[] }
  | { k: 'cmp'; op: string; l: Expr; r: Expr }
  | { k: 'and' | 'or'; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'fn'; name: string; arg: Expr };

const NOTHING = Symbol('nothing');

// ── Parser ────────────────────────────────────────────────────────────────────
class Parser {
  private i = 0;

  constructor(private readonly s: string) {}

  parseQuery(): Segment[] {
    this.skipWs();
    this.expect('$');
    const segments = this.parseSegments();
    this.skipWs();
    if (this.i < this.s.length) throw this.error(`Unexpected "${this.s[this.i]}"`);
    return segments;
  }

  private error(message: string): JsonPathError {
    return new JsonPathError(message, this.i);
  }

  private skipWs(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private peek(offset = 0): string {
    return this.s[this.i + offset] ?? '';
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) throw this.error(`Expected "${ch}"`);
    this.i++;
  }

  private eat(text: string): boolean {
    if (this.s.startsWith(text, this.i)) {
      this.i += text.length;
      return true;
    }
    return false;
  }

  private parseSegments(): Segment[] {
    const segments: Segment[] = [];
    for (;;) {
      const c = this.peek();
      if (c === '.') {
        const descendant = this.peek(1) === '.';
        this.i += descendant ? 2 : 1;
        if (this.peek() === '[') {
          if (!descendant) throw this.error('Unexpected "[" after "."');
          segments.push({ descendant, selectors: this.parseBracket() });
        } else if (this.peek() === '*') {
          this.i++;
          segments.push({ descendant, selectors: [{ t: 'wild' }] });
        } else {
          segments.push({ descendant, selectors: [{ t: 'name', name: this.parseName() }] });
        }
      } else if (c === '[') {
        segments.push({ descendant: false, selectors: this.parseBracket() });
      } else {
        return segments;
      }
    }
  }

  private parseName(): string {
    const start = this.i;
    while (this.i < this.s.length && /[\w$\-\u0080-￿]/.test(this.s[this.i])) this.i++;
    if (start === this.i) throw this.error('Expected a name');
    return this.s.slice(start, this.i);
  }

  private parseBracket(): Selector[] {
    this.expect('[');
    const selectors: Selector[] = [];
    for (;;) {
      this.skipWs();
      selectors.push(this.parseSelector());
      this.skipWs();
      if (this.eat(',')) continue;
      this.expect(']');
      return selectors;
    }
  }

  private parseSelector(): Selector {
    const c = this.peek();
    if (c === '*') {
      this.i++;
      return { t: 'wild' };
    }
    if (c === "'" || c === '"') return { t: 'name', name: this.parseString() };
    if (c === '?') {
      this.i++;
      return { t: 'filter', expr: this.parseOr() };
    }
    const first = this.parseOptionalInt();
    this.skipWs();
    if (this.peek() === ':') {
      this.i++;
      this.skipWs();
      const end = this.parseOptionalInt();
      this.skipWs();
      let step: number | null = null;
      if (this.eat(':')) {
        this.skipWs();
        step = this.parseOptionalInt();
      }
      if (step === 0) throw this.error('Slice step cannot be 0');
      return { t: 'slice', start: first, end, step: step ?? 1 };
    }
    if (first === null) throw this.error('Expected an index, name, "*", slice or filter');
    return { t: 'index', index: first };
  }

  private parseOptionalInt(): number | null {
    const m = /^-?\d+/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return parseInt(m[0], 10);
  }

  private parseString(): string {
    const quote = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      if (e === 'u') {
        const hex = this.s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.error('Invalid \\u escape');
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 4;
      } else {
        out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[e as 'n'] ?? e;
      }
    }
    throw this.error('Unterminated string');
  }

  // ── Filter expressions ─────────────────────────────────────────────────────
  private parseOr(): Expr {
    let left = this.parseAnd();
    for (;;) {
      this.skipWs();
      if (!this.eat('||')) return left;
      left = { k: 'or', l: left, r: this.parseAnd() };
    }
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    for (;;) {
      this.skipWs();
      if (!this.eat('&&')) return left;
      left = { k: 'and', l: left, r: this.parseNot() };
    }
  }

  private parseNot(): Expr {
    this.skipWs();
    if (this.peek() === '!' && this.peek(1) !== '=') {
      this.i++;
      return { k: 'not', e: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parsePrimary();
    this.skipWs();
    for (const op of ['==', '!=', '<=', '>=', '=~', '<', '>']) {
      if (this.eat(op)) return { k: 'cmp', op, l: left, r: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): Expr {
    this.skipWs();
    const c = this.peek();
    if (c === '(') {
      this.i++;
      const inner = this.parseOr();
      this.skipWs();
      this.expect(')');
      return inner;
    }
    if (c === '@' || c === '$') {
      this.i++;
      return { k: 'query', abs: c === '$', segments: this.parseSegments() };
    }
    if (c === "'" || c === '"') return { k: 'lit', value: this.parseString() };
    if (c === '/') return { k: 'lit', value: this.parseRegex() };
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      return { k: 'lit', value: Number(num[0]) };
    }
    const word = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i))?.[0];
    if (word) {
      this.i += word.length;
      if (word === 'true') return { k: 'lit', value: true };
      if (word === 'false') return { k: 'lit', value: false };
      if (word === 'null') return { k: 'lit', value: null };
      this.skipWs();
      if ((word === 'length' || word === 'count') && this.peek() === '(') {
        this.i++;
        const arg = this.parseOr();
        this.skipWs();
        this.expect(')');
        return { k: 'fn', name: word, arg };
      }
      throw this.error(`Unknown function or word "${word}"`);
    }
    throw this.error(c ? `Unexpected "${c}"` : 'Unexpected end of expression');
  }

  private parseRegex(): RegExp {
    this.expect('/');
    let pattern = '';
    while (this.i < this.s.length && this.s[this.i] !== '/') {
      if (this.s[this.i] === '\\') pattern += this.s[this.i++];
      pattern += this.s[this.i++] ?? '';
    }
    if (this.peek() !== '/') throw this.error('Unterminated regular expression');
    this.i++;
    const flags = /^[gimsuy]*/.exec(this.s.slice(this.i))![0];
    this.i += flags.length;
    if (pattern.length > 200) throw this.error('Regular expression is too long');
    try {
      return new RegExp(pattern, flags.replace('g', ''));
    } catch {
      throw this.error('Invalid regular expression');
    }
  }
}

// ── Evaluation ────────────────────────────────────────────────────────────────
interface Node {
  path: string;
  value: any;
}

function children(node: Node): Node[] {
  const type = jsonTypeOf(node.value);
  if (type === 'array') return node.value.map((v: unknown, i: number) => ({ path: childPath(node.path, i, true), value: v }));
  if (type === 'object')
    return Object.entries(node.value).map(([k, v]) => ({ path: childPath(node.path, k, false), value: v }));
  return [];
}

/** The node itself, then everything beneath it, in document order. */
function descendantsOrSelf(node: Node, out: Node[] = []): Node[] {
  out.push(node);
  for (const child of children(node)) descendantsOrSelf(child, out);
  return out;
}

function select(selector: Selector, node: Node, ctx: Ctx): Node[] {
  const type = jsonTypeOf(node.value);
  switch (selector.t) {
    case 'name':
      return type === 'object' && Object.prototype.hasOwnProperty.call(node.value, selector.name)
        ? [{ path: childPath(node.path, selector.name, false), value: node.value[selector.name] }]
        : [];
    case 'index': {
      if (type !== 'array') return [];
      const i = selector.index < 0 ? node.value.length + selector.index : selector.index;
      return i >= 0 && i < node.value.length ? [{ path: childPath(node.path, i, true), value: node.value[i] }] : [];
    }
    case 'wild':
      return children(node);
    case 'slice': {
      if (type !== 'array') return [];
      const len = node.value.length;
      const { step } = selector;
      const norm = (n: number) => (n < 0 ? Math.max(len + n, step < 0 ? -1 : 0) : Math.min(n, step < 0 ? len - 1 : len));
      const out: Node[] = [];
      if (step > 0) {
        const from = selector.start === null ? 0 : norm(selector.start);
        const to = selector.end === null ? len : norm(selector.end);
        for (let i = from; i < to; i += step) out.push({ path: childPath(node.path, i, true), value: node.value[i] });
      } else {
        const from = selector.start === null ? len - 1 : norm(selector.start);
        const to = selector.end === null ? -1 : norm(selector.end);
        for (let i = from; i > to; i += step) out.push({ path: childPath(node.path, i, true), value: node.value[i] });
      }
      return out;
    }
    case 'filter':
      return children(node).filter((child) => truthy(selector.expr, child, ctx));
  }
}

interface Ctx {
  root: Node;
  /** Remaining result budget, so a runaway query cannot hang the page. */
  budget: { left: number };
}

function run(segments: Segment[], start: Node[], ctx: Ctx): Node[] {
  let nodes = start;
  for (const segment of segments) {
    const next: Node[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const scope = segment.descendant ? descendantsOrSelf(node) : [node];
      for (const candidate of scope) {
        for (const selector of segment.selectors) {
          for (const hit of select(selector, candidate, ctx)) {
            if (seen.has(hit.path)) continue;
            seen.add(hit.path);
            next.push(hit);
            if (--ctx.budget.left < 0) throw new JsonPathError('Too many results; narrow the query', 0);
          }
        }
      }
    }
    nodes = next;
  }
  return nodes;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : v instanceof LosslessNumber ? Number(v.raw) : null;

function deepEqual(a: unknown, b: unknown): boolean {
  const na = num(a), nb = num(b);
  if (na !== null && nb !== null) return a instanceof LosslessNumber && b instanceof LosslessNumber ? a.raw === b.raw : na === nb;
  const ta = jsonTypeOf(a);
  if (ta !== jsonTypeOf(b)) return false;
  if (ta === 'array') return (a as any[]).length === (b as any[]).length && (a as any[]).every((v, i) => deepEqual(v, (b as any[])[i]));
  if (ta === 'object') {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => k in (b as object) && deepEqual((a as any)[k], (b as any)[k]));
  }
  return a === b;
}

function evalValue(expr: Expr, current: Node, ctx: Ctx): unknown {
  switch (expr.k) {
    case 'lit':
      return expr.value;
    case 'query': {
      const hits = run(expr.segments, [expr.abs ? ctx.root : current], ctx);
      return hits.length ? hits[0].value : NOTHING;
    }
    case 'fn': {
      if (expr.name === 'count') {
        return expr.arg.k === 'query' ? run(expr.arg.segments, [expr.arg.abs ? ctx.root : current], ctx).length : NOTHING;
      }
      const v = evalValue(expr.arg, current, ctx);
      if (typeof v === 'string') return [...v].length;
      const t = v === NOTHING ? 'nothing' : jsonTypeOf(v);
      if (t === 'array') return (v as unknown[]).length;
      if (t === 'object') return Object.keys(v as object).length;
      return NOTHING;
    }
    default:
      return truthy(expr, current, ctx);
  }
}

function truthy(expr: Expr, current: Node, ctx: Ctx): boolean {
  switch (expr.k) {
    case 'and':
      return truthy(expr.l, current, ctx) && truthy(expr.r, current, ctx);
    case 'or':
      return truthy(expr.l, current, ctx) || truthy(expr.r, current, ctx);
    case 'not':
      return !truthy(expr.e, current, ctx);
    case 'query':
      return run(expr.segments, [expr.abs ? ctx.root : current], ctx).length > 0;
    case 'cmp': {
      const l = evalValue(expr.l, current, ctx);
      const r = evalValue(expr.r, current, ctx);
      switch (expr.op) {
        case '==':
          return l === NOTHING || r === NOTHING ? l === r : deepEqual(l, r);
        case '!=':
          return !(l === NOTHING || r === NOTHING ? l === r : deepEqual(l, r));
        case '=~':
          return typeof l === 'string' && r instanceof RegExp && r.test(l);
        default: {
          const a = num(l), b = num(r);
          const bothNumbers = a !== null && b !== null;
          const bothStrings = typeof l === 'string' && typeof r === 'string';
          if (!bothNumbers && !bothStrings) return false;
          const x = bothNumbers ? a : (l as string), y = bothNumbers ? b : (r as string);
          return expr.op === '<' ? x < y : expr.op === '<=' ? x <= y : expr.op === '>' ? x > y : x >= y;
        }
      }
    }
    default: {
      const v = evalValue(expr, current, ctx);
      return v !== NOTHING && v !== false && v !== null;
    }
  }
}

/** Evaluates `expression` against `root`. Throws JsonPathError for a bad expression. */
export function queryJsonPath(root: unknown, expression: string, limit = 100_000): PathMatch[] {
  const segments = new Parser(expression).parseQuery();
  const rootNode: Node = { path: '$', value: root };
  const ctx: Ctx = { root: rootNode, budget: { left: limit } };
  return run(segments, [rootNode], ctx).map(({ path, value }) => ({ path, value }));
}

/** True for text that should be treated as a JSONPath rather than a plain search: `$`, `$.x`, `$[0]`, `$..x`. */
export function looksLikeJsonPath(text: string): boolean {
  return /^\s*\$(?:[.[]|\s*$)/.test(text);
}
