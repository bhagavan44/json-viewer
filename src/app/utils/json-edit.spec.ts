import {
  EditError,
  addChild,
  deleteAt,
  inputTextOf,
  inputTypeOf,
  renameKey,
  setValue,
  valueFromInput,
} from './json-edit';
import { parseJson } from './json-parse';

const PRETTY = `{
  "id": 1234567890123456789,
  "name": "Priya",
  "tags": ["a", "b"],
  "lines": [
    { "sku": "A", "qty": 1 },
    { "sku": "B", "qty": 2 }
  ],
  "empty": {}
}`;

describe('setValue', () => {
  it('replaces one value and leaves every other byte alone', () => {
    const out = setValue(PRETTY, '$.name', 'Sam');
    expect(out).toBe(PRETTY.replace('"Priya"', '"Sam"'));
    expect(out).toContain('1234567890123456789'); // untouched big number
  });

  it('indents a new container to fit where it goes', () => {
    expect(setValue(PRETTY, '$.empty', { a: [1] })).toContain(
      '"empty": {\n    "a": [\n      1\n    ]\n  }\n}',
    );
  });

  it('keeps minified text on one line', () => {
    expect(setValue('{"a":{"b":1}}', '$.a', { c: [2] })).toBe('{"a":{"c":[2]}}');
  });
});

describe('renameKey', () => {
  it('renames a member, keeping its value and position', () => {
    expect(renameKey(PRETTY, '$.lines[1].sku', 'code')).toBe(
      PRETTY.replace('{ "sku": "B"', '{ "code": "B"'),
    );
    expect(renameKey('{"a\\"b":1}', '$["a\\"b"]', 'x y')).toBe('{"x y":1}');
  });

  it('refuses array items and the root', () => {
    expect(() => renameKey(PRETTY, '$.tags[0]', 'x')).toThrow(EditError);
    expect(() => renameKey(PRETTY, '$', 'x')).toThrow(EditError);
  });
});

describe('deleteAt', () => {
  it('removes a member and its comma, in pretty and minified text', () => {
    expect(deleteAt(PRETTY, '$.name')).toBe(PRETTY.replace('"name": "Priya",\n  ', ''));
    expect(deleteAt(PRETTY, '$.empty')).toBe(PRETTY.replace(',\n  "empty": {}', ''));
    expect(deleteAt('[1,2,3]', '$[1]')).toBe('[1,3]');
    expect(deleteAt('[1,2,3]', '$[2]')).toBe('[1,2]');
    expect(deleteAt('{"only":1}', '$.only')).toBe('{}');
    expect(parseJson(deleteAt(PRETTY, '$.lines[1]')).lines).toEqual([{ sku: 'A', qty: 1 }]);
  });

  it('refuses the root and missing paths', () => {
    expect(() => deleteAt(PRETTY, '$')).toThrow(EditError);
    expect(() => deleteAt(PRETTY, '$.nope')).toThrow(/Nothing at/);
  });
});

describe('addChild', () => {
  it('appends a member following the layout of the others', () => {
    expect(addChild(PRETTY, '$', 'note', 'hi')).toBe(
      PRETTY.replace('"empty": {}\n}', '"empty": {},\n  "note": "hi"\n}'),
    );
    expect(addChild(PRETTY, '$.lines', null, { sku: 'C' })).toContain(
      '{ "sku": "B", "qty": 2 },\n    {\n      "sku": "C"\n    }\n  ]',
    );
    expect(addChild(PRETTY, '$.tags', null, 'c')).toContain('"tags": ["a", "b", "c"]');
    expect(addChild(PRETTY, '$.lines[0]', 'note', null)).toContain(
      '{ "sku": "A", "qty": 1, "note": null }',
    );
  });

  it('fills empty containers', () => {
    expect(addChild(PRETTY, '$.empty', 'a', 1)).toContain('"empty": {\n    "a": 1\n  }');
    expect(addChild('{"a":[]}', '$.a', null, true)).toBe('{"a":[true]}');
  });

  it('checks the kind of parent', () => {
    expect(() => addChild(PRETTY, '$.tags', 'k', 1)).toThrow(/no key/);
    expect(() => addChild(PRETTY, '$', null, 1)).toThrow(/needs a key/);
    expect(() => addChild(PRETTY, '$.name', 'k', 1)).toThrow(/Only objects and arrays/);
  });
});

describe('edit form values', () => {
  it('reads each input type', () => {
    expect(valueFromInput('string', ' 42 ')).toBe(' 42 ');
    expect(valueFromInput('number', '-1.5e3')).toBe(-1500);
    expect(String(valueFromInput('number', '1234567890123456789'))).toBe('1234567890123456789'); // exact
    expect(valueFromInput('boolean', 'false')).toBe(false);
    expect(valueFromInput('null', 'anything')).toBeNull();
    expect(valueFromInput('json', '{"a":[1]}')).toEqual({ a: [1] });
  });

  it('explains input it cannot read', () => {
    expect(() => valueFromInput('number', '12abc')).toThrow('Not a number');
    expect(() => valueFromInput('number', '012')).toThrow('Not a number');
    expect(() => valueFromInput('boolean', 'yes')).toThrow('Type true or false');
    expect(() => valueFromInput('json', '{oops')).toThrow('Not valid JSON');
  });

  it('shows existing values for editing', () => {
    const big = parseJson('[1234567890123456789]')[0];
    expect([
      inputTypeOf('x'),
      inputTypeOf(1),
      inputTypeOf(big),
      inputTypeOf(true),
      inputTypeOf(null),
      inputTypeOf([1]),
    ]).toEqual(['string', 'number', 'number', 'boolean', 'null', 'json']);
    expect(inputTextOf(big)).toBe('1234567890123456789');
    expect(inputTextOf({ a: 1 })).toBe('{"a":1}');
    expect(inputTextOf(null)).toBe('');
  });
});
