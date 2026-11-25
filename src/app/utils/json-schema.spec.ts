import { parseJson } from './json-parse';
import { toJsonSchema } from './json-schema';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('toJsonSchema', () => {
  it('describes primitives, distinguishing integers from numbers', () => {
    expect(toJsonSchema({ a: 1, b: 1.5, c: 's', d: true, e: null })).toEqual({
      $schema: DRAFT,
      type: 'object',
      properties: {
        a: { type: 'integer' },
        b: { type: 'number' },
        c: { type: 'string' },
        d: { type: 'boolean' },
        e: { type: 'null' },
      },
      required: ['a', 'b', 'c', 'd', 'e'],
    });
  });

  it('merges array elements: optional keys, mixed types and widened numbers', () => {
    const schema: any = toJsonSchema({
      rows: [
        { id: 1, note: 'x', v: 1 },
        { id: 2, v: 2.5 },
        { id: 3, v: null },
      ],
    });
    const row = schema.properties.rows.items;
    expect(schema.properties.rows.type).toBe('array');
    expect(row.required).toEqual(['id', 'v']); // "note" is missing from some rows
    expect(row.properties.note).toEqual({ type: 'string' });
    expect(row.properties.v.type).toEqual(['number', 'null']);
  });

  it('handles empty arrays and nested arrays', () => {
    const schema: any = toJsonSchema({ none: [], grid: [[1, 2], [3]] });
    expect(schema.properties.none).toEqual({ type: 'array', items: {} });
    expect(schema.properties.grid.items).toEqual({ type: 'array', items: { type: 'integer' } });
  });

  it('detects string formats only when every sample matches', () => {
    const schema: any = toJsonSchema({
      when: '2026-10-13T08:30:00Z',
      day: '2026-10-13',
      id: '123e4567-e89b-12d3-a456-426614174000',
      mail: 'a@b.io',
      site: 'https://example.com/x',
      mixed: ['a@b.io', 'not an email'],
    });
    const p = schema.properties;
    expect([p.when.format, p.day.format, p.id.format, p.mail.format, p.site.format]).toEqual([
      'date-time',
      'date',
      'uuid',
      'email',
      'uri',
    ]);
    expect(p.mixed.items.format).toBeUndefined();
  });

  it('treats 64-bit IDs as integers and long decimals as numbers', () => {
    const schema: any = toJsonSchema(
      parseJson('{"id": 1234567890123456789, "price": 0.12345678901234567890}'),
    );
    expect(schema.properties.id.type).toBe('integer');
    expect(schema.properties.price.type).toBe('number');
  });

  it('describes a non-object root', () => {
    expect(toJsonSchema([1, 2])).toEqual({
      $schema: DRAFT,
      type: 'array',
      items: { type: 'integer' },
    });
    expect(toJsonSchema('x')).toEqual({ $schema: DRAFT, type: 'string' });
  });
});
