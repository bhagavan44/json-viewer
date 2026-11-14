import { LosslessNumber, parseJson } from './json-parse';
import { MASK, describeRedaction, redact } from './json-redact';

describe('redact', () => {
  it('hides values under sensitive keys, at any depth and in any naming style', () => {
    const r = redact({
      user: 'priya',
      password: 'hunter2',
      auth: { client_secret: 'abc', 'API-Key': 42, scopes: ['read'] },
      apiToken: null,
      credentials: { user: 'x', list: ['a', 'b'] },
      pin: '1234',
      shipping: 'fast', // contains "pin" but is not a pin
    });
    expect(r.value).toEqual({
      user: 'priya',
      password: MASK,
      auth: { client_secret: MASK, 'API-Key': MASK, scopes: [MASK] },
      apiToken: null,
      credentials: { user: MASK, list: [MASK, MASK] },
      pin: MASK,
      shipping: 'fast',
    });
    expect(r.count).toBe(8);
    expect(r.kinds).toEqual(['passwords and secrets']);
  });

  it('masks emails, tokens and card numbers wherever they appear, keeping a useful hint', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
    const r = redact({
      contact: 'priya.n@example.com',
      header: 'Bearer abcdefghijk123',
      raw: jwt,
      card: '4111 1111 1111 1111',
      notACard: '4111 1111 1111 1112', // fails the Luhn check
      orderNo: '1234567890123',
      note: 'email me at priya@example.com', // only whole values are matched
    });
    expect(r.value).toEqual({
      contact: `p${MASK}@example.com`,
      header: `Bearer ${MASK}`,
      raw: MASK,
      card: `${MASK} 1111`,
      notACard: '4111 1111 1111 1112',
      orderNo: '1234567890123',
      note: 'email me at priya@example.com',
    });
    expect(r.kinds).toEqual(['email addresses', 'tokens', 'account and card numbers']);
  });

  it('treats account numbers under their keys as personal data', () => {
    expect(redact({ iban: 'DE89370400440532013000', bank: { accountNumber: 12345678 } }).value).toEqual({
      iban: MASK,
      bank: { accountNumber: MASK },
    });
  });

  it('leaves documents without sensitive data unchanged and does not modify the input', () => {
    const doc = parseJson('{"id": 1234567890123456789, "items": [{"sku": "A"}]}');
    const r = redact(doc);
    expect(r.count).toBe(0);
    expect(r.value).toEqual(doc);
    expect((r.value as any).id).toBeInstanceOf(LosslessNumber);
    const input = { password: 'x' };
    redact(input);
    expect(input.password).toBe('x');
  });

  it('describes what it hid', () => {
    expect(describeRedaction(redact({ password: 'x', email: 'a@b.co' }))).toBe('2 values (passwords and secrets, email addresses)');
  });
});
