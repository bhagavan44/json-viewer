import {
  decodeBase64Json,
  decodeJwt,
  findTextFix,
  parseJsonLines,
  repairJson,
  toJsonLines,
} from './json-repair';

const repaired = (text: string) => {
  const r = repairJson(text);
  return r && JSON.parse(r.text);
};

describe('repairJson', () => {
  it('removes comments and trailing commas', () => {
    const r = repairJson('{\n  // the id\n  "id": 1, /* inline */\n  "tags": ["a", "b",],\n}');
    expect(JSON.parse(r!.text)).toEqual({ id: 1, tags: ['a', 'b'] });
    expect(r!.fixes).toEqual(['removed comments', 'removed trailing commas']);
  });

  it('quotes keys and converts single and curly quotes', () => {
    expect(repaired("{name: 'O\\'Brien', city: “Pune”, note: 'say \"hi\"'}")).toEqual({
      name: "O'Brien",
      city: 'Pune',
      note: 'say "hi"',
    });
  });

  it('replaces Python and JavaScript literals', () => {
    const r = repairJson("{'ok': True, 'missing': None, 'u': undefined, 'n': NaN, 'f': False}");
    expect(JSON.parse(r!.text)).toEqual({ ok: true, missing: null, u: null, n: null, f: false });
    expect(r!.fixes).toContain('replaced non-JSON literals');
  });

  it('adds missing commas between values and between members', () => {
    expect(repaired('[1 2 {"a": 1 "b": 2}]')).toEqual([1, 2, { a: 1, b: 2 }]);
    expect(repaired('{a: 1\n b: 2}')).toEqual({ a: 1, b: 2 });
  });

  it('fixes JSON5 numbers', () => {
    expect(repaired('[+1, .5, 5., 0x1F, -0.25, 007]')).toEqual([1, 0.5, 5, 31, -0.25, 7]);
  });

  it('removes doubled commas, a BOM and non-breaking spaces', () => {
    expect(repaired('﻿[1,,2, 3]')).toEqual([1, 2, 3]);
  });

  it('escapes raw line breaks inside strings', () => {
    expect(repaired('{"a": "line1\nline2"}')).toEqual({ a: 'line1\nline2' });
  });

  it('keeps big numbers exact', () => {
    expect(repairJson('{id: 1234567890123456789,}')!.text).toBe('{"id": 1234567890123456789}');
  });

  it('returns null for valid JSON and for text it cannot repair', () => {
    expect(repairJson('{"a": 1}')).toBeNull();
    for (const bad of [
      '{"a": ',
      '{"a": 1]',
      'hello world',
      '{"a": "unterminated}',
      '[1, 2',
      '{} {}',
    ]) {
      expect(repairJson(bad)).toBeNull();
    }
  });
});

describe('JSON Lines', () => {
  it('reads one value per line, skipping blank lines', () => {
    expect(parseJsonLines('{"a":1}\n\n{"a":2}\r\n[3]\n')).toEqual([{ a: 1 }, { a: 2 }, [3]]);
  });

  it('is not JSON Lines with one value or a bad line', () => {
    expect(parseJsonLines('{"a":1}')).toBeNull();
    expect(parseJsonLines('{"a":1}\n{oops}')).toBeNull();
  });

  it('writes an array as JSON Lines', () => {
    expect(toJsonLines([{ a: 1 }, 2])).toBe('{"a":1}\n2\n');
  });
});

describe('decodeJwt', () => {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', exp: 1700000000 })}.c2ln`;

  it('decodes header and payload and shows times as dates', () => {
    // btoa needs Latin-1, so encode the UTF-8 payload by hand.
    const utf8 = (o: unknown) =>
      btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const t = `${b64url({ alg: 'HS256' })}.${utf8({ name: 'Zoë', exp: 1700000000 })}.sig`;
    expect(decodeJwt('Bearer ' + t)).toEqual({
      header: { alg: 'HS256' },
      payload: { name: 'Zoë', exp: 1700000000 },
      signature: 'sig',
      times: { exp: '2023-11-14T22:13:20.000Z' },
    });
    expect(decodeJwt(token)!['header']).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('returns null for other dotted text', () => {
    expect(decodeJwt('a.b.c')).toBeNull();
    expect(decodeJwt('www.example.com')).toBeNull();
    expect(decodeJwt(`${b64url({ typ: 'JWT' })}.${b64url({ a: 1 })}.x`)).toBeNull(); // no "alg"
  });
});

describe('decodeBase64Json', () => {
  it('decodes Base64 and Base64URL that hold JSON', () => {
    expect(decodeBase64Json(btoa('{"a":[1,2]}'))).toBe('{"a":[1,2]}');
    expect(decodeBase64Json('eyJhIjoiPz8_In0')).toBe('{"a":"???"}'); // Base64URL uses _ where Base64 has /
  });

  it('returns null for Base64 that is not JSON, and for other text', () => {
    expect(decodeBase64Json(btoa('just some text'))).toBeNull();
    expect(decodeBase64Json('not base64!')).toBeNull();
    expect(decodeBase64Json('abc')).toBeNull();
  });
});

describe('findTextFix', () => {
  it('picks the right fix for each kind of text', () => {
    const jwt = `${btoa('{"alg":"none"}')}.${btoa('{"sub":"1"}')}.`.replace(/=/g, '');
    const cases: [string, string | null][] = [
      ['{\\"a\\":1}', 'Unescape'],
      [jwt, 'Decode JWT'],
      [btoa('{"a":1}'), 'Decode Base64'],
      ['{"a":1}\n{"a":2}', 'To array'],
      ["{a: 'x',}", 'Repair'],
      ['plain words', null],
      ['', null],
    ];
    for (const [text, button] of cases) expect(findTextFix(text)?.button ?? null).toBe(button);
  });

  it('describes a repair and returns parseable JSON', () => {
    const fix = findTextFix("{a: 'x', // note\n}")!;
    expect(fix.detail).toBe(
      'Repair: Quoted keys, replaced single quotes, removed comments, removed trailing commas.',
    ); // in the order first applied
    expect(JSON.parse(fix.text)).toEqual({ a: 'x' });
  });
});
