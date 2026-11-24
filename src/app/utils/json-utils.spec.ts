import { looksLikeSchema } from './json-utils';

describe('looksLikeSchema', () => {
  it('recognises schemas', () => {
    expect(looksLikeSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toBe(true);
    expect(looksLikeSchema({ type: 'object', properties: {} })).toBe(true);
    expect(looksLikeSchema({ type: 'order', id: 1 })).toBe(false);
    expect(looksLikeSchema([{ type: 'object', properties: {} }])).toBe(false);
    expect(looksLikeSchema(null)).toBe(false);
  });
});
