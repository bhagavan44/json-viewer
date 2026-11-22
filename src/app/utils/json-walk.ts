import { pathSegments } from './json-locate';
import { childPath, jsonTypeOf } from './json-utils';

/**
 * Paths of every value whose key, or whose scalar value, contains `query` (case-insensitive),
 * in document order. Array items have their index as key. Walks the parsed value directly, so
 * no tree has to be built to search it.
 */
export function findText(root: unknown, query: string): string[] {
  const q = query.toLowerCase();
  const found: string[] = [];
  const visit = (value: any, key: string | null, path: string): void => {
    const type = jsonTypeOf(value);
    const container = type === 'object' || type === 'array';
    if (
      (key !== null && key.toLowerCase().includes(q)) ||
      (!container && String(value).toLowerCase().includes(q))
    ) {
      found.push(path);
    }
    if (type === 'array') {
      (value as unknown[]).forEach((v, i) => visit(v, String(i), childPath(path, i, true)));
    } else if (type === 'object') {
      for (const k of Object.keys(value)) visit(value[k], k, childPath(path, k, false));
    }
  };
  visit(root, null, '$');
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
