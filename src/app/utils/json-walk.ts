import { pathSegments } from './json-locate';
import { childPath, jsonTypeOf } from './json-utils';

/** One value of a document, with the lowercased text that a search compares against. */
interface SearchEntry {
  path: string;
  /** Lowercased key, or `null` for the root. */
  key: string | null;
  /** Lowercased `String(value)` for scalars, `null` for objects and arrays. */
  text: string | null;
}

/** Search entries per parsed document, so typing more of a query does not lowercase it all again. */
const searchIndexes = new WeakMap<object, SearchEntry[]>();

function buildSearchIndex(root: unknown): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const visit = (value: any, key: string | null, path: string): void => {
    const type = jsonTypeOf(value);
    const container = type === 'object' || type === 'array';
    entries.push({
      path,
      key: key === null ? null : key.toLowerCase(),
      text: container ? null : String(value).toLowerCase(),
    });
    if (type === 'array') {
      (value as unknown[]).forEach((v, i) => visit(v, String(i), childPath(path, i, true)));
    } else if (type === 'object') {
      for (const k of Object.keys(value)) visit(value[k], k, childPath(path, k, false));
    }
  };
  visit(root, null, '$');
  return entries;
}

/**
 * Paths of every value whose key, or whose scalar value, contains `query` (case-insensitive),
 * in document order. Array items have their index as key. Walks the parsed value directly, so
 * no tree has to be built to search it.
 *
 * The lowercased keys and values are computed once per document object and reused by every later
 * query, so a document must not be changed in place after it is searched (the viewer parses a new
 * object on every edit).
 */
export function findText(root: unknown, query: string): string[] {
  const q = query.toLowerCase();
  const cacheable = typeof root === 'object' && root !== null;
  let entries = cacheable ? searchIndexes.get(root) : undefined;
  if (!entries) {
    entries = buildSearchIndex(root);
    if (cacheable) searchIndexes.set(root, entries);
  }
  const found: string[] = [];
  for (const { path, key, text } of entries) {
    if ((key !== null && key.includes(q)) || (text !== null && text.includes(q))) found.push(path);
  }
  return found;
}

/** Number of values in a document (containers included), counting no further than `limit`. */
export function countValues(root: unknown, limit = Infinity): number {
  let count = 0;
  const stack: any[] = [root];
  while (stack.length && count < limit) {
    const value = stack.pop();
    count++;
    const type = jsonTypeOf(value);
    if (type === 'array') for (const v of value as unknown[]) stack.push(v);
    else if (type === 'object') for (const k of Object.keys(value)) stack.push(value[k]);
  }
  return count;
}

/** The paths of every ancestor of the given paths (`$.a[1].b` → `$`, `$.a`, `$.a[1]`). */
export function ancestorPaths(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const path of paths) {
    const segments = pathSegments(path);
    for (let i = 0; i < segments.length - 1; i++) out.add(segments[i].path);
  }
  return out;
}
