import { diffJson, findArrayKey } from './json-diff';
import { childPath, summarizeValue } from './json-utils';

describe('diffJson', () => {
  it('reports no changes for equal documents, ignoring key order', () => {
    const r = diffJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 });
    expect(r.changes).toEqual([]);
  });

  it('detects added, removed and changed values with tree-compatible paths', () => {
    const before = { status: 'shipped', tier: 'gold', items: [{ qty: 1 }, { qty: 2 }], old: true };
    const after = { status: 'delivered', tier: 'gold', items: [{ qty: 1 }], coupon: 'X' };
    const r = diffJson(before, after);

    expect(r.changed).toBe(1);
    expect(r.removed).toBe(2);
    expect(r.added).toBe(1);
    expect(r.left['$.status']).toBe('chg');
    expect(r.right['$.status']).toBe('chg');
    expect(r.left['$.items[1]']).toBe('del');
    expect(r.left['$.old']).toBe('del');
    expect(r.right['$.coupon']).toBe('add');
  });

  it('reports keys named like Object.prototype members as added or removed', () => {
    const r = diffJson({ constructor: 1, toString: 'x' }, { valueOf: true });
    expect(r.changes).toEqual([
      { path: '$.constructor', kind: 'del', before: 1 },
      { path: '$.toString', kind: 'del', before: 'x' },
      { path: '$.valueOf', kind: 'add', after: true },
    ]);
  });

  it('treats a type change as a single change at that path', () => {
    const r = diffJson({ v: null }, { v: { x: 1 } });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ path: '$.v', kind: 'chg' });
  });
});

describe('diffJson with matchArrays', () => {
  const before = {
    lines: [
      { sku: 'A', qty: 1 },
      { sku: 'B', qty: 2 },
      { sku: 'C', qty: 3 },
    ],
  };
  const after = {
    lines: [
      { sku: 'NEW', qty: 9 },
      { sku: 'A', qty: 1 },
      { sku: 'C', qty: 4 },
    ],
  };

  it('by index, an insertion at the start marks every item as changed', () => {
    expect(diffJson(before, after).changed).toBe(5); // sku+qty at [0] and [1], qty at [2]
  });

  it('matches items by key, reporting only the real differences', () => {
    const r = diffJson(before, after, { matchArrays: true });
    expect(r.arrayKeys).toEqual(['sku']);
    expect(r.changes).toEqual([
      { path: '$.lines[1]', kind: 'del', before: { sku: 'B', qty: 2 } },
      { path: '$.lines[2].qty', kind: 'chg', before: 3, after: 4 }, // "C" is at index 2 on both sides
      { path: '$.lines[0]', kind: 'add', after: { sku: 'NEW', qty: 9 } },
    ]);
    expect(r.left['$.lines[1]']).toBe('del');
    expect(r.right['$.lines[0]']).toBe('add');
  });

  it('records both paths when a matched item moved', () => {
    const r = diffJson(
      {
        a: [
          { id: 1, v: 'x' },
          { id: 2, v: 'y' },
        ],
      },
      {
        a: [
          { id: 2, v: 'Y' },
          { id: 1, v: 'x' },
        ],
      },
      { matchArrays: true },
    );
    expect(r.changes).toEqual([
      { path: '$.a[1].v', rightPath: '$.a[0].v', kind: 'chg', before: 'y', after: 'Y' },
    ]);
    expect(r.left['$.a[1].v']).toBe('chg');
    expect(r.right['$.a[0].v']).toBe('chg');
  });

  it('ignores reordering', () => {
    const r = diffJson([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], { matchArrays: true });
    expect(r.changes).toEqual([]);
  });

  it('falls back to index when no key identifies the items', () => {
    expect(findArrayKey([{ qty: 1 }, { qty: 2 }], [{ qty: 1 }])).toBeNull(); // not an id-like key
    expect(findArrayKey([{ id: 1 }, { id: 1 }], [{ id: 1 }])).toBeNull(); // not unique
    expect(findArrayKey([{ id: 1 }, { x: 1 }], [{ id: 1 }])).toBeNull(); // missing on one item
    expect(findArrayKey([1, 2], [1])).toBeNull();
    const r = diffJson([1, 2], [2], { matchArrays: true });
    expect(r.arrayKeys).toEqual([]);
    expect(r.changed).toBe(1);
  });

  it('prefers well-known keys, then id-like keys', () => {
    expect(
      findArrayKey([{ name: 'a', orderId: 7, sku: 'x' }], [{ name: 'a', orderId: 7, sku: 'x' }]),
    ).toBe('sku');
    expect(findArrayKey([{ qty: 1, order_no: 'A1' }], [{ qty: 1, order_no: 'A2' }])).toBe(
      'order_no',
    );
    expect(findArrayKey([{ productNumber: 'P1' }], [{ productNumber: 'P2' }])).toBe(
      'productNumber',
    );
  });
});

describe('diffJson with ignore', () => {
  it('leaves out ignored paths and everything inside them, on each side', () => {
    const before = { updatedAt: 1, meta: { v: 1 }, items: [{ id: 1, stamp: 'a', q: 1 }], gone: 1 };
    const after = { updatedAt: 2, meta: { v: 2 }, items: [{ id: 1, stamp: 'b', q: 1 }], extra: 1 };
    const ignore = {
      left: new Set(['$.updatedAt', '$.meta', '$.items[0].stamp', '$.gone']),
      right: new Set(['$.updatedAt', '$.meta', '$.items[0].stamp']),
    };
    expect(diffJson(before, after, { ignore }).changes).toEqual([
      { path: '$.extra', kind: 'add', after: 1 },
    ]);
  });
});

describe('json utils', () => {
  it('quotes keys that are not identifiers', () => {
    expect(childPath('$', 'a b', false)).toBe('$["a b"]');
    expect(childPath('$', 'name', false)).toBe('$.name');
    expect(childPath('$.items', 2, true)).toBe('$.items[2]');
  });

  it('summarizes containers and truncates long strings', () => {
    expect(summarizeValue([1, 2])).toBe('[2 items]');
    expect(summarizeValue({ a: 1 })).toBe('{1 key}');
    expect(summarizeValue('x'.repeat(100), 10)).toHaveLength(10);
  });
});
