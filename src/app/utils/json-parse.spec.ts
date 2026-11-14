import { diffJson } from './json-diff';
import { LosslessNumber, parseJson, stringifyJson } from './json-parse';
import { jsonTypeOf } from './json-utils';

describe('parseJson', () => {
  it('keeps 64-bit integers exactly', () => {
    const doc = parseJson('{"id": 1234567890123456789, "small": 42}');
    expect(doc.id).toBeInstanceOf(LosslessNumber);
    expect(String(doc.id)).toBe('1234567890123456789');
    expect(doc.small).toBe(42);
    expect(jsonTypeOf(doc.id)).toBe('number');
  });

  it('keeps long decimals exactly', () => {
    expect(String(parseJson('[0.12345678901234567890]')[0])).toBe('0.12345678901234567890');
  });

  it('leaves ordinary numbers and long strings alone', () => {
    const doc = parseJson('{"a": 1.5, "b": "12345678901234567890", "c": -7}');
    expect(doc).toEqual({ a: 1.5, b: '12345678901234567890', c: -7 });
  });

  it('round-trips exactly through JSON.stringify', () => {
    const text = '{"id":1234567890123456789,"n":[9007199254740993]}';
    expect(JSON.stringify(parseJson(text))).toBe(text);
  });

  it('still throws the native error for invalid JSON', () => {
    expect(() => parseJson('{"id": 1234567890123456789,')).toThrow();
  });
});

describe('diff with lossless numbers', () => {
  it('notices IDs that differ only in the last digits', () => {
    const a = parseJson('{"id": 9007199254740993}');
    const b = parseJson('{"id": 9007199254740992}');
    expect(diffJson(a, b).changed).toBe(1);
  });

  it('treats identical big numbers as equal', () => {
    const a = parseJson('{"id": 1234567890123456789}');
    const b = parseJson('{"id": 1234567890123456789}');
    expect(diffJson(a, b).changes).toEqual([]);
  });
});

describe('stringifyJson', () => {
  const text = '{"id":1234567890123456789,"n":[9007199254740993,1.5],"s":"1234567890123456789"}';

  it('keeps big numbers exact with JSON.rawJSON', () => {
    expect(stringifyJson(parseJson(text))).toBe(text);
  });

  it('keeps big numbers exact without JSON.rawJSON (older browsers)', () => {
    const rawJSON = (JSON as any).rawJSON;
    delete (JSON as any).rawJSON;
    try {
      expect(JSON.stringify(parseJson(text))).not.toBe(text); // the plain fallback rounds
      expect(stringifyJson(parseJson(text))).toBe(text);
      expect(stringifyJson(new LosslessNumber('12345678901234567890'))).toBe('12345678901234567890');
      expect(stringifyJson(parseJson(text), 2)).toContain('"id": 1234567890123456789');
    } finally {
      (JSON as any).rawJSON = rawJSON;
    }
  });
});
