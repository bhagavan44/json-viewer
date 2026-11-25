import { LosslessNumber, parseJson, stringifyJson } from './json-parse';
import {
  looksLikeJson,
  parseEmbedded,
  replaceAt,
  unescapeJsonText,
  unwrapAll,
} from './json-unwrap';

describe('parseEmbedded', () => {
  it('parses objects and arrays stored in strings', () => {
    expect(parseEmbedded('{"a":1}')).toEqual({ a: 1 });
    expect(parseEmbedded(' [1, 2] ')).toEqual([1, 2]);
  });

  it('parses JSON that was encoded twice', () => {
    expect(parseEmbedded(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it('leaves ordinary strings, scalars and broken JSON alone', () => {
    for (const s of ['hello', '42', 'true', '"x"', '{not json}', '[1,', '{} trailing']) {
      expect(parseEmbedded(s)).toBeUndefined();
    }
  });

  it('keeps big numbers exact', () => {
    expect(parseEmbedded('{"id":1234567890123456789}')).toEqual({
      id: new LosslessNumber('1234567890123456789'),
    });
  });
});

describe('looksLikeJson', () => {
  it('is a cheap shape check', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true);
    expect(looksLikeJson('"{\\"a\\":1}"')).toBe(true);
    expect(looksLikeJson('Order {12}.')).toBe(false);
  });
});

describe('unwrapAll', () => {
  it('unwraps at every depth, including JSON inside unwrapped JSON', () => {
    const doc = {
      id: 7,
      message: JSON.stringify({ body: JSON.stringify([{ sku: 'A' }]), note: 'plain' }),
      list: ['{"x":true}', 'text'],
    };
    const { value, count } = unwrapAll(doc);
    expect(count).toBe(3);
    expect(value).toEqual({
      id: 7,
      message: { body: [{ sku: 'A' }], note: 'plain' },
      list: [{ x: true }, 'text'],
    });
  });

  it('unwraps a document that is itself a JSON string', () => {
    expect(unwrapAll(parseJson(JSON.stringify(JSON.stringify({ a: 1 }))))).toEqual({
      value: { a: 1 },
      count: 1,
    });
  });

  it('reports nothing to do', () => {
    expect(unwrapAll({ a: 'b' }).count).toBe(0);
  });
});

describe('replaceAt', () => {
  it('replaces one value and shares the untouched branches', () => {
    const doc = { a: { b: 1 }, items: [{ body: '{"q":2}' }, { body: 'x' }], ab: 3 };
    const out: any = replaceAt(doc, '$.items[0].body', (v) => parseEmbedded(v));
    expect(out).toEqual({ a: { b: 1 }, items: [{ body: { q: 2 } }, { body: 'x' }], ab: 3 });
    expect(out.a).toBe(doc.a);
    expect(out.items[1]).toBe(doc.items[1]);
    expect(doc.items[0].body).toBe('{"q":2}'); // the input is not mutated
  });

  it('handles quoted keys', () => {
    expect(replaceAt({ 'a b': 1 }, '$["a b"]', () => 2)).toEqual({ 'a b': 2 });
  });
});

describe('unescapeJsonText', () => {
  it('unescapes JSON copied without its outer quotes', () => {
    expect(unescapeJsonText('{\\"id\\":1,\\"tags\\":[\\"a\\"]}')).toBe('{"id":1,"tags":["a"]}');
  });

  it('returns null for text that is not escaped JSON', () => {
    expect(unescapeJsonText('{"id":1}')).toBeNull();
    expect(unescapeJsonText('{\\"id\\":')).toBeNull();
    expect(stringifyJson(unescapeJsonText('plain'))).toBe('null');
  });
});
