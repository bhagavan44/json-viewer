import { parseJson } from './json-parse';
import { JsonPathError, looksLikeJsonPath, queryJsonPath } from './json-path';

const STORE = {
  name: 'shop',
  books: [
    { title: 'A', price: 8.95, tags: ['x', 'y'], author: { name: 'Ann' } },
    { title: 'B', price: 12.99, tags: [], isbn: '0-553' },
    { title: 'C', price: 22.99, tags: ['x'], author: { name: 'Cy' } },
  ],
  'odd key': { 'a.b': 1 },
};

const paths = (expr: string, doc: unknown = STORE) => queryJsonPath(doc, expr).map((m) => m.path);
const values = (expr: string, doc: unknown = STORE) => queryJsonPath(doc, expr).map((m) => m.value);

describe('queryJsonPath', () => {
  it('selects the root, names and indexes with tree-compatible paths', () => {
    expect(paths('$')).toEqual(['$']);
    expect(paths('$.name')).toEqual(['$.name']);
    expect(paths('$.books[1].title')).toEqual(['$.books[1].title']);
    expect(values("$['name']")).toEqual(['shop']);
    expect(paths('$.books[-1]')).toEqual(['$.books[2]']);
  });

  it('quotes keys that are not identifiers, matching the tree', () => {
    expect(paths("$['odd key']['a.b']")).toEqual(['$["odd key"]["a.b"]']);
  });

  it('supports wildcards, unions and slices', () => {
    expect(paths('$.books[*].title')).toEqual([
      '$.books[0].title',
      '$.books[1].title',
      '$.books[2].title',
    ]);
    expect(values('$.books[0,2].title')).toEqual(['A', 'C']);
    expect(values("$.books[0]['title','price']")).toEqual(['A', 8.95]);
    expect(values('$.books[1:3].title')).toEqual(['B', 'C']);
    expect(values('$.books[::2].title')).toEqual(['A', 'C']);
    expect(values('$.books[::-1].title')).toEqual(['C', 'B', 'A']);
    expect(paths('$.name.*')).toEqual([]);
  });

  it('supports recursive descent', () => {
    expect(values('$..title')).toEqual(['A', 'B', 'C']);
    expect(values('$..author.name')).toEqual(['Ann', 'Cy']);
    expect(paths('$.books..tags[0]')).toEqual(['$.books[0].tags[0]', '$.books[2].tags[0]']);
  });

  it('filters with comparisons, logic and existence tests', () => {
    expect(values('$.books[?(@.price > 10)].title')).toEqual(['B', 'C']);
    expect(values('$.books[?(@.price >= 12.99 && @.price < 20)].title')).toEqual(['B']);
    expect(values('$.books[?(@.isbn)].title')).toEqual(['B']);
    expect(values('$.books[?(!@.author)].title')).toEqual(['B']);
    expect(values("$.books[?(@.title == 'A' || @.title == 'C')].price")).toEqual([8.95, 22.99]);
    expect(values("$.books[?@.author.name == 'Cy'].title")).toEqual(['C']);
    expect(values('$.books[?(@.price != 12.99)].title')).toEqual(['A', 'C']);
  });

  it('supports regex and the length/count functions in filters', () => {
    expect(values('$.books[?(@.title =~ /^[AB]$/)].title')).toEqual(['A', 'B']);
    expect(values('$.books[?(@.author.name =~ /^c/i)].title')).toEqual(['C']);
    expect(values('$.books[?(length(@.tags) > 0)].title')).toEqual(['A', 'C']);
    expect(values('$.books[?(count(@.tags[*]) == 2)].title')).toEqual(['A']);
  });

  it('can compare against absolute paths', () => {
    expect(values('$.books[?(@.price > $.books[0].price)].title')).toEqual(['B', 'C']);
  });

  it('returns nothing, not an error, when a path simply does not exist', () => {
    expect(paths('$.nope.deeper')).toEqual([]);
    expect(paths('$.books[10]')).toEqual([]);
    expect(paths('$.books.title')).toEqual([]);
  });

  it('compares lossless numbers by value', () => {
    const doc = parseJson('{"ids":[1234567890123456789, 5]}');
    expect(paths('$.ids[?(@ > 100)]', doc)).toEqual(['$.ids[0]']);
  });

  it('reports malformed expressions with a position', () => {
    for (const bad of [
      '$.',
      '$[',
      '$.books[?(@.price >)]',
      "$['a",
      '$.books[?(@.x =~ /(/)]',
      '$..',
      '$.a b',
    ]) {
      expect(() => queryJsonPath(STORE, bad)).toThrow(JsonPathError);
    }
  });

  it('stops runaway queries', () => {
    expect(() => queryJsonPath(STORE, '$..*', 3)).toThrow(/Too many results/);
  });
});

describe('looksLikeJsonPath', () => {
  it('recognises path syntax but not ordinary searches', () => {
    for (const yes of ['$', '$.a', '$..a', '$[0]', ' $.a'])
      expect(looksLikeJsonPath(yes)).toBe(true);
    for (const no of ['price', '$5.00', '$$', '', 'a$.b'])
      expect(looksLikeJsonPath(no)).toBe(false);
  });
});
