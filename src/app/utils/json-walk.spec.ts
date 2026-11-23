import { parseJson } from './json-parse';
import { ancestorPaths, countValues, findText } from './json-walk';

const DOC = parseJson(
  '{"id": 12345678901234567890, "user": {"name": "Priya", "tags": ["a", "b"]}, "unit price": null, "empty": {}}',
);

describe('findText', () => {
  it('matches keys and scalar values, case-insensitively, in document order', () => {
    expect(findText(DOC, 'PRIYA')).toEqual(['$.user.name']);
    expect(findText(DOC, 'a')).toEqual(['$.user.name', '$.user.tags', '$.user.tags[0]']);
    expect(findText(DOC, 'price')).toEqual(['$["unit price"]']);
    expect(findText(DOC, 'nul')).toEqual(['$["unit price"]']);
  });

  it('keeps every digit of large numbers, and uses array indexes as keys', () => {
    expect(findText(DOC, '901234567890')).toEqual(['$.id']);
    expect(findText(DOC, '1')).toEqual(['$.id', '$.user.tags[1]']);
  });

  it('does not match containers by their value', () => {
    expect(findText(DOC, 'object')).toEqual([]);
  });

  it('gives the same results when a document is searched again with other queries', () => {
    const doc = parseJson('{"Name": "Priya", "list": ["PRIYA", 1]}');
    expect(findText(doc, 'priya')).toEqual(['$.Name', '$.list[0]']);
    expect(findText(doc, 'name')).toEqual(['$.Name']);
    expect(findText(doc, 'priya')).toEqual(['$.Name', '$.list[0]']);
    expect(findText(doc, 'zzz')).toEqual([]);
  });

  it('does not mix up results between documents', () => {
    expect(findText(parseJson('{"a": 1}'), 'a')).toEqual(['$.a']);
    expect(findText(parseJson('{"b": 1}'), 'a')).toEqual([]);
  });

  it('searches a scalar root and a null root', () => {
    expect(findText('Hello', 'ell')).toEqual(['$']);
    expect(findText(null, 'nul')).toEqual(['$']);
    expect(findText(null, 'ell')).toEqual([]);
  });
});

describe('countValues', () => {
  it('counts every value, containers included', () => {
    expect(countValues(DOC)).toBe(9);
    expect(countValues(42)).toBe(1);
  });

  it('stops at the limit', () => {
    expect(countValues(new Array(100_000).fill(0), 10)).toBe(10);
  });
});

describe('ancestorPaths', () => {
  it('collects the ancestors of each path, but not the paths themselves', () => {
    expect([...ancestorPaths(['$.a[1].b', '$["x y"].z'])].sort()).toEqual(
      ['$', '$.a', '$.a[1]', '$["x y"]'].sort(),
    );
    expect(ancestorPaths(['$']).size).toBe(0);
  });
});
