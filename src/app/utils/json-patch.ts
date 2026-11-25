import { LosslessNumber } from './json-parse';
import { childPath, jsonTypeOf } from './json-utils';

/** One RFC 6902 operation. */
export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown };

/** RFC 6901 pointer token. */
const token = (key: string | number) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

function sameScalar(a: unknown, b: unknown): boolean {
  if (a instanceof LosslessNumber || b instanceof LosslessNumber) return String(a) === String(b);
  return a === b;
}

/**
 * A JSON Patch (RFC 6902) that turns `before` into `after`. Operations apply in
 * order: array items are compared by index, extra items are removed from the end
 * first and new ones appended, so every index is valid when its operation runs.
 * Values at a tree path in `ignore` (e.g. timestamps) are left alone.
 */
export function jsonPatch(
  before: unknown,
  after: unknown,
  ignore: ReadonlySet<string> = new Set(),
): PatchOp[] {
  const ops: PatchOp[] = [];
  const walk = (a: any, b: any, pointer: string, path: string): void => {
    if (ignore.has(path)) return;
    const ta = jsonTypeOf(a);
    if (ta !== jsonTypeOf(b)) {
      ops.push({ op: 'replace', path: pointer, value: b });
    } else if (ta === 'object') {
      for (const key of Object.keys(a)) {
        const p = childPath(path, key, false);
        if (ignore.has(p)) continue;
        if (Object.hasOwn(b, key)) walk(a[key], b[key], `${pointer}/${token(key)}`, p);
        else ops.push({ op: 'remove', path: `${pointer}/${token(key)}` });
      }
      for (const key of Object.keys(b)) {
        if (!Object.hasOwn(a, key) && !ignore.has(childPath(path, key, false))) {
          ops.push({ op: 'add', path: `${pointer}/${token(key)}`, value: b[key] });
        }
      }
    } else if (ta === 'array') {
      const common = Math.min(a.length, b.length);
      for (let i = 0; i < common; i++)
        walk(a[i], b[i], `${pointer}/${i}`, childPath(path, i, true));
      for (let i = a.length - 1; i >= b.length; i--)
        ops.push({ op: 'remove', path: `${pointer}/${i}` });
      for (let i = a.length; i < b.length; i++)
        ops.push({ op: 'add', path: `${pointer}/${i}`, value: b[i] });
    } else if (!sameScalar(a, b)) {
      ops.push({ op: 'replace', path: pointer, value: b });
    }
  };
  walk(before, after, '', '$');
  return ops;
}
