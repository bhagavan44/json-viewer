import { toTypeScript, toYaml } from './json-convert';
import { friendlyJsonError, locateJsonError } from './json-error';

describe('locateJsonError', () => {
  it('uses line and column when the engine reports them', () => {
    expect(locateJsonError('{}', "Expected ',' in JSON at position 5 (line 2 column 3)")).toEqual({ line: 2, column: 3 });
    expect(locateJsonError('{}', 'JSON.parse: expected property name at line 4 column 9 of the JSON data')).toEqual({ line: 4, column: 9 });
  });

  it('converts a character offset into line and column', () => {
    const text = '{\n  "a": 1,\n  oops\n}';
    const offset = text.indexOf('oops');
    expect(locateJsonError(text, `Unexpected token 'o' in JSON at position ${offset}`)).toEqual({ line: 3, column: 3 });
  });

  it('points at the end for "unexpected end" errors', () => {
    expect(locateJsonError('{\n"a": 1', 'Unexpected end of JSON input')).toEqual({ line: 2, column: 7 });
  });

  it('returns null when there is nothing to locate', () => {
    expect(locateJsonError('x', 'Something else')).toBeNull();
  });

  it('strips the location suffix from the message', () => {
    expect(friendlyJsonError("Expected ',' or '}' after property value in JSON at position 12 (line 2 column 4)")).toBe(
      "Expected ',' or '}' after property value",
    );
  });
});

describe('toYaml', () => {
  it('converts nested objects and arrays', () => {
    const yaml = toYaml({ name: 'Priya', paid: true, items: [{ sku: 'KB-114', qty: 1 }, { sku: 'MS-220', qty: 2 }], tags: [], x: null });
    expect(yaml).toBe(
      ['name: Priya', 'paid: true', 'items:', '  - sku: KB-114', '    qty: 1', '  - sku: MS-220', '    qty: 2', 'tags: []', 'x: null'].join('\n'),
    );
  });

  it('quotes strings that would be read as something else', () => {
    expect(toYaml({ a: 'true', b: '123', c: 'a: b', d: '' })).toBe('a: "true"\nb: "123"\nc: "a: b"\nd: ""');
  });
});

describe('toTypeScript', () => {
  it('declares nested interfaces and merges array items', () => {
    const ts = toTypeScript({ id: 1, items: [{ sku: 'a', note: 'x' }, { sku: 'b' }], meta: null });
    expect(ts).toContain('interface Root {');
    expect(ts).toContain('id: number;');
    expect(ts).toContain('items: RootItem[];');
    expect(ts).toContain('meta: null;');
    expect(ts).toContain('interface RootItem {');
    expect(ts).toContain('note?: string;');
  });

  it('wraps a non-object root in a type alias', () => {
    expect(toTypeScript([1, 'a'])).toBe('type Root = (number | string)[];');
  });
});
