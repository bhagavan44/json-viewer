import { parseJson } from './json-parse';
import { childPath, jsonTypeOf } from './json-utils';

/** Cheap test for a string that may hold a JSON object or array (used while rendering). */
export function looksLikeJson(text: string): boolean {
  return /^\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/.test(text) || /^\s*"\s*[[{][\s\S]*"\s*$/.test(text);
}

/**
 * The object or array encoded in `text` (e.g. a message body stored as a string),
 * also when it was encoded twice. Undefined when the text is not such JSON.
 */
export function parseEmbedded(text: string): unknown {
  if (!looksLikeJson(text)) return undefined;
  let value: unknown;
  try {
    value = parseJson(text);
  } catch {
    return undefined;
  }
  if (typeof value === 'string') return parseEmbedded(value);
  const type = jsonTypeOf(value);
  return type === 'object' || type === 'array' ? value : undefined;
}

/** Replaces every string that holds JSON with the parsed value, at any depth. */
export function unwrapAll(value: unknown): { value: unknown; count: number } {
  let count = 0;
  const visit = (v: any): any => {
    const type = jsonTypeOf(v);
    if (type === 'string') {
      const inner = parseEmbedded(v);
      if (inner === undefined) return v;
      count++;
      return visit(inner);
    }
    if (type === 'array') return v.map(visit);
    // fromEntries defines own properties, so a "__proto__" key stays a key
    if (type === 'object') return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, visit(c)]));
    return v;
  };
  return { value: visit(value), count };
}

/**
 * Returns a copy of `doc` with the value at `target` (a tree path such as `$.items[1].body`)
 * replaced by `update(value)`. Branches off the path are shared, not copied.
 */
export function replaceAt(doc: unknown, target: string, update: (value: any) => unknown): unknown {
  const visit = (v: any, path: string): any => {
    if (path === target) return update(v);
    if (!target.startsWith(path)) return v;
    const type = jsonTypeOf(v);
    if (type === 'array') return v.map((c: any, i: number) => visit(c, childPath(path, i, true)));
    if (type === 'object') return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, visit(c, childPath(path, k, false))]));
    return v;
  };
  return visit(doc, '$');
}

/**
 * For text that is escaped JSON without its outer quotes (as copied from many logs),
 * e.g. `{\"id\":1}`, returns the unescaped JSON text. Null otherwise.
 */
export function unescapeJsonText(text: string): string | null {
  const trimmed = text.trim();
  if (!/\\"/.test(trimmed)) return null;
  let inner: unknown;
  try {
    inner = JSON.parse(`"${trimmed}"`);
  } catch {
    return null;
  }
  if (typeof inner !== 'string') return null;
  try {
    parseJson(inner);
    return inner;
  } catch {
    return null;
  }
}
