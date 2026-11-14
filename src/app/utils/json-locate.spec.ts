import { pathAtOffset, pathSegments, spanOfPath } from './json-locate';

const TEXT = `{
  "id": 7,
  "customer": { "name": "Priya", "unit price": 1.5 },
  "items": [ { "sku": "A,]}" }, [1, 2] ],
  "esc": "say \\"hi\\""
}`;

const at = (needle: string, shift = 0) => pathAtOffset(TEXT, TEXT.indexOf(needle) + shift);

describe('pathAtOffset', () => {
  it('finds values, keys and nested items', () => {
    expect(at('7')).toBe('$.id');
    expect(at('"id"', 1)).toBe('$.id'); // on the key
    expect(at('Priya')).toBe('$.customer.name');
    expect(at('1.5')).toBe('$.customer["unit price"]');
    expect(at('"sku"')).toBe('$.items[0].sku');
    expect(at('A,]}')).toBe('$.items[0].sku'); // brackets inside a string do not confuse it
    expect(at('2] ]')).toBe('$.items[1][1]');
    expect(at('hi')).toBe('$.esc');
  });

  it('returns the container between its members, and the root outside them', () => {
    expect(at('{ "name"')).toBe('$.customer');
    expect(pathAtOffset(TEXT, 0)).toBe('$');
  });
});

describe('spanOfPath', () => {
  it('returns the exact text of the value and where its key starts', () => {
    const span = spanOfPath(TEXT, '$.customer')!;
    expect(TEXT.slice(span.start, span.end)).toBe('{ "name": "Priya", "unit price": 1.5 }');
    expect(TEXT.slice(span.keyStart, span.start)).toBe('"customer": ');
    const item = spanOfPath(TEXT, '$.items[1]')!;
    expect(TEXT.slice(item.start, item.end)).toBe('[1, 2]');
    expect(item.keyStart).toBe(item.start);
  });

  it('returns null for a path that is not in the document', () => {
    expect(spanOfPath(TEXT, '$.nope')).toBeNull();
    expect(spanOfPath(TEXT, '$.items[5]')).toBeNull();
  });

  it('works on minified text and scalars at the root', () => {
    expect(spanOfPath('[1,{"a":[true]}]', '$[1].a[0]')).toMatchObject({ start: 9, end: 13 });
    expect(spanOfPath('42', '$')).toMatchObject({ start: 0, end: 2 });
  });
});

describe('pathSegments', () => {
  it('splits a path into breadcrumb steps', () => {
    expect(pathSegments('$.orders[12]["unit price"].x')).toEqual([
      { label: '$', path: '$' },
      { label: 'orders', path: '$.orders' },
      { label: '[12]', path: '$.orders[12]' },
      { label: 'unit price', path: '$.orders[12]["unit price"]' },
      { label: 'x', path: '$.orders[12]["unit price"].x' },
    ]);
    expect(pathSegments('$')).toEqual([{ label: '$', path: '$' }]);
    expect(pathSegments('$["a\\"]b"]').map((s) => s.label)).toEqual(['$', 'a"]b']);
  });
});
