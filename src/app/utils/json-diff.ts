import { LosslessNumber } from './json-parse';
import { childPath, jsonTypeOf } from './json-utils';

export type DiffKind = 'add' | 'del' | 'chg';

export interface DiffEntry {
  /** Path in the "before" document, or in the "after" document for an addition. */
  path: string;
  /** Path in the "after" document when it differs from `path` (an array item matched by key at another index). */
  rightPath?: string;
  kind: DiffKind;
  before?: any;
  after?: any;
}

export interface DiffResult {
  /** Marks keyed by path for the "before" document (del / chg). */
  left: Record<string, DiffKind>;
  /** Marks keyed by path for the "after" document (add / chg). */
  right: Record<string, DiffKind>;
  changes: DiffEntry[];
  added: number;
  removed: number;
  changed: number;
  /** Keys used to match array items (empty when every array was compared by index). */
  arrayKeys: string[];
}

export interface DiffOptions {
  /**
   * Match the items of two arrays of objects by an identifying key (such as `id` or `sku`)
   * instead of by index, so an inserted, removed or reordered item does not mark
   * every following item as changed.
   */
  matchArrays?: boolean;
  /** Tree paths to leave out on each side (e.g. timestamps), with everything inside them. */
  ignore?: { left: ReadonlySet<string>; right: ReadonlySet<string> };
}

/** Keys tried first, in order, when looking for an identifying key. */
const PREFERRED_KEYS = ['id', '_id', 'uuid', 'guid', 'key', 'sku', 'code'];
/** Other keys that look like identifiers: `orderId`, `order_id`, `ID`, `productNumber`... */
const ID_LIKE = /(^|[_-])id$|[a-z]Id$|ID$|(^|[_-])(no|number|code|key)$|[a-z](No|Number|Code|Key)$/;

function identity(value: unknown): string | null {
  if (typeof value === 'string') return 's:' + value;
  if (typeof value === 'number' || value instanceof LosslessNumber) return 'n:' + String(value);
  return null;
}

/** True when every item is an object with a unique string/number under `key`. */
function identifies(items: any[], key: string): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    if (jsonTypeOf(item) !== 'object' || !Object.hasOwn(item, key)) return false;
    const id = identity(item[key]);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** The key that identifies the items of both arrays, or null to compare by index. */
export function findArrayKey(a: any[], b: any[]): string | null {
  if (!a.length || !b.length) return null;
  if (jsonTypeOf(a[0]) !== 'object') return null;
  const shared = Object.keys(a[0]).filter((k) => Object.hasOwn(b[0] ?? {}, k));
  const candidates = [
    ...PREFERRED_KEYS.filter((k) => shared.includes(k)),
    ...shared.filter((k) => !PREFERRED_KEYS.includes(k) && ID_LIKE.test(k)),
  ];
  return candidates.find((k) => identifies(a, k) && identifies(b, k)) ?? null;
}

/** Compares scalars; lossless numbers are compared by their exact digits. */
function sameScalar(a: unknown, b: unknown): boolean {
  if (a instanceof LosslessNumber || b instanceof LosslessNumber) return String(a) === String(b);
  return a === b;
}

/**
 * Structural diff. Objects are compared by key (key order is ignored), arrays by
 * index or, with `matchArrays`, by an identifying key. Paths use the same format
 * as the tree view; each side's marks use that side's paths.
 */
export function diffJson(before: any, after: any, options: DiffOptions = {}): DiffResult {
  const result: DiffResult = {
    left: {},
    right: {},
    changes: [],
    added: 0,
    removed: 0,
    changed: 0,
    arrayKeys: [],
  };
  const keys = new Set<string>();
  const ignoreLeft = options.ignore?.left ?? new Set<string>();
  const ignoreRight = options.ignore?.right ?? new Set<string>();

  const added = (path: string, value: any) => {
    if (ignoreRight.has(path)) return;
    result.right[path] = 'add';
    result.added++;
    result.changes.push({ path, kind: 'add', after: value });
  };
  const removed = (path: string, value: any) => {
    if (ignoreLeft.has(path)) return;
    result.left[path] = 'del';
    result.removed++;
    result.changes.push({ path, kind: 'del', before: value });
  };
  const changed = (pa: string, pb: string, a: any, b: any) => {
    result.left[pa] = 'chg';
    result.right[pb] = 'chg';
    result.changed++;
    result.changes.push(
      pa === pb
        ? { path: pa, kind: 'chg', before: a, after: b }
        : { path: pa, rightPath: pb, kind: 'chg', before: a, after: b },
    );
  };

  const walkArraysByKey = (a: any[], b: any[], pa: string, pb: string, key: string): void => {
    keys.add(key);
    const indexInB = new Map<string, number>();
    b.forEach((item, j) => indexInB.set(identity(item[key])!, j));
    const matched = new Set<number>();
    a.forEach((item, i) => {
      const j = indexInB.get(identity(item[key])!);
      if (j === undefined) return removed(childPath(pa, i, true), item);
      matched.add(j);
      walk(item, b[j], childPath(pa, i, true), childPath(pb, j, true));
    });
    b.forEach((item, j) => {
      if (!matched.has(j)) added(childPath(pb, j, true), item);
    });
  };

  const walk = (a: any, b: any, pa: string, pb: string): void => {
    if (ignoreLeft.has(pa) || ignoreRight.has(pb)) return;
    const ta = jsonTypeOf(a);
    if (ta !== jsonTypeOf(b)) return changed(pa, pb, a, b);
    if (ta === 'object') {
      for (const key of Object.keys(a)) {
        if (Object.hasOwn(b, key))
          walk(a[key], b[key], childPath(pa, key, false), childPath(pb, key, false));
        else removed(childPath(pa, key, false), a[key]);
      }
      for (const key of Object.keys(b)) {
        if (!Object.hasOwn(a, key)) added(childPath(pb, key, false), b[key]);
      }
    } else if (ta === 'array') {
      const key = options.matchArrays ? findArrayKey(a, b) : null;
      if (key !== null) return walkArraysByKey(a, b, pa, pb, key);
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (i >= a.length) added(childPath(pb, i, true), b[i]);
        else if (i >= b.length) removed(childPath(pa, i, true), a[i]);
        else walk(a[i], b[i], childPath(pa, i, true), childPath(pb, i, true));
      }
    } else if (!sameScalar(a, b)) {
      changed(pa, pb, a, b);
    }
  };

  walk(before, after, '$', '$');
  result.arrayKeys = [...keys];
  return result;
}
