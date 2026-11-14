import { parseJson, stringifyJson } from './json-parse';
import { PatchOp, jsonPatch } from './json-patch';

/** A minimal RFC 6902 applier, to prove the generated patches are correct. */
function apply(doc: any, ops: PatchOp[]): any {
  doc = structuredClone(doc);
  for (const op of ops) {
    const keys = op.path.split('/').slice(1).map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!keys.length) {
      doc = (op as any).value;
      continue;
    }
    const last = keys.pop()!;
    const parent = keys.reduce((node, k) => node[Array.isArray(node) ? Number(k) : k], doc);
    if (Array.isArray(parent)) {
      const i = Number(last);
      if (op.op === 'add') parent.splice(i, 0, op.value);
      else if (op.op === 'remove') parent.splice(i, 1);
      else parent[i] = op.value;
    } else if (op.op === 'remove') delete parent[last];
    else parent[last] = op.value;
  }
  return doc;
}

describe('jsonPatch', () => {
  it('produces add, remove and replace operations with escaped pointers', () => {
    expect(jsonPatch({ a: 1, 'x/y': true, gone: 0 }, { a: 2, 'x/y': true, 'm~n': [1] })).toEqual([
      { op: 'replace', path: '/a', value: 2 },
      { op: 'remove', path: '/gone' },
      { op: 'add', path: '/m~0n', value: [1] },
    ]);
  });

  it('turns before into after, for arrays that grow, shrink and nest', () => {
    const cases: [unknown, unknown][] = [
      [{ items: [1, 2, 3, 4] }, { items: [1, 9] }],
      [{ items: [1] }, { items: [1, 2, { x: [3] }] }],
      [[{ a: [1, 2] }, 'x'], [{ a: [2] }]],
      [{ a: { b: null } }, { a: { b: { c: 1 } } }],
      [1, { whole: 'replaced' }],
    ];
    for (const [before, after] of cases) expect(apply(before, jsonPatch(before, after))).toEqual(after);
  });

  it('is empty for equal documents, ignoring key order', () => {
    expect(jsonPatch({ a: 1, b: [1] }, { b: [1], a: 1 })).toEqual([]);
  });

  it('leaves ignored paths alone', () => {
    const ignore = new Set(['$.updatedAt', '$.items[0].stamp']);
    expect(jsonPatch({ updatedAt: 1, items: [{ stamp: 1, q: 1 }] }, { updatedAt: 2, items: [{ stamp: 2, q: 2 }] }, ignore)).toEqual([
      { op: 'replace', path: '/items/0/q', value: 2 },
    ]);
  });

  it('keeps big numbers exact', () => {
    const ops = jsonPatch(parseJson('{"id": 1}'), parseJson('{"id": 1234567890123456789}'));
    expect(stringifyJson(ops)).toBe('[{"op":"replace","path":"/id","value":1234567890123456789}]');
  });
});
