import {
  compareDocuments,
  ignoreTextError,
  resolveIgnoredPaths,
  splitJsonPaths,
  withDiffValues,
  withoutDiffValues,
} from './json-compare';
import { diffJson } from './json-diff';
import { LosslessNumber, parseJson } from './json-parse';

describe('splitJsonPaths', () => {
  it('splits JSONPath lists on top-level commas only', () => {
    expect(splitJsonPaths(" $..updatedAt, $['a,b'], $.x[0,1] ,")).toEqual([
      '$..updatedAt',
      "$['a,b']",
      '$.x[0,1]',
    ]);
  });
});

describe('ignoreTextError', () => {
  it('reports an expression that is not a JSONPath, without needing the documents', () => {
    expect(ignoreTextError('')).toBeNull();
    expect(ignoreTextError('$..updatedAt, $.a')).toBeNull();
    expect(ignoreTextError('$.a, updatedAt')).toBe(
      '"updatedAt" is not a JSONPath (start it with $)',
    );
  });
});

describe('resolveIgnoredPaths', () => {
  it('collects the matching tree paths on each side', () => {
    const { ignore, error } = resolveIgnoredPaths({ at: 1 }, { at: 2, x: { at: 3 } }, '$..at');
    expect(error).toBeNull();
    expect([...ignore!.left]).toEqual(['$.at']);
    expect([...ignore!.right]).toEqual(['$.at', '$.x.at']);
  });

  it('ignores nothing for empty text', () => {
    expect(resolveIgnoredPaths({}, {}, ' , ')).toEqual({ error: null });
  });

  it('explains text that is not a JSONPath, or not a valid one', () => {
    expect(resolveIgnoredPaths({}, {}, 'at').error).toBe(
      '"at" is not a JSONPath (start it with $)',
    );
    expect(resolveIgnoredPaths({}, {}, '$.items[').error).toMatch(/^\$\.items\[: /);
  });
});

describe('compareDocuments', () => {
  it('leaves ignored paths out, and still compares when the ignore text is invalid', () => {
    const a = { id: 1, at: 'a' };
    const b = { id: 1, at: 'b' };
    expect(compareDocuments(a, b, { matchArrays: true, ignoreText: '$.at' })).toEqual({
      result: diffJson(a, b, { ignore: { left: new Set(['$.at']), right: new Set(['$.at']) } }),
      ignoreError: null,
    });
    const bad = compareDocuments(a, b, { matchArrays: true, ignoreText: 'at' });
    expect(bad.result.changed).toBe(1);
    expect(bad.ignoreError).toMatch(/not a JSONPath/);
  });
});

describe('withoutDiffValues / withDiffValues', () => {
  const before = parseJson(
    '{"id":12345678901234567890,"items":[{"id":1,"q":1},{"id":2,"q":2}],"old":{"x":[1]},"s":"a"}',
  );
  const after = parseJson(
    '{"id":12345678901234567891,"items":[{"id":2,"q":3},{"id":3,"q":1}],"new":[true],"s":1}',
  );
  const full = diffJson(before, after, { matchArrays: true });

  it('drops the values, so the diff can be copied between threads', () => {
    const bare = withoutDiffValues(full);
    expect(bare.changes.some((c) => 'before' in c || 'after' in c)).toBe(false);
    expect(bare.left).toBe(full.left);
    expect(structuredClone(bare)).toEqual(bare);
  });

  it('puts the same values back from the documents, lossless numbers included', () => {
    expect(full.changes.some((c) => c.rightPath)).toBe(true); // a matched item moved
    const restored = withDiffValues(structuredClone(withoutDiffValues(full)), before, after);
    expect(restored).toEqual(full);
    const id = restored.changes.find((c) => c.path === '$.id')!;
    expect(id.before).toBeInstanceOf(LosslessNumber);
    expect(id.after).toBe(after.id);
  });
});
